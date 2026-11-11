/**
 * Signing out of Cloudflare Access.
 *
 * 1. POST /api/logout: the Worker deletes the Access cookie of this hostname, so this app
 *    is no longer signed in (otherwise Access keeps accepting it for up to ~30 seconds).
 * 2. Go to the team logout address, which ends the Access session itself. Without this,
 *    Access would sign the same person straight back in. It ends the session of every
 *    Access application of the team in this browser.
 * 3. The logout address returns to the app (`returnTo`); with no session left, Access shows
 *    its login screen, where another approved email can be used.
 */

const SIGNED_OUT_KEY = 'signed-out';

/** Builds the team logout address that comes back to this app. */
export function buildLogoutUrl(logoutUrl: string, origin: string): string {
  return `${logoutUrl}?returnTo=${encodeURIComponent(`${origin}/`)}`;
}

export async function signOut(logoutUrl: string | null): Promise<void> {
  try {
    sessionStorage.setItem(SIGNED_OUT_KEY, '1');
  } catch {
    // Without storage the "signed in as" note after the next login is just skipped.
  }
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', redirect: 'manual' });
  } catch {
    // Carry on: the team logout below still ends the Access session.
  }
  // Leave the short message on screen for a moment.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  // Local development has no Access in front of it, so there is nothing more to end.
  window.location.replace(logoutUrl ? buildLogoutUrl(logoutUrl, window.location.origin) : '/');
}

/** True once, on the first load after a sign-out (used to say who is now signed in). */
export function consumeSignedOut(): boolean {
  try {
    const value = sessionStorage.getItem(SIGNED_OUT_KEY);
    sessionStorage.removeItem(SIGNED_OUT_KEY);
    return value === '1';
  } catch {
    return false;
  }
}
