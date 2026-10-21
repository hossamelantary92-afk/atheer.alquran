'use strict';
const stations = [
  { id: 'cairo', name: 'إذاعة القاهرة', country: 'مصر', flag: 'assets/flags/eg.svg', relay: 'cairo', url: 'https://stream.radiojar.com/8s5u5tpdtwzuv' },
  { id: 'saudi', name: 'إذاعة السعودية', country: 'المملكة العربية السعودية', flag: 'assets/flags/sa.svg', relay: 'saudi', url: 'https://stream.radiojar.com/0tpy1h0kxtzuv' },
  { id: 'kuwait', name: 'إذاعة الكويت', country: 'دولة الكويت', flag: 'assets/flags/kw.svg', url: 'https://kwtkrdota.cdn.mangomolo.com/qrrdo/qrrdo.stream_aac/chunklist.m3u8' },
  { id: 'sharjah', fresh: true, relay: 'sharjah', finiteReconnect: true, name: 'إذاعة الشارقة', country: 'الإمارات العربية المتحدة', flag: 'assets/flags/ae.svg', url: 'https://live.kwikmotion.com/smcquranlive/quranradiolive/icecast.audio' }
];
const audio = document.getElementById('radio');
const grid = document.getElementById('stations');
const master = document.getElementById('master-toggle');
grid.innerHTML = stations.map(s => `<article class="card" id="card-${s.id}" aria-labelledby="title-${s.id}"><svg class="ornament" viewBox="0 0 90 114" fill="none" aria-hidden="true"><path d="M13 113V49C13 29 35 26 45 7c10 19 32 22 32 42v64M22 113V51c0-15 16-19 23-31 7 12 23 16 23 31v62" stroke="currentColor" stroke-width="1.2"/><path d="m45 40 5 9 10 5-10 5-5 10-5-10-10-5 10-5zM26 88h38M26 96h38M26 104h38" stroke="currentColor" stroke-width=".9"/></svg><div class="card-top"><span class="flag"><img src="${s.flag}" alt="علم ${s.country}" width="32" height="24"></span><span class="tag">بث مباشر</span></div><h3 id="title-${s.id}">${s.name}</h3><p class="country">${s.country}</p><div class="card-bottom"><span class="card-status">اضغط للاستماع</span><button type="button" class="station-toggle" data-station="${s.id}" aria-label="تشغيل ${s.name}" aria-pressed="false">▶</button><span class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div></article>`).join('');
// A single media element owns all playback. Every connection has its own generation.
let current = null, state = 'idle', hls = null, generation = 0;
let wanted = false, retryCount = 0, relaySelected = false;
const relayBase = window.ATHIR_CONFIG?.relayBase || null;
let loadTimer = null, retryTimer = null, stableTimer = null, watchdog = null;
let detach = () => {};
const MAX_RETRIES = 3;
const isRunning = () => wanted && ['loading', 'playing', 'reconnecting', 'offline'].includes(state);
function syncMediaSession() {
  if (!navigator.mediaSession) return;
  try {
    if (current && window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({
      title: current.name + ' — القرآن الكريم', artist: current.country, album: 'أثير القرآن',
      artwork: [{ src: new URL('assets/artwork.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }]
    });
    navigator.mediaSession.playbackState = state === 'playing' ? 'playing' : 'paused';
  } catch (_) { /* Optional OS integration must never interrupt audio. */ }
}
function render(message) {
  syncMediaSession();
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
  document.getElementById('player-symbol').innerHTML = current ? `<img src="${current.flag}" alt="علم ${current.country}" width="32" height="24">` : '۞';
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
  // Direct audio always gets the first attempt. Use a configured relay only
  // after a genuine failure, and only for the SAME station.
  if (current?.relay && relayBase) relaySelected = true;
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
  let sourceURL = relaySelected && station.relay && relayBase
    ? relayBase.replace(/\/$/, '') + '/' + station.relay : station.url;
  // Prevent a CDN cache from replaying a finite, old Icecast response.
  if (station.fresh) {
    const freshURL = new URL(sourceURL, document.baseURI);
    freshURL.searchParams.set('athir', String(Date.now())); sourceURL = freshURL.href;
  }
  const events = [];
  const listen = (name, handler) => { audio.addEventListener(name, handler); events.push([name, handler]); };
  detach = () => events.forEach(([name, handler]) => audio.removeEventListener(name, handler));
  const armTimeout = () => {
    // Repeated waiting/stalled events must not postpone the connection deadline.
    if (document.hidden || loadTimer !== null) return;
    loadTimer = setTimeout(() => {
      loadTimer = null;
      if (!valid() || document.hidden || audio.paused) return;
      // Delayed JS events alone do not mean the audio stopped.
      if (Date.now() - lastProgress < 20000) { armTimeout(); return; }
      fail('تعذّر الاتصال · اضغط للمحاولة مجددًا', token);
    }, 35000);
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
  listen('waiting', buffering);
  // stalled describes the download, not necessarily an audible interruption.
  listen('stalled', () => { if (valid() && audio.readyState < 3) buffering(); });
  listen('pause', () => {
    if (!valid() || audio.error || state !== 'playing') return;
    wanted = false; clearLoadTimer(); clearTimeout(stableTimer);
    state = 'paused'; render('متوقف مؤقتًا · اضغط للتشغيل');
  });
  const visibility = () => {
    if (!valid()) return;
    clearLoadTimer(); lastProgress = Date.now(); lastTime = audio.currentTime || 0;
    if (!document.hidden && !audio.paused && state === 'loading') armTimeout();
  };
  document.addEventListener('visibilitychange', visibility);
  const detachAudio = detach;
  detach = () => { detachAudio(); document.removeEventListener('visibilitychange', visibility); };
  listen('error', () => fail('البث غير متاح حاليًا · اضغط للمحاولة أو اختر إذاعة أخرى', token));
  listen('ended', () => {
    if (!valid()) return;
    // Sharjah sometimes closes a finite AAC response; healthy playback followed
    // by EOF should not exhaust the recovery budget after three such responses.
    if (station.finiteReconnect && audio.currentTime >= 10) retryCount = 0;
    fail('انقطع البث · جارٍ استعادته', token);
  });
  watchdog = setInterval(() => {
    if (valid() && state === 'playing' && document.visibilityState !== 'hidden' && Date.now() - lastProgress > 30000) {
      fail('توقف البث · اضغط لإعادة المحاولة', token);
    }
  }, 5000);
  armTimeout();
  if (/\.m3u8(?:$|\?)/i.test(sourceURL)) {
    const nativeHls = !!audio.canPlayType('application/vnd.apple.mpegurl');
    const jsHls = !!(window.Hls && window.Hls.isSupported());
    // Keep native HLS on Safari on every attempt: background playback is OS managed.
    if (nativeHls) {
      audio.src = sourceURL; play();
    } else if (jsHls) {
      hls = new window.Hls({
        enableWorker: true, lowLatencyMode: false,
        liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8,
        maxBufferLength: 30, backBufferLength: 20,
        manifestLoadingTimeOut: 15000, levelLoadingTimeOut: 15000, fragLoadingTimeOut: 20000
      });
      const instance = hls; let mediaRecoveries = 0;
      instance.on(window.Hls.Events.MEDIA_ATTACHED, () => { if (valid()) instance.loadSource(sourceURL); });
      instance.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (!valid()) return;
        // Reject video feeds rather than silently loading video for radio.
        if (instance.levels.some(level => level.videoCodec || level.width || level.height)) {
          fail('تم استبعاد مصدر يحتوي على فيديو', token, false); return;
        }
        // Pin the lowest audio rendition.
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
  } else { audio.src = sourceURL; play(); }
}
function start(station) { wanted = true; retryCount = 0; relaySelected = false; connect(station); }
function toggle(station) { if (current === station && isRunning()) stop(); else start(station); }
for (const station of stations) document.getElementById(`card-${station.id}`).addEventListener('click', () => toggle(station));
master.addEventListener('click', () => { if (current) toggle(current); });
setupVolumeControls();
window.addEventListener('offline', offline);
window.addEventListener('online', () => {
  if (wanted && current && state === 'offline') { retryCount = 0; connect(current); }
});
// Never pause, unload the source, or destroy HLS on pagehide / hidden.
// Audio stays owned by the native media element when the screen locks.
if (navigator.audioSession) {
  try { navigator.audioSession.type = 'playback'; } catch (_) {}
}
if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
  const actions = {
    play: () => { if (current && !isRunning()) start(current); },
    pause: stop, stop,
    nexttrack: () => start(stations[(stations.indexOf(current) + 1) % stations.length]),
    previoustrack: () => start(stations[(stations.indexOf(current) + stations.length - 1) % stations.length])
  };
  for (const [action, handler] of Object.entries(actions)) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
  }
}
render('لم يتم تشغيل أي محطة');

// iOS reserves media volume for the device buttons. Avoid a misleading slider.
function setupVolumeControls() {
  const slider = document.getElementById('volume');
  const control = document.getElementById('volume-control');
  const note = document.getElementById('volume-note');
  const mute = document.getElementById('mute-toggle');
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let adjustable = !ios;
  if (adjustable) {
    const before = audio.volume;
    try {
      audio.volume = 0.43;
      adjustable = Math.abs(audio.volume - 0.43) < 0.01;
      audio.volume = before;
    } catch (_) { adjustable = false; }
  }
  control.hidden = !adjustable;
  note.hidden = adjustable;
  slider.disabled = !adjustable;
  let lastAudibleVolume = 0.8;
  const speaker = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>';
  const silent = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM16 9l6 6M22 9l-6 6"/></svg>';
  const sync = () => {
    const muted = audio.muted || (adjustable && audio.volume === 0);
    mute.innerHTML = muted ? silent : speaker;
    mute.setAttribute('aria-label', muted ? 'إلغاء كتم الصوت' : 'كتم الصوت');
    mute.setAttribute('title', muted ? 'إلغاء كتم الصوت' : 'كتم الصوت');
    mute.setAttribute('aria-pressed', String(!!muted));
    if (adjustable) {
      slider.value = String(audio.volume);
      slider.setAttribute('aria-valuetext', `${Math.round(audio.volume * 100)} بالمئة`);
    }
  };
  slider.addEventListener('input', () => {
    if (!adjustable) return;
    const value = Number(slider.value);
    if (!Number.isFinite(value)) return;
    audio.volume = Math.max(0, Math.min(1, value));
    if (audio.volume > 0) lastAudibleVolume = audio.volume;
    audio.muted = audio.volume === 0;
    sync();
  });
  mute.addEventListener('click', () => {
    const wasMuted = audio.muted || (adjustable && audio.volume === 0);
    audio.muted = !wasMuted;
    if (wasMuted && adjustable && audio.volume === 0) audio.volume = lastAudibleVolume;
    sync();
  });
  audio.addEventListener('volumechange', sync);
  if (adjustable) audio.volume = 0.8;
  sync();
}
