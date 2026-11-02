'use strict';
// Request body helpers: urlencoded, JSON, and multipart/form-data (no dependencies).

const MAX_BODY = (parseInt(process.env.MAX_UPLOAD_MB || (process.env.VERCEL ? '4' : '100'), 10)) * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error(`Upload too large (max ${MAX_BODY / 1048576} MB)`), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buf, contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw Object.assign(new Error('Missing multipart boundary'), { status: 400 });
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const fields = {}; const files = {};
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    pos += boundary.length;
    if (buf[pos] === 45 && buf[pos + 1] === 45) break; // closing --
    pos += 2; // CRLF
    const headEnd = buf.indexOf('\r\n\r\n', pos);
    if (headEnd === -1) break;
    const headers = buf.slice(pos, headEnd).toString('utf8');
    const next = buf.indexOf(boundary, headEnd + 4);
    if (next === -1) break;
    const data = buf.slice(headEnd + 4, next - 2);
    const name = (headers.match(/name="([^"]*)"/i) || [])[1];
    const filename = (headers.match(/filename="([^"]*)"/i) || [])[1];
    const ctype = (headers.match(/content-type:\s*([^\r\n]+)/i) || [])[1];
    if (name) {
      if (filename !== undefined) { if (filename) files[name] = { filename: filename.split(/[\\/]/).pop(), mime: (ctype || 'application/octet-stream').trim(), data }; }
      else if (fields[name] !== undefined) fields[name] = [].concat(fields[name], data.toString('utf8'));
      else fields[name] = data.toString('utf8');
    }
    pos = next;
  }
  return { fields, files };
}

async function parseBody(req) {
  const ct = req.headers['content-type'] || '';
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && ct.includes('application/json')) return { fields: req.body, files: {} };
  const buf = Buffer.isBuffer(req.body) ? req.body : typeof req.body === 'string' ? Buffer.from(req.body) : await readBody(req);
  if (ct.startsWith('multipart/form-data')) return parseMultipart(buf, ct);
  if (ct.includes('application/json')) {
    try { const fields=JSON.parse(buf.toString('utf8') || '{}'); if(!fields || Array.isArray(fields) || typeof fields !== 'object') throw new Error('Expected object'); return { fields, files: {} }; }
    catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
  }
  const fields = {};
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) fields[k] = fields[k] !== undefined ? [].concat(fields[k], v) : v;
  return { fields, files: {} };
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

module.exports = { parseBody, parseCookies };
