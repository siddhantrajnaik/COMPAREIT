import { useState, useEffect } from 'react';
import { api, money } from '../api';
import { useLocalState } from '../hooks';
import { IconTrash, IconPlus, IconRefresh, IconClose } from '../components/Icons';

/**
 * The basket is where the app earns its keep.
 *
 * Per-item cheapest is easy and often wrong: fees and free-delivery thresholds
 * mean the app that wins every line can still lose the total. So we show the
 * full cost of each single-cart option AND the split-cart option, then say
 * plainly which one wins and by how much.
 */
export default function BasketView({ toast, bump }) {
  const [lists, setLists] = useState([]);
  const [activeId, setActiveId] = useLocalState('qc.activeList', null);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [opt, setOpt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);

  const loadLists = async () => {
    const ls = await api.lists();
    setLists(ls);
    // Fall back to the first list whenever the remembered one is gone.
    if (!ls.some((l) => l.id === activeId)) setActiveId(ls[0]?.id ?? null);
    return ls;
  };

  const loadItems = async (id) => {
    if (!id) return setItems([]);
    setItems(await api.basket(id));
  };

  useEffect(() => { loadLists(); }, [bump]);
  useEffect(() => { loadItems(activeId); setOpt(null); }, [activeId, bump]);

  const add = async (e) => {
    e.preventDefault();
    if (!q.trim() || !activeId) return;
    await api.addBasket({ query: q.trim(), qty: 1, listId: activeId });
    setQ(''); loadItems(activeId); loadLists(); setOpt(null);
  };

  const optimise = async (fresh = false) => {
    setBusy(true);
    try {
      const r = await api.optimise(fresh, activeId);
      setOpt(r);
      if (r.recommendation?.mode === 'split') {
        toast?.({ title: `Split saves ${money(r.recommendation.saves)}`, body: 'Buying across two apps beats any single one.' });
      }
    } catch (e) {
      toast?.({ title: 'Could not price the basket', body: e.message });
    } finally { setBusy(false); }
  };

  const setQty = async (it, d) => {
    const qty = Math.max(1, it.qty + d);
    await api.updateBasket(it.id, { qty }); loadItems(activeId); setOpt(null);
  };

  const remove = async (it) => { await api.delBasket(it.id); loadItems(activeId); loadLists(); setOpt(null); };

  const createList = async (name) => {
    const r = await api.addList(name);
    await loadLists();
    setActiveId(r.id);
    setNaming(false);
  };

  const deleteList = async () => {
    try {
      await api.delList(activeId);
      const ls = await loadLists();
      setActiveId(ls[0]?.id ?? null);
    } catch (e) { toast?.({ title: 'Cannot delete', body: e.message }); }
  };

  return (
    <>
      <div className="section-head">
        <h2>Basket</h2>
        {lists.length > 1 && (
          <button className="btn ghost sm" onClick={deleteList} title="Delete this list">
            <IconTrash width="13" height="13" /> Delete list
          </button>
        )}
      </div>

      <div className="chips">
        {lists.map((l) => (
          <button key={l.id} className={`chip ${l.id === activeId ? 'on' : ''}`}
                  onClick={() => setActiveId(l.id)}>
            {l.name}{l.count > 0 && <span style={{ opacity: .55, marginLeft: 5 }}>{l.count}</span>}
          </button>
        ))}
        <button className="chip" onClick={() => setNaming(true)}>+ New list</button>
      </div>

      {naming && (
        <NameList onSave={createList} onCancel={() => setNaming(false)} />
      )}

      <form className="card" onSubmit={add}>
        <div className="row">
          <input className="grow" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Add an item — milk, bread, eggs…" />
          <button className="btn sm" disabled={!q.trim()}><IconPlus width="15" height="15" /></button>
        </div>
      </form>

      {items.length > 0 && (
        <div className="card">
          {items.map((it) => (
            <div className="bline" key={it.id}>
              <span className="sm">{it.query}</span>
              <div className="qty">
                <button onClick={() => setQty(it, -1)}>−</button>
                <span className="num">{it.qty}</span>
                <button onClick={() => setQty(it, +1)}>+</button>
              </div>
              <button className="btn ghost sm" onClick={() => remove(it)}><IconTrash width="13" height="13" /></button>
            </div>
          ))}
          <button className="btn" style={{ width: '100%', marginTop: 12 }}
                  onClick={() => optimise(false)} disabled={busy}>
            {busy ? <><IconRefresh width="15" height="15" className="spin" /> Pricing {items.length} items…</>
                  : 'Find the cheapest way to buy this'}
          </button>
          {opt && (
            <button className="btn ghost sm" style={{ width: '100%', marginTop: 7 }}
                    onClick={() => optimise(true)} disabled={busy}>
              Re-price with fresh data
            </button>
          )}
        </div>
      )}

      {!items.length && !naming && (
        <div className="empty">
          <h3>Build your list</h3>
          <p>Add everything you'd normally buy, then let QuickCompare work out whether one app
             wins outright — or whether splitting the order across two beats it once delivery
             fees are counted.</p>
        </div>
      )}

      {opt && <Result opt={opt} />}
    </>
  );
}

function NameList({ onSave, onCancel }) {
  const [name, setName] = useState('');
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
      <div className="field-row">
        <label>List name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Weekly shop, Monthly stock-up…" />
      </div>
      <div className="row">
        <button className="btn sm" disabled={!name.trim()}>Create</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          <IconClose width="13" height="13" /> Cancel
        </button>
      </div>
    </form>
  );
}

function Result({ opt }) {
  const rec = opt.recommendation;
  const best = opt.singleCart?.find((c) => c.complete) || opt.singleCart?.[0];

  return (
    <>
      <div className="section-head"><h2>Result</h2></div>

      {rec?.mode === 'split' && opt.split && (
        <div className="card" style={{ borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)' }}>
          <div className="row between" style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: 14 }}>Split across {opt.split.platforms.length} apps</strong>
            <span className="price num" style={{ color: 'var(--accent)' }}>{money(opt.split.total)}</span>
          </div>
          <p className="tiny muted" style={{ marginBottom: 9 }}>
            Saves {money(rec.saves)} versus the best single cart, after both apps' fees.
          </p>
          <div className="breakdown">
            <span>items {money(opt.split.subtotal)}</span>
            <span>fees {money(opt.split.fees)}</span>
            <span>{opt.split.platforms.join(' + ')}</span>
          </div>
        </div>
      )}

      <div className="section" style={{ paddingTop: 0 }}>
        {opt.singleCart?.map((c) => (
          <div key={c.platform} className={`cartcard ${c === best && rec?.mode !== 'split' ? 'win' : ''}`}>
            <div className="head">
              <i className="swatch" style={{ background: c.meta.color }} />
              <span className="name">{c.meta.label}</span>
              <span className="total num">{money(c.total)}</span>
            </div>
            <div className="breakdown">
              <span>items {money(c.subtotal)}</span>
              <span>delivery {c.delivery ? money(c.delivery) : 'free'}</span>
              {c.handling > 0 && <span>handling {money(c.handling)}</span>}
              {c.missing > 0 && <span style={{ color: 'var(--warn)' }}>{c.missing} not stocked</span>}
            </div>
            <details style={{ marginTop: 9 }}>
              <summary className="tiny muted" style={{ cursor: 'pointer' }}>see items</summary>
              <div style={{ marginTop: 7 }}>
                {c.items.map((it, i) => (
                  <div key={i} className="row between tiny" style={{ padding: '3px 0' }}>
                    <span className={it.missing ? 'muted' : 'dim'}>
                      {it.query}{it.qty > 1 && ` ×${it.qty}`}
                      {it.missing && ' — unavailable'}
                    </span>
                    {!it.missing && <span className="num">{money(it.cost)}</span>}
                  </div>
                ))}
              </div>
            </details>
          </div>
        ))}
      </div>

      <p className="tiny muted" style={{ padding: '0 16px 24px', lineHeight: 1.55 }}>
        Delivery and handling fees come from Settings — edit them there if yours differ.
        Real fees vary by city, cart value and whatever surge the app feels like today.
      </p>
    </>
  );
}
