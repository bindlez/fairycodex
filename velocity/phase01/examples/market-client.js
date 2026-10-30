/** Opt-in, browser-native adapter shared by FairyCodex and Central Market.
 * Keep existing apps unchanged until backend connectivity is confirmed.
 * Only use this from your own pages; do not blindly fallback on 4xx errors.
 */
export function createMarketClient({apiBase='',region='na',fetcher=fetch}={}) {
  if(!['na','eu'].includes(region))throw new Error('Invalid region');
  const base=String(apiBase).replace(/\/$/,'');
  if(base && !base.startsWith('https://') && !/^http:\/\/localhost(?::\d+)?$/.test(base))throw new Error('HTTPS API required');
  const cache=new Map();
  async function get(kind,category) {
    if(!['hot','items'].includes(kind))throw Error('Invalid kind');
    if(kind==='items'&&!Number.isInteger(Number(category)))throw Error('Invalid category');
    const params=kind==='items'?`?category=${encodeURIComponent(category)}`:'';
    const path=`/v1/market/${region}/${kind}${params}`;
    const key=path;
    if(cache.has(key)&&Date.now()-cache.get(key).checkedAt<30_000)return {...cache.get(key).data, clientCache:'MEMORY'};
    if(!base)throw Error('Velocity API not configured; continue using existing direct-Arsha integration');
    const controller=new AbortController();const t=setTimeout(()=>controller.abort(),6000);
    try {
      const res=await fetcher(base+path,{signal:controller.signal});
      if(!res.ok)throw Error(`Velocity API HTTP ${res.status}`);
      const data=await res.json();
      if(!Array.isArray(data.items)||!data.observedAt)throw Error('Invalid Velocity API response');
      cache.set(key,{checkedAt:Date.now(),data});return {...data,clientCache:'NETWORK'};
    } catch(e){
      if(cache.has(key))return {...cache.get(key).data,clientCache:'STALE',warning:'Could not refresh; previous data shown'};
      throw e;
    }finally{clearTimeout(t)}
  }
  return {hot:()=>get('hot'),items:(category)=>get('items',category),clear:()=>cache.clear()};
}