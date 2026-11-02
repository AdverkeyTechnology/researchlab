import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { LuX, LuCopy, LuCheck } from 'react-icons/lu';

// ---------- formatting ----------
export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime(); const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
}
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtTime = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- small pieces ----------
const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
export function Avatar({ email, size = 26 }) {
  const ini = email.split('@')[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?';
  return <span className="avatar" style={{ '--h': hue(email), width: size, height: size, fontSize: size * 0.4 }} title={email}>{ini}</span>;
}

const FORMAT_LABEL = { pdf: 'PDF', image: 'Image', html: 'HTML', markdown: 'Report', text: 'Text', slides: 'Pitch', video: 'Video', audio: 'Audio', file: 'File' };
export const FormatBadge = ({ format }) => <span className={`fmt fmt-${format}`}>{FORMAT_LABEL[format] || 'File'}</span>;

export const Spinner = ({ label }) => <div className="loading"><span className="spin" />{label && <span>{label}</span>}</div>;

export function Empty({ icon: Icon, title, children }) {
  return <div className="empty">{Icon && <Icon className="empty-icon" />}<div className="empty-title">{title}</div>{children && <div className="empty-body">{children}</div>}</div>;
}

export function Button({ variant = 'default', size, icon: Icon, busy, children, className = '', ...rest }) {
  return (
    <button className={`btn ${variant} ${size || ''} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spin sm" /> : Icon && <Icon />}{children}
    </button>
  );
}

export function CopyField({ value, label = 'Copy', mono = true, multiline }) {
  const [done, setDone] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); };
  return (
    <div className={`copyfield ${multiline ? 'multi' : ''}`}>
      {multiline ? <pre className="snip">{value}</pre> : <input readOnly value={value} className={mono ? 'mono' : ''} onFocus={(e) => e.target.select()} />}
      <Button size="sm" icon={done ? LuCheck : LuCopy} onClick={copy} type="button">{done ? 'Copied' : label}</Button>
    </div>
  );
}

// ---------- modal ----------
export function Modal({ title, onClose, children, width = 560, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const first = ref.current && ref.current.querySelector('input:not([type=hidden]),textarea,select');
    first && first.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }} ref={ref}>
        <div className="modal-head"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close"><LuX /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- confirm ----------
const ConfirmCtx = createContext(() => Promise.resolve(false));
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback((message, { danger = true, action = 'Delete' } = {}) => new Promise((resolve) => setState({ message, danger, action, resolve })), []);
  const close = (v) => { state.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal title="Are you sure?" width={420} onClose={() => close(false)}
          footer={<><Button variant="ghost" onClick={() => close(false)}>Cancel</Button><Button variant={state.danger ? 'danger-solid' : 'primary'} onClick={() => close(true)} autoFocus>{state.action}</Button></>}>
          <p className="muted" style={{ margin: 0 }}>{state.message}</p>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- data hook ----------
export function useData(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => loader().then((data) => setState({ data, error: null, loading: false }), (error) => setState((s) => ({ data: s.data, error, loading: false }))), deps); // eslint-disable-line
  useEffect(() => { setState({ data: null, error: null, loading: true }); run(); }, [run]);
  return { ...state, reload: run, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

// ---------- access picker (project vs selected members) ----------
export function AccessPicker({ members, mode, setMode, selected, setSelected }) {
  const toggle = (e) => setSelected(selected.includes(e) ? selected.filter((x) => x !== e) : [...selected, e]);
  return (
    <div className="access">
      <label className="choice"><input type="radio" checked={mode === 'project'} onChange={() => setMode('project')} />
        <span><strong>Everyone in the project</strong><small>{plural(members.length, 'member')}</small></span></label>
      <label className="choice"><input type="radio" checked={mode === 'restricted'} onChange={() => setMode('restricted')} />
        <span><strong>Only selected members</strong><small>Report-level access</small></span></label>
      {mode === 'restricted' && (
        <div className="checks">
          {members.length ? members.map((m) => (
            <label key={m.email}><input type="checkbox" checked={selected.includes(m.email)} onChange={() => toggle(m.email)} /><Avatar email={m.email} size={22} />{m.email}</label>
          )) : <span className="hint">Add members to the project first.</span>}
        </div>
      )}
    </div>
  );
}
