import {relayAudio} from './relay/audio.mjs';
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/assets/config.js') return new Response('window.ATHIR_CONFIG={relayBase:"/api/audio"};', {
      headers: {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}
    });
    const match = /^\/api\/audio\/(cairo|saudi|sharjah)$/.exec(path);
    if (match) return relayAudio(request, match[1]);
    if (path.startsWith('/api/')) return new Response('Not found', {status: 404});
    return env.ASSETS.fetch(request);
  }
};
