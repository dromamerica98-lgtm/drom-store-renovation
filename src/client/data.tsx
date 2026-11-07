import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { computeProject, type ProjectSummary } from '../shared/calc';
import type { Dataset } from '../shared/types';
import { api } from './api';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api.data());
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e));
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
        setToast(message(e));
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
            <p>לא הצלחנו לטעון את הנתונים: {loadError}</p>
            <button className="btn primary" onClick={() => void reload()}>
              נסו שוב
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
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
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
