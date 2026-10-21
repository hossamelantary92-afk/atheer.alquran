// Sharjah sends an ADTS AAC stream. Only COMPLETE frames may cross a
// reconnect boundary: passing an incomplete last frame corrupts the decoder.
export class AdtsFrames {
  constructor(codec = null) { this.tail = new Uint8Array(); this.codec = codec; }
  reset() { this.tail = new Uint8Array(); } // never splice two upstream sessions
  push(chunk) {
    const bytes = new Uint8Array(this.tail.length + chunk.length);
    bytes.set(this.tail); bytes.set(chunk, this.tail.length);
    const frames = []; let offset = 0, length = 0;
    while (offset + 7 <= bytes.length) {
      if (bytes[offset] !== 255 || (bytes[offset + 1] & 246) !== 240) { offset++; continue; }
      const frequency = (bytes[offset + 2] >> 2) & 15;
      const header = bytes[offset + 1] & 1 ? 7 : 9;
      const size = ((bytes[offset + 3] & 3) << 11) | (bytes[offset + 4] << 3) | (bytes[offset + 5] >> 5);
      if (frequency > 12 || size < header) { offset++; continue; }
      if (offset + size > bytes.length) break;
      const codec = [(bytes[offset + 2] >> 6) + 1, frequency,
        ((bytes[offset + 2] & 1) << 2) | (bytes[offset + 3] >> 6)].join(':');
      if (this.codec && this.codec !== codec) throw new Error('AAC configuration changed');
      this.codec = codec;
      frames.push(bytes.subarray(offset, offset + size)); length += size; offset += size;
    }
    this.tail = bytes.slice(offset);
    const output = new Uint8Array(length); let position = 0;
    for (const frame of frames) { output.set(frame, position); position += frame.length; }
    return output;
  }
}
const URL_BASE = 'https://live.kwikmotion.com/smcquranlive/quranradiolive/icecast.audio';
export async function relaySharjah(request, fetcher = fetch, report = () => {}) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status: 405, headers: {Allow:'GET, HEAD'}});
  let reader = null, connection = null, closed = false, failures = 0, sessionBytes = 0, unframedBytes = 0;
  const frames = new AdtsFrames();
  let phase = "connect", sourceStatus = null, sourceType = null;
  const end = () => {
    if (closed) return;
    closed = true; connection?.abort();
    request.signal.removeEventListener('abort', end);
    if (reader) reader.cancel().catch(() => {});
  };
  request.signal.addEventListener('abort', end, {once:true});
  if (request.signal.aborted) end();
  async function discardConnection() {
    connection?.abort();
    if (reader) {try {await reader.cancel();} catch (_) {}}
    reader = null; frames.reset(); sessionBytes = 0; unframedBytes = 0;
  }
  async function open() {
    if (closed) throw new Error('Listener disconnected');
    phase = "connect"; sourceStatus = null; sourceType = null;
    connection = new AbortController();
    const timer = setTimeout(() => connection.abort(), 8000);
    let response;
    try {
      response = await fetcher(URL_BASE + '?athir=' + Date.now(), {
        redirect:'error', signal:connection.signal, cache:'no-store',
        headers:{Accept:'audio/aac, audio/aacp', 'Icy-MetaData':'0', 'Cache-Control':'no-cache'}
      });
    } finally {clearTimeout(timer);}
    phase = 'response'; sourceStatus = response.status;
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    sourceType = type;
    if (!response.ok || !response.body || !['audio/aac','audio/aacp'].includes(type) || response.headers.has('icy-metaint')) {
      await response.body?.cancel(); throw new Error('Unsupported AAC response');
    }
    phase = 'audio'; reader = response.body.getReader();
  }
  async function nextFrames() {
    while (!closed) {
      try {
        if (!reader) await open();
        const idle = setTimeout(() => connection.abort(), 12000);
        let item;
        try { item = await reader.read(); } finally {clearTimeout(idle);}
        if (item.done) {
          // An actual successful session may end early: keep the downstream
          // audio response alive while opening a new upstream connection.
          if (!sessionBytes) throw new Error('Empty AAC response');
          await discardConnection(); continue;
        }
        const output = frames.push(item.value);
        if (!output.length) {
          unframedBytes += item.value.length;
          // Bound invalid/no-audio input rather than forwarding arbitrary data.
          if (unframedBytes > 65536) throw new Error('No complete AAC frames');
          continue;
        }
        sessionBytes += output.length; failures = 0; unframedBytes = 0;
        return output;
      } catch (error) {
        if (!closed) report({phase, sourceStatus, sourceType,
          error: error.name || 'Error',
          message: String(error.message || error).replace(/https?:\/\/[^\s]+/g, '[source]').slice(0, 240)});
        await discardConnection();
        if (closed || ++failures >= 3) throw error;
        // Retry failures in the server, including failures of the reconnect.
        // Do not terminate a working downstream response after one bad fetch.
        await new Promise(resolve => setTimeout(resolve, failures * 500));
      }
    }
    throw new Error('Listener disconnected');
  }
  const headers = {'Content-Type':'audio/aac', 'Cache-Control':'no-store, no-transform',
    'X-Content-Type-Options':'nosniff', 'X-Accel-Buffering':'no', 'X-Athir-Relay':'sharjah-7.1'};
  try {
    // Verify actual AAC bytes, not just the provider's Content-Type header.
    const first = await nextFrames();
    if (request.method === 'HEAD') {end();return new Response(null,{headers});}
    let pending = first;
    const body = new ReadableStream({
      async pull(destination) {
        try {
          const output = pending || await nextFrames(); pending = null;
          if (closed) {destination.close();return;}
          destination.enqueue(output);
        } catch (error) {end();destination.error(error);}
      },
      cancel() {end();}
    });
    return new Response(body,{headers});
  } catch (_) {
    end(); return new Response('Sharjah audio source is temporarily unavailable.', {
      status:502,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Athir-Relay':'sharjah-7.1'}
    });
  }
}

// Test the SAME connection, MIME and AAC validation path used by playback.
// Fixed source only; no arbitrary proxy, credentials, or station replacement.
export async function diagnoseSharjah(request, fetcher = fetch) {
  const started = Date.now(); let issue = null, attempts = 0;
  const probe = new Request(request.url, {method:'HEAD', signal:request.signal});
  const result = await relaySharjah(probe, fetcher, item => {issue = item; attempts++;});
  return Response.json({version:'7.1.1', station:'sharjah',
    ok: result.ok, audioValidated: result.ok, elapsedMs:Date.now()-started,
    failedAttempts:attempts, lastFailure:issue},
    {headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
