const filterAsync = async (rows, fn) => { const flags = await Promise.all(rows.map(fn)); return rows.filter((_, i) => flags[i]); };
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  db,
  q,
  FILES_DIR
} = require('./db');
const {
  normEmail,
  isEmail
} = require('./auth');
const now = () => Date.now();

// ---------- format detection ----------
const EXT_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  key: 'application/x-iwork-keynote-sffkey',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  zip: 'application/zip'
};
function detect(filename, mime) {
  const ext = (path.extname(filename || '').slice(1) || '').toLowerCase();
  const m = EXT_MIME[ext] || mime || 'application/octet-stream';
  let format = 'file';
  if (m === 'application/pdf') format = 'pdf';else if (m.startsWith('image/')) format = 'image';else if (m === 'text/html') format = 'html';else if (m === 'text/markdown') format = 'markdown';else if (m.startsWith('text/') || m === 'application/json') format = 'text';else if (m.startsWith('video/')) format = 'video';else if (m.startsWith('audio/')) format = 'audio';else if (/presentation|powerpoint|keynote/.test(m)) format = 'slides';
  return {
    format,
    mime: m,
    ext
  };
}
const parseEmails = v => [...new Set([].concat(v || []).flatMap(s => String(s).split(/[\s,;]+/)).map(normEmail).filter(isEmail))];
const slugify = s => String(s).toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';

// ---------- projects ----------
async function createProject(name, description, emails) {
  let base = slugify(name),
    slug = base,
    n = 2;
  while (await q('SELECT 1 FROM projects WHERE slug = ?').get(slug)) slug = `${base}-${n++}`;
  const {
    lastInsertRowid
  } = await q('INSERT INTO projects (slug, name, description, created_at) VALUES (?,?,?,?)').run(slug, name.trim(), (description || '').trim(), now());
  await addMembers(lastInsertRowid, emails);
  return await getProject(slug);
}
const getProject = async slugOrId => await q('SELECT * FROM projects WHERE slug = ? OR id = ? OR lower(name) = lower(?)').get(String(slugOrId), Number(slugOrId) || -1, String(slugOrId));
const updateProject = async (id, name, description) => await q('UPDATE projects SET name = ?, description = ? WHERE id = ?').run(name.trim(), (description || '').trim(), id);
async function deleteProject(id) {
  for (const r of await q('SELECT storage_name FROM reports WHERE project_id = ?').all(id)) await removeFile(r.storage_name);
  await q('DELETE FROM projects WHERE id = ?').run(id);
}
async function addMembers(projectId, emails) {
  const st = q('INSERT OR IGNORE INTO project_members (project_id, email, added_at) VALUES (?,?,?)');
  const list = parseEmails(emails);
  for (const e of list) await st.run(projectId, e, now());
  return list;
}
async function removeMember(projectId, email) {
  await q('DELETE FROM project_members WHERE project_id = ? AND email = ?').run(projectId, normEmail(email));
  await q('DELETE FROM report_access WHERE email = ? AND report_id IN (SELECT id FROM reports WHERE project_id = ?)').run(normEmail(email), projectId);
}
const members = async projectId => await q('SELECT email, added_at FROM project_members WHERE project_id = ? ORDER BY email').all(projectId);
const isMember = async (projectId, email) => !!(await q('SELECT 1 FROM project_members WHERE project_id = ? AND email = ?').get(projectId, normEmail(email)));
async function projectsFor(user) {
  const base = `SELECT p.*, (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count,
    (SELECT MAX(created_at) FROM reports r WHERE r.project_id = p.id) AS last_report FROM projects p`;
  const list = user.isAdmin ? await q(`${base} ORDER BY COALESCE((SELECT MAX(created_at) FROM reports rr WHERE rr.project_id = p.id), p.created_at) DESC`).all() : await q(`${base} JOIN project_members pm ON pm.project_id = p.id AND pm.email = ? ORDER BY COALESCE((SELECT MAX(created_at) FROM reports rr WHERE rr.project_id = p.id), p.created_at) DESC`).all(user.email);
  for (const p of list) p.report_count = (await reportsFor(user, p.id)).length;
  return list;
}

// ---------- reports ----------
const {
  putFile: storeFile,
  deleteFile: removeFile
} = require('./files');
async function createReport({
  projectId,
  title,
  summary,
  filename,
  mime,
  data,
  source,
  createdBy,
  allowedEmails, storedFile
}) {
  const d = detect(filename, mime);

  const restricted = await filterAsync(parseEmails(allowedEmails), async e => await isMember(projectId, e));
  if (parseEmails(allowedEmails).length && !restricted.length) throw Object.assign(new Error('Select valid project members for restricted access.'), {
    status: 400
  });
  const storage = storedFile?.pathname || await storeFile(data);
  const {
    lastInsertRowid
  } = await q(`INSERT INTO reports (project_id, title, summary, format, filename, mime, size, storage_name, access, source, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(projectId, title.trim() || filename, (summary || '').trim(), d.format, filename, d.mime, storedFile?.size ?? data.length, storage, restricted.length ? 'restricted' : 'project', source || 'upload', createdBy, now());
  await setReportAccess(lastInsertRowid, restricted.length ? 'restricted' : 'project', restricted);
  return await getReport(lastInsertRowid);
}
const getReport = async id => await q('SELECT * FROM reports WHERE id = ?').get(Number(id));
async function setReportAccess(reportId, mode, emails) {
  const r = await getReport(reportId);
  const list = await filterAsync(parseEmails(emails), async e => await isMember(r.project_id, e));
  const access = mode === 'restricted' ? 'restricted' : 'project';
  await q('UPDATE reports SET access = ? WHERE id = ?').run(access, reportId);
  await q('DELETE FROM report_access WHERE report_id = ?').run(reportId);
  if (access === 'restricted') {
    const st = q('INSERT OR IGNORE INTO report_access (report_id, email) VALUES (?,?)');
    for (const e of list) await st.run(reportId, e);
  }
}
const reportAccessList = async id => (await q('SELECT email FROM report_access WHERE report_id = ? ORDER BY email').all(id)).map(r => r.email);
const updateReport = async (id, title, summary) => await q('UPDATE reports SET title = ?, summary = ? WHERE id = ?').run(title.trim(), (summary || '').trim(), id);
async function deleteReport(id) {
  const r = await getReport(id);
  if (r) {
    await removeFile(r.storage_name);
    await q('DELETE FROM reports WHERE id = ?').run(id);
  }
}
async function canViewReport(user, report) {
  if (!user || !report) return false;
  if (user.isAdmin) return true;
  if (!(await isMember(report.project_id, user.email))) return false;
  if (report.access === 'project') return true;
  return !!(await q('SELECT 1 FROM report_access WHERE report_id = ? AND email = ?').get(report.id, user.email));
}
const canViewProject = async (user, project) => !!user && !!project && (user.isAdmin || (await isMember(project.id, user.email)));
async function reportsFor(user, projectId) {
  const rows = await q(`SELECT r.*, (SELECT COUNT(*) FROM comments c WHERE c.report_id = r.id) AS comment_count FROM reports r WHERE project_id = ? ORDER BY created_at DESC`).all(projectId);
  return await filterAsync(rows, async r => await canViewReport(user, r));
}

// ---------- comments ----------
const addComment = async (reportId, email, body) => await q('INSERT INTO comments (report_id, email, body, created_at) VALUES (?,?,?,?)').run(reportId, email, body.trim().slice(0, 10000), now());
const comments = async reportId => await q('SELECT * FROM comments WHERE report_id = ? ORDER BY created_at ASC').all(reportId);
const getComment = async id => await q('SELECT * FROM comments WHERE id = ?').get(Number(id));
const deleteComment = async id => await q('DELETE FROM comments WHERE id = ?').run(Number(id));
async function recentActivity(user, limit = 8) {
  const rows = await q(`SELECT c.*, r.title AS report_title, r.id AS rid, p.name AS project_name FROM comments c JOIN reports r ON r.id = c.report_id JOIN projects p ON p.id = r.project_id ORDER BY c.created_at DESC LIMIT 200`).all();
  return (await filterAsync(rows, async c => await canViewReport(user, await getReport(c.rid)))).slice(0, limit);
}
module.exports = {
  detect,
  parseEmails,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  addMembers,
  removeMember,
  members,
  isMember,
  projectsFor,
  createReport,
  getReport,
  setReportAccess,
  reportAccessList,
  updateReport,
  deleteReport,
  canViewReport,
  canViewProject,
  reportsFor,
  addComment,
  comments,
  getComment,
  deleteComment,
  recentActivity,
  db
};
