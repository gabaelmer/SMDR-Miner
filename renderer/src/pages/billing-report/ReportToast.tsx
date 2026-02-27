interface ToastState {
  type: 'loading' | 'success' | 'error';
  title: string;
  sub: string;
}

export function ReportToast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-full max-w-sm pointer-events-none">
      <div
        className="card p-3 flex items-start gap-3 shadow-xl"
        style={{
          borderColor:
            toast.type === 'success'
              ? 'rgba(34, 197, 94, 0.45)'
              : toast.type === 'error'
                ? 'rgba(239, 68, 68, 0.45)'
                : 'rgba(36, 132, 235, 0.45)',
          background:
            toast.type === 'success'
              ? 'rgba(34, 197, 94, 0.12)'
              : toast.type === 'error'
                ? 'rgba(239, 68, 68, 0.12)'
                : 'rgba(36, 132, 235, 0.12)'
        }}
      >
        <div
          className="h-7 w-7 rounded-full flex items-center justify-center text-sm font-bold"
          style={{
            color: toast.type === 'success' ? '#86efac' : toast.type === 'error' ? '#fca5a5' : '#93c5fd',
            border:
              toast.type === 'success'
                ? '1px solid rgba(34, 197, 94, 0.45)'
                : toast.type === 'error'
                  ? '1px solid rgba(239, 68, 68, 0.45)'
                  : '1px solid rgba(36, 132, 235, 0.45)'
          }}
        >
          {toast.type === 'loading' ? <span className="spin">⟳</span> : toast.type === 'success' ? '✓' : '!'}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            {toast.title}
          </p>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted2)' }}>
            {toast.sub}
          </p>
        </div>
      </div>
    </div>
  );
}

export type { ToastState };
