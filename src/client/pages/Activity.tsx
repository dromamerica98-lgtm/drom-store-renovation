import { useCallback, useEffect, useState } from 'react';
import { describeEntry, ENTITY_TEXT, type AuditEntity, type AuditEntry } from '../../shared/audit';
import { api } from '../api';
import { Chip, Empty, Icon, PageHeader, type IconName } from '../components/ui';
import { useData } from '../data';

const ACTION_ICON: Record<AuditEntry['action'], IconName> = { create: 'plus', update: 'edit', delete: 'trash' };

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

/** Change history: who changed what and when. Owners only. */
export function ActivityPage() {
  const { data } = useData();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [others, setOthers] = useState(false);
  const [actor, setActor] = useState('');
  const [entity, setEntity] = useState('');

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.audit({ before, actor: actor || undefined, entity: entity || undefined, others });
        setEntries((prev) => (before ? [...prev, ...page.entries] : page.entries));
        setActors(page.actors);
        setHasMore(page.hasMore);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה בטעינת היומן');
      } finally {
        setLoading(false);
      }
    },
    [actor, entity, others],
  );

  useEffect(() => {
    if (data.user.isAdmin) void load();
  }, [data.user.isAdmin, load]);

  if (!data.user.isAdmin) {
    return (
      <>
        <PageHeader title="יומן שינויים" back="/" />
        <section className="card">
          <Empty>יומן השינויים זמין רק לבעלי האפליקציה.</Empty>
        </section>
      </>
    );
  }

  let lastDay = '';
  return (
    <>
      <PageHeader title="יומן שינויים" subtitle="מי שינה מה ומתי, לפי החשבון שהתחבר דרך Cloudflare Access" />

      <div className="filters">
        <div className="segmented" role="group" aria-label="של מי">
          <button type="button" aria-pressed={!others} className={!others ? 'active' : ''} onClick={() => setOthers(false)}>
            כל השינויים
          </button>
          <button type="button" aria-pressed={others} className={others ? 'active' : ''} onClick={() => setOthers(true)}>
            של משתמשים אחרים
          </button>
        </div>
        <div className="filter-selects">
          <select aria-label="סינון לפי משתמש" value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">כל המשתמשים</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select aria-label="סינון לפי סוג" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">כל הסוגים</option>
            {(Object.keys(ENTITY_TEXT) as AuditEntity[]).map((k) => (
              <option key={k} value={k}>
                {ENTITY_TEXT[k].name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="card">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && entries.length === 0 && (
          <Empty>אין שינויים להצגה. היומן מתעד שינויים מהרגע שהופעל, ולא שינויים מלפני כן.</Empty>
        )}
        <ol className="activity">
          {entries.map((e) => {
            const d = describeEntry(e);
            const day = dayLabel(e.at);
            const header = day !== lastDay ? day : null;
            lastDay = day;
            return (
              <li key={e.id}>
                {header && <h3 className="activity-day">{header}</h3>}
                <div className={`activity-item ${e.action}`}>
                  <Icon name={ACTION_ICON[e.action]} className="activity-icon" />
                  <div className="activity-main">
                    <div className="activity-title">
                      {d.title}{' '}
                      <b>
                        <bdi>{d.label}</bdi>
                      </b>
                    </div>
                    {d.details.length > 0 && (
                      <ul className="activity-details">
                        {d.details.map((line) => (
                          <li key={line}>
                            <bdi>{line}</bdi>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="activity-meta">
                      <span className="num">{timeLabel(e.at)}</span>
                      <span dir="ltr">{e.actor}</span>
                      {e.actor === data.user.email && <Chip>אני</Chip>}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {loading && <p className="hint">טוען…</p>}
        {hasMore && !loading && (
          <button type="button" className="btn small" onClick={() => void load(entries[entries.length - 1]?.id)}>
            הצגת שינויים קודמים
          </button>
        )}
      </section>
    </>
  );
}
