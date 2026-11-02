'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { FILES_DIR } = require('./db');
const cloud = () => !!process.env.BLOB_READ_WRITE_TOKEN;
async function putFile(data) {
  const name = 'reports/' + crypto.randomUUID();
  if (cloud()) return (await require('@vercel/blob').put(name, data, { access: 'private', addRandomSuffix: false, contentType: 'application/octet-stream' })).pathname;
  if (process.env.VERCEL) throw Object.assign(new Error('Private file storage is not configured.'), {status:503});
  await fs.mkdir(path.join(FILES_DIR, 'reports'), {recursive:true});
  await fs.writeFile(path.join(FILES_DIR, name), data);
  return name;
}
async function readFile(name, range) {
  if (!/^reports\/[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid storage key');
  if (cloud()) {
    const result = await require('@vercel/blob').get(name, { access: 'private', useCache: false });
    if (!result || result.statusCode === 304) throw Object.assign(new Error('File not found.'), {status:404});
    const input = Readable.fromWeb(result.stream);
    if (!range) return input;
    return Readable.from((async function* () { let offset=0; for await (const part of input) { const chunk=Buffer.from(part), end=offset+chunk.length; if(end>range.start && offset<=range.end) yield chunk.subarray(Math.max(0,range.start-offset), Math.min(chunk.length,range.end-offset+1)); offset=end; if(offset>range.end) break; } })());
  }
  const { createReadStream } = require('node:fs');
  return createReadStream(path.join(FILES_DIR, name), range);
}
async function readBuffer(name) {
  const stream = await readFile(name); const chunks=[];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function deleteFile(name) {
  if (cloud()) return require('@vercel/blob').del(name);
  await fs.unlink(path.join(FILES_DIR, name)).catch(e => { if(e.code !== 'ENOENT') throw e; });
}
module.exports = { putFile, readFile, readBuffer, deleteFile };
