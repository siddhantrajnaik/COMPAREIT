import { useState, useEffect } from 'react';
import { api, enablePush, disablePush, ago } from '../api';
import { useAsync } from '../hooks';
import { IconPin, IconRefresh, IconFlame } from '../components/Icons';

export default function SettingsView({ health, reloadHealth, toast, installPrompt, onInstall }) {
  const [loc, setLoc] = useState(health?.location || { lat: 12.9716, lon: 77.5946, locality: '', pincode: '' });
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState('');
  const [subJson, setSubJson] = useState(null);
  const { data: diag, run: reloadDiag } = useAsync(api.diagnostics, []);
  const { data: cityList } = useAsync(api.cities, []);
  const cities = cityList || [];

  // Reflect the dropdown only when the saved location really is that preset —
  // otherwise a hand-tuned lat/lon would silently look like a stock city.
  const matchedCityId = cities.find(
    (c) => Math.abs(c.lat - Number(loc.lat)) < 0.01 && Math.abs(c.lon - Number(loc.lon)) < 0.01
  )?.id || '';

  const pickCity = async (cityId) => {
    setBusy('loc');
    try {
      const r = await api.setLocation({ cityId });
      setLoc(r.location);
      await reloadHealth();
      toast?.({ title: `Switched to ${r.location.locality}`, body: 'Cached prices cleared.' });
    } catch (e) { toast?.({ title: 'Failed', body: e.message }); }
    finally { setBusy(''); }
  };

  useEffect(() => { if (health?.location) setLoc(health.location); }, [health?.location]);

  useEffect(() => {
    navigator.serviceWorker?.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setPushOn(!!s))
      .catch(() => {});
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast?.({ title: 'Geolocation unavailable' });
    setBusy('geo');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc((l) => ({ ...l, lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6) }));
        setBusy('');
        toast?.({ title: 'Location captured', body: 'Save it to re-price everything.' });
      },
      (e) => { setBusy(''); toast?.({ title: 'Location denied', body: e.message }); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const saveLoc = async () => {
    setBusy('loc');
    try {
      await api.setLocation({
        lat: Number(loc.lat), lon: Number(loc.lon),
        locality: loc.locality, pincode: loc.pincode || undefined,
      });
      await reloadHealth();
      toast?.({ title: 'Location saved', body: 'Cached prices cleared — searches will re-run fresh.' });
    } catch (e) { toast?.({ title: 'Failed', body: e.message }); }
    finally { setBusy(''); }
  };

  const togglePush = async () => {
    setBusy('push');
    try {
      if (pushOn) {
        await disablePush(); setPushOn(false); setSubJson(null);
        toast?.({ title: 'Notifications off' });
      } else {
        const r = await enablePush(health?.vapidPublicKey);
        if (r.ok) {
          setPushOn(true);
          if (r.manual) {
            // Static build: nowhere to POST it, so surface it for copying.
            setSubJson(JSON.stringify(r.subscription));
            toast?.({ title: 'Subscription ready', body: 'Copy it into the PUSH_SUBSCRIPTION secret.' });
          } else {
            toast?.({ title: 'Notifications on', body: 'Send a test to confirm.' });
          }
        } else toast?.({ title: 'Could not enable', body: r.reason });
      }
    } finally { setBusy(''); }
  };

  const copySub = async () => {
    try {
      await navigator.clipboard.writeText(subJson);
      toast?.({ title: 'Copied', body: 'Paste it into the PUSH_SUBSCRIPTION repo secret.' });
    } catch {
      toast?.({ title: 'Copy failed', body: 'Select the text and copy it manually.' });
    }
  };

  const toggleRescue = async (on) => {
    await api.rescueToggle(on);
    await reloadHealth();
  };

  return (
    <>
      {installPrompt && (
        <div className="card" style={{ background: 'linear-gradient(140deg, var(--lav-soft), var(--mint-soft))' }}>
          <strong style={{ fontSize: 15 }}>Add to Home Screen</strong>
          <p className="tiny muted" style={{ margin: '5px 0 10px', lineHeight: 1.5 }}>
            Installing gives you a real app icon and, on iOS, is the only way notifications work at all.
          </p>
          <button className="btn sm" onClick={onInstall}>Install</button>
        </div>
      )}

      <div className="section-head"><h2>Location</h2></div>
      <div className="card">
        <p className="tiny muted" style={{ marginBottom: 11, lineHeight: 1.5 }}>
          Everything depends on this. Blinkit and Zepto pick your dark store from the
          coordinates; Flipkart, DMart and JioMart show <em>nothing at all</em> without a
          pincode. Picking a city sets both.
        </p>

        {cities.length > 0 && (
          <div className="field-row">
            <label>City</label>
            <select value={matchedCityId} onChange={(e) => e.target.value && pickCity(e.target.value)}>
              <option value="">— custom / pick a city —</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="field-row">
          <label>Area name</label>
          <input value={loc.locality || ''} onChange={(e) => setLoc({ ...loc, locality: e.target.value })}
                 placeholder="Indiranagar, Bengaluru" />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field-row grow">
            <label>Latitude</label>
            <input className="num" value={loc.lat} onChange={(e) => setLoc({ ...loc, lat: e.target.value })} />
          </div>
          <div className="field-row grow">
            <label>Longitude</label>
            <input className="num" value={loc.lon} onChange={(e) => setLoc({ ...loc, lon: e.target.value })} />
          </div>
          <div className="field-row grow">
            <label>Pincode</label>
            <input className="num" inputMode="numeric" maxLength={6} value={loc.pincode || ''}
                   onChange={(e) => setLoc({ ...loc, pincode: e.target.value.replace(/\D/g, '') })}
                   placeholder="560001" />
          </div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={saveLoc} disabled={busy === 'loc'}>
            {busy === 'loc' ? 'Saving…' : 'Save location'}
          </button>
          <button className="btn ghost sm" onClick={useMyLocation} disabled={busy === 'geo'}>
            <IconPin width="14" height="14" /> {busy === 'geo' ? 'Locating…' : 'Use my GPS'}
          </button>
        </div>
        <p className="tiny muted" style={{ marginTop: 9, lineHeight: 1.5 }}>
          City pincodes are central defaults. For accurate stock and fees, replace it with
          your own — GPS can't tell us a pincode, so it borrows the nearest city's.
        </p>
      </div>

      <div className="section-head"><h2>Notifications</h2></div>
      <div className="card">
        <label className="switch" style={{ marginBottom: 10 }}>
          <input type="checkbox" checked={pushOn} onChange={togglePush} disabled={busy === 'push'} />
          <span className="track" />
          <span className="sm">Push to this device</span>
        </label>
        {!health?.push && (
          <p className="tiny" style={{ color: 'var(--warn)', marginBottom: 9 }}>
            Server has no VAPID keys. Run <code>npm run keys</code>, then restart.
          </p>
        )}
        {subJson ? (
          <>
            <p className="tiny muted" style={{ marginBottom: 8, lineHeight: 1.55 }}>
              This build has no server, so paste this into the repo secret
              <b style={{ color: 'var(--ink-2)' }}> PUSH_SUBSCRIPTION</b> — the scheduled
              job sends your alerts through it.
            </p>
            <textarea readOnly value={subJson} onFocus={(e) => e.target.select()}
                      style={{
                        width: '100%', minHeight: 88, fontSize: 11, lineHeight: 1.4,
                        fontFamily: 'var(--mono)', resize: 'vertical', marginBottom: 10,
                        background: 'var(--surface-2)', border: '1.5px solid transparent',
                        borderRadius: 'var(--r-sm)', padding: 10, color: 'var(--ink-2)',
                      }} />
            <button className="btn sm" onClick={copySub}>Copy subscription</button>
          </>
        ) : (
          <button className="btn ghost sm" onClick={() => api.testPush()
            .then((r) => toast?.({ title: 'Test sent', body: `${r.subscribers} device(s) subscribed.` }))
            .catch((e) => toast?.({ title: 'Not available here', body: e.message }))}>
            Send a test notification
          </button>
        )}
      </div>

      <div className="section-head"><h2>Food Rescue radar</h2></div>
      <div className="card">
        <label className="switch" style={{ marginBottom: 10 }}>
          <input type="checkbox" checked={!!health?.rescue?.enabled}
                 onChange={(e) => toggleRescue(e.target.checked)} />
          <span className="track" />
          <span className="sm"><IconFlame width="13" height="13" style={{ verticalAlign: -2 }} /> Watch Zomato for rescues</span>
        </label>
        <p className="tiny muted" style={{ lineHeight: 1.55, marginBottom: 10 }}>
          Checks your own signed-in Zomato session every minute for discounted cancelled orders
          nearby. Run <code>npm run login</code> once to sign in.
          <br /><br />
          <b style={{ color: 'var(--ink-2)' }}>Honest caveat:</b> Zomato pushes these mainly through
          its own app and the claim window is only a few minutes, so treat this as a second net —
          keep Zomato's own notifications on too.
        </p>
        <div className="row">
          <span className="pill">
            <i className="bulb" /> {health?.rescue?.status || 'idle'}
            {health?.rescue?.lastCheck && ` · ${ago(health.rescue.lastCheck)}`}
          </span>
          <button className="btn ghost sm" onClick={() => api.rescueCheck().then((r) =>
            toast?.({ title: r.ok ? `Checked — ${r.hits.length} found` : 'Check failed', body: r.reason || '' }))}>
            Check now
          </button>
        </div>
      </div>

      <FeeEditor toast={toast} />

      <div className="section-head"><h2>Your data</h2></div>
      <div className="card">
        <p className="tiny muted" style={{ marginBottom: 10, lineHeight: 1.55 }}>
          Every price this app has ever recorded, as a CSV — one row per observation, with
          price-per-unit worked out. Yours to keep; it never left this machine.
        </p>
        <div className="row">
          <a className="btn ghost sm" href="/api/export/history.csv?days=90" download>
            Export last 90 days
          </a>
          <a className="btn ghost sm" href="/api/export/history.csv?days=3650" download>
            Export everything
          </a>
        </div>
      </div>

      <div className="section-head">
        <h2>Background checks</h2>
        <button className="btn ghost sm" onClick={() => api.pollRun().then(() =>
          toast?.({ title: 'Sweep started', body: 'Re-pricing every tracked item.' }))}>
          <IconRefresh width="13" height="13" /> Run now
        </button>
      </div>
      <div className="card tight">
        <div className="row between tiny">
          <span className="muted">Interval</span>
          <span className="num">{Math.round((health?.poller?.intervalMs || 0) / 60000)} min</span>
        </div>
        <div className="row between tiny" style={{ marginTop: 5 }}>
          <span className="muted">Last sweep</span>
          <span>{health?.poller?.lastRun ? ago(health.poller.lastRun) : 'not yet'}</span>
        </div>
      </div>

      <div className="section-head">
        <h2>Diagnostics</h2>
        <button className="btn ghost sm" onClick={reloadDiag}><IconRefresh width="13" height="13" /></button>
      </div>
      <div className="card tight">
        {diag && Object.entries(diag.byPlatform).length === 0 && (
          <p className="tiny muted">No scrapes in the last 24h.</p>
        )}
        {diag && Object.entries(diag.byPlatform).map(([p, s]) => (
          <div key={p} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row between">
              <span className="sm" style={{ fontWeight: 550 }}>{health?.platformMeta?.[p]?.label || p}</span>
              <span className="tiny num" style={{ color: s.fail > s.ok ? 'var(--danger)' : 'var(--lav)' }}>
                {s.ok}/{s.ok + s.fail} ok · {s.avgMs}ms
              </span>
            </div>
            {s.lastError && (
              <div className="tiny" style={{ color: 'var(--warn)', marginTop: 3, wordBreak: 'break-word' }}>
                {s.lastError.slice(0, 140)}
              </div>
            )}
          </div>
        ))}
        {diag && (
          <div className="breakdown" style={{ marginTop: 10 }}>
            <span>{diag.counts.products} products</span>
            <span>{diag.counts.pricePoints} price points</span>
            <span>{diag.counts.watches} tracked</span>
            <span>{diag.counts.pushSubs} devices</span>
          </div>
        )}
      </div>

      <p className="tiny muted" style={{ padding: '4px 16px 30px', lineHeight: 1.6 }}>
        QuickCompare reads public listing pages from a browser on your own machine, at a
        human pace, for your own shopping. It stores nothing off-device. If a platform
        starts returning empty results, its page layout probably changed — check Diagnostics.
      </p>
    </>
  );
}

/**
 * Delivery / handling / free-delivery-threshold per platform.
 *
 * These feed the basket optimiser directly, and the shipped defaults are
 * educated guesses — fees differ by city, cart value and account. Getting them
 * right is the difference between a correct recommendation and a confident
 * wrong one, so they're editable rather than buried in code.
 */
function FeeEditor({ toast }) {
  const { data, setData, run: reload } = useAsync(api.fees, []);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const edit = (platform, field, value) => {
    setData((d) => ({ ...d, [platform]: { ...d[platform], [field]: value } }));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.saveFees(data);
      setDirty(false);
      toast?.({ title: 'Fees saved', body: 'Re-price your basket to see the effect.' });
    } catch (e) { toast?.({ title: 'Failed', body: e.message }); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true);
    try { await api.resetFees(); await reload(); setDirty(false); }
    finally { setBusy(false); }
  };

  if (!data) return null;

  return (
    <>
      <div className="section-head"><h2>Delivery fees</h2></div>
      <div className="card">
        <p className="tiny muted" style={{ marginBottom: 11, lineHeight: 1.55 }}>
          What the basket optimiser assumes. Defaults are estimates — correct them to whatever
          you actually get charged and the recommendation gets sharper.
        </p>

        <div className="feerow">
          <span />
          <span className="feehead">Delivery</span>
          <span className="feehead">Handling</span>
          <span className="feehead">Free above</span>
        </div>

        {Object.entries(data).map(([platform, f]) => (
          <div className="feerow" key={platform}>
            <span className="feename">
              <i className="swatch" style={{ background: f.color }} />
              {f.label}
            </span>
            {['deliveryFee', 'handling', 'freeAbove'].map((field) => (
              <input key={field} className="num" type="number" inputMode="decimal" min="0"
                     value={f[field] ?? 0}
                     onChange={(e) => edit(platform, field, e.target.value === '' ? 0 : Number(e.target.value))} />
            ))}
          </div>
        ))}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn sm" onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : dirty ? 'Save fees' : 'Saved'}
          </button>
          <button className="btn ghost sm" onClick={reset} disabled={busy}>Reset to defaults</button>
        </div>
      </div>
    </>
  );
}
