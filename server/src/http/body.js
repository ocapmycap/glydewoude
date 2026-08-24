/** Read and parse a JSON request body, with a hard size cap. */

const MAX_BYTES = 64 * 1024;

export function readJsonBody(req, { maxBytes = MAX_BYTES } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      // Cap before buffering, so an oversized body cannot exhaust memory
      // just by being sent.
      if (size > maxBytes) {
        finish({ ok: false, reason: 'payload_too_large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return finish({ ok: true, value: {} });
      try {
        const value = JSON.parse(raw);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return finish({ ok: false, reason: 'malformed_body' });
        }
        return finish({ ok: true, value });
      } catch {
        return finish({ ok: false, reason: 'malformed_body' });
      }
    });

    req.on('error', () => finish({ ok: false, reason: 'malformed_body' }));
  });
}
