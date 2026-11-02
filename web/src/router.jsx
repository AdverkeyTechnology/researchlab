import { useEffect, useState, useCallback } from 'react';

// Minimal history-API router: enough for a handful of routes without a dependency.
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
window.addEventListener('popstate', notify);

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search + location.hash) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  notify();
  if (!to.includes('#')) window.scrollTo(0, 0);
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => {
    const fn = () => setLoc({ path: location.pathname, search: location.search });
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return loc;
}

export function matchRoute(routes, path) {
  for (const [pattern, render] of routes) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    const m = re.exec(path);
    if (m) return render(Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])));
  }
  return null;
}

export function Link({ to, children, onClick, ...rest }) {
  const handle = useCallback((e) => {
    onClick && onClick(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
    e.preventDefault();
    navigate(to);
  }, [to, onClick, rest.target]);
  return <a href={to} onClick={handle} {...rest}>{children}</a>;
}

export function Redirect({ to }) {
  useEffect(() => { navigate(to, { replace: true }); }, [to]);
  return null;
}
