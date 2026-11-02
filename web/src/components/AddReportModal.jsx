import { useRef, useState } from 'react';
import { LuClipboardPaste, LuUpload, LuX } from 'react-icons/lu';
import { api, enc } from '../api.js';
import { AccessPicker, Button, Modal, fmtSize, useToast } from '../ui.jsx';

const looksHtml = (s) => /^\s*(<!doctype html|<html)/i.test(s);

export default function AddReportModal({ project, members, onClose, onPublished }) {
  const toast = useToast();
  const [tab, setTab] = useState('upload');
  const [files, setFiles] = useState([]);
  const [drag, setDrag] = useState(false);
  const [content, setContent] = useState('');
  const [format, setFormat] = useState('markdown');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [mode, setMode] = useState('project');
  const [selected, setSelected] = useState([]);
  const [progress, setProgress] = useState(null); // {i, n, p}
  const [error, setError] = useState('');
  const input = useRef(null);
  const url = `/api/app/projects/${enc(project.slug)}/reports`;
  const multi = tab === 'upload' && files.length > 1;

  const addFiles = (list) => { setFiles((f) => [...f, ...Array.from(list)]); setError(''); };
  const onPaste = (v) => { setContent(v); if (looksHtml(v)) setFormat('html'); };

  const fields = (fd) => {
    if (!multi && title.trim()) fd.append('title', title.trim());
    if (summary.trim()) fd.append('summary', summary.trim());
    fd.append('access', mode);
    if (mode === 'restricted') selected.forEach((e) => fd.append('allowed', e));
    return fd;
  };

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (mode === 'restricted' && !selected.length) return setError('Pick at least one member, or choose “Everyone in the project”.');
    try {
      let last;
      if (tab === 'upload') {
        if (!files.length) return setError('Choose a file to upload.');
        for (let i = 0; i < files.length; i++) {
          const fd = fields(new FormData()); fd.append('file', files[i]);
          setProgress({ i, n: files.length, p: 0 });
          last = await api.upload(url, fd, (p) => setProgress({ i, n: files.length, p }));
        }
      } else {
        if (!content.trim()) return setError('Paste the research first.');
        const fd = fields(new FormData()); fd.append('content', content); fd.append('format', format);
        setProgress({ i: 0, n: 1, p: 0 });
        last = await api.upload(url, fd, (p) => setProgress({ i: 0, n: 1, p }));
      }
      if (last.warning) toast(last.warning, 'err'); else toast(files.length > 1 && tab === 'upload' ? `Published ${files.length} reports` : 'Published');
      onPublished(last.report, tab === 'upload' ? files.length : 1);
    } catch (err) { setError(err.message); setProgress(null); }
  };

  const busy = !!progress;
  const pct = progress ? Math.round(((progress.i + progress.p) / progress.n) * 100) : 0;

  return (
    <Modal title={`Add report to ${project.name}`} onClose={busy ? () => {} : onClose} width={640}>
      <form onSubmit={submit}>
        <div className="tabs compact" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'upload'} className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}><LuUpload /> Upload file</button>
          <button type="button" role="tab" aria-selected={tab === 'paste'} className={tab === 'paste' ? 'on' : ''} onClick={() => setTab('paste')}><LuClipboardPaste /> Paste from LLM</button>
        </div>

        {tab === 'upload' ? (
          <>
            <div className={`dropzone ${drag ? 'drag' : ''}`} onClick={() => input.current.click()} role="button" tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
              <LuUpload className="dz-icon" />
              <div><strong>Drop files here</strong> or click to choose</div>
              <div className="hint">PDF, images, HTML (incl. interactive), Markdown, pitch decks, video — any format</div>
              <input ref={input} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            {files.length > 0 && (
              <ul className="filelist">{files.map((f, i) => (
                <li key={i}><span className="fname">{f.name}</span><span className="hint">{fmtSize(f.size)}</span>
                  {!busy && <button type="button" className="iconbtn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><LuX /></button>}</li>
              ))}</ul>
            )}
          </>
        ) : (
          <>
            <textarea className="code" rows={11} placeholder="Paste the research straight from ChatGPT, Claude or Gemini (Markdown), or a full HTML page…"
              value={content} onChange={(e) => onPaste(e.target.value)} aria-label="Research content" />
            <div className="seg" role="radiogroup" aria-label="Content format">
              {['markdown', 'html'].map((f) => <button type="button" key={f} role="radio" aria-checked={format === f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>{f === 'markdown' ? 'Markdown' : 'HTML page'}</button>)}
            </div>
          </>
        )}

        <div className="two">
          <div><label htmlFor="rt">Title</label>
            <input id="rt" value={multi ? '' : title} disabled={multi} placeholder={multi ? 'Each file uses its own name' : 'Defaults to the first heading or file name'} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label htmlFor="rs">Summary <span className="opt">optional</span></label>
            <input id="rs" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One line for the list" /></div>
        </div>

        <label>Who can view</label>
        <AccessPicker members={members} mode={mode} setMode={setMode} selected={selected} setSelected={setSelected} />

        {error && <div className="flash err mt">{error}</div>}
        {busy && <div className="progress mt" aria-label="Upload progress"><div style={{ width: `${pct}%` }} /><span>{progress.n > 1 ? `File ${progress.i + 1} of ${progress.n} · ` : ''}{pct}%</span></div>}

        <div className="modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" busy={busy}>{multi ? `Publish ${files.length} reports` : 'Publish'}</Button>
        </div>
      </form>
    </Modal>
  );
}
