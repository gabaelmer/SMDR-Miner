import clsx from 'clsx';

interface Props {
  status: string;
  controller?: string;
}

export function ConnectionIndicator({ status, controller }: Props) {
  const normalized = status.toLowerCase();
  const color =
    normalized === 'connected' ? 'bg-emerald-500' : normalized === 'retrying' ? 'bg-amber-500 animate-pulseRing' : 'bg-rose-500';

  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <span className={clsx('inline-flex h-3 w-3 rounded-full', color)} />
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text)' }}>
          {status}
        </p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {controller ? `Controller: ${controller}` : 'Controller not selected'}
        </p>
      </div>
    </div>
  );
}
