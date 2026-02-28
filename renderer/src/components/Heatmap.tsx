import { useMemo } from 'react';

interface Cell {
  day: string;
  hour: number;
  count: number;
}

interface Props {
  data: Cell[];
  onCellClick?: (cell: Cell) => void;
}

export function Heatmap({ data, onCellClick }: Props) {
  const { max, dayOrder, cellMap } = useMemo(() => {
    const maxCount = Math.max(...data.map((item) => item.count), 1);
    const days = Array.from(new Set(data.map((item) => item.day))).sort();
    const map = new Map<string, Cell>();
    for (const item of data) {
      map.set(`${item.day}|${item.hour}`, item);
    }
    return {
      max: maxCount,
      dayOrder: days,
      cellMap: map
    };
  }, [data]);

  return (
    <div className="card p-3 min-h-0 overflow-hidden flex flex-col h-full">
      <p className="mb-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
        Day/Hour Heatmap
      </p>
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
        {Array.from({ length: 24 }).map((_, hour) => (
          <span key={`h-${hour}`} className="text-[10px] text-center" style={{ color: 'var(--muted)' }}>
            {hour}
          </span>
        ))}
      </div>
      <div className="mt-2 space-y-2 min-h-0 overflow-auto pr-1">
        {dayOrder.map((day) => (
          <div key={day} className="grid grid-cols-[70px_1fr] items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {day.slice(5)}
            </span>
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
              {Array.from({ length: 24 }).map((_, hour) => {
                const cell = cellMap.get(`${day}|${hour}`);
                const intensity = Math.min((cell?.count ?? 0) / max, 1);
                return (
                  <div
                    key={`${day}-${hour}`}
                    title={`${day} ${hour}:00 (${cell?.count ?? 0})`}
                    className="h-4 rounded"
                    style={{
                      background: `rgba(36, 132, 235, ${0.12 + intensity * 0.88})`,
                      cursor: onCellClick ? 'pointer' : 'default'
                    }}
                    onClick={() => onCellClick?.({ day, hour, count: cell?.count ?? 0 })}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
