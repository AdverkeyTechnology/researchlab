import { useEffect, useRef, useState } from 'react';
import { LuDownload, LuExternalLink, LuGlobe, LuLock, LuPencil, LuSend, LuShieldCheck, LuTrash2 } from 'react-icons/lu';
import { api } from '../api.js';
import { Link, navigate } from '../router.jsx';
import { useSession } from '../session.js';
import NotFound from './NotFound.jsx';
import { AccessPicker, Avatar, Button, FormatBadge, Modal, Spinner, fmtDate, fmtSize, fmtTime, plural, timeAgo, useConfirm, useData, useToast } from '../ui.jsx';

export default function Report({ id }) {
  const { user } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, setData } = useData(() => api.get(`/api/app/reports/${id}`), [id]);
  const [modal, setModal] = useState(null); // 'share' | 'edit'

  if (loading) return <main className="wrap"><Spinner /></main>;
  if (error) return <NotFound message={error.message} />;
  const { report, project, members } = data;
  const setReport = (r) => setData((d) => ({ ...d, report: r }));

  const remove = async () => {
    if (!(await confirm(`Delete “${report.title}” and its comments?`))) return;
    try { await api.del(`/api/app/reports/${report.id}`); toast('Report deleted'); navigate(`/p/${project.slug}`); } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <main className="wrap">
      <div className="crumbs"><Link to="/">Projects</Link> / <Link to={`/p/${project.slug}`}>{project.name}</Link> /</div>
      <div className="head">
        <div>
          <h1>{report.title}</h1>
          {report.summary && <p>{report.summary}</p>}
          <div className="meta mt-sm">
            <span>Published {fmtDate(report.createdAt)}</span><span>via {report.source}</span>
            {user.isAdmin && (report.access === 'restricted'
              ? <span className="meta-lock"><LuLock /> {plural(report.allowed.length, 'selected member')}</span>
              : <span><LuGlobe /> Everyone in project</span>)}
          </div>
        </div>
        {user.isAdmin && (
          <div className="head-actions">
            <Button icon={LuShieldCheck} onClick={() => setModal('share')}>Access</Button>
            <Button variant="ghost" icon={LuPencil} onClick={() => setModal('edit')} aria-label="Edit details">Edit</Button>
            <button className="iconbtn danger" title="Delete report" aria-label="Delete report" onClick={remove}><LuTrash2 /></button>
          </div>
        )}
      </div>

      <div className="layout wide">
        <Viewer report={report} />
        <aside className="side"><Comments reportId={report.id} initial={data.comments} /></aside>
      </div>

      {modal === 'share' && <AccessModal report={report} members={members} onClose={() => setModal(null)} onSaved={(r) => { setReport(r); setModal(null); }} />}
      {modal === 'edit' && <EditModal report={report} onClose={() => setModal(null)} onSaved={(r) => { setReport(r); setModal(null); }} />}
    </main>
  );
}

function Viewer({ report: r }) {
  const raw = r.rawUrl;
  let body;
  switch (r.format) {
    case 'pdf': body = <iframe src={raw} title={r.title} />; break;
    case 'image': body = <a href={raw} target="_blank" rel="noopener"><img src={raw} alt={r.title} /></a>; break;
    case 'html': case 'markdown': case 'text':
      // Served with a CSP sandbox too; the attribute is defence in depth.
      body = <iframe src={raw} title={r.title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals" />; break;
    case 'video': body = <video src={raw} controls />; break;
    case 'audio': body = <div className="pad"><audio src={raw} controls style={{ width: '100%' }} /></div>; break;
    default:
      body = (
        <div className="filecard"><FormatBadge format={r.format} /><div className="big">{r.filename}</div>
          <p className="hint">{fmtSize(r.size)} · Opens in its own app.{r.format === 'slides' ? ' Tip: export decks as PDF to view them right here.' : ''}</p>
          <a className="btn primary mt" href={`${raw}?download=1`}><LuDownload /> Download</a></div>
      );
  }
  return (
    <section className="card viewer" aria-label="Report">
      <div className="bar"><FormatBadge format={r.format} /><span className="fname">{r.filename} · {fmtSize(r.size)}</span><span className="sp" />
        <a className="btn sm ghost" href={raw} target="_blank" rel="noopener"><LuExternalLink /> Full screen</a>
        <a className="btn sm ghost" href={`${raw}?download=1`}><LuDownload /> Download</a></div>
      {body}
    </section>
  );
}

function Comments({ reportId, initial }) {
  const { user } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [comments, setComments] = useState(initial);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const url = `/api/app/reports/${reportId}/comments`;

  // Light polling so a discussion stays current without a refresh.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) api.get(url).then((d) => setComments(d.comments)).catch(() => {}); }, 20000);
    return () => clearInterval(t);
  }, [url]);

  const post = async (e) => {
    e && e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    try { setComments((await api.post(url, { body })).comments); setBody(''); setTimeout(() => endRef.current && endRef.current.scrollIntoView({ block: 'nearest' }), 0); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  const remove = async (c) => {
    if (!(await confirm('Delete this comment?'))) return;
    try { setComments((await api.del(`${url}/${c.id}`)).comments); } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <div className="card pad comments" id="comments">
      <h3>Comments · {comments.length}</h3>
      <div className="comment-list">
        {comments.length ? comments.map((c) => (
          <div className="comment" key={c.id}>
            <Avatar email={c.email} />
            <div className="b">
              <div className="h"><strong>{c.email === user.email ? 'You' : c.email}</strong><span title={fmtTime(c.createdAt)}>{timeAgo(c.createdAt)}</span>
                {(user.isAdmin || c.email === user.email) && <button className="x" onClick={() => remove(c)}>Delete</button>}</div>
              <div className="txt">{c.body}</div>
            </div>
          </div>
        )) : <p className="hint">No comments yet. Start the discussion.</p>}
        <div ref={endRef} />
      </div>
      <form onSubmit={post} className="compose">
        <textarea rows={3} placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Comment"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(e); }} />
        <div className="row-between"><span className="hint">⌘/Ctrl + Enter to post</span><Button variant="primary" size="sm" icon={LuSend} busy={busy} disabled={!body.trim()}>Post</Button></div>
      </form>
    </div>
  );
}

function AccessModal({ report, members, onClose, onSaved }) {
  const toast = useToast();
  const [mode, setMode] = useState(report.access);
  const [selected, setSelected] = useState(report.allowed || []);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (mode === 'restricted' && !selected.length) return toast('Pick at least one member.', 'err');
    setBusy(true);
    try { const { report: r } = await api.put(`/api/app/reports/${report.id}/access`, { access: mode, allowed: selected }); toast('Access updated'); onSaved(r); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title="Who can view this report" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save access</Button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Report-level access narrows who in the project can open this report. To give someone new access, add them to the project first.</p>
      <AccessPicker members={members} mode={mode} setMode={setMode} selected={selected} setSelected={setSelected} />
    </Modal>
  );
}

function EditModal({ report, onClose, onSaved }) {
  const toast = useToast();
  const [title, setTitle] = useState(report.title);
  const [summary, setSummary] = useState(report.summary);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { onSaved((await api.patch(`/api/app/reports/${report.id}`, { title, summary })).report); toast('Saved'); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title="Edit report" onClose={onClose}>
      <form onSubmit={save}>
        <label htmlFor="et">Title</label><input id="et" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="es">Summary</label><textarea id="es" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
        <div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy}>Save</Button></div>
      </form>
    </Modal>
  );
}
