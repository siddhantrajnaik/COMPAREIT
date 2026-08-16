import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { useSSE, useAsync, useToasts } from './hooks';
import SearchView from './views/SearchView';
import WatchView from './views/WatchView';
import BasketView from './views/BasketView';
import AlertsView from './views/AlertsView';
import SettingsView from './views/SettingsView';
import { IconSearch, IconEye, IconBasket, IconBell, IconSliders } from './components/Icons';

const TABS = [
  { id: 'search',   label: 'Compare',  Icon: IconSearch },
  { id: 'watch',    label: 'Tracking', Icon: IconEye },
  { id: 'basket',   label: 'Basket',   Icon: IconBasket },
  { id: 'alerts',   label: 'Alerts',   Icon: IconBell },
  { id: 'settings', label: 'Settings', Icon: IconSliders },
];

export default function App() {
  const [tab, setTab] = useState('search');
  const [toasts, toast] = useToasts();
  const [unseen, setUnseen] = useState(0);
  const [bump, setBump] = useState(0);          // forces child views to refetch
  const [installPrompt, setInstallPrompt] = useState(null);

  const { data: health, run: reloadHealth } = useAsync(api.health, []);

  const refresh = useCallback(() => setBump((b) => b + 1), []);

  // Live server events: alerts, poll cycles, rescue status.
  const connected = useSSE({
    alert: (a) => {
      if (!a) return;
      toast({ title: a.title, body: a.body, kind: a.kind });
      setUnseen((n) => n + 1);
      refresh();
    },
    poll: (p) => { if (p?.state === 'done') { refresh(); reloadHealth(); } },
    rescue: () => reloadHealth(),
    'watch-updated': refresh,
  });

  useEffect(() => { api.alerts(50).then((a) => setUnseen(a.filter((x) => !x.seen).length)).catch(() => {}); }, []);

  useEffect(() => {
    if (tab === 'alerts' && unseen > 0) { api.markSeen().catch(() => {}); setUnseen(0); }
  }, [tab, unseen]);

  // Capture the install prompt so Settings can offer it deliberately rather
  // than letting Chrome's banner interrupt a search.
  useEffect(() => {
    const onBIP = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', onBIP);
    return () => window.removeEventListener('beforeinstallprompt', onBIP);
  }, []);

  const doInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const addWatch = async (group) => {
    await api.addWatch({
      query: group.name, label: group.name, matchKey: group.offers[0]?.matchKey,
      targetPrice: null, minDiscount: 20, notifyRestock: true,
    });
    toast({ title: 'Tracking', body: `${group.name} — you'll hear about drops.` });
    refresh();
  };

  const addBasket = async (group) => {
    await api.addBasket({ query: group.name, qty: 1 });
    toast({ title: 'Added to basket', body: group.name });
    refresh();
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          QuickCompare
          <small>{health?.location?.locality || '…'}</small>
        </div>
        <div className="topbar-right">
          <span className={`pill ${connected ? 'live' : 'off'}`}>
            <i className="bulb" />{connected ? 'live' : 'offline'}
          </span>
        </div>
      </header>

      <main className="main" key={tab}>
        {tab === 'search' && (
          <SearchView health={health} onWatch={addWatch} onBasket={addBasket} toast={toast} />
        )}
        {tab === 'watch'  && <WatchView toast={toast} bump={bump} />}
        {tab === 'basket' && <BasketView toast={toast} bump={bump} />}
        {tab === 'alerts' && <AlertsView bump={bump} />}
        {tab === 'settings' && (
          <SettingsView health={health} reloadHealth={reloadHealth} toast={toast}
                        installPrompt={installPrompt} onInstall={doInstall} />
        )}
      </main>

      <nav className="tabbar">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            <Icon />
            {label}
            {id === 'alerts' && unseen > 0 && <span className="badge">{unseen > 9 ? '9+' : unseen}</span>}
          </button>
        ))}
      </nav>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'rescue' ? 'rescue' : ''}`}>
            <strong>{t.title}</strong>
            {t.body && <span>{t.body}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
