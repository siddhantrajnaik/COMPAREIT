/**
 * Price history sparkline.
 *
 * Shows the trailing median as a dashed baseline so a "deal" can be judged
 * against what the thing normally costs, not against a marketing MRP.
 */
export default function Sparkline({ points, median, height = 34 }) {
  if (!points?.length) return null;

  const prices = points.map((p) => p.p);
  const min = Math.min(...prices, median ?? Infinity);
  const max = Math.max(...prices, median ?? -Infinity);
  const span = max - min || 1;
  const pad = 3;
  const W = 100;
  const H = height;

  const x = (i) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (p) => pad + (1 - (p - min) / span) * (H - pad * 2);

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(p.p).toFixed(2)}`).join(' ');
  const area = `${d} L${W},${H} L0,${H} Z`;

  const last = points[points.length - 1];
  const falling = points.length > 1 && last.p < points[0].p;
  const stroke = falling ? 'var(--accent)' : 'var(--text-dim)';

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {median != null && (
        <line x1="0" x2={W} y1={y(median)} y2={y(median)}
              stroke="var(--text-mute)" strokeWidth="0.6" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      )}
      <path d={area} fill="url(#sparkfill)" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.4"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last.p)} r="2" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
