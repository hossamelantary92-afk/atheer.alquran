import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relayAudio} from '../relay/audio.mjs';
const request = (method='GET') => new Request('https://athir.example/api/audio/cairo',{method});
test('keeps token and upgrades redirect; streams audio without lifetime deadline',async()=>{
 const calls=[];
 const r=await relayAudio(request(),'cairo',async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'manual');
  if(calls.length===1)return new Response(null,{status:302,headers:{Location:'http://n05.radiojar.com/test?rj-tok=fresh&rj-ttl=5'}});
  return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});
 });
 assert.equal(calls[1],'https://n05.radiojar.com/test?rj-tok=fresh&rj-ttl=5');
 assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'audio/mpeg');
 assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2,3]);
});
test('forbids arbitrary stations and redirect hosts',async()=>{
 assert.equal((await relayAudio(request(),'arbitrary')).status,404);
 const r=await relayAudio(request(),'cairo',async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1/secret'}}));
 assert.equal(r.status,502);
});
test('rejects video and HTML; never relabels them audio',async()=>{
 for (const type of ['video/mp2t','text/html','application/vnd.apple.mpegurl']) {
  const r=await relayAudio(request(),'cairo',async()=>new Response('not audio',{headers:{'Content-Type':type}}));assert.equal(r.status,502);
 }
});
test('client disconnect cancels upstream and body; no buffering of full broadcast',async()=>{
 let signal,cancelled=false;
 const r=await relayAudio(request(),'saudi',async(u,o)=>{signal=o.signal;return new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array([1]))},cancel(){cancelled=true}}),{headers:{'Content-Type':'audio/mpeg'}})});
 const rd=r.body.getReader();await rd.read();await rd.cancel();assert.equal(signal.aborted,true);assert.equal(cancelled,true);
});
test('rejects POST and detects redirect loops',async()=>{
 assert.equal((await relayAudio(request('POST'),'cairo')).status,405);
 let calls=0;const r=await relayAudio(request(),'cairo',async()=>{calls++;return new Response(null,{status:302,headers:{Location:'http://n01.radiojar.com/loop'}})});
 assert.equal(r.status,502);assert.equal(calls,8);
});
test('HEAD validates upstream and returns no streaming body',async()=>{
 const r=await relayAudio(request('HEAD'),'cairo',async()=>new Response('audio',{headers:{'Content-Type':'audio/mpeg'}}));assert.equal(r.status,200);assert.equal(r.body,null);
});
test('Sharjah continues the same downstream AAC response when upstream ends',async()=>{
 let calls=0;const payload=new Uint8Array(32768).fill(7);
 const r=await relayAudio(request(),'sharjah',async(url)=>{calls++;assert.match(url,/^https:\/\/live\.kwikmotion\.com\/.*\?athir=/);return new Response(payload,{headers:{'Content-Type':'audio/aacp'}})});
 const rd=r.body.getReader();assert.equal((await rd.read()).value.byteLength,32768);
 assert.equal((await rd.read()).value.byteLength,32768);assert.equal(calls,2);await rd.cancel();
});
