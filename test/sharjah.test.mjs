import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdtsFrames,relaySharjah,diagnoseSharjah} from '../relay/sharjah.mjs';
function frame(payload=32,frequency=3) {
 const size=7+payload;const b=new Uint8Array(size).fill(0x22);
 b.set([255,241,0x40|(frequency<<2),0x80|(size>>11),(size>>3)&255,((size&7)<<5)|31,252]);return b;
}
const req=()=>new Request('https://athir.example/api/audio/sharjah');
function holdBody(chunk){let sent=false;return new ReadableStream({pull(c){if(!sent){sent=true;c.enqueue(chunk)}},cancel(){}})}
test('ADTS frames remain exact across all possible chunk boundaries',()=>{
 const f=frame();for(let cut=0;cut<=f.length;cut++){
  const parser=new AdtsFrames();const a=parser.push(f.slice(0,cut)),b=parser.push(f.slice(cut));
  assert.deepEqual(Buffer.concat([a,b]),Buffer.from(f));
 }
});
test('drops an incomplete tail at EOF instead of splicing it into the next stream',()=>{
 const f=frame();const parser=new AdtsFrames();assert.equal(parser.push(f.slice(0,15)).length,0);
 parser.reset();assert.deepEqual(parser.push(f),f);
});
test('discards leading noise and refuses a codec change between sessions',()=>{
 const parser=new AdtsFrames();const f=frame();assert.deepEqual(parser.push(Buffer.concat([Buffer.from('junk'),f])),f);
 parser.reset();assert.throws(()=>parser.push(frame(32,4)),/configuration changed/);
});
test('small finite AAC responses reconnect; Content-Type is standard audio/aac',async()=>{
 let calls=0;const f=frame();
 const r=await relaySharjah(req(),async()=>{calls++;return new Response(f,{headers:{'Content-Type':'audio/aacp'}})});
 assert.equal(r.headers.get('Content-Type'),'audio/aac');
 const rd=r.body.getReader();assert.deepEqual((await rd.read()).value,f);assert.deepEqual((await rd.read()).value,f);
 assert.equal(calls,2);await rd.cancel();
});
test('retries a failed reconnect inside the SAME downstream response',async()=>{
 let calls=0;const f=frame();
 const r=await relaySharjah(req(),async()=>{
  calls++;if(calls===2)return new Response('temporary',{status:503});
  return new Response(calls===1?f:holdBody(f),{headers:{'Content-Type':'audio/aac'}});
 });
 const rd=r.body.getReader();await rd.read();assert.deepEqual((await rd.read()).value,f);assert.equal(calls,3);await rd.cancel();
});
test('recovers from truncated upstream read and omits its incomplete final frame',async()=>{
 let calls=0;const f=frame();let pulls=0;
 const r=await relaySharjah(req(),async()=>{
  calls++;return new Response(calls===1?new ReadableStream({pull(c){if(pulls++===0)c.enqueue(Buffer.concat([f,f.slice(0,12)]));else c.error(new Error('truncated'))}}):holdBody(f),{headers:{'Content-Type':'audio/aacp'}});
 });
 const rd=r.body.getReader();assert.deepEqual((await rd.read()).value,f);assert.deepEqual((await rd.read()).value,f);await rd.cancel();
});
test('does not forward bytes until AAC is validated, and cancels upstream',async()=>{
 const r=await relaySharjah(req(),async()=>new Response('bad',{headers:{'Content-Type':'text/html'}}));assert.equal(r.status,502);
 let signal;
 const good=await relaySharjah(req(),async(u,o)=>{signal=o.signal;return new Response(holdBody(frame()),{headers:{'Content-Type':'audio/aac'}})});
 await good.body.cancel();assert.equal(signal.aborted,true);
});

test('diagnosis distinguishes an upstream rejection from an AAC or network error',async()=>{
 const denied=await diagnoseSharjah(req(),async()=>new Response('denied',{status:403,headers:{'Content-Type':'text/html'}}));
 const d=await denied.json();assert.equal(d.ok,false);assert.equal(d.lastFailure.phase,'response');
 assert.equal(d.lastFailure.sourceStatus,403);assert.equal(d.failedAttempts,3);
 const network=await diagnoseSharjah(req(),async()=>{throw new TypeError('fetch failed')});
 const n=await network.json();assert.equal(n.lastFailure.phase,'connect');assert.equal(n.lastFailure.sourceStatus,null);
 const good=await diagnoseSharjah(req(),async()=>new Response(holdBody(frame()),{headers:{'Content-Type':'audio/aac'}}));
 const g=await good.json();assert.equal(g.ok,true);assert.equal(g.audioValidated,true);
});

test('uses Workers-supported manual redirects and never forwards a redirect body as audio',async()=>{
 let calls=0;
 const fetcher=async(u,options)=>{
  assert.equal(options.redirect,'manual');calls++;
  return new Response('redirect',{status:302,headers:{Location:'https://untrusted.example/audio'}});
 };
 const r=await diagnoseSharjah(req(),fetcher);const info=await r.json();
 assert.equal(info.ok,false);assert.equal(info.lastFailure.sourceStatus,302);assert.equal(calls,3);
 const ok=await relaySharjah(new Request(req(),{method:'HEAD'}),async(u,o)=>{
  assert.equal(o.redirect,'manual');return new Response(holdBody(frame()),{headers:{'Content-Type':'audio/aac'}});
 });
 assert.equal(ok.status,200);assert.equal(ok.body,null);
});
