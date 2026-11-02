import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LuLogOut } from 'react-icons/lu';
import { ClerkProvider, SignIn, useAuth, useClerk } from '@clerk/react';
import { api, setTokenGetter } from './api.js';
import { Link, matchRoute, navigate, Redirect, useLocation } from './router.jsx';
import { Avatar, ConfirmProvider, Spinner, ToastProvider } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Project from './pages/Project.jsx';
import Report from './pages/Report.jsx';
import Push from './pages/Push.jsx';
import NotFound from './pages/NotFound.jsx';
import { SessionCtx } from './session.js';
import './styles.css';

function App({ authReady = true, authUserId, signOut, clerkMode = false }) {
  const { path, search } = useLocation();
  const [session, setSession] = useState(null);

  const refresh = useCallback(() => api.get('/api/app/me').then(setSession), []);
  useEffect(() => {
    if (!authReady) return;
    let active = true;
    setSession(null);
    api.get('/api/app/me').then(value => { if (active) setSession(value); }).catch(error => { if (active) setSession({ user: null, appName: 'Research Hub', error: error.message }); });
    return () => { active = false; };
  }, [authReady, authUserId]);
  useEffect(() => { if (session) document.title = session.appName; }, [session]);

  if (!authReady || !session) return <Spinner />;
  if (session.error) return <main className="auth"><div className="card auth-card" role="alert"><p>{session.error}</p><button onClick={() => location.reload()}>Retry</button></div></main>;
  if (clerkMode && authUserId && !session.user) return <main className="auth"><div className="card auth-card"><h1>Email verification required</h1><p>Sign in with a verified primary email address to access your research.</p><button onClick={() => signOut({ redirectUrl: '/login' })}>Sign out</button></div></main>;
  const { user } = session;

  if (!user && path !== '/login') return <Redirect to={`/login${path !== '/' ? `?next=${encodeURIComponent(path)}` : ''}`} />;
  if (user && path === '/login') {
    return <Redirect to={safeNext(search)} />;
  }

  const page = matchRoute([
    ['/login', () => clerkMode ? <main className="auth"><div><SignIn routing="hash" fallbackRedirectUrl={safeNext(search)} /><p className="muted">Use the email address that was given project access.</p></div></main> : <Login />],
    ['/', () => <Dashboard />],
    ['/p/:slug', ({ slug }) => <Project key={slug} slug={slug} />],
    ['/r/:id', ({ id }) => <Report key={id} id={id} />],
    ['/push', () => (user.isAdmin ? <Push /> : <NotFound />)],
  ], path) || <NotFound />;

  const logout = async () => { if (clerkMode) return signOut({ redirectUrl: '/login' }); await api.post('/api/app/logout'); await refresh(); navigate('/login'); };

  return (
    <SessionCtx.Provider value={{ ...session, refresh }}>
      {user && (
        <header className="topbar"><div className="in">
          <Link className="brand" to="/"><span className="mark">R</span>{session.appName}</Link>
          <nav className="nav">
            <Link to="/" className={path === '/' || path.startsWith('/p/') || path.startsWith('/r/') ? 'on' : ''}>Projects</Link>
            {user.isAdmin && <Link to="/push" className={path === '/push' ? 'on' : ''}>Push from LLM</Link>}
          </nav>
          <div className="who">
            {user.isAdmin && <span className="pill">Admin</span>}
            <span className="email">{user.email}</span><Avatar email={user.email} />
            <button className="iconbtn" title="Sign out" aria-label="Sign out" onClick={logout}><LuLogOut /></button>
          </div>
        </div></header>
      )}
      {page}
    </SessionCtx.Provider>
  );
}

function safeNext(search) {
  const next = new URLSearchParams(search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
}
function ClerkApp() {
  const { isLoaded, userId, getToken } = useAuth();
  const { signOut } = useClerk();
  setTokenGetter(getToken);
  return <App authReady={isLoaded} authUserId={userId} signOut={signOut} clerkMode />;
}
function Bootstrap() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/api/app/auth-config').then(setConfig).catch(e => setError(e.message)); }, []);
  if (error) return <main className="auth"><div className="card auth-card" role="alert"><p>{error}</p><button onClick={() => location.reload()}>Retry</button></div></main>;
  if (!config) return <Spinner />;
  return config.publishableKey ? <ClerkProvider publishableKey={config.publishableKey}><ClerkApp /></ClerkProvider> : <App />;
}
createRoot(document.getElementById('root')).render(
  <StrictMode><ToastProvider><ConfirmProvider><Bootstrap /></ConfirmProvider></ToastProvider></StrictMode>,
);
