import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/worker.js';
const base='https://velocity.example';
const origin='https://bindlez.github.io';
const fixtures=[{id:100,name:'Test Meal',basePrice:125000,currentStock:17,totalTrades:123,priceChangeDirection:2,priceChangeValue:1000},{id:101,name:'No stock',basePrice:0,currentStock:0}];
const fakeFetch=async(url)=>{assert.match(url,/https:\/\/api\.arsha\.io\/v2\/(na|eu)\//);return new Response(JSON.stringify(fixtures),{status:200,headers:{'Content-Type':'application/json'}})};
const fakeCache=()=>{const map=new Map();return {map,async match(req){return map.get(req.url)?.clone()},async put(req,res){map.set(req.url,res.clone())}}};
const req=(p,opts={})=>new Request(base+p,{headers:{Origin:origin},...opts});
test('health: does not invoke upstream',async()=>{const w=createWorker({fetcher:()=>{throw Error('should not fetch')}});const r=await w.fetch(req('/v1/health'));assert.equal(r.status,200);assert.equal((await r.json()).status,'ok')});
test('normalizes hot and item categories from Central Market source endpoints',async()=>{const urls=[];const w=createWorker({fetcher:async(u)=>{urls.push(u);return fakeFetch(u)}});for(const p of ['/v1/market/na/hot','/v1/market/eu/items?category=35']){const r=await w.fetch(req(p));assert.equal(r.status,200);const j=await r.json();assert.equal(j.items[0].price,125000);assert.equal(j.items[0].stock,17);assert.equal(j.source,'arsha.io');assert.equal(j.cache,'MISS');assert.ok(j.observedAt)}assert.equal(urls[0],'https://api.arsha.io/v2/na/hot?lang=en');assert.equal(urls[1],'https://api.arsha.io/v2/eu/GetWorldMarketList?mainCategory=35&lang=en')});
test('second request reuses cached response without another fetch',async()=>{let n=0;const cache=fakeCache();const w=createWorker({cache,fetcher:async(u)=>{n++;return fakeFetch(u)}});const ctx={waitUntil:p=>p};let a=await w.fetch(req('/v1/market/na/items?category=25'),{},ctx);assert.equal((await a.json()).cache,'MISS');await new Promise(r=>setTimeout(r,0));let b=await w.fetch(req('/v1/market/na/items?category=25'),{},ctx);assert.equal((await b.json()).cache,'HIT');assert.equal(n,1)});
test('stale snapshot survives upstream failure; never called live',async()=>{const cache=fakeCache();const w=createWorker({cache,fetcher:fakeFetch});await w.fetch(req('/v1/market/na/hot'));const key=[...cache.map.keys()].find(x=>x.includes('fresh'));cache.map.delete(key);const bad=createWorker({cache,fetcher:async()=>{throw Error('network down')}});const response=await bad.fetch(req('/v1/market/na/hot'));assert.equal((await response.json()).cache,'STALE')});
test('network error without cache is explicit 502',async()=>{const w=createWorker({fetcher:async()=>{throw Error('offline')}});const r=await w.fetch(req('/v1/market/na/hot'));assert.equal(r.status,502);assert.equal((await r.json()).code,'UPSTREAM_UNAVAILABLE')});
test('reject invalid endpoints, origins and methods',async()=>{const w=createWorker({fetcher:fakeFetch});for(const p of ['/v1/market/na/items?category=999','/v1/market/na/items?category=35&url=https://evil.com','/v1/market/zz/hot','/v1/market/na/item/1','/v1/market/na/hot?foo=x'])assert.equal((await w.fetch(req(p))).status,404);assert.equal((await w.fetch(new Request(base+'/v1/market/na/hot',{headers:{Origin:'https://evil.example'}}))).status,403);assert.equal((await w.fetch(req('/v1/market/na/hot',{method:'POST'}))).status,405)});
test('CORS preflight allows only configured GitHub Pages host',async()=>{const w=createWorker({fetcher:fakeFetch});const r=await w.fetch(req('/v1/market/na/hot',{method:'OPTIONS'}));assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);assert.equal((await w.fetch(new Request(base+'/v1/market/na/hot',{method:'OPTIONS',headers:{Origin:'https://evil.example'}}))).status,403)});
test('invalid upstream payload never silently becomes empty market',async()=>{const w=createWorker({fetcher:async()=>new Response('{"error":"busted"}')});assert.equal((await w.fetch(req('/v1/market/na/hot'))).status,502)});
test('no CORS leakage on cached response across permitted origins',async()=>{const cache=fakeCache();const w=createWorker({cache,fetcher:fakeFetch});await w.fetch(req('/v1/market/na/hot'));const response=await w.fetch(new Request(base+'/v1/market/na/hot'));assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert.equal((await response.json()).cache,'HIT')});

test('expired fresh responds immediately using stale snapshot, refreshes in background',async()=>{
 const cache=fakeCache();const warm=createWorker({cache,fetcher:fakeFetch});await warm.fetch(req('/v1/market/na/hot'));
 cache.map.delete([...cache.map.keys()].find(x=>x.includes('__velocity_cache=fresh')));
 let release;const gate=new Promise(r=>release=r);let calls=0,background;
 const w=createWorker({cache,fetcher:async()=>{calls++;await gate;return fakeFetch('https://api.arsha.io/v2/na/hot')}});
 const start=performance.now();const response=await w.fetch(req('/v1/market/na/hot'),{}, {waitUntil:p=>background=p});
 assert.equal((await response.json()).cache,'STALE');assert.ok(performance.now()-start<300,'stale response must not wait for origin');assert.equal(calls,1);
 release();await background;const after=await w.fetch(req('/v1/market/na/hot'));assert.equal((await after.json()).cache,'HIT');
});
test('parallel cold misses coalesce upstream fetches per isolate',async()=>{
 const cache=fakeCache();let count=0;const w=createWorker({cache,fetcher:async(url)=>{count++;await new Promise(r=>setTimeout(r,12));return fakeFetch(url)}});
 const results=await Promise.all(Array.from({length:12},()=>w.fetch(req('/v1/market/na/hot'))));
 assert.ok(results.every(r=>r.status===200));assert.equal(count,1);
});