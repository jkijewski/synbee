import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from './api';

/**
 * Loads JSON from the hub and keeps it in state: `data` is null until it arrives, `error` holds the hub's message,
 * and `reload` fetches again. With `refreshMs`, it also reloads on that interval while mounted. A null url loads
 * nothing.
 */
export function useApi<T>(url: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    if (!url) return;
    api<T>('GET', url).then(
      (d) => {
        setData(d);
        setError('');
      },
      (e: ApiError) => setError(e.message),
    );
  }, [url]);
  useEffect(() => {
    reload();
    if (!opts.refreshMs) return;
    const t = setInterval(reload, opts.refreshMs);
    return () => clearInterval(t);
  }, [reload, opts.refreshMs]);
  return { data, error, reload, setData };
}
