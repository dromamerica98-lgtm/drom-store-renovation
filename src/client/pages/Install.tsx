import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, PageHeader, Section } from '../components/ui';
import { dismissBanner, isBannerDismissed, useInstall, type Platform } from '../install';

const APP_NAME = 'תקציב שיפוץ';

const PLATFORM_LABELS: Record<Platform, string> = {
  ios: 'אייפון / אייפד',
  android: 'אנדרואיד',
  desktop: 'מחשב',
};

function Steps({ children }: { children: ReactNode }) {
  return <ol className="install-steps">{children}</ol>;
}

/** Inline picture of a browser control, so the user knows what to look for. */
function Glyph({ name, label }: { name: 'share' | 'more' | 'addSquare' | 'install'; label: string }) {
  return (
    <span className="glyph" aria-label={label} role="img">
      <Icon name={name} />
    </span>
  );
}

function IosSteps() {
  return (
    <>
      <Steps>
        <li>
          פתחו את האפליקציה ב־<b>Safari</b>. אם הקישור נפתח מתוך אפליקציה אחרת, כמו המייל או וואטסאפ, בחרו קודם
          "פתיחה ב־Safari".
        </li>
        <li>
          הקישו על כפתור השיתוף <Glyph name="share" label="שיתוף" /> שבסרגל התחתון (באייפד: בחלק העליון של המסך).
        </li>
        <li>
          גללו למטה ובחרו <Glyph name="addSquare" label="הוספה למסך הבית" /> <b>הוספה למסך הבית</b>.
        </li>
        <li>
          ודאו שהשם הוא "{APP_NAME}", והקישו על <b>הוסף</b>.
        </li>
      </Steps>
      <p className="hint">
        באייפון, האפליקציה שמותקנת במסך הבית שומרת התחברות נפרדת מ־Safari. לכן בפתיחה הראשונה מהאייקון תתבקשו להתחבר
        שוב עם קוד חד־פעמי למייל.
      </p>
    </>
  );
}

function AndroidSteps({ canPrompt }: { canPrompt: boolean }) {
  return (
    <>
      {canPrompt && <p className="hint">אפשר פשוט ללחוץ על "התקנת האפליקציה" למעלה. אם הכפתור לא עובד:</p>}
      <Steps>
        <li>
          פתחו את האפליקציה ב־<b>Chrome</b>.
        </li>
        <li>
          הקישו על תפריט שלוש הנקודות <Glyph name="more" label="תפריט" /> שבפינה העליונה.
        </li>
        <li>
          בחרו <Glyph name="install" label="התקנה" /> <b>התקנת אפליקציה</b> או <b>הוספה למסך הבית</b>.
        </li>
        <li>
          אשרו עם <b>התקנה</b>. האייקון "{APP_NAME}" יופיע במסך הבית ובמגירת האפליקציות.
        </li>
      </Steps>
      <p className="hint">בפתיחה הראשונה מהאייקון ייתכן שתתבקשו להתחבר שוב עם קוד חד־פעמי למייל.</p>
    </>
  );
}

function DesktopSteps() {
  return (
    <Steps>
      <li>
        ב־Chrome או Edge, לחצו על סמל ההתקנה <Glyph name="install" label="התקנה" /> שבשורת הכתובת.
      </li>
      <li>
        או: פתחו את תפריט הדפדפן <Glyph name="more" label="תפריט" />, ובחרו <b>התקנת "{APP_NAME}"</b> (ב־Edge: "אפליקציות"
        ואז "התקנת האתר כאפליקציה").
      </li>
      <li>באייפון או באנדרואיד, פתחו את האפליקציה בטלפון ובחרו את הכרטיסייה המתאימה כאן.</li>
    </Steps>
  );
}

export function InstallPage() {
  const install = useInstall();
  const [platform, setPlatform] = useState<Platform>(install.platform);
  const [result, setResult] = useState<'accepted' | 'dismissed' | null>(null);

  return (
    <>
      <PageHeader back="/settings" title="התקנה במסך הבית" subtitle="פתיחה מהירה מהטלפון, במסך מלא ובלי שורת הכתובת" />

      <section className="card install-hero">
        <img src="/apple-touch-icon.png" alt="" width="72" height="72" className="install-icon" />
        <div>
          <div className="install-name">{APP_NAME}</div>
          <div className="hint">כך האייקון והשם יופיעו במסך הבית</div>
        </div>
      </section>

      {install.standalone || install.installed ? (
        <section className="card install-done" role="status">
          <Icon name="check" />
          <div>
            <b>{install.standalone ? 'האפליקציה פתוחה מהמסך הבית.' : 'האפליקציה הותקנה.'}</b>
            <div className="hint">אפשר לפתוח אותה מהאייקון "{APP_NAME}".</div>
          </div>
        </section>
      ) : (
        install.canPrompt && (
          <section className="card">
            <button
              type="button"
              className="btn primary install-button"
              onClick={async () => setResult((await install.promptInstall()) ? 'accepted' : 'dismissed')}
            >
              <Icon name="install" />
              התקנת האפליקציה
            </button>
            {result === 'dismissed' && <p className="hint">ההתקנה בוטלה. אפשר לנסות שוב, או לפעול לפי ההוראות למטה.</p>}
          </section>
        )
      )}

      <Section title="איך מתקינים">
        <div className="segmented" role="tablist" aria-label="סוג המכשיר">
          {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={platform === p}
              className={platform === p ? 'active' : ''}
              onClick={() => setPlatform(p)}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="install-body">
          {platform === 'ios' && <IosSteps />}
          {platform === 'android' && <AndroidSteps canPrompt={install.canPrompt} />}
          {platform === 'desktop' && <DesktopSteps />}
        </div>
      </Section>
    </>
  );
}

/** A dismissible hint on the dashboard, shown on phones until the app is installed. */
export function InstallBanner() {
  const install = useInstall();
  const [hidden, setHidden] = useState(isBannerDismissed);
  if (hidden || install.standalone || install.installed || install.platform === 'desktop') return null;
  return (
    <aside className="install-banner">
      <img src="/icons/icon-192.png" alt="" width="40" height="40" />
      <div className="install-banner-text">
        <b>התקינו את האפליקציה במסך הבית</b>
        <span>פתיחה מהירה, במסך מלא</span>
      </div>
      <Link to="/install" className="btn small primary">
        איך?
      </Link>
      <button
        type="button"
        className="icon-btn"
        aria-label="סגירה"
        onClick={() => {
          dismissBanner();
          setHidden(true);
        }}
      >
        ✕
      </button>
    </aside>
  );
}
