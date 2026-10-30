import {performance} from 'node:perf_hooks';
import {createWorker} from '../src/worker.js';
const fixture=Array.from({length:100},(_,i)=>({id:i+1,name:`Item ${i}`,basePrice:i*1500,currentStock:i}));
let upstream=0;
const memory=new Map();const cache={match:async(r)=>memory.get(r.url)?.clone(),put:async(r,v)=>{memory.set(r.url,v.clone())}};
const w=createWorker({cache,fetcher:async()=>{upstream++;return new Response(JSON.stringify(fixture))}});
const req=new Request('https://velocity.local/v1/market/na/items?category=35',{headers:{Origin:'https://bindlez.github.io'}});
const times=[];for(let i=0;i<250;i++){const t=performance.now();const r=await w.fetch(req);await r.text();times.push(performance.now()-t);}
const arr=times.slice(20).sort((a,b)=>a-b),pct=x=>arr[Math.floor((arr.length-1)*x)].toFixed(3);
console.log(JSON.stringify({environment:'Node in-memory cache; NOT Cloudflare edge RTT',requests:times.length,upstreamCalls:upstream,p50_ms:pct(.5),p95_ms:pct(.95),p99_ms:pct(.99)},null,2));