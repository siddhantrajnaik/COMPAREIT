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

  // Pastel tint per platform, mirroring the reference's category tiles.
  const TINTS = {
    blinkit:   ['#FFF6DC', '#8A6A00'],
    zepto:     ['#EDEAFE', '#5646D6'],
    instamart: ['#FFEBE1', '#C2521F'],
    bigbasket: ['#E9F6DC', '#4A7A12'],
    dmart:     ['#E1F1FB', '#12658F'],
    flipkart:  ['#E4EDFE', '#1E51B5'],
    jiomart:   ['#DFF3E4', '#0C6B26'],
  };

  return (
    <>
      {!res && !loading && (
        <div className="hero">
          <h1>Never overpay<br />for groceries again</h1>
          <p>One search, every quick-commerce app near you — compared by real price per unit.</p>
        </div>
      )}

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

      <div className="chips" role="group" aria-label="Filter platforms">
        {platforms.map((p) => {
          const meta = health?.platformMeta?.[p];
          const [bg, ink] = TINTS[p] || ['#F1F1F8', '#4A4A66'];
          const active = only.includes(p);
          return (
            <button key={p} className={`chip tint ${active ? 'on' : ''}`}
                    onClick={() => togglePlatform(p)}
                    aria-pressed={active}
                    style={{ '--tint': bg, '--tint-ink': ink }}>
              <i className="swatch" aria-hidden="true"
                 style={{ width: 8, height: 8, borderRadius: 4, background: meta?.color || ink }} />
              {meta?.label || p}
            </button>
          );
        })}
        {only.length > 0 && <button className="chip" onClick={() => setOnly([])}>Reset</button>}
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
          <div className="sectionlabel"><h2>Try one of these</h2></div>
          <div className="chips" style={{ paddingTop: 0, flexWrap: 'wrap', overflow: 'visible' }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => run(s)}>{s}</button>
            ))}
          </div>
        </>
      )}

      {loading && !res && <SkeletonList />}

      {err && (
        <div className="card" role="alert">
          <strong style={{ color: 'var(--danger)', fontSize: 14.5 }}>Search failed</strong>
          <p className="sm muted" style={{ marginTop: 6 }}>{err}</p>
          <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => run(q, true)}>Retry</button>
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
              <button onClick={() => run(q, true)} style={{ color: 'var(--lav)', fontSize: 11 }}>
                refresh
              </button>
            </span>
          </div>

          {res.platforms.some((p) => p.blocked) && (
            <div className="card tight" style={{ background: 'var(--peach-soft)' }}>
              <strong style={{ fontSize: 13.5, color: '#9C3F10' }}>
                {res.platforms.filter((p) => p.blocked).map((p) => p.meta?.label).join(' and ')} refused the connection
              </strong>
              <p className="tiny muted" style={{ marginTop: 5, lineHeight: 1.5 }}>
                They returned an empty page rather than results — typical when traffic looks like it's
                from a datacenter, VPN or proxy. On a normal home connection they usually work. Turn off
                any VPN and try again.
              </p>
            </div>
          )}

          {res.groups.length > 0 && (
            <div className="sectionlabel">
              <h2>{res.groups.length} {res.groups.length === 1 ? 'result' : 'results'}</h2>
              <span className="tiny muted" style={{ fontWeight: 600 }}>
                cheapest first
              </span>
            </div>
          )}

          {res.groups.length === 0 && (
            <div className="empty">
              <div className="art"><IconSearch aria-hidden="true" /></div>
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

/* Mirrors the real card's dimensions so nothing jumps when results land. */
function SkeletonList() {
  return (
    <div aria-busy="true" aria-label="Loading results">
      {[0, 1, 2].map((i) => (
        <div className="group" key={i}>
          <div style={{ display: 'flex', gap: 13 }}>
            <div className="skel" style={{ width: 56, height: 56, flex: 'none', borderRadius: 16 }} />
            <div style={{ flex: 1 }}>
              <div className="skel" style={{ height: 15, width: `${62 + i * 9}%`, marginBottom: 8 }} />
              <div className="skel" style={{ height: 12, width: '42%' }} />
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skel" style={{ height: 62, borderRadius: 16 }} />
            <div className="skel" style={{ height: 62, borderRadius: 16 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
