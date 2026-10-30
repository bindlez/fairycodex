/**
 * FairyCodex Velocity: read-only shared Central Market edge adapter.
 * No database, accounts, secrets or mutations in Phase 1.
 * Client and upstream response shapes deliberately differ: versioned and normalized.
 */
const CATEGORIES = new Set([1,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85]);
const REGIONS = new Set(['na','eu']);
const MAX_BYTES = 1_500_000;
const DEFAULT_ORIGINS = 'https://bindlez.github.io';
const nowISO = () => new Date().toISOString();
const asPositiveInt = (v, fallback) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : fallback; };
function headers(origin, allowed) {
  const h = {'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Vary':'Origin','Cache-Control':'no-store'};
  if(origin && allowed) { h['Access-Control-Allow-Origin']=origin; h['Access-Control-Allow-Methods']='GET, HEAD, OPTIONS'; h['Access-Control-Allow-Headers']='Content-Type'; h['Access-Control-Max-Age']='600'; }
  return h;
}
function json(body,status=200,origin='',allowed=false,additional={}) {
  return new Response(JSON.stringify(body),{status,headers:{...headers(origin,allowed),...additional}});
}
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id=Number(raw.id), price=Number(raw.basePrice), stock=Number(raw.currentStock), trades=Number(raw.totalTrades);
  if(!Number.isSafeInteger(id)||id<1||typeof raw.name!=='string'||raw.name.length>180||!Number.isFinite(price)||price<0) return null;
  return {id,name:raw.name,price,stock:Number.isFinite(stock)&&stock>=0?stock:0,trades:Number.isFinite(trades)&&trades>=0?trades:0,priceChangeDirection:raw.priceChangeDirection??null,priceChangeValue:Number(raw.priceChangeValue)||0};
}
function validateRoute(url) {
  if(url.pathname==='/v1/health') return {kind:'health'};
  const match=/^\/v1\/market\/(na|eu)\/(hot|items)$/.exec(url.pathname);
  if(!match)return null;
  const [,region,kind]=match;
  let category=null;
  if(kind==='items') {
    if(!/^\d{1,2}$/.test(url.searchParams.get('category')||''))return null;
    category=Number(url.searchParams.get('category'));
    if(!CATEGORIES.has(category))return null;
  }
  const allowedParams=kind==='items'?new Set(['category']):new Set();
  if([...url.searchParams.keys()].some(k=>!allowedParams.has(k)))return null;
  return {region,kind,category};
}
function buildUpstream(route,env) {
  const base=(env.UPSTREAM_BASE||'https://api.arsha.io').replace(/\/$/,'');
  // Host locked: never allow request-controlled upstream URLs, credentials or paths.
  if(base!=='https://api.arsha.io')throw new Error('UPSTREAM_BASE must be https://api.arsha.io');
  if(!REGIONS.has(route.region))throw new Error('Unsupported region');
  return route.kind==='hot'
    ? `${base}/v2/${route.region}/hot?lang=en`
    : `${base}/v2/${route.region}/GetWorldMarketList?mainCategory=${route.category}&lang=en`;
}
function allowedOrigin(origin,env) {
  const set=new Set((env.ALLOWED_ORIGINS||DEFAULT_ORIGINS).split(',').map(s=>s.trim()).filter(Boolean));
  return !!origin && set.has(origin);
}
function cacheKey(url,mode){const key=new URL(url);key.searchParams.set('__velocity_cache',mode);return new Request(key.toString(),{method:'GET'});}
function cacheResponse(body,ttl) {return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':`public, max-age=${ttl}`}});}
async function readCache(cache,url,mode) {
  try {const x=await cache.match(cacheKey(url,mode)); if(!x)return null;const data=await x.json();return data && Array.isArray(data.items)?data:null;}catch{return null;}
}
async function loadUpstream(route,env,fetcher) {
  const url=buildUpstream(route,env);
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),4500);
  try {
    const res=await fetcher(url,{signal:ac.signal,headers:{'Accept':'application/json'}});
    if(!res.ok)throw new Error(`Upstream HTTP ${res.status}`);
    if(Number(res.headers.get('content-length'))>MAX_BYTES)throw new Error('Upstream response too large');
    const body=await res.text();
    if(body.length>MAX_BYTES)throw new Error('Upstream response too large');
    const parsed=JSON.parse(body);
    if(!Array.isArray(parsed))throw new Error('Upstream returned an unexpected payload');
    if(parsed.length>25000)throw new Error('Upstream item limit exceeded');
    const items=parsed.map(normalize).filter(Boolean);
    if(parsed.length && items.length===0)throw new Error('No valid upstream item records');
    return {apiVersion:1,source:'arsha.io',region:route.region,kind:route.kind,category:route.category,observedAt:nowISO(),items};
  } finally {clearTimeout(timer);}
}
export function createWorker({fetcher=fetch,cache}={}) {
  const pending=new Map(); // in-isolate concurrent request deduplication; not a global distributed lock
  async function refresh(key,route,env,store,freshTTL,staleTTL){
    if(pending.has(key))return pending.get(key);
    const task=(async()=>{
      const data=await loadUpstream(route,env,fetcher);
      if(store)await Promise.all([store.put(cacheKey(key,'fresh'),cacheResponse(data,freshTTL)),store.put(cacheKey(key,'stale'),cacheResponse(data,staleTTL))]);
      return data;
    })();
    pending.set(key,task);
    try{return await task}finally{if(pending.get(key)===task)pending.delete(key)}
  }
  return { async fetch(request,env={},ctx={}) {
    const url=new URL(request.url),origin=request.headers.get('Origin')||'';
    const allowed=allowedOrigin(origin,env);
    if(origin && !allowed) return json({error:'Origin not allowed'},403);
    if(request.method==='OPTIONS') return allowed ? new Response(null,{status:204,headers:headers(origin,true)}) : json({error:'Origin not allowed'},403);
    if(request.method!=='GET'&&request.method!=='HEAD') return json({error:'Method not allowed'},405,origin,allowed,{'Allow':'GET, HEAD, OPTIONS'});
    const route=validateRoute(url);
    if(!route)return json({error:'Unknown endpoint or category'},404,origin,allowed);
    if(route.kind==='health')return json({service:'fairycodex-velocity-api',version:'0.1.0',status:'ok',marketConfigured:true},200,origin,allowed);
    const store=cache??globalThis.caches?.default;
    const freshTTL=Math.min(asPositiveInt(env.FRESH_TTL_SECONDS,45),300);
    const staleTTL=Math.min(Math.max(asPositiveInt(env.STALE_TTL_SECONDS,300),freshTTL+1),3600);
    const key=`${url.origin}${url.pathname}${url.search}`;
    if(store){
      const fresh=await readCache(store,key,'fresh');
      if(fresh)return json({...fresh,cache:'HIT'},200,origin,allowed,{'X-Velocity-Cache':'HIT'});
      // Instant stale response: refresh asynchronously, never block user on a slow upstream.
      const stale=await readCache(store,key,'stale');
      if(stale){
        const background=refresh(key,route,env,store,freshTTL,staleTTL).catch(()=>{});
        if(ctx.waitUntil)ctx.waitUntil(background);
        return json({...stale,cache:'STALE',warning:'Cached snapshot; refresh requested in background'},200,origin,allowed,{'X-Velocity-Cache':'STALE'});
      }
    }
    try {
      const data=await refresh(key,route,env,store,freshTTL,staleTTL);
      return json({...data,cache:'MISS'},200,origin,allowed,{'X-Velocity-Cache':'MISS'});
    }catch(error){
      return json({error:'Market data temporarily unavailable',code:'UPSTREAM_UNAVAILABLE',source:'arsha.io'},502,origin,allowed,{'X-Velocity-Cache':'ERROR'});
    }
  }};
}
export default createWorker();