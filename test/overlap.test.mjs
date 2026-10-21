import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReconnectOverlap} from '../relay/overlap.mjs';
function frame(n){const f=new Uint8Array(39).fill(n%251);f.set([255,241,76,128,4,255,252]);f[7]=n>>8;f[8]=n&255;return f;}
const block=(from,to)=>Buffer.concat(Array.from({length:to-from},(_,i)=>frame(from+i)));
test('removes exact overlap across reconnects regardless of chunk boundaries',()=>{
 const g=new ReconnectOverlap();g.begin();assert.deepEqual(Buffer.from(g.push(block(0,40))),block(0,40));
 g.begin();const out=[];
 for(let n=20;n<60;n+=3)out.push(g.push(block(n,Math.min(60,n+3))));
 assert.deepEqual(Buffer.concat(out),block(40,60));assert.equal(g.skippedFrames,20);
});
test('preserves a new stream and repeats inside an uninterrupted stream',()=>{
 const g=new ReconnectOverlap();g.begin();g.push(block(0,40));
 assert.deepEqual(Buffer.from(g.push(block(0,40))),block(0,40));
 g.begin();assert.deepEqual(Buffer.from(g.push(block(100,140))),block(100,140));
});
test('a wholly repeated response emits no replay, next fresh response recovers',()=>{
 const g=new ReconnectOverlap();g.begin();g.push(block(0,40));g.begin();
 assert.equal(g.push(block(0,40)).length,0);assert.equal(g.finish().length,0);
 g.begin();assert.deepEqual(Buffer.from(g.push(block(30,60))),block(40,60));
});
test('insufficient evidence at EOF preserves short input and storage is bounded',()=>{
 const g=new ReconnectOverlap();g.begin();g.push(block(0,40));g.begin();
 assert.equal(g.push(block(100,103)).length,0);assert.deepEqual(Buffer.from(g.finish()),block(100,103));
 g.begin();g.push(block(200,5000));assert.ok(g.history.length<=4096);
});
test('relay passes new AAC once when the provider repeats the preceding session tail',async()=>{
 const {relaySharjah}=await import('../relay/sharjah.mjs');let calls=0;
 const response=await relaySharjah(new Request('https://example.test/api/audio/sharjah'),async()=>{
  const bytes=calls++===0?block(0,40):block(20,60);
  return new Response(bytes,{headers:{'Content-Type':'audio/aac'}});
 });
 const reader=response.body.getReader();const a=await reader.read(),b=await reader.read();
 assert.deepEqual(Buffer.concat([a.value,b.value]),block(0,60));await reader.cancel();
});
