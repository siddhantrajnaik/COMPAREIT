import { useState } from 'react';
import { money } from '../api';
import { IconExternal, IconEye, IconPlus, IconCheck } from './Icons';

/**
 * One physical product, priced across every platform that stocks it.
 *
 * The design decision that matters: the cheapest STICKER price and the best
 * PRICE-PER-UNIT are marked separately, because they're often different rows.
 * A 1L pack at ₹72 beats a 500ml at ₹40 despite the bigger number, and hiding
 * that would defeat the purpose of the app.
 */
export default function ProductGroup({ group, onWatch, onBasket }) {
  const [watched, setWatched] = useState(false);
  const [basketed, setBasketed] = useState(false);

  const multi = group.platformCount > 1;

  return (
    <article className="group">
      <div className="group-head">
        {group.image
          ? <img className="thumb" src={group.image} alt="" loading="lazy"
                 onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          : <div className="thumb ph">◍</div>}

        <div className="group-title">
          <h3>{group.name}</h3>
          <div className="group-sub">
            {group.unitText && <span>{group.unitText}</span>}
            {group.unitText && <i className="sep" />}
            <span>{group.platformCount} {group.platformCount === 1 ? 'store' : 'stores'}</span>
            {group.bestPpu && (
              <>
                <i className="sep" />
                <span className="num">{money(group.bestPpu.value)}/{group.bestPpu.label}</span>
              </>
            )}
          </div>
        </div>

        {multi && group.maxSaving > 0 && (
          <span className="saveflag num">save {money(group.maxSaving)}</span>
        )}
      </div>

      <div className="offers">
        {group.offers.map((o) => (
          <OfferRow key={o.id} offer={o} multi={multi} />
        ))}
      </div>

      <div className="group-actions">
        <button
          className="btn ghost sm"
          disabled={watched}
          onClick={() => { setWatched(true); onWatch?.(group); }}
        >
          {watched ? <IconCheck width="14" height="14" /> : <IconEye width="14" height="14" />}
          {watched ? 'Tracking' : 'Track price'}
        </button>
        <button
          className="btn ghost sm"
          disabled={basketed}
          onClick={() => { setBasketed(true); onBasket?.(group); }}
        >
          {basketed ? <IconCheck width="14" height="14" /> : <IconPlus width="14" height="14" />}
          {basketed ? 'In basket' : 'Add to basket'}
        </button>
      </div>
    </article>
  );
}

function OfferRow({ offer: o, multi }) {
  // "Cheapest" only means something when there's something to be cheaper than.
  const winner = multi && o.isCheapest && o.inStock;
  const cls = ['offer', winner ? 'best' : '', !o.inStock ? 'oos' : ''].filter(Boolean).join(' ');

  return (
    <a className={cls} href={o.url || '#'} target="_blank" rel="noreferrer"
       onClick={(e) => { if (!o.url) e.preventDefault(); }}>
      <span className="bar" style={{ background: o.meta.color }} />

      <div className="offer-mid">
        <div className="offer-name">
          {o.meta.label}
          {o.url && <IconExternal width="11" height="11" style={{ opacity: .35 }} />}
        </div>
        <div className="offer-meta">
          {o.unitText && <span>{o.unitText}</span>}
          {o.eta && <span>· {o.eta}</span>}
          {o.deal?.median && o.price < o.deal.median && (
            <span style={{ color: 'var(--accent-dk)' }}>
              · below its {money(o.deal.median)} usual
            </span>
          )}
        </div>
      </div>

      <div className="offer-right">
        <div className="tagline">
          {!o.inStock && <span className="tag oos">out</span>}
          {winner && <span className="tag best">cheapest</span>}
          {multi && o.inStock && o.isBestPpu && !o.isCheapest && <span className="tag ppu">best value</span>}
          {o.discount > 0 && <span className="tag off">{o.discount}% off</span>}
        </div>
        <div className="price num">{money(o.price)}</div>
        {o.mrp && o.mrp > o.price && <div className="mrp num">{money(o.mrp)}</div>}
        {o.ppu && <div className="ppu num">{money(o.ppu.value)}/{o.ppu.label}</div>}
      </div>
    </a>
  );
}
