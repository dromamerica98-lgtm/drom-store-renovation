import type { ComponentChildren } from 'preact';
import { Link } from '../router';
import { Icon } from './Icon';

export function Topbar({ title, sub, children }: { title: string; sub?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <header class="topbar">
      <div class="titles">
        <h1>{title}</h1>
        {sub ? <p class="sub">{sub}</p> : null}
      </div>
      {children}
      <Link to="/settings" class="icon-btn settings-link" aria-label="Settings">
        <Icon name="settings" size={20} />
      </Link>
    </header>
  );
}
