'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('./lib/auth');
const clerk = require('./lib/clerk');
const store = require('./lib/store');
const md = require('./lib/markdown');
const {
  markdownDoc
} = require('./lib/doc');
const {
  parseBody,
  parseCookies
} = require('./lib/http');
const PORT = parseInt(process.env.PORT || '3000', 10);
const APP_NAME = process.env.APP_NAME || 'Research Hub';
const COOKIE = 'rh_session';
const SECURE_COOKIE = !!process.env.VERCEL || /^https:/.test(process.env.BASE_URL || '');
const DIST = path.join(__dirname, 'web', 'dist');
if (!clerk.enabled() && !auth.ADMIN_PASSWORD) console.warn('⚠  ADMIN_PASSWORD is not set — admin password sign-in is disabled. Admins can still sign in with an email code.');
if (!fs.existsSync(path.join(DIST, 'index.html'))) console.warn('⚠  web/dist is missing — run `npm run build` to build the React app.');

// ---------------- router ----------------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '/?$');
  routes.push({
    method,
    re,
    keys,
    handler
  });
};
class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}
const need = (cond, status, msg) => {
  if (!cond) throw new HttpError(status, msg);
};
function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  return `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
function send(res, status, body, headers = {}) {
  if (res.deferred) { res.deferred.push(() => send(res, status, body, headers)); return; }
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers
  });
  res.end(body);
}
const json = (res, obj, status = 200, headers = {}) => send(res, status, JSON.stringify(obj), {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  ...headers
});
const cookie = (v, maxAge) => `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`;
const sessionCookie = async email => cookie(await auth.createSession(email, auth.isAdminEmail(email)), 30 * 86400);
const requireUser = ctx => {
  need(ctx.user, 401, 'Please sign in.');
  return ctx.user;
};
const requireAdmin = ctx => {
  requireUser(ctx);
  need(ctx.user.isAdmin, 403, 'Only admins can do that.');
  return ctx.user;
};
const loadProject = async (ctx, user = ctx.user) => {
  const p = await store.getProject(ctx.params.slug);
  need(p && (await store.canViewProject(user, p)), 404, 'This project does not exist or you do not have access.');
  return p;
};
const loadReport = async (ctx, user = ctx.user) => {
  const r = await store.getReport(ctx.params.id);
  need(r && (await store.canViewReport(user, r)), 404, 'This report does not exist or you do not have access.');
  return r;
};

// ---------------- serializers ----------------
const iso = t => t ? new Date(t).toISOString() : null;
const projectOut = (p, user) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  description: p.description,
  createdAt: iso(p.created_at),
  lastReportAt: iso(p.last_report),
  reportCount: p.report_count,
  memberCount: user.isAdmin ? p.member_count : undefined
});
const reportOut = async (ctx, r, user) => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  summary: r.summary,
  format: r.format,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  access: r.access,
  allowed: user.isAdmin && r.access === 'restricted' ? await store.reportAccessList(r.id) : undefined,
  source: r.source,
  createdAt: iso(r.created_at),
  commentCount: r.comment_count,
  url: `${baseUrl(ctx.req)}/r/${r.id}`,
  rawUrl: `/r/${r.id}/raw`
});
const commentOut = c => ({
  id: c.id,
  email: c.email,
  body: c.body,
  createdAt: iso(c.created_at)
});
const membersOut = async projectId => (await store.members(projectId)).map(m => ({
  email: m.email,
  addedAt: iso(m.added_at)
}));

// ================= session API for the React app =================
route('GET', '/api/app/auth-config', ctx => {
  if (clerk.enabled()) clerk.config();
  json(ctx.res, { publishableKey: process.env.CLERK_PUBLISHABLE_KEY || null });
});
route('GET', '/api/app/me', ctx => json(ctx.res, {
  user: ctx.user,
  appName: APP_NAME,
  emailConfigured: !!process.env.RESEND_API_KEY,
  passwordLogin: !clerk.enabled() && !!auth.ADMIN_PASSWORD,
  authProvider: clerk.enabled() ? 'clerk' : 'legacy',
  setupRequired: !process.env.DATABASE_URL && process.env.DB_TEST_MODE !== 'pglite'
}));
route('POST', '/api/app/login/email', async ctx => {
  const email = auth.normEmail(ctx.body.email);
  need(auth.isEmail(email), 400, 'Enter a valid email address.');
  need(!!process.env.RESEND_API_KEY || (!process.env.VERCEL && process.env.NODE_ENV !== 'production'), 503, 'Email sign-in is not configured. Ask the administrator for a sign-in link.');
  const known = auth.isAdminEmail(email) || !!(await store.db.prepare('SELECT 1 FROM project_members WHERE email = ? LIMIT 1').get(email));
  if (known) {
    const code = await auth.issueOtp(email);
    try {
      await auth.sendEmail(email, `Your ${APP_NAME} sign-in code: ${code}`, `Your sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't request it, ignore this email.`);
    } catch (e) {
      console.error(e.message);
      throw new HttpError(502, 'Could not send the email right now. Ask the admin for a sign-in link.');
    }
  }
  json(ctx.res, {
    ok: true
  }); // same answer either way so emails can't be probed
});
route('POST', '/api/app/login/verify', async ctx => {
  const email = auth.normEmail(ctx.body.email);
  if (!await auth.verifyOtp(email, String(ctx.body.code || '').replace(/\s/g, ''))) return json(ctx.res, {error:'That code is wrong or expired.'}, 401);
  need(auth.isAdminEmail(email) || !!await store.db.prepare('SELECT 1 FROM project_members WHERE email = ? LIMIT 1').get(email), 401, 'Access has been revoked.');
  json(ctx.res, {
    ok: true
  }, 200, {
    'Set-Cookie': await sessionCookie(email)
  });
});
route('POST', '/api/app/login/admin', async ctx => {
  const email = auth.normEmail(ctx.body.email);
  const ok = auth.ADMIN_PASSWORD && auth.isAdminEmail(email) && auth.safeEqual(ctx.body.password || '', auth.ADMIN_PASSWORD);
  need(ok, 401, 'Wrong email or password.');
  json(ctx.res, {
    ok: true
  }, 200, {
    'Set-Cookie': cookie(await auth.createSession(email, true), 30 * 86400)
  });
});
route('POST', '/api/app/logout', async ctx => {
  await auth.destroySession(ctx.cookies[COOKIE]);
  json(ctx.res, {
    ok: true
  }, 200, {
    'Set-Cookie': cookie('', 0)
  });
});
route('GET', '/auth/link/:token', async ctx => {
  const email = await auth.consumeLoginLink(ctx.params.token);
  if (!email || !(auth.isAdminEmail(email) || await store.db.prepare('SELECT 1 FROM project_members WHERE email = ? LIMIT 1').get(email))) return send(ctx.res, 303, '', {
    Location: '/login?expired=1'
  });
  send(ctx.res, 303, '', {
    Location: '/',
    'Set-Cookie': await sessionCookie(email)
  });
});

// ---- projects ----
route('GET', '/api/app/projects', async ctx => {
  const user = requireUser(ctx);
  const activity = (await store.recentActivity(user, 8)).map(c => ({
    ...commentOut(c),
    reportId: c.rid,
    reportTitle: c.report_title,
    projectName: c.project_name
  }));
  json(ctx.res, {
    projects: (await store.projectsFor(user)).map(p => projectOut(p, user)),
    activity
  });
});
async function notify(ctx, project, emails) {
  if (!emails.length || !ctx.body.notify) return;
  for (const e of emails) {
    try {
      await auth.sendEmail(e, `You've been given access to “${project.name}”`, `You now have access to the research project “${project.name}” on ${APP_NAME}.\n\nSign in at ${baseUrl(ctx.req)}/login using the email address that was granted access.`);
    } catch (err) {
      console.error('invite email failed:', err.message);
    }
  }
}
route('POST', '/api/app/projects', async ctx => {
  const user = requireAdmin(ctx);
  need(String(ctx.body.name || '').trim(), 400, 'Project name is required.');
  const p = await store.createProject(ctx.body.name, ctx.body.description, ctx.body.emails);
  await notify(ctx, p, (await store.members(p.id)).map(m => m.email));
  json(ctx.res, {
    project: projectOut(p, user)
  }, 201);
});
route('GET', '/api/app/projects/:slug', async ctx => {
  const user = requireUser(ctx);
  const p = await loadProject(ctx);
  json(ctx.res, {
    project: projectOut(p, user),
    reports: await Promise.all((await store.reportsFor(user, p.id)).map(async r => await reportOut(ctx, r, user))),
    members: user.isAdmin ? await membersOut(p.id) : []
  });
});
route('PATCH', '/api/app/projects/:slug', async ctx => {
  const user = requireAdmin(ctx);
  const p = await loadProject(ctx);
  need(String(ctx.body.name || '').trim(), 400, 'Name is required.');
  await store.updateProject(p.id, ctx.body.name, ctx.body.description);
  json(ctx.res, {
    project: projectOut(await store.getProject(p.id), user)
  });
});
route('DELETE', '/api/app/projects/:slug', async ctx => {
  requireAdmin(ctx);
  await store.deleteProject((await loadProject(ctx)).id);
  json(ctx.res, {
    ok: true
  });
});
route('POST', '/api/app/projects/:slug/members', async ctx => {
  requireAdmin(ctx);
  const p = await loadProject(ctx);
  const before = new Set((await store.members(p.id)).map(m => m.email));
  const list = await store.addMembers(p.id, ctx.body.emails);
  need(list.length, 400, 'No valid email addresses found.');
  const added = list.filter(e => !before.has(e));
  await notify(ctx, p, added);
  json(ctx.res, {
    added,
    members: await membersOut(p.id),
    emailed: !!(ctx.body.notify && process.env.RESEND_API_KEY)
  });
});
route('DELETE', '/api/app/projects/:slug/members/:email', async ctx => {
  requireAdmin(ctx);
  const p = await loadProject(ctx);
  await store.removeMember(p.id, ctx.params.email);
  json(ctx.res, {
    members: await membersOut(p.id)
  });
});
route('POST', '/api/app/projects/:slug/members/:email/link', async ctx => {
  requireAdmin(ctx);
  const p = await loadProject(ctx);
  const email = auth.normEmail(ctx.params.email);
  need(await store.isMember(p.id, email), 404, 'Not a member of this project.');
  json(ctx.res, {
    email,
    url: clerk.enabled() ? `${baseUrl(ctx.req)}/login` : `${baseUrl(ctx.req)}/auth/link/${await auth.issueLoginLink(email)}`,
    expiresInHours: clerk.enabled() ? null : 72
  });
});
async function reportFromInput(fields, files, projectId, email) {
  if (fields.uploadId) {
    const pending = await store.db.prepare('SELECT * FROM pending_uploads WHERE id = ? AND project_id = ? AND email = ?').get(String(fields.uploadId),projectId,email);
    need(pending && Number(pending.expires) > Date.now(),400,'Upload session expired. Upload again.');
    const blob = await require('@vercel/blob').head(pending.pathname);
    need(blob.pathname === pending.pathname && blob.size <= 100*1024*1024,400,'Invalid uploaded file.');
    await store.db.prepare('DELETE FROM pending_uploads WHERE id = ?').run(pending.id);
    return {filename:pending.filename,mime:blob.contentType,title:String(fields.title || '').trim() || pending.filename.replace(/\.[^.]+$/,''),storedFile:{pathname:pending.pathname,size:blob.size}};
  }
  if (files.file && files.file.data.length) {
    const f = files.file;
    const fromHeading = /\.(md|markdown)$/i.test(f.filename) ? md.firstHeading(f.data.toString('utf8')) : '';
    return {
      filename: f.filename,
      mime: f.mime,
      data: f.data,
      title: String(fields.title || '').trim() || fromHeading || f.filename.replace(/\.[^.]+$/, '')
    };
  }
  const content = String(fields.content || '');
  need(content.trim(), 400, 'Attach a file or provide content.');
  let fmt = String(fields.format || '').toLowerCase();
  if (!['markdown', 'html', 'text'].includes(fmt)) fmt = /^\s*(<!doctype html|<html)/i.test(content) ? 'html' : 'markdown';
  const ext = {
    markdown: 'md',
    html: 'html',
    text: 'txt'
  }[fmt];
  const htmlTitle = fmt === 'html' ? (content.match(/<title>([^<]+)<\/title>/i) || content.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1] || '' : '';
  const title = String(fields.title || '').trim() || (fmt === 'markdown' ? md.firstHeading(content) : htmlTitle.trim()) || 'Untitled research';
  const filename = `${title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'report'}.${ext}`;
  return {
    filename,
    mime: {
      md: 'text/markdown',
      html: 'text/html',
      txt: 'text/plain'
    }[ext],
    data: Buffer.from(content, 'utf8'),
    title
  };
}
route('POST', '/api/app/projects/:slug/reports', async ctx => {
  const user = requireAdmin(ctx);
  const p = await loadProject(ctx);
  const r = await store.createReport({
    projectId: p.id,
    ...await reportFromInput(ctx.body, ctx.files, p.id, user.email),
    summary: ctx.body.summary,
    source: ctx.files.file ? 'upload' : 'paste',
    createdBy: user.email,
    allowedEmails: ctx.body.access === 'restricted' ? ctx.body.allowed : []
  });
  json(ctx.res, {
    report: await reportOut(ctx, r, user),
    warning: ctx.body.access === 'restricted' && r.access !== 'restricted' ? 'No members were selected, so it is visible to the whole project.' : undefined
  }, 201);
});

// Direct-to-private-Blob upload: tokens are scoped to a server-generated path.
const startUpload = async ctx => {
  const user=requireAdmin(ctx), project=await loadProject(ctx);
  if(!process.env.BLOB_READ_WRITE_TOKEN) return json(ctx.res,{direct:false});
  const filename=String(ctx.body.filename || 'report').split(/[\\/]/).pop().slice(0,255);
  const id=require('node:crypto').randomUUID(), pathname='reports/'+id;
  await store.db.prepare('INSERT INTO pending_uploads (id,project_id,pathname,email,filename,expires) VALUES (?,?,?,?,?,?)').run(id,project.id,pathname,user.email,filename,Date.now()+3600000);
  json(ctx.res,{direct:true,id,pathname});
};
const handleBlobUpload = async ctx=>{
  const user=requireAdmin(ctx);
  const result=await require('@vercel/blob/client').handleUpload({request:ctx.req,body:ctx.body,onBeforeGenerateToken:async pathname=>{
    const p=await store.db.prepare('SELECT * FROM pending_uploads WHERE pathname = ? AND email = ?').get(pathname,user.email);
    need(p && Number(p.expires)>Date.now(),403,'Invalid upload session.');
    return {maximumSizeInBytes:100*1024*1024,addRandomSuffix:false,allowOverwrite:false,validUntil:Number(p.expires)};
  }});
  json(ctx.res,result);
};
route('POST','/api/app/projects/:slug/uploads',startUpload);
route('POST','/api/app/blob/upload',handleBlobUpload);
route('POST','/api/v1/projects/:slug/uploads',startUpload);
route('POST','/api/v1/blob/upload',handleBlobUpload);

// ---- reports ----
route('GET', '/api/app/reports/:id', async ctx => {
  const user = requireUser(ctx);
  const r = await loadReport(ctx);
  const p = await store.getProject(r.project_id);
  json(ctx.res, {
    report: await reportOut(ctx, r, user),
    project: projectOut(p, user),
    comments: (await store.comments(r.id)).map(commentOut),
    members: user.isAdmin ? await membersOut(p.id) : []
  });
});
route('PATCH', '/api/app/reports/:id', async ctx => {
  const user = requireAdmin(ctx);
  const r = await loadReport(ctx);
  await store.updateReport(r.id, String(ctx.body.title || '').trim() || r.title, ctx.body.summary ?? r.summary);
  json(ctx.res, {
    report: await reportOut(ctx, await store.getReport(r.id), user)
  });
});
route('PUT', '/api/app/reports/:id/access', async ctx => {
  const user = requireAdmin(ctx);
  const r = await loadReport(ctx);
  await store.setReportAccess(r.id, ctx.body.access, ctx.body.allowed);
  json(ctx.res, {
    report: await reportOut(ctx, await store.getReport(r.id), user)
  });
});
route('DELETE', '/api/app/reports/:id', async ctx => {
  requireAdmin(ctx);
  const r = await loadReport(ctx);
  await store.deleteReport(r.id);
  json(ctx.res, {
    ok: true,
    projectSlug: (await store.getProject(r.project_id)).slug
  });
});
route('GET', '/api/app/reports/:id/comments', async ctx => {
  requireUser(ctx);
  json(ctx.res, {
    comments: (await store.comments((await loadReport(ctx)).id)).map(commentOut)
  });
});
route('POST', '/api/app/reports/:id/comments', async ctx => {
  const user = requireUser(ctx);
  const r = await loadReport(ctx);
  need(String(ctx.body.body || '').trim(), 400, 'Comment is empty.');
  await store.addComment(r.id, user.email, ctx.body.body);
  json(ctx.res, {
    comments: (await store.comments(r.id)).map(commentOut)
  }, 201);
});
route('DELETE', '/api/app/reports/:id/comments/:cid', async ctx => {
  const user = requireUser(ctx);
  const r = await loadReport(ctx);
  const c = await store.getComment(ctx.params.cid);
  need(c && c.report_id === r.id, 404, 'Comment not found.');
  need(user.isAdmin || c.email === user.email, 403, 'You can only delete your own comments.');
  await store.deleteComment(c.id);
  json(ctx.res, {
    comments: (await store.comments(r.id)).map(commentOut)
  });
});

// ---- API tokens (admin) ----
const tokensOut = async () => (await store.db.prepare('SELECT id, name, prefix, created_at, last_used FROM api_tokens ORDER BY created_at DESC').all()).map(t => ({
  id: t.id,
  name: t.name,
  prefix: t.prefix,
  createdAt: iso(t.created_at),
  lastUsed: iso(t.last_used)
}));
route('GET', '/api/app/tokens', async ctx => {
  requireAdmin(ctx);
  json(ctx.res, {
    tokens: await tokensOut(),
    baseUrl: baseUrl(ctx.req)
  });
});
route('POST', '/api/app/tokens', async ctx => {
  requireAdmin(ctx);
  const token = await auth.createApiToken(String(ctx.body.name || 'token').trim().slice(0, 80) || 'token');
  json(ctx.res, {
    token,
    tokens: await tokensOut()
  }, 201);
});
route('DELETE', '/api/app/tokens/:id', async ctx => {
  requireAdmin(ctx);
  await store.db.prepare('DELETE FROM api_tokens WHERE id = ?').run(+ctx.params.id);
  json(ctx.res, {
    tokens: await tokensOut()
  });
});

// ================= raw file serving (used by the viewer iframe) =================
route('GET', '/r/:id/raw', async ctx => {
  if (!ctx.user) return send(ctx.res, 401, 'Sign in required', {
    'Content-Type': 'text/plain'
  });
  await serveRaw(ctx, await loadReport(ctx));
});
async function serveRaw(ctx, r) {
  const {
    req,
    res
  } = ctx;
  const {
    readFile,
    readBuffer
  } = require('./lib/files');
  const base = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer'
  };
  const disp = type => `${type}; filename*=UTF-8''${encodeURIComponent(r.filename)}`;
  if (ctx.query.get('download') === '1') {
    const stream=await readFile(r.storage_name);
    res.writeHead(200,{...base,'Content-Type':'application/octet-stream','Content-Disposition':disp('attachment')});
    return require('node:stream/promises').pipeline(stream,res);
  }
  // User-supplied active content runs in an opaque-origin sandbox: it cannot read cookies or call the app as the viewer.
  const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals; frame-ancestors 'self'";
  if (r.format === 'markdown') {
    return send(res, 200, markdownDoc(r.title, md.render((await readBuffer(r.storage_name)).toString('utf8'))), {
      ...base,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src * data:; style-src 'unsafe-inline'; frame-ancestors 'self'"
    });
  }
  if (r.format === 'html') return send(res, 200, await readBuffer(r.storage_name), {
    ...base,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': SANDBOX
  });
  if (r.format === 'text') return send(res, 200, await readBuffer(r.storage_name), {
    ...base,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Security-Policy': SANDBOX
  });
  const inline = ['pdf', 'image', 'video', 'audio'].includes(r.format);
  const headers = {
    ...base,
    'Content-Type': r.mime,
    'Content-Disposition': disp(inline ? 'inline' : 'attachment'),
    'Accept-Ranges': 'bytes'
  };
  if (r.mime === 'image/svg+xml') headers['Content-Security-Policy'] = SANDBOX;
  const total = Number(r.size);
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? +range[1] : Math.max(0, total - +range[2]);
    const end = range[1] && range[2] ? Math.min(+range[2], total - 1) : total - 1;
    if (start >= total || start > end) return send(res, 416, '', {
      'Content-Range': `bytes */${total}`
    });
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': end - start + 1
    });
    return require('node:stream/promises').pipeline(await readFile(r.storage_name, {start,end}),res);
  }
  res.writeHead(200, {
    ...headers,
    'Content-Length': total
  });
  return require('node:stream/promises').pipeline(await readFile(r.storage_name),res);
}

// ================= public token API (for LLMs / scripts) =================
const API_ADMIN = {
  email: 'api',
  isAdmin: true
};
const apiNeedProject = async ref => {
  const p = ref && (await store.getProject(ref));
  if (!p) throw new HttpError(404, `Project “${ref || ''}” not found. Available: ${(await store.projectsFor(API_ADMIN)).map(x => x.slug).join(', ') || '(none)'}`);
  return p;
};
const apiProject = async p => ({
  ...projectOut(p, API_ADMIN),
  members: (await store.members(p.id)).map(m => m.email)
});
route('GET', '/api/v1/projects', async ctx => json(ctx.res, {
  projects: await Promise.all((await store.projectsFor(API_ADMIN)).map(apiProject))
}));
route('POST', '/api/v1/projects', async ctx => {
  need(String(ctx.body.name || '').trim(), 400, '`name` is required.');
  json(ctx.res, {
    project: await apiProject(await store.createProject(ctx.body.name, ctx.body.description, ctx.body.members || ctx.body.emails))
  }, 201);
});
route('GET', '/api/v1/projects/:slug/reports', async ctx => json(ctx.res, {
  reports: await Promise.all((await store.reportsFor(API_ADMIN, (await apiNeedProject(ctx.params.slug)).id)).map(async r => await reportOut(ctx, r, API_ADMIN)))
}));
route('POST', '/api/v1/reports', async ctx => {
  const p = await apiNeedProject(ctx.body.project || ctx.body.project_slug);
  const r = await store.createReport({
    projectId: p.id,
    ...await reportFromInput(ctx.body, ctx.files, p.id, 'api'),
    summary: ctx.body.summary,
    source: 'api',
    createdBy: 'api',
    allowedEmails: ctx.body.allowed || ctx.body.allowed_emails
  });
  json(ctx.res, {
    report: await reportOut(ctx, r, API_ADMIN),
    url: `${baseUrl(ctx.req)}/r/${r.id}`
  }, 201);
});
route('GET', '/api/v1/reports/:id/comments', async ctx => {
  const r = await store.getReport(ctx.params.id);
  need(r, 404, 'Report not found.');
  json(ctx.res, {
    report: await reportOut(ctx, r, API_ADMIN),
    comments: (await store.comments(r.id)).map(commentOut)
  });
});
route('GET', '/push.sh', ctx => send(ctx.res, 200, fs.readFileSync(path.join(__dirname, 'push.sh')), {
  'Content-Type': 'text/x-shellscript; charset=utf-8'
}));
route('GET','/healthz',async ctx=>{await require('./lib/db').initialize(); json(ctx.res,{ok:true});});

// ================= static React app =================
const STATIC_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; frame-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'none'; object-src 'none'";
function clerkCsp() {
  const { publishableKey } = clerk.config();
  const host = Buffer.from(publishableKey.replace(/^pk_(test|live)_/, ''), 'base64').toString().replace(/\$$/, '');
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error('Invalid Clerk publishable key');
  const origin = `https://${host}`;
  return `default-src 'self'; script-src 'self' ${origin} https://challenges.cloudflare.com; connect-src 'self' ${origin} https://clerk-telemetry.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://img.clerk.com; worker-src 'self' blob:; media-src 'self'; frame-src 'self' ${origin} https://challenges.cloudflare.com; frame-ancestors 'self'; form-action 'self'; base-uri 'none'; object-src 'none'`;
}
function serveStatic(req, res, pathname) {
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = path.join(DIST, rel);
  const isAsset = rel && fs.existsSync(file) && fs.statSync(file).isFile() && file.startsWith(DIST + path.sep);
  if (!isAsset) {
    if (path.extname(rel)) return send(res, 404, 'Not found', {
      'Content-Type': 'text/plain'
    });
    file = path.join(DIST, 'index.html'); // SPA fallback: client-side routes
    if (!fs.existsSync(file)) return send(res, 503, 'The web app has not been built. Run `npm run build`.', {
      'Content-Type': 'text/plain'
    });
  }
  const hashed = /\/assets\/.+-[A-Z0-9]{8}\./i.test(file);
  send(res, 200, fs.readFileSync(file), {
    'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Security-Policy': clerk.enabled() ? clerkCsp() : APP_CSP
  });
}

// ================= server =================
async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let cookies = {}; try { cookies = parseCookies(req); } catch {}
  const ctx = {
    req,
    res,
    path: p,
    query: url.searchParams,
    cookies,
    user: null,
    body: {},
    files: {},
    params: {}
  };
  try {
    if (clerk.enabled()) {
      need(!p.startsWith('/api/app/login/') && !p.startsWith('/auth/link/'), 410, 'Please sign in with Clerk.');
      if ((p.startsWith('/api/app/') && p !== '/api/app/auth-config') || /^\/r\/[^/]+\/raw\/?$/.test(p)) ctx.user = await clerk.getUser(req);
    } else ctx.user = await auth.getSession(cookies[COOKIE]);
    if (p.startsWith('/api/v1/')) {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
      need(await auth.checkApiToken(token), 401, 'Missing or invalid API token. Send `Authorization: Bearer <token>` — create one under “Push from LLM”.');
      ctx.user = API_ADMIN;
    } else if (p.startsWith('/api/app/') && req.method !== 'GET') {
      // CSRF: a custom header can't be sent cross-site without a CORS preflight, which we never grant.
      need(req.headers['x-requested-with'] === 'research-hub', 403, 'Missing request header.');
      const origin = req.headers.origin;
      need(!origin || new URL(origin).host === req.headers.host || origin === process.env.BASE_URL, 403, 'Cross-origin request blocked.');
    }
    const match = routes.find(r => r.method === req.method && r.re.test(p));
    if (!match) {
      if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(req, res, p);
      throw new HttpError(404, 'Not found.');
    }
    const m = match.re.exec(p);
    match.keys.forEach((k, i) => {
      ctx.params[k] = decodeURIComponent(m[i + 1]);
    });
    if (!['GET', 'HEAD'].includes(req.method)) {
      const b = await parseBody(req);
      ctx.body = b.fields;
      ctx.files = b.files;
    }
    if (p.startsWith('/api/app/login/')) await rateLimit(ctx);
    const execute = async () => await match.handler(ctx);
    if (!['GET', 'HEAD'].includes(req.method) || p.startsWith('/auth/link/')) {
      res.deferred=[];
      await require('./lib/db').transaction(execute);
      const replies=res.deferred; res.deferred=null; for(const reply of replies) reply();
    } else await execute();
  } catch (e) {
    res.deferred=null;
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.end();
    json(res, {
      error: status === 500 ? 'Unexpected server error.' : e.message
    }, status);
  }
}
module.exports = handler;
if (require.main === module) http.createServer(handler).listen(PORT, () => console.log(`${APP_NAME} running on http://localhost:${PORT}`));

async function rateLimit(ctx) {
  const email=auth.normEmail(ctx.body.email), ip=String(ctx.req.headers['x-real-ip'] || ctx.req.socket?.remoteAddress || 'unknown');
  for (const [key, maximum] of [[auth.sha('ip:'+ip),60],[auth.sha('email:'+email+':'+ctx.path),10]]) {
    const row=await store.db.prepare(`INSERT INTO rate_limits (key,count,expires) VALUES (?,1,?) ON CONFLICT (key) DO UPDATE SET count=CASE WHEN rate_limits.expires < ? THEN 1 ELSE rate_limits.count+1 END, expires=CASE WHEN rate_limits.expires < ? THEN EXCLUDED.expires ELSE rate_limits.expires END RETURNING count`).get(key,Date.now()+600000,Date.now(),Date.now());
    need(row.count<=maximum,429,'Too many attempts. Please wait 10 minutes.');
  }
}
