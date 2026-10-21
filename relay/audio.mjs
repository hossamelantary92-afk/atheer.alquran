import {relaySharjah} from './sharjah.mjs';
// Only these known stations can be proxied. No caller-supplied URL is accepted.
export const FEEDS = Object.freeze({
  cairo: 'https://stream.radiojar.com/8s5u5tpdtwzuv',
  saudi: 'https://stream.radiojar.com/0tpy1h0kxtzuv',
  sharjah: 'https://live.kwikmotion.com/smcquranlive/quranradiolive/icecast.audio'
});
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
function secureAudioURL(value, base, station) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !(station === 'sharjah' ? url.hostname === 'live.kwikmotion.com' : (url.hostname === 'radiojar.com' || url.hostname.endsWith('.radiojar.com'))) ||
      url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
    throw new Error('Unexpected upstream destination');
  }
  // Preserve the fresh routing token, but never send listeners through HTTP.
  url.protocol = 'https:'; url.port = '';
  return url.href;
}
export async function relayAudio(request, station, fetcher = fetch) {
  if (station === 'sharjah') return relaySharjah(request, fetcher);
  if (!FEEDS[station]) return new Response('Unknown station', {status: 404});
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.signal.aborted) abort();
  request.signal.addEventListener('abort', abort, {once: true});
  let reader;
  const release = () => request.signal.removeEventListener('abort', abort);
  async function openAudio() {
    let url = FEEDS[station];
    for (let hop = 0; hop < 8; hop++) {
      // A deadline for opening EACH connection only, never for the whole broadcast.
      const timer = setTimeout(abort, 20000);
      let upstream;
      try {
        upstream = await fetcher(url, {
          redirect: 'manual', signal: controller.signal,
          headers: {Accept: 'audio/mpeg, audio/aac, audio/aacp', 'Icy-MetaData': '0'},
          cache: 'no-store'
        });
      } finally { clearTimeout(timer); }
      if (REDIRECTS.has(upstream.status)) {
        const location = upstream.headers.get('location');
        await upstream.body?.cancel();
        if (!location) throw new Error('Missing redirect');
        url = secureAudioURL(location, url, station);
        continue;
      }
      const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!upstream.ok || !upstream.body || !['audio/mpeg', 'audio/aac', 'audio/aacp'].includes(type)) {
        await upstream.body?.cancel(); throw new Error('Audio source unavailable');
      }
      return upstream;
    }
    throw new Error('Too many redirects');
  }
  try {
      const upstream = await openAudio();
      const headers = {
        'Content-Type': upstream.headers.get('content-type').split(';')[0],
        'Cache-Control': 'no-store, no-cache, must-revalidate, no-transform',
        'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no'
      };
      if (request.method === 'HEAD') {
        await upstream.body.cancel(); release();
        return new Response(null, {headers});
      }
      reader = upstream.body.getReader();
      const stream = new ReadableStream({
        async pull(destination) {
          const idle = setTimeout(abort, 30000);
          try {
            const item = await reader.read();
            if (item.done) { release(); destination.close(); }
            else destination.enqueue(item.value);
          } catch (error) { release(); controller.abort(); destination.error(error); }
          finally { clearTimeout(idle); }
        },
        async cancel(reason) {
          release(); controller.abort();
          try { await reader.cancel(reason); } catch (_) {}
        }
      });
      return new Response(stream, {headers});
  } catch (_) {
    controller.abort(); release();
    return new Response('Audio source temporarily unavailable. Please retry.', {
      status: 502, headers: {'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8'}
    });
  }
}
