// Upload pipeline helpers: the image worker, malware scanning through ClamAV's
// clamd, and an optional content-classification webhook.
import { Worker } from 'node:worker_threads';
import { createConnection } from 'node:net';
import { HttpError } from './cosmetics.js';

// One worker, one image at a time. A file that takes too long is abandoned and
// the worker is replaced, so a hostile upload costs at most `timeoutMs` of CPU.
export function createImageProcessor({ timeoutMs = 30000 } = {}) {
  let worker = null, sequence = 0, queue = Promise.resolve();
  const pending = new Map();
  const failAll = message => { for (const [id, task] of pending) { clearTimeout(task.timer); task.reject(new HttpError(500, message)); pending.delete(id); } };
  function start() {
    worker = new Worker(new URL('./image-worker.js', import.meta.url), { resourceLimits:{ maxOldGenerationSizeMb:96, maxYoungGenerationSizeMb:16 } });
    worker.unref();
    worker.on('message', message => {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id); clearTimeout(task.timer);
      if (message.ok) task.resolve({ bytes:Buffer.from(message.bytes.buffer, message.bytes.byteOffset, message.bytes.byteLength), width:message.width, height:message.height, frames:message.frames, dropped:message.dropped, kind:message.kind });
      else task.reject(new HttpError(message.expected ? 400 : 500, message.error));
    });
    worker.on('error', () => { worker = null; failAll('The image could not be processed.'); });
    worker.on('exit', () => { worker = null; failAll('The image could not be processed.'); });
  }
  function run(kind, bytes) {
    return new Promise((resolve, reject) => {
      if (!worker) start();
      const id = ++sequence, copy = new Uint8Array(bytes);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new HttpError(422, 'This image takes too long to process. Try a smaller or shorter file.'));
        const stale = worker; worker = null; stale?.terminate();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, kind, bytes:copy }, [copy.buffer]);
    });
  }
  return {
    process(kind, bytes) { const task = queue.then(() => run(kind, bytes)); queue = task.catch(() => {}); return task; },
    close() { const stale = worker; worker = null; return stale?.terminate(); }
  };
}

// clamd's INSTREAM protocol: "zINSTREAM\0", then length-prefixed chunks, then a
// zero length. The reply is "stream: OK" or "stream: <signature> FOUND".
export function clamdScan(bytes, { path, host = '127.0.0.1', port = 3310, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = path ? createConnection({ path }) : createConnection({ host, port });
    let reply = '';
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('clamd timed out')));
    socket.on('error', reject);
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < bytes.length; i += 65536) {
        const piece = bytes.subarray(i, i + 65536), size = Buffer.alloc(4);
        size.writeUInt32BE(piece.length); socket.write(size); socket.write(piece);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', chunk => { reply += chunk.toString('latin1'); if (reply.includes('\0')) socket.end(); });
    socket.on('close', () => {
      const text = reply.replace(/\0.*$/s, '').trim();
      if (/^stream: OK$/.test(text)) return resolve({ clean:true });
      const found = /^stream: (.+) FOUND$/.exec(text);
      if (found) return resolve({ clean:false, signature:found[1].slice(0, 200) });
      reject(new Error(text ? `clamd: ${text.slice(0, 200)}` : 'clamd closed without a reply'));
    });
  });
}

// A content classifier you run yourself (or a hosted one) receives the
// sanitized image and answers {"verdict":"allow"|"review"|"block","reason":"…"}.
export async function contentScan(bytes, { url, token, type, timeoutMs = 15000 }) {
  const response = await fetch(url, { method:'POST', body:bytes, signal:AbortSignal.timeout(timeoutMs), headers:{ 'Content-Type':type, ...(token ? { Authorization:`Bearer ${token}` } : {}) } });
  if (!response.ok) throw new Error(`Content scanner answered ${response.status}`);
  const result = await response.json();
  if (!['allow', 'review', 'block'].includes(result?.verdict)) throw new Error('Content scanner gave no verdict');
  return { verdict:result.verdict, reason:typeof result.reason === 'string' ? result.reason.slice(0, 200) : '' };
}

export function createScanner(env = {}) {
  const clamd = env.CLAMD_SOCKET ? { path:env.CLAMD_SOCKET } : env.CLAMD_HOST ? { host:env.CLAMD_HOST, port:Number(env.CLAMD_PORT || 3310) } : null;
  let content = null;
  if (env.CONTENT_SCAN_URL) {
    const url = new URL(env.CONTENT_SCAN_URL);
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('CONTENT_SCAN_URL must use HTTPS unless it is on this machine.');
    content = { url:url.toString(), token:env.CONTENT_SCAN_TOKEN || '' };
  }
  if (![undefined, '', 'closed', 'review'].includes(env.SCAN_FAIL_MODE)) throw new Error('SCAN_FAIL_MODE must be closed or review.');
  const failToReview = env.SCAN_FAIL_MODE === 'review';
  return {
    enabled:{ malware:Boolean(clamd), content:Boolean(content) },
    // Returns {status:'clean'|'review'|'unscanned', reasons}; throws 422 for a
    // blocked file and 503 when a configured scanner is down (unless
    // SCAN_FAIL_MODE=review, which accepts the file but flags it for reviewers).
    async scan({ original, sanitized, type }) {
      if (!clamd && !content) return { status:'unscanned', reasons:[] };
      const reasons = [];
      const unavailable = name => {
        if (!failToReview) throw new HttpError(503, 'Image scanning is unavailable right now. Try again shortly.');
        reasons.push(`${name} unavailable`);
      };
      if (clamd) {
        let result = null;
        // The original upload is what an exploit would be, so that is what clamd sees.
        try { result = await clamdScan(original, clamd); } catch { unavailable('Malware scanner'); }
        if (result && !result.clean) { const error = new HttpError(422, 'This file was flagged as malicious and was not uploaded.'); error.signature = result.signature; throw error; }
      }
      if (content) {
        let result = null;
        try { result = await contentScan(sanitized, { ...content, type }); } catch { unavailable('Content scanner'); }
        if (result?.verdict === 'block') { const error = new HttpError(422, 'This image is not allowed on Nameflare.'); error.signature = result.reason || 'content'; throw error; }
        if (result?.verdict === 'review') reasons.push(result.reason || 'Content scanner asked for a closer look');
      }
      return { status:reasons.length ? 'review' : 'clean', reasons };
    }
  };
}
