import { useState } from 'react';
import { LuArrowLeft, LuMail } from 'react-icons/lu';
import { api } from '../api.js';
import { useSession } from '../session.js';
import { Button } from '../ui.jsx';

export default function Login() {
  const { appName, refresh, passwordLogin, setupRequired, emailConfigured } = useSession();
  const expired = new URLSearchParams(location.search).get('expired');
  const [mode, setMode] = useState('email'); // email | code | admin
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(expired ? 'That sign-in link has expired or was already used. Request a code instead.' : '');

  const run = (fn) => async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const sendCode = run(async () => { await api.post('/api/app/login/email', { email }); setMode('code'); setCode(''); });
  const verify = run(async () => { await api.post('/api/app/login/verify', { email, code }); await refresh(); });
  const adminLogin = run(async () => { await api.post('/api/app/login/admin', { email, password }); await refresh(); });

  return (
    <div className="auth">
      <div className="card auth-card">
        <div className="brand"><span className="mark">R</span>{appName}</div>
        {setupRequired && <div className="flash err mt">Research Lab is awaiting database setup. Sign-in will be available once setup is complete.</div>}
        {mode === 'email' && (
          <form onSubmit={sendCode}>
            <h1>Sign in</h1>
            <p className="muted">{emailConfigured ? "Enter the email address you were given access with. We'll send you a one-time code." : "Use the sign-in link shared by your administrator. Email sign-in is not yet enabled."}</p>
            {error && <div className="flash err">{error}</div>}
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoFocus placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button variant="primary" className="block mt" icon={LuMail} busy={busy} disabled={setupRequired || !emailConfigured}>Email me a code</Button>
            {passwordLogin && <button type="button" className="linkbtn mt" onClick={() => { setMode('admin'); setError(''); }}>Admin sign in with password</button>}
          </form>
        )}
        {mode === 'code' && (
          <form onSubmit={verify}>
            <h1>Check your inbox</h1>
            <p className="muted">If <strong>{email}</strong> has access to a project, we've sent it a 6-digit code. It expires in 10 minutes.</p>
            {error && <div className="flash err">{error}</div>}
            <label htmlFor="code">Code</label>
            <input id="code" className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} />
            <Button variant="primary" className="block mt" busy={busy}>Verify and sign in</Button>
            <div className="row-between mt">
              <button type="button" className="linkbtn" onClick={() => { setMode('email'); setError(''); }}><LuArrowLeft /> Different email</button>
              <button type="button" className="linkbtn" onClick={sendCode} disabled={busy}>Resend code</button>
            </div>
          </form>
        )}
        {mode === 'admin' && (
          <form onSubmit={adminLogin}>
            <h1>Admin sign in</h1>
            <p className="muted">Use the admin email and password configured on the server.</p>
            {error && <div className="flash err">{error}</div>}
            <label htmlFor="aemail">Email</label>
            <input id="aemail" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button variant="primary" className="block mt" busy={busy}>Sign in</Button>
            <button type="button" className="linkbtn mt" onClick={() => { setMode('email'); setError(''); }}><LuArrowLeft /> Sign in with an email code</button>
          </form>
        )}
      </div>
    </div>
  );
}
