'use strict';
const { createClerkClient } = require('@clerk/backend');
const { normEmail, isAdminEmail } = require('./auth');
const enabled = () => !!(process.env.CLERK_PUBLISHABLE_KEY || process.env.CLERK_SECRET_KEY);
function config() {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  const origins = (process.env.CLERK_AUTHORIZED_PARTIES || process.env.BASE_URL || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!publishableKey || !secretKey || !origins.length) throw Object.assign(new Error('Clerk authentication is not fully configured.'), { status: 503 });
  return { publishableKey, secretKey, origins };
}
async function getUser(req, clientOverride) {
  const { publishableKey, secretKey, origins } = config();
  const client = clientOverride || createClerkClient({ publishableKey, secretKey });
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  const request = new Request(new URL(req.url, origins[0]), { method: req.method, headers });
  const state = await client.authenticateRequest(request, { authorizedParties: origins, acceptsToken: 'session_token' });
  if (!state.isSignedIn) return null;
  const { userId } = state.toAuth();
  if (!userId) return null;
  // Resolve identity from Clerk, never from client input or an unverified JWT email.
  const user = await client.users.getUser(userId);
  const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId && e.verification?.status === 'verified');
  if (!primary) return null;
  const email = normEmail(primary.emailAddress);
  return { email, isAdmin: isAdminEmail(email), clerkUserId: userId };
}
module.exports = { enabled, config, getUser };
