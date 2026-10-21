const fs=require('fs'),vm=require('vm'),assert=require('assert');
let timers=[],handlers={},docEvents={},audioEvents={},plays=0;
function el(){return {classList:{toggle(){}},querySelector(){return el()},setAttribute(){},addEventListener(){},innerHTML:'',textContent:'',disabled:false,hidden:false,value:'0.8'}}
const audio={...el(),volume:0.8,currentTime:0,paused:true,readyState:4,canPlayType:()=>'maybe',pause(){this.paused=true},load(){},removeAttribute(){},play(){plays++;this.paused=false;return Promise.resolve()},addEventListener(n,f){(audioEvents[n]??=[]).push(f)},removeEventListener(n,f){audioEvents[n]=(audioEvents[n]||[]).filter(x=>x!==f)}};
let els={radio:audio};const document={hidden:false,visibilityState:'visible',baseURI:'https://example.test/',getElementById:id=>els[id]??=(el()),addEventListener(n,f){(docEvents[n]??=[]).push(f)},removeEventListener(n,f){docEvents[n]=(docEvents[n]||[]).filter(x=>x!==f)}};
let actions={};const navigator={onLine:true,userAgent:'iPhone',mediaSession:{setActionHandler(n,f){actions[n]=f}},audioSession:{}};
let context={document,navigator,URL,MediaMetadata:class{constructor(v){Object.assign(this,v)}},setTimeout(f,ms){let t={f,ms};timers.push(t);return t},clearTimeout(t){if(t)t.off=true},setInterval(){},clearInterval(){}};context.window={MediaMetadata:context.MediaMetadata,addEventListener(n,f){handlers[n]=f}};vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8'),context);
const run=s=>vm.runInContext(s,context),emit=n=>(audioEvents[n]||[]).slice().forEach(f=>f());
run('start(stations[0])');emit('playing');assert.equal(navigator.mediaSession.playbackState,'playing');assert(navigator.mediaSession.metadata.title.includes('القاهرة'));assert(!handlers.pagehide);assert.equal(navigator.audioSession.type,'playback');
document.hidden=true;document.visibilityState='hidden';docEvents.visibilitychange.forEach(f=>f());assert.equal(audio.paused,false);emit('waiting');assert(!timers.some(t=>!t.off&&t.ms===35000));
actions.pause();assert.equal(run('wanted'),false);assert.equal(audio.paused,true);actions.play();emit('playing');assert.equal(run('state'),'playing');
run('stop()');emit('error');assert.equal(run('state'),'stopped');assert.equal(run('wanted'),false);assert.deepEqual(run('stations.map(s=>s.id)').join(','),'cairo,saudi,kuwait,sharjah');
// Verify that the optional relay never replaces the direct first attempt.
context.window.ATHIR_CONFIG={relayBase:'/api/audio'};
const ctx2={...context,window:{...context.window},navigator:{...navigator}};
vm.createContext(ctx2);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8'),ctx2);
vm.runInContext('start(stations[0])',ctx2);assert.equal(audio.src,'https://stream.radiojar.com/8s5u5tpdtwzuv');
vm.runInContext("fail('failed',generation)",ctx2);
const retry=timers.filter(t=>!t.off&&t.ms===1500).at(-1);assert(retry);retry.f();
assert.equal(audio.src,'/api/audio/cairo');
vm.runInContext('start(stations[0])',ctx2);assert.equal(audio.src,'https://stream.radiojar.com/8s5u5tpdtwzuv');
console.log('PASS: background keeps audio, no hidden timeout, Media Session metadata/actions, stop cancels stale events, station filtering.');
