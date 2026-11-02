import { useMemo, useState } from 'react';
import { LuFolderOpen, LuPlus, LuSearch } from 'react-icons/lu';
import { api } from '../api.js';
import { Link, navigate } from '../router.jsx';
import { useSession } from '../session.js';
import { Avatar, Button, Empty, Modal, Spinner, plural, timeAgo, useData, useToast } from '../ui.jsx';

export default function Dashboard() {
  const { user } = useSession();
  const { data, loading, error } = useData(() => api.get('/api/app/projects'), []);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const projects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data ? data.projects : [];
    return q ? list.filter((p) => (p.name + ' ' + p.description).toLowerCase().includes(q)) : list;
  }, [data, query]);

  return (
    <main className="wrap">
      <div className="head">
        <div>
          <h1>{user.isAdmin ? 'All projects' : 'Your projects'}</h1>
          <p>{user.isAdmin ? 'Every project on the platform. Members only see projects they have been added to.' : 'Research that has been shared with you.'}</p>
        </div>
        <div className="head-actions">
          {data && data.projects.length > 3 && (
            <div className="search"><LuSearch /><input type="search" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" /></div>
          )}
          {user.isAdmin && <Button variant="primary" icon={LuPlus} onClick={() => setCreating(true)}>New project</Button>}
        </div>
      </div>

      {loading ? <Spinner /> : error ? <div className="flash err">{error.message}</div> : (
        <div className="layout">
          <div>
            {projects.length ? (
              <div className="grid">
                {projects.map((p) => (
                  <Link key={p.id} className="card proj" to={`/p/${p.slug}`}>
                    <h2>{p.name}</h2>
                    <p>{p.description || 'No description yet.'}</p>
                    <div className="meta">
                      <span>{plural(p.reportCount, 'report')}</span>
                      {user.isAdmin && <span>{plural(p.memberCount, 'member')}</span>}
                      <span>Updated {timeAgo(p.lastReportAt || p.createdAt)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="card">
                <Empty icon={LuFolderOpen} title={query ? 'No matching projects' : user.isAdmin ? 'No projects yet' : 'Nothing shared with you yet'}>
                  {!query && (user.isAdmin
                    ? <Button variant="primary" icon={LuPlus} onClick={() => setCreating(true)}>Create the first project</Button>
                    : <p>Ask the admin to add <strong>{user.email}</strong> to a project.</p>)}
                </Empty>
              </div>
            )}
          </div>
          <aside className="side">
            <div className="card pad">
              <h3>Recent comments</h3>
              {data.activity.length ? data.activity.map((c) => (
                <div className="comment" key={c.id}>
                  <Avatar email={c.email} />
                  <div className="b">
                    <div className="h"><strong>{c.email.split('@')[0]}</strong> on <Link to={`/r/${c.reportId}`}>{c.reportTitle}</Link></div>
                    <div className="txt clamp2">{c.body}</div>
                    <div className="hint">{c.projectName} · {timeAgo(c.createdAt)}</div>
                  </div>
                </div>
              )) : <p className="hint">Comments on reports will show up here.</p>}
            </div>
          </aside>
        </div>
      )}
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </main>
  );
}

function NewProjectModal({ onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '', emails: '', notify: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { project } = await api.post('/api/app/projects', form);
      toast(`Created “${project.name}”`);
      navigate(`/p/${project.slug}`);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="flash err">{error}</div>}
        <label htmlFor="pn">Name</label>
        <input id="pn" required placeholder="e.g. Market sizing — EV batteries" value={form.name} onChange={set('name')} />
        <label htmlFor="pd">Description</label>
        <textarea id="pd" rows={2} placeholder="What is this research for?" value={form.description} onChange={set('description')} />
        <label htmlFor="pe">Who can access</label>
        <textarea id="pe" rows={3} placeholder="alice@acme.com, bob@acme.com" value={form.emails} onChange={set('emails')} />
        <p className="hint">Comma, space or newline separated. You can change this any time.</p>
        <label className="inline"><input type="checkbox" checked={form.notify} onChange={set('notify')} /> Email them an invite</label>
        <div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy}>Create project</Button></div>
      </form>
    </Modal>
  );
}
