import { useState, useEffect } from 'react';
import { api, money, ago } from '../api';
import { useAsync } from '../hooks';
import Sparkline from '../components/Sparkline';
import DealsStrip from '../components/DealsStrip';
import { IconTrash, IconRefresh, IconPlus } from '../components/Icons';

export default function WatchView({ toast, bump }) {
  const { data: watches, loading, run: reload } = useAsync(api.watches, [bump]);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <DealsStrip bump={bump} />

      <div className="section-head">
        <h2>Tracking</h2>
        <button className="btn ghost sm" onClick={() => setAdding((v) => !v)}>
          <IconPlus width="14" height="14" /> New
        </button>
      </div>

      {adding && (
        <AddWatch
          onDone={() => { setAdding(false); reload(); toast?.({ title: 'Tracking started', body: 'First price check is running now.' }); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {loading && !watches && <div className="card"><div className="skel" style={{ height: 60 }} /></div>}

      {watches?.length === 0 && !adding && (
        <div className="empty">
          <h3>Nothing tracked yet</h3>
          <p>Track an item and QuickCompare re-prices it in the background, then pushes
             your phone the moment it drops below your target — or below what it normally costs.</p>
        </div>
      )}

      {watches?.map((w) => (
        <WatchCard key={w.id} watch={w} onChange={reload} toast={toast} />
      ))}
    </>
  );
}

function AddWatch({ onDone, onCancel }) {
  const [f, setF] = useState({ query: '', targetPrice: '', minDiscount: '', notifyRestock: true });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.query.trim()) return;
    setBusy(true);
    try {
      await api.addWatch({
        query: f.query.trim(),
        label: f.query.trim(),
        targetPrice: f.targetPrice ? Number(f.targetPrice) : null,
        minDiscount: f.minDiscount ? Number(f.minDiscount) : null,
        notifyRestock: f.notifyRestock,
      });
      onDone();
    } finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit}>
      <div className="field-row">
        <label>What to track</label>
        <input autoFocus value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })}
               placeholder="e.g. amul gold milk 1 ltr" />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div className="field-row grow">
          <label>Alert at or below (₹)</label>
          <input type="number" inputMode="decimal" value={f.targetPrice}
                 onChange={(e) => setF({ ...f, targetPrice: e.target.value })} placeholder="optional" />
        </div>
        <div className="field-row grow">
          <label>Or at least (% off)</label>
          <input type="number" inputMode="numeric" value={f.minDiscount}
                 onChange={(e) => setF({ ...f, minDiscount: e.target.value })} placeholder="optional" />
        </div>
      </div>
      <label className="switch" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={f.notifyRestock}
               onChange={(e) => setF({ ...f, notifyRestock: e.target.checked })} />
        <span className="track" />
        <span className="sm">Tell me when it's back in stock</span>
      </label>
      <p className="tiny muted" style={{ marginBottom: 12, lineHeight: 1.5 }}>
        Even with no rule set, you'll still get a nudge when the price falls meaningfully
        below its own 30-day norm — that filters out permanent fake discounts.
      </p>
      <div className="row">
        <button className="btn sm" disabled={busy || !f.query.trim()}>{busy ? 'Saving…' : 'Start tracking'}</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function WatchCard({ watch: w, onChange, toast }) {
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  const best = w.best;

  useEffect(() => {
    if (!best?.id) return;
    api.history(best.id, 30).then(setHist).catch(() => {});
  }, [best?.id]);

  const check = async () => {
    setBusy(true);
    try { await api.checkWatch(w.id); onChange(); toast?.({ title: 'Checked', body: w.label }); }
    finally { setBusy(false); }
  };

  const remove = async () => { await api.delWatch(w.id); onChange(); };

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="grow">
          <div style={{ fontWeight: 600, fontSize: 14 }}>{w.label || w.query}</div>
          <div className="tiny muted" style={{ marginTop: 2 }}>
            {w.target_price != null && <>target {money(w.target_price)} · </>}
            {w.min_discount != null && <>{w.min_discount}%+ off · </>}
            {w.last_checked ? `checked ${ago(w.last_checked)}` : 'not checked yet'}
          </div>
        </div>
        <button className="btn ghost sm" onClick={check} disabled={busy} title="Check now">
          <IconRefresh width="14" height="14" className={busy ? 'spin' : ''} />
        </button>
        <button className="btn ghost sm" onClick={remove} title="Stop tracking">
          <IconTrash width="14" height="14" />
        </button>
      </div>

      {best ? (
        <>
          <div className="row between" style={{ alignItems: 'flex-end' }}>
            <div>
              <div className="price num" style={{ fontSize: 22, color: 'var(--lav)' }}>{money(best.price)}</div>
              <div className="tiny muted">
                cheapest on <b style={{ color: 'var(--ink-2)' }}>{best.platform}</b>
                {best.mrp > best.price && <> · MRP {money(best.mrp)}</>}
                {!best.in_stock && <> · <span style={{ color: 'var(--danger)' }}>out of stock</span></>}
              </div>
            </div>
            {hist?.points?.length > 1 && (
              <div style={{ width: 110 }}>
                <Sparkline points={hist.points} median={hist.median} />
                <div className="tiny muted" style={{ textAlign: 'right', marginTop: 1 }}>
                  {hist.points.length} pts · 30d
                </div>
              </div>
            )}
          </div>

          {w.current?.length > 1 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {w.current.slice(0, 4).map((c) => (
                <div key={c.id} className="row between tiny"
                     style={{ padding: '4px 0', borderTop: '1px solid var(--line)' }}>
                  <span className="dim">{c.platform}</span>
                  <span className="num" style={{ opacity: c.in_stock ? 1 : .4 }}>
                    {money(c.price)}{!c.in_stock && ' · out'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="tiny muted">No price captured yet — the next check will fill this in.</div>
      )}
    </div>
  );
}
