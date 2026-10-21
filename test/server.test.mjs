import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
test('Node serves the site, enables fallback, and keeps source files private',async()=>{
 const server=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
 try {
  const [line]=await once(server.stdout,'data');const port=/port (\d+)/.exec(String(line))[1];
  const base='http://127.0.0.1:'+port;
  assert.equal((await fetch(base)).status,200);
  assert.match(await (await fetch(base+'/assets/config.js')).text(),/relayBase:"\/api\/audio"/);
  assert.equal((await fetch(base+'/assets/app.js')).status,200);
  for(const p of ['/server.mjs','/relay/audio.mjs','/assets/%2e%2e%2fserver.mjs','/api/audio/unknown']) assert.equal((await fetch(base+p)).status,404);
 } finally {server.kill();}
});
