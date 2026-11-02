import { useState } from 'react';
import { LuFileText, LuLink, LuLock, LuMessageSquare, LuPlus, LuSearch, LuTrash2, LuUserPlus } from 'react-icons/lu';
import { api, enc } from '../api.js';
import { Link, navigate } from '../router.jsx';
import { useSession } from '../session.js';
import AddReportModal from '../components/AddReportModal.jsx';
import NotFound from './NotFound.jsx';
import { Avatar, Button, CopyField, Empty, FormatBadge, Modal, Spinner, plural, timeAgo, useConfirm, useData, useToast } from '../ui.jsx';

export default function Project({ slug }) {
  const { user } = useSession();
  const { data, loading, error, reload, setData } = useData(() => api.get(`/api/app/projects/${enc(slug)}`), [slug]);
  const [tab, setTab] = useState('reports');
  const [adding, setAdding] = useState(false);

  if (loading) return <main className="wrap"><Spinner /></main>;
  if (error) return <NotFound message={error.message} />;
  const { project, reports, members } = data;

  return (
    <main className="wrap">
      <div className="crumbs"><Link to="/">Projects</Link> /</div>
      <div className="head">
        <div><h1>{project.name}</h1>{project.description && <p>{project.description}</p>}</div>
        {user.isAdmin && <Button variant="primary" icon={LuPlus} onClick={() => setAdding(true)}>Add report</Button>}
      </div>

      {user.isAdmin && (
        <div className="tabs" role="tablist">
          {[['reports', `Reports · ${reports.length}`], ['members', `Members · ${members.length}`], ['settings', 'Settings']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      )}

      {tab === 'reports' && <ReportList reports={reports} isAdmin={user.isAdmin} onAdd={() => setAdding(true)} />}
      {tab === 'members' && <Members project={project} members={members} onChange={(m) => setData((d) => ({ ...d, members: m }))} />}
      {tab === 'settings' && <Settings project={project} onSaved={(p) => setData((d) => ({ ...d, project: p }))} />}

      {adding && <AddReportModal project={project} members={members} onClose={() => setAdding(false)} onPublished={(r, count) => { setAdding(false); if (count === 1) navigate(`/r/${r.id}`); else { setTab('reports'); reload(); } }} />}
    </main>
  );
}

function ReportList({ reports, isAdmin, onAdd }) {
  const [q, setQ] = useState('');
  const [fmt, setFmt] = useState('all');
  const formats = [...new Set(reports.map((r) => r.format))];
  const shown = reports.filter((r) => (fmt === 'all' || r.format === fmt) && (r.title + ' ' + r.summary + ' ' + r.filename).toLowerCase().includes(q.toLowerCase()));

  if (!reports.length) return (
    <div className="card"><Empty icon={LuFileText} title="No reports yet">
      {isAdmin ? <><p>Upload a PDF, image, deck or HTML page — or paste research straight from an LLM.</p><Button variant="primary" icon={LuPlus} onClick={onAdd}>Add the first report</Button></> : <p>Reports will appear here once they're published.</p>}
    </Empty></div>
  );

  return (
    <>
      {reports.length > 4 && (
        <div className="filters">
          <div className="search"><LuSearch /><input type="search" placeholder="Search reports" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search reports" /></div>
          {formats.length > 1 && <div className="chips">{['all', ...formats].map((f) => <button key={f} className={`chip ${fmt === f ? 'on' : ''}`} onClick={() => setFmt(f)}>{f === 'all' ? 'All' : <FormatBadge format={f} />}</button>)}</div>}
        </div>
      )}
      <div className="card">
        {shown.length ? (
          <ul className="list">
            {shown.map((r) => (
              <li key={r.id}>
                <Link className="row" to={`/r/${r.id}`}>
                  <FormatBadge format={r.format} />
                  <div className="t"><div className="title">{r.title}</div><div className="sub">{r.summary || r.filename}</div></div>
                  {r.access === 'restricted' && <span className="pill lock" title="Only selected members can see this"><LuLock /> Restricted</span>}
                  {r.commentCount > 0 && <span className="pill" title="Comments"><LuMessageSquare /> {r.commentCount}</span>}
                  <span className="hint when">{timeAgo(r.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <Empty title="No reports match" />}
      </div>
    </>
  );
}

function Members({ project, members, onChange }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [emails, setEmails] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const base = `/api/app/projects/${enc(project.slug)}/members`;

  const add = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.post(base, { emails, notify });
      onChange(r.members); setEmails('');
      toast(r.added.length ? `Added ${plural(r.added.length, 'member')}${notify && !r.emailed ? ' — no email provider is set up, use 🔗 to send each a sign-in link' : ''}` : 'They were already members');
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  const remove = async (email) => {
    if (!(await confirm(`Remove ${email} from “${project.name}”? They will lose access to all its reports.`, { action: 'Remove' }))) return;
    try { onChange((await api.del(`${base}/${enc(email)}`)).members); toast(`Removed ${email}`); } catch (err) { toast(err.message, 'err'); }
  };
  const makeLink = async (email) => {
    try { setLink(await api.post(`${base}/${enc(email)}/link`)); } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <div className="layout">
      <div className="card">
        {members.length ? (
          <ul className="list">{members.map((m) => (
            <li className="row static" key={m.email}>
              <Avatar email={m.email} size={30} />
              <div className="t"><div className="title">{m.email}</div><div className="sub">Added {timeAgo(m.addedAt)}</div></div>
              <Button size="sm" variant="ghost" icon={LuLink} onClick={() => makeLink(m.email)} title="Create a single-use sign-in link">Sign-in link</Button>
              <button className="iconbtn danger" title={`Remove ${m.email}`} aria-label={`Remove ${m.email}`} onClick={() => remove(m.email)}><LuTrash2 /></button>
            </li>
          ))}</ul>
        ) : <Empty icon={LuUserPlus} title="No members yet"><p>Add the email addresses that should see this project.</p></Empty>}
      </div>
      <aside className="side">
        <form className="card pad" onSubmit={add}>
          <h3>Add members</h3>
          <textarea rows={3} required placeholder="new@acme.com, other@acme.com" value={emails} onChange={(e) => setEmails(e.target.value)} aria-label="Emails to add" />
          <label className="inline"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email them an invite</label>
          <Button variant="primary" size="sm" className="mt" icon={LuUserPlus} busy={busy}>Add</Button>
        </form>
        <div className="card pad"><h3>How access works</h3><p className="hint">Members see every report in this project, unless a report is restricted to selected members. Remove someone here to revoke all their access at once.</p></div>
      </aside>
      {link && (
        <Modal title="Sign-in link" onClose={() => setLink(null)}>
          <p className="muted">Send this to <strong>{link.email}</strong> over chat or email. It signs them in once and expires in {link.expiresInHours} hours.</p>
          <CopyField value={link.url} label="Copy link" />
        </Modal>
      )}
    </div>
  );
}

function Settings({ project, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ name: project.name, description: project.description });
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { onSaved((await api.patch(`/api/app/projects/${enc(project.slug)}`, form)).project); toast('Saved'); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm(`Delete “${project.name}”, all its reports and comments? This cannot be undone.`, { action: 'Delete project' }))) return;
    try { await api.del(`/api/app/projects/${enc(project.slug)}`); toast(`Deleted “${project.name}”`); navigate('/'); } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <div className="narrow">
      <form className="card pad" onSubmit={save}>
        <h3>Details</h3>
        <label htmlFor="sn">Name</label><input id="sn" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label htmlFor="sd">Description</label><textarea id="sd" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <p className="hint">API slug: <code>{project.slug}</code></p>
        <Button variant="primary" size="sm" className="mt" busy={busy}>Save changes</Button>
      </form>
      <div className="card pad danger-zone">
        <h3>Delete project</h3>
        <p className="hint">Removes every report, file and comment in it.</p>
        <Button variant="danger" size="sm" icon={LuTrash2} onClick={remove}>Delete project</Button>
      </div>
    </div>
  );
}
