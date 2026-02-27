import { useEffect, useState } from 'react';
import { TREND_COLORS } from './constants';
import { fmtCur } from './utils';

type RechartsModule = typeof import('recharts');

interface DailyTrendChartProps {
  trendData: Array<Record<string, string | number>>;
  trendCurrencies: string[];
  from: string;
  to: string;
}

export function DailyTrendChart({ trendData, trendCurrencies, from, to }: DailyTrendChartProps) {
  const [recharts, setRecharts] = useState<RechartsModule | null>(null);

  useEffect(() => {
    let active = true;
    void import('recharts').then((mod) => {
      if (active) setRecharts(mod);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
          Daily Trend
        </p>
        <p className="text-xs" style={{ color: 'var(--muted2)' }}>
          {from} to {to}
        </p>
      </div>
      {trendCurrencies.length > 1 && (
        <p className="text-xs mb-2" style={{ color: 'var(--muted2)' }}>
          Mixed currencies detected. Cost is shown per currency and is not combined.
        </p>
      )}

      {!recharts ? (
        <div className="h-[250px] flex items-center justify-center text-sm" style={{ color: 'var(--muted2)' }}>
          Loading chart...
        </div>
      ) : (
        <div style={{ width: '100%', height: 250 }}>
          <recharts.ResponsiveContainer>
            <recharts.LineChart data={trendData} margin={{ top: 6, right: 8, left: 6, bottom: 6 }}>
              <recharts.CartesianGrid stroke="rgba(95,110,136,0.2)" vertical={false} />
              <recharts.XAxis dataKey="label" stroke="var(--muted2)" tick={{ fontSize: 11 }} />
              <recharts.YAxis yAxisId="calls" stroke="var(--muted2)" tick={{ fontSize: 11 }} />
              <recharts.YAxis yAxisId="cost" orientation="right" stroke="var(--muted2)" tick={{ fontSize: 11 }} />
              <recharts.Tooltip
                contentStyle={{
                  borderRadius: 10,
                  border: '1px solid rgba(36,132,235,0.6)',
                  background: '#081935'
                }}
                labelStyle={{ color: '#e9f1ff' }}
                formatter={(value: number, name: string) => {
                  if (name === 'Calls') return [Number(value).toLocaleString(), name];
                  const match = /^Cost \((.+)\)$/.exec(name);
                  if (match) return [fmtCur(Number(value), match[1]), name];
                  return [Number(value).toFixed(2), name];
                }}
              />
              <recharts.Legend wrapperStyle={{ fontSize: 12 }} />
              <recharts.Line yAxisId="calls" type="monotone" dataKey="callCount" name="Calls" stroke="#22c55e" strokeWidth={2.2} dot={false} />
              {trendCurrencies.map((currency, index) => (
                <recharts.Line
                  key={currency}
                  yAxisId="cost"
                  type="monotone"
                  dataKey={`cost_${currency}`}
                  name={`Cost (${currency})`}
                  stroke={TREND_COLORS[index % TREND_COLORS.length]}
                  strokeWidth={2.2}
                  dot={false}
                  connectNulls
                />
              ))}
            </recharts.LineChart>
          </recharts.ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
