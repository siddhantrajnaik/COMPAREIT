import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Server-sent events with automatic reconnect.
 *
 * SSE over WebSocket deliberately: the traffic is one-directional (server tells
 * client about price drops), it survives proxies better, and the browser
 * handles reconnection semantics for us.
 */
export function useSSE(handlers) {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    // No server in the static build — there's nothing to stream from, and
    // retrying forever would just fill the console with failures.
    if (import.meta.env.VITE_STATIC === '1') return undefined;

    let es;
    let retry;
    let closed = false;

    const connect = () => {
      es = new EventSource('/api/events');
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
      for (const name of ['alert', 'poll', 'rescue', 'watch-updated']) {
        es.addEventListener(name, (e) => {
          let data = null;
          try { data = JSON.parse(e.data); } catch { /* ignore */ }
          ref.current?.[name]?.(data);
        });
      }
    };
    connect();

    return () => { closed = true; clearTimeout(retry); es?.close(); };
  }, []);

  return connected;
}

/** Small async-data helper: load(), loading, error, refetch, setData. */
export function useAsync(fn, deps = [], immediate = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args) => {
    setLoading(true); setError(null);
    try {
      const r = await fnRef.current(...args);
      setData(r);
      return r;
    } catch (e) {
      setError(e.message || String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (immediate) run().catch(() => {}); }, deps);

  return { data, loading, error, run, setData };
}

export function useLocalState(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; }
    catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota */ } }, [key, v]);
  return [v, setV];
}

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), t.kind === 'rescue' ? 12000 : 6000);
  }, []);
  return [toasts, push];
}
