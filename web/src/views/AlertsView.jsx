import { api, money, ago } from '../api';
import { useAsync } from '../hooks';
import { IconTrash } from '../components/Icons';

const ICON = { target: '🎯', discount: '🏷️', drop: '📉', restock: '📦', rescue: '🍜', test: '🔔' };

export default function AlertsView({ bump }) {
  const { data: alerts, run: reload } = useAsync(api.alerts, [bump]);

  const clear = async () => { await api.clearAlerts(); reload(); };

  return (
    <>
      <div className="section-head">
        <h2>Alerts</h2>
        {alerts?.length > 0 && (
          <button className="btn ghost sm" onClick={clear}>
            <IconTrash width="13" height="13" /> Clear
          </button>
        )}
      </div>

      {alerts?.length === 0 && (
        <div className="empty">
          <h3>Quiet for now</h3>
          <p>Price drops, restocks and nearby food rescues land here — and on your
             phone's lock screen once notifications are on.</p>
        </div>
      )}

      {alerts?.map((a) => (
        <div key={a.id} className={`alert-item ${a.seen ? '' : 'unseen'}`}>
          <div className="alert-ico">{ICON[a.kind] || '•'}</div>
          <div className="alert-body grow">
            <h4>{a.title}</h4>
            <p>{a.body}</p>
            <time>
              {ago(a.ts)}
              {a.payload?.platform && ` · ${a.payload.platform}`}
              {a.payload?.price != null && ` · ${money(a.payload.price)}`}
            </time>
          </div>
        </div>
      ))}
    </>
  );
}
