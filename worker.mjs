import {relayAudio} from './relay/audio.mjs';
import {diagnoseSharjah} from './relay/sharjah.mjs';
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/assets/config.js') return new Response('window.ATHIR_CONFIG={relayBase:"/api/audio"};', {
      headers: {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}
    });
    if (path === '/api/status') return Response.json({version:'7.1.2',sharjah:'aac-framed-reconnect'});
    if (path === '/api/diagnostics/sharjah') {
      if (request.method !== 'GET') return new Response('Method not allowed',{status:405});
      return diagnoseSharjah(request);
    }
    const match = /^\/api\/audio\/(cairo|saudi|sharjah)$/.exec(path);
    if (match) return relayAudio(request, match[1]);
    if (path.startsWith('/api/')) return new Response('Not found', {status: 404});
    return env.ASSETS.fetch(request);
  }
};
