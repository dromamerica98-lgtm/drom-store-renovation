/** Minimal history-API router: six fixed sections, no dependencies. */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export const ROUTES = ['/', '/health', '/training', '/coach', '/trends', '/settings'] as const;
export type Route = (typeof ROUTES)[number];

function current(): Route {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : '/';
}

export function navigate(to: Route) {
  if (to === current()) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const onPop = () => setRoute(current());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

export function Link(props: { to: Route; children: ComponentChildren; class?: string; 'aria-label'?: string }) {
  const { to, children } = props;
  const active = current() === to;
  return (
    <a
      href={to}
      class={props.class}
      aria-label={props['aria-label']}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
