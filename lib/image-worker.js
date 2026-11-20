// Runs the image sanitizer off the main thread. One message in, one out.
import { parentPort } from 'node:worker_threads';
import { sanitizeImage, ImageError } from './images.js';

parentPort.on('message', ({ id, kind, bytes }) => {
  try {
    const result = sanitizeImage(kind, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    const out = new Uint8Array(result.bytes);
    parentPort.postMessage({ id, ok:true, bytes:out, width:result.width, height:result.height, frames:result.frames, dropped:result.dropped, kind:result.kind }, [out.buffer]);
  } catch (error) {
    parentPort.postMessage({ id, ok:false, expected:error instanceof ImageError, error:error instanceof ImageError ? error.message : 'The image could not be processed.' });
  }
});
