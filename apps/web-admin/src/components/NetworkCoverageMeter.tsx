import type { NetworkStats } from '../api/invitations-types';

interface Props {
  stats: NetworkStats;
  loading?: boolean;
}

// Circular meter — PRD §8.4 NetworkCoverageMeter "% of counterparties
// verified". Trend line is deferred (no historical data in v1).

const CIRC_SIZE = 120;
const CIRC_STROKE = 10;
const RADIUS = (CIRC_SIZE - CIRC_STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function NetworkCoverageMeter({ stats, loading }: Props) {
  const pct = Math.max(0, Math.min(100, stats.coveragePercent));
  const dashOffset = CIRCUMFERENCE * (1 - pct / 100);

  return (
    <section
      aria-labelledby="coverage-heading"
      className={[
        'rounded-lg border border-gray-200 bg-white p-5',
        'flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6',
      ].join(' ')}
    >
      <div className="flex shrink-0 items-center justify-center">
        <svg
          width={CIRC_SIZE}
          height={CIRC_SIZE}
          viewBox={`0 0 ${CIRC_SIZE} ${CIRC_SIZE}`}
          role="img"
          aria-label={`Network coverage ${pct}%`}
          className="-rotate-90"
        >
          <circle
            cx={CIRC_SIZE / 2}
            cy={CIRC_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#E5E7EB"
            strokeWidth={CIRC_STROKE}
          />
          <circle
            cx={CIRC_SIZE / 2}
            cy={CIRC_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#0F9D58"
            strokeWidth={CIRC_STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
          />
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(90 ${CIRC_SIZE / 2} ${CIRC_SIZE / 2})`}
            className="fill-[#0B1F3A] font-semibold"
            style={{ fontSize: '24px' }}
          >
            {loading ? '—' : `${pct}%`}
          </text>
        </svg>
      </div>
      <div className="flex-1 space-y-1.5">
        <p
          id="coverage-heading"
          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          Network coverage
        </p>
        <p className="text-base text-[#1F2937]">
          {loading ? (
            <span className="text-gray-400">Loading…</span>
          ) : stats.totalInvited === 0 ? (
            <span>You haven't invited anyone yet.</span>
          ) : (
            <span>
              <span className="font-semibold text-[#0B1F3A]">
                {stats.verified} of {stats.totalInvited}
              </span>{' '}
              invited counterparties are verified.
            </span>
          )}
        </p>
        {!loading && stats.totalInvited > 0 ? (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-xs text-gray-500">
            <Stat label="Pending" value={stats.pending} />
            <Stat label="Expired" value={stats.expired} />
            {stats.cancelled > 0 ? (
              <Stat label="Cancelled" value={stats.cancelled} />
            ) : null}
          </dl>
        ) : null}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="font-semibold text-[#0B1F3A]">{value}</dd>
    </div>
  );
}
