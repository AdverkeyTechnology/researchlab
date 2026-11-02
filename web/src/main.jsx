import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LuLogOut } from 'react-icons/lu';
import { api } from './api.js';
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

function App() {
  const { path, search } = useLocation();
  const [session, setSession] = useState(null);

  const refresh = useCallback(() => api.get('/api/app/me').then(setSession), []);
  useEffect(() => { refresh().catch(() => setSession({ user: null, appName: 'Research Hub' })); }, [refresh]);
  useEffect(() => { if (session) document.title = session.appName; }, [session]);

  if (!session) return <Spinner />;
  const { user } = session;

  if (!user && path !== '/login') return <Redirect to={`/login${path !== '/' ? `?next=${encodeURIComponent(path)}` : ''}`} />;
  if (user && path === '/login') {
    const next = new URLSearchParams(search).get('next');
    return <Redirect to={next && next.startsWith('/') && !next.startsWith('//') ? next : '/'} />;
  }

  const page = matchRoute([
    ['/login', () => <Login />],
    ['/', () => <Dashboard />],
    ['/p/:slug', ({ slug }) => <Project key={slug} slug={slug} />],
    ['/r/:id', ({ id }) => <Report key={id} id={id} />],
    ['/push', () => (user.isAdmin ? <Push /> : <NotFound />)],
  ], path) || <NotFound />;

  const logout = async () => { await api.post('/api/app/logout'); await refresh(); navigate('/login'); };

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

createRoot(document.getElementById('root')).render(
  <StrictMode><ToastProvider><ConfirmProvider><App /></ConfirmProvider></ToastProvider></StrictMode>,
);
