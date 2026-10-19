'use strict';
const stations = [
  { id: 'cairo', name: 'إذاعة القاهرة', country: 'مصر', flag: '🇪🇬', url: 'https://stream.radiojar.com/8s5u5tpdtwzuv' },
  { id: 'saudi', name: 'إذاعة السعودية', country: 'المملكة العربية السعودية', flag: '🇸🇦', url: 'https://live.kwikmotion.com/sbrksaquranradiolive/srpksaquranradio/playlist.m3u8' },
  { id: 'kuwait', name: 'إذاعة الكويت', country: 'دولة الكويت', flag: '🇰🇼', url: 'https://kwtkrdota.cdn.mangomolo.com/qrrdo/qrrdo.stream_aac/chunklist.m3u8' },
  { id: 'sharjah', name: 'إذاعة الشارقة', country: 'الإمارات العربية المتحدة', flag: '🇦🇪', url: 'https://live.kwikmotion.com/smcquranlive/quranradiolive/playlist.m3u8' }
];
const audio = document.getElementById('radio');
const grid = document.getElementById('stations');
const master = document.getElementById('master-toggle');
grid.innerHTML = stations.map(s => `<article class="card" id="card-${s.id}" aria-labelledby="title-${s.id}"><svg class="ornament" viewBox="0 0 90 114" fill="none" aria-hidden="true"><path d="M13 113V49C13 29 35 26 45 7c10 19 32 22 32 42v64M22 113V51c0-15 16-19 23-31 7 12 23 16 23 31v62" stroke="currentColor" stroke-width="1.2"/><path d="m45 40 5 9 10 5-10 5-5 10-5-10-10-5 10-5zM26 88h38M26 96h38M26 104h38" stroke="currentColor" stroke-width=".9"/></svg><div class="card-top"><span class="flag" role="img" aria-label="علم ${s.country}">${s.flag}</span><span class="tag">بث مباشر</span></div><h3 id="title-${s.id}">${s.name}</h3><p class="country">${s.country}</p><div class="card-bottom"><span class="card-status">اضغط للاستماع</span><button type="button" class="station-toggle" data-station="${s.id}" aria-label="تشغيل ${s.name}" aria-pressed="false">▶</button><span class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div></article>`).join('');
// A single media element owns all playback. Every connection has its own generation.
let current = null, state = 'idle', hls = null, generation = 0;
let wanted = false, retryCount = 0;
let loadTimer = null, retryTimer = null, stableTimer = null, watchdog = null;
let detach = () => {};
const MAX_RETRIES = 3;
const isRunning = () => wanted && ['loading', 'playing', 'reconnecting', 'offline'].includes(state);
function render(message) {
  for (const s of stations) {
    const card = document.getElementById(`card-${s.id}`);
    const selected = current === s, running = selected && isRunning();
    card.classList.toggle('active', running);
    card.classList.toggle('playing', selected && state === 'playing');
    card.classList.toggle('loading', selected && ['loading', 'reconnecting'].includes(state));
    card.classList.toggle('error', selected && state === 'error');
    card.querySelector('.tag').textContent = selected && state === 'playing' ? 'يعمل الآن' : selected && state === 'reconnecting' ? 'إعادة اتصال' : selected && state === 'loading' ? 'جارٍ الاتصال' : 'بث مباشر';
    card.querySelector('.card-status').textContent = selected ? message : 'اضغط للاستماع';
    const button = card.querySelector('button');
    button.textContent = running ? '■' : '▶';
    button.setAttribute('aria-pressed', String(running));
    button.setAttribute('aria-label', `${running ? 'إيقاف' : selected && state === 'error' ? 'إعادة محاولة تشغيل' : 'تشغيل'} ${s.name}`);
  }
  document.getElementById('player-title').textContent = current ? current.name + ' — القرآن الكريم' : 'اختر إذاعة لتبدأ';
  document.getElementById('player-status').textContent = message;
  document.getElementById('player-symbol').textContent = current ? current.flag : '۞';
  master.disabled = !current;
  master.textContent = isRunning() ? '■' : '▶';
  master.setAttribute('aria-label', isRunning() ? 'إيقاف الإذاعة' : 'تشغيل الإذاعة');
}
function clearLoadTimer() { clearTimeout(loadTimer); loadTimer = null; }
function cleanup() {
  ++generation;
  clearLoadTimer(); clearTimeout(retryTimer); clearTimeout(stableTimer); clearInterval(watchdog);
  retryTimer = stableTimer = watchdog = null;
  detach(); detach = () => {};
  audio.pause();
  if (hls) { hls.destroy(); hls = null; }
  audio.removeAttribute('src'); audio.load();
}
function stop() {
  wanted = false; retryCount = 0; cleanup(); state = 'stopped';
  render(current ? 'متوقف · اضغط للتشغيل' : 'لم يتم تشغيل أي محطة');
}
function offline() {
  if (!wanted || !current) return;
  cleanup(); state = 'offline'; render('انقطع الإنترنت · في انتظار عودة الاتصال');
}
function fail(message, token, retryable = true) {
  if (token !== generation || !wanted) return;
  if (navigator.onLine === false) { offline(); return; }
  cleanup();
  if (!retryable || retryCount >= MAX_RETRIES) {
    wanted = false; state = 'error'; render(message); return;
  }
  retryCount += 1;
  state = 'reconnecting'; render(`إعادة الاتصال… ${retryCount}/${MAX_RETRIES}`);
  const retryToken = generation, station = current;
  retryTimer = setTimeout(() => {
    if (wanted && generation === retryToken && current === station) connect(station);
  }, Math.min(1500 * 2 ** (retryCount - 1), 6000));
}
function connect(station) {
  cleanup(); current = station;
  if (navigator.onLine === false) { state = 'offline'; render('لا يوجد اتصال بالإنترنت · في انتظار الاتصال'); return; }
  state = 'loading'; render(retryCount ? `جارٍ استعادة البث… ${retryCount}/${MAX_RETRIES}` : 'جارٍ تحميل البث…');
  const token = generation, valid = () => token === generation && wanted;
  const events = [];
  const listen = (name, handler) => { audio.addEventListener(name, handler); events.push([name, handler]); };
  detach = () => events.forEach(([name, handler]) => audio.removeEventListener(name, handler));
  const armTimeout = () => {
    // Repeated waiting/stalled events must not postpone the connection deadline.
    if (loadTimer === null) loadTimer = setTimeout(() => fail('تعذّر الاتصال · اضغط للمحاولة مجددًا', token), 25000);
  };
  const play = () => {
    if (!valid()) return;
    const rejected = error => {
      if (!valid() || error.name === 'AbortError') return;
      const blocked = error.name === 'NotAllowedError';
      fail(blocked ? 'اضغط مجددًا للسماح بتشغيل الصوت' : 'تعذّر تشغيل البث · اضغط للمحاولة مجددًا', token, !blocked);
    };
    try { const promise = audio.play(); if (promise && promise.catch) promise.catch(rejected); }
    catch (error) { rejected(error); }
  };
  let lastProgress = Date.now(), lastTime = audio.currentTime || 0;
  listen('timeupdate', () => {
    if (valid() && audio.currentTime !== lastTime) { lastProgress = Date.now(); lastTime = audio.currentTime; }
  });
  listen('playing', () => {
    if (!valid()) return;
    clearLoadTimer(); state = 'playing'; lastProgress = Date.now(); render('يعمل الآن · بث مباشر');
    if (stableTimer === null) stableTimer = setTimeout(() => {
      stableTimer = null;
      if (valid() && state === 'playing') retryCount = 0;
    }, 60000);
  });
  const buffering = () => {
    if (!valid()) return;
    clearTimeout(stableTimer); stableTimer = null;
    state = 'loading'; render('جارٍ استكمال البث…'); armTimeout();
  };
  listen('waiting', buffering); listen('stalled', buffering);
  listen('error', () => fail('البث غير متاح حاليًا · اضغط للمحاولة أو اختر إذاعة أخرى', token));
  listen('ended', () => fail('انقطع البث · اضغط لإعادة المحاولة', token));
  watchdog = setInterval(() => {
    if (valid() && state === 'playing' && document.visibilityState !== 'hidden' && Date.now() - lastProgress > 30000) {
      fail('توقف البث · اضغط لإعادة المحاولة', token);
    }
  }, 5000);
  armTimeout();
  if (/\.m3u8(?:$|\?)/i.test(station.url)) {
    const nativeHls = !!audio.canPlayType('application/vnd.apple.mpegurl');
    const jsHls = !!(window.Hls && window.Hls.isSupported());
    // Safari uses its native player first; on failure try hls.js if supported.
    if (nativeHls && !(retryCount % 2 && jsHls)) {
      audio.src = station.url; play();
    } else if (jsHls) {
      hls = new window.Hls({
        enableWorker: true, lowLatencyMode: false,
        liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8,
        maxBufferLength: 30, backBufferLength: 20,
        manifestLoadingTimeOut: 15000, levelLoadingTimeOut: 15000, fragLoadingTimeOut: 20000
      });
      const instance = hls; let mediaRecoveries = 0;
      instance.on(window.Hls.Events.MEDIA_ATTACHED, () => { if (valid()) instance.loadSource(station.url); });
      instance.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (!valid()) return;
        // Use the lowest rendition when a radio feed includes an accompanying video.
        if (instance.levels && instance.levels.length) {
          let lowest = 0;
          instance.levels.forEach((level, index) => { if (level.bitrate < instance.levels[lowest].bitrate) lowest = index; });
          instance.currentLevel = lowest; instance.autoLevelCapping = lowest;
        }
        play();
      });
      instance.on(window.Hls.Events.ERROR, (_, data) => {
        if (!valid() || !data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 1) {
          instance.recoverMediaError(); return;
        }
        fail('البث غير متاح حاليًا · اضغط للمحاولة مجددًا', token);
      });
      instance.attachMedia(audio);
    } else fail('المتصفح لا يدعم هذا البث · جرّب متصفحًا أحدث', token, false);
  } else { audio.src = station.url; play(); }
}
function start(station) { wanted = true; retryCount = 0; connect(station); }
function toggle(station) { if (current === station && isRunning()) stop(); else start(station); }
for (const station of stations) document.getElementById(`card-${station.id}`).addEventListener('click', () => toggle(station));
master.addEventListener('click', () => { if (current) toggle(current); });
document.getElementById('volume').addEventListener('input', event => { audio.volume = Number(event.target.value); });
audio.volume = 0.8;
window.addEventListener('offline', offline);
window.addEventListener('online', () => {
  if (wanted && current && state === 'offline') { retryCount = 0; connect(current); }
});
window.addEventListener('pagehide', stop);
if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
  try {
    navigator.mediaSession.setActionHandler('play', () => { if (current) start(current); });
    navigator.mediaSession.setActionHandler('pause', stop);
    navigator.mediaSession.setActionHandler('stop', stop);
  } catch (_) { /* Media Session support varies by browser. */ }
}
render('لم يتم تشغيل أي محطة');
