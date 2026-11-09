import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { signOut } from '../auth';
import { useData } from '../data';
import { Icon } from './ui';

/** The "עוד" menu: who is signed in, settings, install, and signing out of Cloudflare Access. */
export function AccountMenu({ onClose }: { onClose: () => void }) {
  const { data } = useData();
  const ref = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open && !signingOut) dialog.showModal();
  }, [signingOut]);

  if (signingOut) {
    return (
      <div className="signout-screen" role="status" aria-live="polite">
        <Icon name="logout" />
        <h2>התנתקתם מ־Cloudflare Access</h2>
        <p>מעבירים למסך הכניסה. שם אפשר להיכנס עם כתובת מייל מאושרת אחרת.</p>
      </div>
    );
  }

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="account-menu-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="sheet-head">
        <h2 id="account-menu-title">עוד</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה">
          ✕
        </button>
      </header>
      <div className="sheet-body">
        <div className="account-box">
          <Icon name="user" />
          <div>
            <span className="hint">החשבון המחובר</span>
            <b dir="ltr" className="account-email">
              {data.user.email}
            </b>
          </div>
        </div>

        <nav className="menu-list" aria-label="עוד">
          <Link to="/settings" onClick={onClose}>
            <Icon name="settings" />
            הגדרות
          </Link>
          <Link to="/install" onClick={onClose}>
            <Icon name="install" />
            התקנה במסך הבית
          </Link>
        </nav>

        {confirming ? (
          <div className="confirm-box" role="alertdialog" aria-labelledby="signout-title" aria-describedby="signout-text">
            <b id="signout-title">להתנתק מ־Cloudflare Access?</b>
            <p id="signout-text">
              תועברו למסך הכניסה, ותוכלו להיכנס עם כתובת מייל מאושרת אחרת.{' '}
              <b>שימו לב:</b> ההתנתקות מנתקת גם מאפליקציות אחרות שמוגנות ב־Cloudflare Access באותו דפדפן.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn danger-solid"
                onClick={() => {
                  setSigningOut(true);
                  void signOut(data.user.logoutUrl);
                }}
              >
                <Icon name="logout" />
                התנתקות
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                ביטול
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn signout-button" onClick={() => setConfirming(true)}>
            <Icon name="logout" />
            התנתקות
          </button>
        )}
      </div>
    </dialog>
  );
}
