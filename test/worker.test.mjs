import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
test('serves static pages through the assets binding',async()=>{
 let called=false;const r=await worker.fetch(new Request('https://athir.example/'),{ASSETS:{fetch:async()=>{called=true;return new Response('home')}}});assert.equal(called,true);assert.equal(await r.text(),'home');
});
test('unknown API paths never fall back to a successful HTML page',async()=>{
 const r=await worker.fetch(new Request('https://athir.example/api/audio/untrusted'),{});assert.equal(r.status,404);
});
test('enables the optional relay on Worker hosting without changing static defaults',async()=>{
 const r=await worker.fetch(new Request('https://athir.example/assets/config.js'),{});
 assert.equal(r.headers.get('Content-Type'),'text/javascript; charset=utf-8');
 assert.match(await r.text(),/relayBase:"\/api\/audio"/);
});
