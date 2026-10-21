import http from 'node:http';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {relayAudio} from './relay/audio.mjs';
const root = path.resolve(fileURLToPath(new URL('./', import.meta.url)));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const server = http.createServer(async (req,res) => {
  const aborter = new AbortController();
  res.on('close', () => aborter.abort());
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/assets/config.js') {
      res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8', 'Cache-Control':'no-store'});
      res.end('window.ATHIR_CONFIG={relayBase:"/api/audio"};'); return;
    }
    const match = /^\/api\/audio\/(cairo|saudi|sharjah)$/.exec(url.pathname);
    if (match) {
      const result = await relayAudio(new Request(url, {method:req.method,signal:aborter.signal}), match[1]);
      if (res.destroyed) {await result.body?.cancel();return;}
      res.writeHead(result.status, Object.fromEntries(result.headers));
      if (!result.body) {res.end();return;}
      res.flushHeaders();
      const stream = Readable.fromWeb(result.body);
      const close = () => stream.destroy();
      res.once('close',close);
      stream.on('error', () => res.destroy());
      stream.on('close', () => res.removeListener('close',close));
      stream.pipe(res);return;
    }
    if (url.pathname.startsWith('/api/')) {res.writeHead(404);res.end();return;}
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
    if (url.pathname !== '/' && url.pathname !== '/index.html' && !url.pathname.startsWith('/assets/')) {
      res.writeHead(404); res.end(); return;
    }
    const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!filename.startsWith(root + path.sep)) {res.writeHead(403);res.end();return;}
    const relative = path.relative(root, filename);
    if (relative !== 'index.html' && !relative.startsWith('assets' + path.sep)) {
      res.writeHead(404);res.end();return;
    }
    const body = await readFile(filename);
    res.writeHead(200, {'Content-Type':mime[path.extname(filename)] || 'application/octet-stream','Cache-Control':'no-cache'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (_) {if (!res.headersSent) res.writeHead(404); res.end();}
});
server.requestTimeout = 0;
server.listen(Number(process.env.PORT || 8787), '0.0.0.0', () => console.log('Athir ready on port ' + server.address().port));
