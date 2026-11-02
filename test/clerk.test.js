'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
process.env.ADMIN_EMAIL = 'owner@example.test';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64');
process.env.CLERK_SECRET_KEY = 'sk_test_not_a_real_key';
process.env.CLERK_AUTHORIZED_PARTIES = 'http://localhost:3000';
const clerk = require('../lib/clerk');
const req = { url: '/api/app/me', method: 'GET', headers: { authorization: 'Bearer example' } };
function client(email, status = 'verified') {
  return {
    authenticateRequest: async (request, options) => {
      assert.equal(request.headers.get('authorization'), 'Bearer example');
      assert.deepEqual(options.authorizedParties, ['http://localhost:3000']);
      assert.equal(options.acceptsToken, 'session_token');
      return { isSignedIn: true, toAuth: () => ({ userId: 'user_123' }) };
    },
    users: { getUser: async id => {
      assert.equal(id, 'user_123');
      return { primaryEmailAddressId: 'email_1', emailAddresses: [{ id: 'email_1', emailAddress: email, verification: { status } }] };
    } }
  };
}
test('verified primary email determines admin access; member stays non-admin', async () => {
  assert.deepEqual(await clerk.getUser(req, client('OWNER@example.test')), { email: 'owner@example.test', isAdmin: true, clerkUserId: 'user_123' });
  assert.equal((await clerk.getUser(req, client('member@example.test'))).isAdmin, false);
});
test('unverified emails and unsigned sessions cannot obtain identity', async () => {
  assert.equal(await clerk.getUser(req, client('owner@example.test', 'unverified')), null);
  assert.equal(await clerk.getUser(req, { authenticateRequest: async () => ({ isSignedIn: false }) }), null);
});
test('partial configuration fails closed', () => {
  const key = process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_SECRET_KEY;
  assert.equal(clerk.enabled(), true);
  assert.throws(() => clerk.config(), { status: 503 });
  process.env.CLERK_SECRET_KEY = key;
});
const server = http.createServer(require('../server'));
const started = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(() => new Promise(resolve => server.close(resolve)));
async function call(path, options = {}) {
  await started;
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
}
test('runtime config exposes only the publishable key', async () => {
  const response = await call('/api/app/auth-config');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
});
test('all legacy browser authentication routes are disabled', async () => {
  for (const path of ['/api/app/login/admin', '/api/app/login/email', '/api/app/login/verify', '/auth/link/old-token']) {
    const response = await call(path, { method: path.startsWith('/auth/') ? 'GET' : 'POST' });
    assert.equal(response.status, 410);
  }
});
test('old cookies cannot access projects or private raw reports in Clerk mode', async () => {
  for (const path of ['/api/app/projects', '/r/report-id/raw']) {
    const response = await call(path, { headers: { Cookie: 'rh_session=old-session' } });
    assert.equal(response.status, 401);
  }
});
test('malformed bearer token cannot access protected data', async () => {
  const response = await call('/api/app/projects', { headers: { Authorization: 'Bearer invalid.jwt.token' } });
  assert.equal(response.status, 401);
});
