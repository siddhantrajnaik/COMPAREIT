import { api, money, ago, IS_STATIC } from '../api';
import { useAsync } from '../hooks';
import {
  IconTrash, IconTarget, IconTag, IconTrendDown, IconBox, IconBowl, IconBell,
} from '../components/Icons';

/**
 * Alert icons are SVG, never emoji — emoji render inconsistently across
 * platforms, ignore the type colour, and are announced verbatim by screen
 * readers ("chart decreasing"). Each kind also gets its own tinted chip so the
 * type is legible without relying on the glyph alone.
 */
const KIND = {
  target:   { Icon: IconTarget,    cls: '' },
  discount: { Icon: IconTag,       cls: '' },
  drop:     { Icon: IconTrendDown, cls: 'drop' },
  restock:  { Icon: IconBox,       cls: 'restock' },
  rescue:   { Icon: IconBowl,      cls: 'rescue' },
  test:     { Icon: IconBell,      cls: '' },
};

export default function AlertsView({ bump }) {
  const { data: alerts, run: reload } = useAsync(api.alerts, [bump]);

  const clear = async () => { await api.clearAlerts(); reload(); };

  return (
    <>
      <div className="section-head">
        <h2>Alerts</h2>
        {!IS_STATIC && alerts?.length > 0 && (
          <button className="btn ghost sm" onClick={clear}>
            <IconTrash width="15" height="15" aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      {alerts?.length === 0 && (
        <div className="empty">
          <div className="art"><IconBell aria-hidden="true" /></div>
          <h3>Quiet for now</h3>
          <p>Price drops, restocks and nearby food rescues land here — and on your
             phone's lock screen once notifications are on.</p>
        </div>
      )}

      {alerts?.map((a) => {
        const { Icon, cls } = KIND[a.kind] || KIND.test;
        return (
          <div key={a.id} className={`alert-item ${a.seen ? '' : 'unseen'}`}>
            <div className={`alert-ico ${cls}`}><Icon aria-hidden="true" /></div>
            <div className="alert-body grow">
              <h4>{a.title}</h4>
              <p>{a.body}</p>
              <time dateTime={new Date(a.ts).toISOString()}>
                {ago(a.ts)}
                {a.payload?.platform && ` · ${a.payload.platform}`}
                {a.payload?.price != null && ` · ${money(a.payload.price)}`}
              </time>
            </div>
          </div>
        );
      })}
    </>
  );
}
