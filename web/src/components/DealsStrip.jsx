import { useState } from 'react';
import { api, money, ago } from '../api';
import { useAsync } from '../hooks';
import { IconRefresh, IconExternal } from './Icons';

/**
 * Live deals across everything we've priced recently.
 *
 * Deliberately ranked by the composite score (history-weighted), not by
 * headline discount — otherwise this fills up with permanent "60% OFF" tags
 * against invented MRPs, which is exactly the noise the app exists to cut.
 */
export default function DealsStrip({ bump }) {
  const [days, setDays] = useState(3);
  const { data: deals, loading, run } = useAsync(() => api.deals({ days, minScore: 20 }), [bump, days]);

  return (
    <>
      <div className="section-head">
        <h2>Deals right now</h2>
        <div className="row" style={{ gap: 6 }}>
          {[3, 7, 30].map((d) => (
            <button key={d} className={`chip ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>
              {d}d
            </button>
          ))}
          <button className="btn ghost sm" onClick={() => run()}>
            <IconRefresh width="13" height="13" className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {!loading && deals?.length === 0 && (
        <div className="card tight">
          <p className="tiny muted" style={{ lineHeight: 1.55 }}>
            Nothing worth flagging in the last {days} days. Search a few things and this fills in —
            and once an item has a bit of price history, "below its own usual" replaces
            "% off MRP" as the test, which is the number platforms can't invent.
          </p>
        </div>
      )}

      {deals?.length > 0 && deals.every((d) => !d.hasHistory) && (
        <p className="tiny muted" style={{ padding: '0 16px 8px', lineHeight: 1.5 }}>
          These are scored on the platforms' own MRP claims — there isn't enough price
          history yet to check them. They'll firm up over the next few days.
        </p>
      )}

      {deals?.map((d) => (
        <a key={d.id} className="deal" href={d.url || '#'} target="_blank" rel="noreferrer"
           onClick={(e) => { if (!d.url) e.preventDefault(); }}>
          <span className="bar" style={{ background: d.meta.color }} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="deal-name">{d.name}</div>
            <div className="offer-meta">
              <span>{d.meta.label}</span>
              {d.unit_text && <span>· {d.unit_text}</span>}
              {d.ppu && <span>· {money(d.ppu.value)}/{d.ppu.label}</span>}
              <span>· {ago(d.ts)}</span>
            </div>
            <div className="tagline" style={{ marginTop: 4 }}>
              {d.vsMedian > 0 && <span className="tag best">{d.vsMedian}% below usual</span>}
              {d.vsMrp > 0 && <span className="tag off">{d.vsMrp}% off MRP</span>}
              {/* Be explicit when we're trusting the platform's own MRP claim. */}
              {!d.hasHistory && <span className="tag oos">unverified</span>}
            </div>
          </div>
          <div className="offer-right">
            <div className="price num" style={{ color: 'var(--accent)' }}>{money(d.price)}</div>
            {d.mrp > d.price && <div className="mrp num">{money(d.mrp)}</div>}
            {d.hasHistory && d.median > d.price && <div className="ppu num">was ~{money(d.median)}</div>}
            {d.url && <IconExternal width="11" height="11" style={{ opacity: .3, marginTop: 2 }} />}
          </div>
        </a>
      ))}
    </>
  );
}
