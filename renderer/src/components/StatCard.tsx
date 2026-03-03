interface StatCardProps {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  color?: 'brand' | 'green' | 'orange' | 'purple' | 'red';
}

const COLOR_MAP = {
  brand: { bg: 'rgba(36,132,235,0.15)', text: 'var(--brand)' },
  green: { bg: 'rgba(38,182,127,0.15)', text: 'var(--green)' },
  orange: { bg: 'rgba(245,158,11,0.15)', text: 'var(--orange)' },
  purple: { bg: 'rgba(139,92,246,0.15)', text: 'var(--purple)' },
  red: { bg: 'rgba(239,68,68,0.15)', text: 'var(--red)' }
};

export function StatCard({ label, value, icon, color = 'brand' }: StatCardProps) {
  const colors = COLOR_MAP[color];
  
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60" style={{ color: 'var(--text)' }}>
            {label}
          </p>
          <p className="text-2xl font-bold mt-2" style={{ color: colors.text }}>{value}</p>
        </div>
        {icon && (
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: colors.bg }}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
