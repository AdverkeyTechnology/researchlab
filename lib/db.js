'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
let pool, ready;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
async function connection() {
  if (!pool) {
    if (process.env.DB_TEST_MODE === 'pglite') {
      const { PGlite } = require('@electric-sql/pglite');
      const engine = new PGlite();
      pool = { query: (...args) => engine.query(...args), connect: async () => ({query: (...args) => engine.query(...args), release() {}}), end: () => engine.close() };
    } else {
      if (!process.env.DATABASE_URL) throw Object.assign(new Error('Database is not configured. Connect PostgreSQL and set DATABASE_URL.'), { status: 503 });
      const { Pool, types } = require('pg');
      types.setTypeParser(20, Number); // IDs and millisecond timestamps are within safe integer range.
      pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
    }
  }
  return pool;
}
async function initialize() {
  if (!ready) ready = (async () => {
    const p = await connection();
    const c = await p.connect();
    try {
      await c.query('BEGIN');
      if (process.env.DB_TEST_MODE !== 'pglite') await c.query('SELECT pg_advisory_xact_lock(721981)');
      const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_initial.sql'), 'utf8');
      // Execute individual statements for compatibility with both PostgreSQL and PGlite tests.
      for (const statement of sql.split(';').filter(s => s.trim())) await c.query(statement);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  })().catch(e => { ready = null; throw e; });
  return ready;
}
async function execute(sql, params) {
  await initialize();
  let index = 0;
  sql = sql.replace(/\?/g, () => '$' + (++index));
  if (/INSERT OR IGNORE/i.test(sql)) sql = sql.replace(/INSERT OR IGNORE/i, 'INSERT') + ' ON CONFLICT DO NOTHING';
  if (/INSERT OR REPLACE INTO otps/i.test(sql)) sql = sql.replace(/INSERT OR REPLACE/i, 'INSERT') + ' ON CONFLICT (email) DO UPDATE SET code_hash=EXCLUDED.code_hash, expires=EXCLUDED.expires, attempts=0';
  if (/^INSERT INTO (projects|reports|comments|api_tokens)\s/i.test(sql) && !/RETURNING/i.test(sql)) sql += ' RETURNING id';
  const c = context.getStore() || await connection();
  const result = await c.query(sql, params);
  return { rows: result.rows, changes: result.rowCount ?? result.affectedRows ?? result.rows.length, lastInsertRowid: result.rows[0]?.id };
}
const q = sql => ({
  get: async (...params) => (await execute(sql, params)).rows[0],
  all: async (...params) => (await execute(sql, params)).rows,
  run: async (...params) => execute(sql, params),
});
async function transaction(fn) {
  if (context.getStore()) return fn();
  await initialize();
  const c = await (await connection()).connect();
  try {
    await c.query('BEGIN');
    // Serialize mutations to protect single-use login tokens, attempt counters, and slug allocation.
    if (process.env.DB_TEST_MODE !== 'pglite') await c.query('SELECT pg_advisory_xact_lock(721982)');
    const result = await context.run(c, fn);
    await c.query('COMMIT');
    return result;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
const db = { prepare: q };
module.exports = { db, q, DATA_DIR, FILES_DIR, initialize, transaction, close: async () => pool && pool.end() };
