import { useSyncExternalStore } from 'react';

/** Installing the app on the home screen ("Add to Home Screen" / "Install app"). */

export type Platform = 'ios' | 'android' | 'desktop';

/** Chrome's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  // iPadOS Safari reports itself as a Mac; a touch screen gives it away.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}

/** True when the app was opened from the home screen rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Call once at startup: the browser fires its install event early, before any page asks for it. */
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => `${deferredPrompt ? 1 : 0}${installed ? 1 : 0}`;

export function useInstall() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
    standalone: isStandalone(),
    /** The browser offers its own install dialog (Chrome / Edge / Samsung Internet). */
    canPrompt: deferredPrompt !== null,
    installed,
    async promptInstall(): Promise<boolean> {
      const event = deferredPrompt;
      if (!event) return false;
      deferredPrompt = null;
      await event.prompt();
      const { outcome } = await event.userChoice;
      notify();
      return outcome === 'accepted';
    },
  };
}

const DISMISS_KEY = 'install-banner-dismissed';

export function isBannerDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissBanner() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Storage can be unavailable (private mode); the banner then just shows again next time.
  }
}
