interface Props {
  label: string;
  value: string | number;
  subtext?: string;
}

export function MetricCard({ label, value, subtext }: Props) {
  return (
    <div className="card fade-up p-4">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        {value}
      </p>
      {subtext ? (
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          {subtext}
        </p>
      ) : null}
    </div>
  );
}
