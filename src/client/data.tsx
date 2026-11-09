import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeProject, type ProjectSummary } from '../shared/calc';
import type { Dataset } from '../shared/types';
import { api, AuthError } from './api';
import { consumeSignedOut } from './auth';

interface DataContextValue {
  data: Dataset;
  summary: ProjectSummary;
  reload: () => Promise<void>;
  /** Runs a change, reloads the data and shows any error. Resolves to true on success. */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}

const DataContext = createContext<DataContextValue | null>(null);

/** Today's date in the user's time zone, as YYYY-MM-DD. */
export function todayISO(): string {
  return new Date().toLocaleDateString('sv-SE');
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'שגיאה לא צפויה';
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; auth: boolean } | null>(null);
  const [toast, setToast] = useState<{ message: string; auth: boolean; info?: boolean } | null>(null);
  const firstLoad = useRef(true);

  const reload = useCallback(async () => {
    try {
      const loaded = await api.data();
      setData(loaded);
      setLoadError(null);
      if (firstLoad.current) {
        firstLoad.current = false;
        // Coming back from a sign-out: say who is signed in now.
        if (consumeSignedOut()) setToast({ message: `התחברתם כ־${loaded.user.email}`, auth: false, info: true });
      }
    } catch (e) {
      const error = { message: message(e), auth: e instanceof AuthError };
      // Before the first load this shows as the splash; afterwards (a background refresh) as a toast.
      setLoadError(error);
      setToast(error);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Other users may have changed things while the app was in the background.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await reload();
        return true;
      } catch (e) {
        setToast({ message: message(e), auth: e instanceof AuthError });
        return false;
      }
    },
    [reload],
  );

  const summary = useMemo(() => (data ? computeProject(data, todayISO()) : null), [data]);

  if (!data || !summary) {
    return (
      <div className="splash">
        {loadError ? (
          <>
            <p>{loadError.auth ? loadError.message : `לא הצלחנו לטעון את הנתונים: ${loadError.message}`}</p>
            <button className="btn primary" onClick={() => window.location.reload()}>
              טעינה מחדש
            </button>
          </>
        ) : (
          <p>טוען…</p>
        )}
      </div>
    );
  }

  return (
    <DataContext.Provider value={{ data, summary, reload, run }}>
      {children}
      {toast && (
        <div
          className={`toast ${toast.info ? 'info' : ''}`}
          role={toast.info ? 'status' : 'alert'}
          onClick={() => (toast.auth ? window.location.reload() : setToast(null))}
        >
          {toast.message}
        </div>
      )}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
