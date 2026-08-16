import { useState, useRef } from 'react';
import { api } from '../api';
import { useLocalState } from '../hooks';
import ProductGroup from '../components/ProductGroup';
import { IconSearch, IconRefresh } from '../components/Icons';

const SUGGESTIONS = ['milk', 'amul butter', 'eggs', 'bread', 'curd', 'bananas', 'onion', 'maggi', 'coffee', 'paneer'];

export default function SearchView({ health, onWatch, onBasket, toast }) {
  const [q, setQ] = useLocalState('qc.lastQuery', '');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [only, setOnly] = useLocalState('qc.platformFilter', []);
  const [recent, setRecent] = useLocalState('qc.recent', []);
  const inputRef = useRef(null);
  const reqId = useRef(0);

  const platforms = health?.platforms || [];

  const run = async (query = q, fresh = false) => {
    const term = query.trim();
    if (!term) return;
    setQ(term);
    setLoading(true);
    setErr(null);
    const id = ++reqId.current;
    try {
      const r = await api.search(term, { platforms: only.length ? only : null, fresh });
      if (id !== reqId.current) return;         // a newer search already landed
      setRes(r);
      // Keep the most recent 8, most-recent-first, no duplicates.
      setRecent((prev) => [term, ...prev.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8));
      if (!r.groups.length) toast?.({ title: 'Nothing found', body: `No results for "${term}".` });
    } catch (e) {
      if (id === reqId.current) setErr(e.message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  const togglePlatform = (p) =>
    setOnly((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  return (
    <>
      <div className="searchwrap">
        <form className="searchbox" onSubmit={(e) => { e.preventDefault(); inputRef.current?.blur(); run(); }}>
          <div className="field">
            <IconSearch />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search milk, butter, eggs…"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
            />
          </div>
          <button className="btn" type="submit" disabled={loading || !q.trim()}>
            {loading ? <IconRefresh width="16" height="16" className="spin" /> : 'Compare'}
          </button>
        </form>
      </div>

      <div className="chips">
        {platforms.map((p) => {
          const meta = health?.platformMeta?.[p];
          const on = only.length === 0 || only.includes(p);
          return (
            <button key={p} className={`chip ${only.includes(p) ? 'on' : ''}`}
                    onClick={() => togglePlatform(p)}
                    style={!only.includes(p) && on ? { borderColor: meta?.color + '55' } : undefined}>
              {meta?.label || p}
            </button>
          );
        })}
        {only.length > 0 && <button className="chip" onClick={() => setOnly([])}>reset</button>}
      </div>

      {!res && !loading && !err && (
        <>
          {recent.length > 0 && (
            <>
              <div className="row between" style={{ padding: '0 16px 4px' }}>
                <span className="tiny muted" style={{ letterSpacing: '.05em', textTransform: 'uppercase' }}>Recent</span>
                <button className="tiny muted" onClick={() => setRecent([])}>clear</button>
              </div>
              <div className="chips" style={{ paddingTop: 0, paddingBottom: 8 }}>
                {recent.map((s) => (
                  <button key={s} className="chip" onClick={() => run(s)}>{s}</button>
                ))}
              </div>
            </>
          )}
          <div className="chips" style={{ paddingTop: 0 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => run(s)}>{s}</button>
            ))}
          </div>
          <div className="empty">
            <h3>Compare before you tap Add</h3>
            <p>
              One search hits every quick-commerce app you have nearby and lines up the real
              prices — including price-per-100g, so bigger packs can't hide behind a smaller number.
            </p>
          </div>
        </>
      )}

      {loading && !res && <SkeletonList />}

      {err && (
        <div className="card">
          <strong style={{ color: 'var(--hot)', fontSize: 13 }}>Search failed</strong>
          <p className="sm muted" style={{ marginTop: 6 }}>{err}</p>
          <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => run(q, true)}>Retry</button>
        </div>
      )}

      {res && (
        <>
          <div className="statusrow">
            {res.platforms.map((p) => (
              <span key={p.platform} className={`pstat ${p.ok ? '' : 'fail'}`}
                    title={p.error || `${p.count} results in ${p.ms}ms`}>
                <i className="swatch" style={{ background: p.meta?.color || '#666' }} />
                {p.meta?.label || p.platform}
                <b className="num" style={{ fontWeight: 600 }}>
                  {p.blocked ? 'blocked' : p.ok ? p.count : 'failed'}
                </b>
              </span>
            ))}
            <span className="pstat" style={{ marginLeft: 'auto' }}>
              {res.cached ? 'cached' : 'live'}
              <button onClick={() => run(q, true)} style={{ color: 'var(--accent)', fontSize: 11 }}>
                refresh
              </button>
            </span>
          </div>

          {res.platforms.some((p) => p.blocked) && (
            <div className="card tight" style={{ borderColor: 'color-mix(in srgb, var(--warn) 30%, transparent)' }}>
              <strong style={{ fontSize: 12.5, color: 'var(--warn)' }}>
                {res.platforms.filter((p) => p.blocked).map((p) => p.meta?.label).join(' and ')} refused the connection
              </strong>
              <p className="tiny muted" style={{ marginTop: 5, lineHeight: 1.5 }}>
                They returned an empty page rather than results — typical when traffic looks like it's
                from a datacenter, VPN or proxy. On a normal home connection they usually work. Turn off
                any VPN and try again.
              </p>
            </div>
          )}

          {res.groups.length === 0 && (
            <div className="empty">
              <h3>No matches</h3>
              <p>Nothing came back for “{res.query}”. Try a broader term, or check Settings → Diagnostics
                 to see whether a platform is blocking us.</p>
            </div>
          )}

          {res.groups.map((g) => (
            <ProductGroup key={g.key} group={g} onWatch={onWatch} onBasket={onBasket} />
          ))}
        </>
      )}
    </>
  );
}

function SkeletonList() {
  return (
    <div style={{ padding: '4px 16px' }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '14px 0', borderBottom: '1px solid var(--line-soft)' }}>
          <div className="skel" style={{ width: 52, height: 52, flex: 'none' }} />
          <div style={{ flex: 1 }}>
            <div className="skel" style={{ height: 13, width: `${60 + i * 8}%`, marginBottom: 7 }} />
            <div className="skel" style={{ height: 10, width: '35%', marginBottom: 12 }} />
            <div className="skel" style={{ height: 38, width: '100%', marginBottom: 3 }} />
            <div className="skel" style={{ height: 38, width: '100%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
