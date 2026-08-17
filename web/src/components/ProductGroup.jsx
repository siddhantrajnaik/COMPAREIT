import { useState } from 'react';
import { money, IS_STATIC } from '../api';
import { IconExternal, IconEye, IconPlus, IconCheck, IconBox } from './Icons';

/**
 * One physical product, priced across every platform that stocks it.
 *
 * Laid out like the reference's search-result card: a coloured platform mark,
 * the details, and the price on the right — with the winner promoted to a solid
 * black pill so the answer is findable without reading a single number.
 *
 * The cheapest STICKER price and the best PRICE-PER-UNIT are marked separately,
 * because they're often different rows. A 1L pack at ₹72 beats 500ml at ₹40
 * despite the bigger number, and hiding that would defeat the app.
 */
export default function ProductGroup({ group, onWatch, onBasket }) {
  const [watched, setWatched] = useState(false);
  const [basketed, setBasketed] = useState(false);

  const multi = group.platformCount > 1;

  return (
    <article className="group">
      <div className="group-head">
        {group.image
          ? <img className="thumb" src={group.image} alt="" loading="lazy" width="56" height="56"
                 onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          : <div className="thumb ph"><IconBox aria-hidden="true" /></div>}

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
        {group.offers.map((o) => <OfferRow key={o.id} offer={o} multi={multi} />)}
      </div>

      {/* Tracking and baskets both need a server to persist to. Offering the
          buttons on the static build would only produce an apology. */}
      {!IS_STATIC && (
        <div className="group-actions">
          <button className="btn ghost sm" disabled={watched}
                  onClick={() => { setWatched(true); onWatch?.(group); }}>
            {watched ? <IconCheck width="15" height="15" aria-hidden="true" />
                     : <IconEye width="15" height="15" aria-hidden="true" />}
            {watched ? 'Tracking' : 'Track price'}
          </button>
          <button className="btn ghost sm" disabled={basketed}
                  onClick={() => { setBasketed(true); onBasket?.(group); }}>
            {basketed ? <IconCheck width="15" height="15" aria-hidden="true" />
                      : <IconPlus width="15" height="15" aria-hidden="true" />}
            {basketed ? 'In basket' : 'Add to basket'}
          </button>
        </div>
      )}
    </article>
  );
}

function OfferRow({ offer: o, multi }) {
  // "Cheapest" only means something when there's something to be cheaper than.
  const winner = multi && o.isCheapest && o.inStock;
  const cls = ['offer', winner ? 'best' : '', !o.inStock ? 'oos' : ''].filter(Boolean).join(' ');

  return (
    <a className={cls} href={o.url || undefined} target="_blank" rel="noreferrer"
       onClick={(e) => { if (!o.url) e.preventDefault(); }}>
      <span className="mark" style={{ background: o.meta.color, color: o.meta.textColor }} aria-hidden="true">
        {o.meta.label.slice(0, 1)}
      </span>

      <div className="offer-mid">
        <div className="offer-name">
          {o.meta.label}
          {o.url && <IconExternal width="12" height="12" aria-hidden="true" />}
        </div>
        <div className="offer-meta">
          {o.unitText && <span>{o.unitText}</span>}
          {o.eta && <span>· {o.eta}</span>}
          {o.deal?.median && o.price < o.deal.median && (
            <span style={{ color: 'var(--mint-ink)', fontWeight: 650 }}>
              · under its {money(o.deal.median)} usual
            </span>
          )}
        </div>
        <div className="tagline" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
          {!o.inStock && <span className="tag oos">out of stock</span>}
          {winner && <span className="tag best">cheapest</span>}
          {multi && o.inStock && o.isBestPpu && !o.isCheapest && <span className="tag ppu">best value</span>}
          {o.discount > 0 && <span className="tag off">{o.discount}% off</span>}
        </div>
      </div>

      <div className="offer-right">
        {winner
          ? <span className="pricepill num">{money(o.price)}</span>
          : <span className="price num">{money(o.price)}</span>}
        {o.mrp && o.mrp > o.price && <span className="mrp num">{money(o.mrp)}</span>}
        {o.ppu && <span className="ppu num">{money(o.ppu.value)}/{o.ppu.label}</span>}
      </div>
    </a>
  );
}
