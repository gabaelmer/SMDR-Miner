import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  VisibilityState
} from '@tanstack/react-table';
import { SMDRRecord } from '../../../shared/types';
import { formatCurrency } from '../../../shared/utils/currency';

interface Props {
  rows: SMDRRecord[];
  loading?: boolean;
  showBilling?: boolean;
  onPaginationChange?: (page: number, limit: number) => void;
  totalRecords?: number;
  initialPageSize?: number;
  resetPaginationToken?: number;
}

const STATUS_STYLE: Record<string, string> = {
  A: 'sa',
  B: 'sb2',
  T: 'st',
  D: 'sd',
  E: 'sd',
  I: 'sb2',
  O: 'sb2',
  S: 'sb2',
  U: 'sb2',
  C: 'sb2',
  R: 'sb2'
};

const LONG_CALL_STYLE: Record<string, string> = {
  ' ': 'sb2',
  '-': 'st',
  '%': 'bi',
  '+': 'bi'
};

const PARTY_TYPE_BADGE: Record<string, string> = {
  station: 'bint',
  attendant: 'bext',
  co_trunk: 'bext',
  non_co_trunk: 'bext',
  ip_trunk: 'bext',
  unknown: 'sb2'
};

const CAT_STYLE: Record<string, string> = {
  local: 'bl',
  national: 'bn',
  mobile: 'bm',
  international: 'bi',
  unclassified: 'bu'
};

const COMPLETION_LEGEND: Array<{ code: string; label: string }> = [
  { code: 'A', label: 'Answered' },
  { code: 'B', label: 'Busy' },
  { code: 'E', label: 'Error' },
  { code: 'T', label: 'Toll Denied / Pickup' },
  { code: 'I', label: 'Internal' },
  { code: 'O', label: 'Occupied' },
  { code: 'D', label: 'Do Not Disturb' },
  { code: 'S', label: 'Out of Service' },
  { code: 'U', label: 'Attendant Unavailable' },
  { code: 'C', label: 'Caller Account Code' },
  { code: 'R', label: 'Receiver Account Code' }
];

const VIRTUAL_ROW_HEIGHT = 54;
const VIRTUAL_OVERSCAN = 8;

function durationToSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  const parts = duration.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function timeToSeconds(time: string | undefined): number {
  if (!time) return 0;
  const parts = time.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  const [h = 0, m = 0, s = 0] = parts;
  return h * 3600 + m * 60 + s;
}

function recordKey(record: SMDRRecord): string {
  return `${record.date}|${record.startTime}|${record.callingParty}|${record.calledParty}|${record.callIdentifier ?? ''}|${record.associatedCallIdentifier ?? ''}`;
}

function visibilityStorageKey(showBilling: boolean): string {
  return showBilling ? 'call-log-column-visibility-billing' : 'call-log-column-visibility';
}

function pageSizeStorageKey(showBilling: boolean): string {
  return showBilling ? 'call-log-page-size-billing' : 'call-log-page-size';
}

export function CallLogTable({
  rows,
  loading = false,
  showBilling = false,
  onPaginationChange,
  totalRecords,
  initialPageSize = 50,
  resetPaginationToken = 0
}: Props) {
  const baseVisibility: VisibilityState = {
    date: true,
    startTime: true,
    duration: true,
    callingParty: true,
    calledParty: true,
    digitsDialed: true,
    accountCode: false,
    callCompletionStatus: true,
    callType: false,
    callIdentifier: false,
    associatedCallIdentifier: false,
    networkOLI: false,
    // New Mitel spec fields (hidden by default)
    longCallIndicator: false,
    attendantFlag: false,
    timeToAnswer: false,
    meterPulses: false,
    speedCallForwardFlag: false,
    routeOptFlag: false,
    systemId: false,
    ani: false,
    dnis: false,
    callSequence: false,
    suiteId: false,
    twoBChannelTag: false,
    callingEHDU: false,
    calledEHDU: false,
    callingLocation: false,
    calledLocation: false,
    recordFormat: false,
    // Billing columns
    call_category: showBilling,
    call_cost: showBilling
  };

  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    if (typeof window === 'undefined') return baseVisibility;
    try {
      const raw = window.localStorage.getItem(visibilityStorageKey(showBilling));
      if (!raw) return baseVisibility;
      const parsed = JSON.parse(raw) as VisibilityState;
      return { ...baseVisibility, ...parsed };
    } catch {
      return baseVisibility;
    }
  });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState(() => {
    let pageSize = initialPageSize;
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(pageSizeStorageKey(showBilling));
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed) && parsed >= 25 && parsed <= 250) pageSize = parsed;
    }
    return { pageIndex: 0, pageSize };
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [copiedState, setCopiedState] = useState<string>('');
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(420);

  const selectedRecord = useMemo(() => rows.find((row) => recordKey(row) === selectedKey) ?? null, [rows, selectedKey]);

  const columns = useMemo<ColumnDef<SMDRRecord>[]>(
    () => {
      const baseColumns: ColumnDef<SMDRRecord>[] = [
        {
          accessorKey: 'date',
          header: 'Date',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>{getValue<string>()}</span>
        },
        {
          accessorKey: 'startTime',
          header: 'Start',
          sortingFn: (a, b, id) => timeToSeconds(String(a.getValue(id) ?? '')) - timeToSeconds(String(b.getValue(id) ?? '')),
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>{getValue<string>()}</span>
        },
        {
          id: 'duration',
          accessorFn: (row) => durationToSeconds(row.duration),
          header: 'Duration',
          cell: ({ row }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>{row.original.duration}</span>
        },
        {
          accessorKey: 'callingParty',
          header: 'Calling',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'calledParty',
          header: 'Called',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'digitsDialed',
          header: 'Digits Dialled',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'accountCode',
          header: 'Account',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'callCompletionStatus',
          header: 'Completion',
          cell: ({ getValue }) => {
            const status = getValue<string>();
            return <span className={STATUS_STYLE[status] || 'sb2'} style={{ fontSize: '13px', fontWeight: 700, padding: '4px 8px', color: '#FFFFFF' }}>{status || '—'}</span>;
          }
        },
        {
          accessorKey: 'callType',
          header: 'Type',
          cell: ({ getValue }) => {
            const type = getValue<string>();
            return <span className={`badge ${type === 'internal' ? 'bint' : 'bext'}`} style={{ fontSize: '13px', fontWeight: 600, padding: '4px 10px', color: '#FFFFFF' }}>{type || '—'}</span>;
          }
        },
        {
          accessorKey: 'callIdentifier',
          header: 'Call ID',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'associatedCallIdentifier',
          header: 'Assoc ID',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'networkOLI',
          header: 'OLI',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600, color: '#FFFFFF' }}>{getValue<string>() || '—'}</span>
        },
        // === Mitel Spec Extended Fields ===
        {
          accessorKey: 'longCallIndicator',
          header: 'Long',
          cell: ({ getValue }) => {
            const indicator = getValue<string>();
            const labels: Record<string, string> = { ' ': '<5m', '-': '5-9m', '%': '10-29m', '+': '30+m' };
            return <span className={LONG_CALL_STYLE[indicator] || 'sb2'} style={{ fontSize: '13px', fontWeight: 700, padding: '4px 8px', color: '#FFFFFF' }}>{labels[indicator] || '—'}</span>;
          }
        },
        {
          accessorKey: 'attendantFlag',
          header: 'Attd',
          cell: ({ getValue }) => {
            const flag = getValue<string>();
            return flag === '*' ? <span className="st" style={{ fontSize: '13px', fontWeight: 700, padding: '4px 8px', color: '#FFFFFF' }}>✱</span> : <span>—</span>;
          }
        },
        {
          accessorKey: 'timeToAnswer',
          header: 'TTA',
          cell: ({ getValue }) => {
            const tta = getValue<number | null>();
            return tta !== null && tta !== undefined ? <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{tta}s</span> : <span>—</span>;
          }
        },
        {
          accessorKey: 'meterPulses',
          header: 'Meter',
          cell: ({ getValue }) => {
            const pulses = getValue<number | null>();
            return pulses !== null && pulses !== undefined ? <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{pulses}</span> : <span>—</span>;
          }
        },
        {
          accessorKey: 'speedCallForwardFlag',
          header: 'S/F',
          cell: ({ getValue }) => {
            const flag = getValue<string>();
            const labels: Record<string, string> = { S: 'Speed', F: 'Fwd' };
            return flag ? <span className="badge bext" style={{ fontSize: '13px', fontWeight: 600, padding: '4px 8px' }}>{labels[flag] || flag}</span> : <span>—</span>;
          }
        },
        {
          accessorKey: 'routeOptFlag',
          header: 'Route',
          cell: ({ getValue }) => {
            const flag = getValue<string>();
            const labels: Record<string, string> = { r: 'Pre-opt', R: 'Post-opt' };
            return flag ? <span className="badge bl" style={{ fontSize: '13px', fontWeight: 600, padding: '4px 8px' }}>{labels[flag] || flag}</span> : <span>—</span>;
          }
        },
        {
          accessorKey: 'systemId',
          header: 'Sys ID',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'ani',
          header: 'ANI',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'dnis',
          header: 'DNIS',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'callSequence',
          header: 'Seq',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'suiteId',
          header: 'Suite',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'twoBChannelTag',
          header: '2B Tag',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'callingEHDU',
          header: 'EHDU (Call)',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'calledEHDU',
          header: 'EHDU (Recv)',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'callingLocation',
          header: 'Location (Call)',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'calledLocation',
          header: 'Location (Recv)',
          cell: ({ getValue }) => <span className="mono" style={{ fontSize: '14px', fontWeight: 600 }}>{getValue<string>() || '—'}</span>
        },
        {
          accessorKey: 'recordFormat',
          header: 'Format',
          cell: ({ getValue }) => {
            const format = getValue<string>();
            return <span className="badge bu" style={{ fontSize: '13px', fontWeight: 600, padding: '4px 8px' }}>{format || '—'}</span>;
          }
        }
      ];

      if (showBilling) {
        baseColumns.push(
          {
            accessorKey: 'call_category',
            header: 'Category',
            cell: ({ getValue }) => {
              const cat = getValue<string>();
              if (!cat) return <span>—</span>;
              return <span className={`badge ${CAT_STYLE[cat] || 'bu'}`}>{cat}</span>;
            }
          },
          {
            accessorKey: 'call_cost',
            header: 'Cost',
            cell: ({ row }) => {
              const cost = row.original.call_cost as number | undefined;
              const currency = row.original.bill_currency as string | undefined;
              return cost ? <span className="mono" style={{ color: 'var(--brand)', fontWeight: 700 }}>{formatCurrency(cost, currency || 'PHP')}</span> : <span>—</span>;
            }
          }
        );
      }

      return baseColumns;
    },
    [showBilling]
  );

  const table = useReactTable({
    columns,
    data: rows,
    state: { columnVisibility: visibility, sorting, pagination },
    onColumnVisibilityChange: setVisibility,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    rowCount: totalRecords ?? rows.length
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(visibilityStorageKey(showBilling), JSON.stringify(visibility));
    }
  }, [showBilling, visibility]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(pageSizeStorageKey(showBilling), String(pagination.pageSize));
    }
  }, [pagination.pageSize, showBilling]);

  useEffect(() => {
    if (onPaginationChange) {
      onPaginationChange(pagination.pageIndex, pagination.pageSize);
    }
    // Intentionally keyed by pagination values to avoid callback identity loops.
  }, [pagination.pageIndex, pagination.pageSize]);

  useEffect(() => {
    setPagination((prev) => {
      if (prev.pageIndex === 0) return prev;
      return { ...prev, pageIndex: 0 };
    });
  }, [resetPaginationToken]);

  useEffect(() => {
    setPagination((prev) => {
      if (initialPageSize === prev.pageSize) return prev;
      return { ...prev, pageSize: initialPageSize };
    });
  }, [initialPageSize]);

  useEffect(() => {
    if (!selectedKey) return;
    const stillExists = rows.some((row) => recordKey(row) === selectedKey);
    if (!stillExists) setSelectedKey(null);
  }, [rows, selectedKey]);

  const copyToClipboard = async (label: string, value: string | undefined) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedState(`${label} copied`);
      setTimeout(() => setCopiedState(''), 1400);
    } catch {
      setCopiedState('Copy failed');
      setTimeout(() => setCopiedState(''), 1400);
    }
  };

  const pageCount = Math.max(table.getPageCount(), 1);
  const rowModel = table.getRowModel().rows;
  const visibleColumnsCount = table.getVisibleLeafColumns().length;
  const shouldVirtualize = rowModel.length > 80;

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;

    const updateHeight = () => {
      setViewportHeight(node.clientHeight);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const virtualRange = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        startIndex: 0,
        endIndex: rowModel.length,
        topSpacer: 0,
        bottomSpacer: 0
      };
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const endIndex = Math.min(
      rowModel.length,
      Math.ceil((scrollTop + viewportHeight) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN
    );
    const topSpacer = startIndex * VIRTUAL_ROW_HEIGHT;
    const bottomSpacer = Math.max(0, (rowModel.length - endIndex) * VIRTUAL_ROW_HEIGHT);
    return { startIndex, endIndex, topSpacer, bottomSpacer };
  }, [rowModel.length, scrollTop, shouldVirtualize, viewportHeight]);

  const visibleRows = useMemo(
    () => rowModel.slice(virtualRange.startIndex, virtualRange.endIndex),
    [rowModel, virtualRange.endIndex, virtualRange.startIndex]
  );

  return (
    <div className="card h-full min-h-0 flex flex-col" style={{ padding: '12px 14px', position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px', maxHeight: '56px', overflowY: 'auto' }}>
        {table.getAllLeafColumns().map((column) => (
          <label
            key={column.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '11px',
              color: 'var(--muted)',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={column.getIsVisible()}
              aria-label={`Toggle ${String(column.columnDef.header)} column`}
              onChange={column.getToggleVisibilityHandler()}
              style={{ accentColor: 'var(--brand)' }}
            />
            {String(column.columnDef.header)}
          </label>
        ))}
      </div>

      <div
        ref={viewportRef}
        className="twrap flex-1 min-h-0"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} style={{ fontSize: '14px', fontWeight: 700, padding: '14px 12px', borderBottom: '2px solid var(--border)' }}>
                    <button
                      type="button"
                      aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                      onClick={header.column.getToggleSortingHandler()}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'inherit',
                        font: 'inherit',
                        fontWeight: '700',
                        fontSize: '14px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '0'
                      }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <span style={{ color: 'var(--muted2)', fontSize: '12px' }}>
                        {{ asc: '↑', desc: '↓' }[header.column.getIsSorted() as string] ?? ''}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody id="log-tbody">
            {virtualRange.topSpacer > 0 && (
              <tr aria-hidden>
                <td colSpan={visibleColumnsCount} style={{ padding: 0, borderBottom: 'none' }}>
                  <div style={{ height: `${virtualRange.topSpacer}px` }} />
                </td>
              </tr>
            )}
            {visibleRows.map((row) => {
              const key = recordKey(row.original);
              const isSelected = selectedKey === key;
              return (
                <tr
                  key={row.id}
                  tabIndex={0}
                  aria-selected={isSelected}
                  onClick={() => setSelectedKey(key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedKey(key);
                    }
                  }}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(36, 132, 235, 0.16)' : undefined
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} style={{ padding: '14px 12px', fontSize: '14px', borderBottom: '1px solid var(--border)' }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {virtualRange.bottomSpacer > 0 && (
              <tr aria-hidden>
                <td colSpan={visibleColumnsCount} style={{ padding: 0, borderBottom: 'none' }}>
                  <div style={{ height: `${virtualRange.bottomSpacer}px` }} />
                </td>
              </tr>
            )}
            {rowModel.length === 0 && (
              <tr>
                <td colSpan={visibleColumnsCount} style={{ textAlign: 'center', padding: '40px 12px', color: 'var(--muted2)', fontSize: '15px' }}>
                  No records found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(5, 11, 26, 0.72)',
            backdropFilter: 'blur(2px)',
            color: 'var(--muted)',
            fontSize: '13px',
            fontWeight: 600
          }}
        >
          <span className="spin" style={{ marginRight: '8px' }}>⟳</span>
          Applying filters...
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
        <div style={{ fontSize: '11px', color: 'var(--muted2)', whiteSpace: 'nowrap' }}>
          Showing {rowModel.length} of {totalRecords ?? rows.length} records
        </div>
        <div
          style={{
            flex: '1 1 420px',
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            overflowX: 'auto',
            padding: '0 8px'
          }}
        >
          {COMPLETION_LEGEND.map((entry) => (
            <span
              key={entry.code}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 7px',
                borderRadius: '10px',
                border: '1px solid rgba(56, 189, 248, 0.38)',
                background: 'linear-gradient(135deg, rgba(18, 36, 80, 0.95), rgba(15, 33, 75, 0.9))',
                boxShadow: 'inset 0 0 0 1px rgba(56, 189, 248, 0.18), 0 0 10px rgba(56, 189, 248, 0.14)',
                fontSize: '10px',
                color: '#dbeafe',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
              title={`${entry.code} = ${entry.label}`}
            >
              <span
                className={STATUS_STYLE[entry.code] || 'sb2'}
                style={{
                  minWidth: '18px',
                  textAlign: 'center',
                  color: '#FFFFFF',
                  boxShadow: '0 0 8px rgba(59, 130, 246, 0.35)'
                }}
              >
                {entry.code}
              </span>
              <span style={{ color: '#eef6ff' }}>{entry.label}</span>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap' }}>
            <button
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              className="btn bg2"
              style={{ fontSize: '10px', height: '28px', padding: '0 10px', minWidth: '50px' }}
            >
              First
            </button>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="btn bg2"
              style={{ fontSize: '10px', height: '28px', padding: '0 10px', minWidth: '50px' }}
            >
              Prev
            </button>
            <span style={{ fontSize: '11px', color: 'var(--text)', whiteSpace: 'nowrap', minWidth: '92px', textAlign: 'center' }}>
              Page {table.getState().pagination.pageIndex + 1} of {pageCount}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="btn bg2"
              style={{ fontSize: '10px', height: '28px', padding: '0 10px', minWidth: '50px' }}
            >
              Next
            </button>
            <button
              onClick={() => table.setPageIndex(Math.max(table.getPageCount() - 1, 0))}
              disabled={!table.getCanNextPage()}
              className="btn bg2"
              style={{ fontSize: '10px', height: '28px', padding: '0 10px', minWidth: '50px' }}
            >
              Last
            </button>
          </div>
          <select
            value={table.getState().pagination.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            style={{
              fontSize: '11px',
              height: '28px',
              padding: '0 10px',
              width: 'auto',
              minWidth: '112px',
              flex: '0 0 auto',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              borderRadius: '7px'
            }}
          >
            {[25, 50, 100, 250].map((size) => (
              <option key={size} value={size}>{size} / page</option>
            ))}
          </select>
        </div>
      </div>

      {selectedRecord && (
        <div
          className="rounded-2xl border p-3"
          style={{
            marginTop: '10px',
            borderColor: 'var(--border)',
            background: 'var(--surface-alt)',
            maxHeight: '280px',
            overflowY: 'auto'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <p style={{ fontSize: '12px', color: 'var(--text)', fontWeight: 700 }}>Record Details (Mitel SMDR)</p>
            <button
              className="btn bg2"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() => setSelectedKey(null)}
            >
              Close
            </button>
          </div>
          
          {/* Core Fields */}
          <div className="grid gap-2 md:grid-cols-3" style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '12px' }}>
            <p><strong style={{ color: 'var(--text)' }}>Date/Time:</strong> {selectedRecord.date} {selectedRecord.startTime}</p>
            <p><strong style={{ color: 'var(--text)' }}>Duration:</strong> {selectedRecord.duration}</p>
            <p><strong style={{ color: 'var(--text)' }}>Long Call:</strong> {selectedRecord.longCallIndicator === '+' ? '30+ min' : selectedRecord.longCallIndicator === '%' ? '10-29 min' : selectedRecord.longCallIndicator === '-' ? '5-9 min' : '<5 min'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Calling:</strong> {selectedRecord.callingParty || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Called:</strong> {selectedRecord.calledParty || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Third Party:</strong> {selectedRecord.thirdParty || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Trunk:</strong> {selectedRecord.trunkNumber || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Digits Dialed:</strong> {selectedRecord.digitsDialed || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Account Code:</strong> {selectedRecord.accountCode || '—'}</p>
          </div>
          
          {/* Call Status & Flags */}
          <div className="grid gap-2 md:grid-cols-3" style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '12px' }}>
            <p><strong style={{ color: 'var(--text)' }}>Completion:</strong> <span className={STATUS_STYLE[selectedRecord.callCompletionStatus || ''] || 'sb2'} style={{ padding: '2px 6px', borderRadius: '4px' }}>{selectedRecord.callCompletionStatus || '—'}</span></p>
            <p><strong style={{ color: 'var(--text)' }}>Transfer:</strong> {selectedRecord.transferConference || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Speed/Fwd:</strong> {selectedRecord.speedCallForwardFlag === 'S' ? 'Speed Call' : selectedRecord.speedCallForwardFlag === 'F' ? 'Forwarded' : '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Attendant:</strong> {selectedRecord.attendantFlag === '*' ? '✱ Assisted' : '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Time to Answer:</strong> {selectedRecord.timeToAnswer !== null && selectedRecord.timeToAnswer !== undefined ? `${selectedRecord.timeToAnswer}s` : '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Meter Pulses:</strong> {selectedRecord.meterPulses ?? '—'}</p>
          </div>
          
          {/* Network & Extended Fields */}
          <div className="grid gap-2 md:grid-cols-3" style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '12px' }}>
            <p><strong style={{ color: 'var(--text)' }}>Call ID:</strong> {selectedRecord.callIdentifier || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Assoc ID:</strong> {selectedRecord.associatedCallIdentifier || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Sequence:</strong> {selectedRecord.callSequence || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Network OLI:</strong> {selectedRecord.networkOLI || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>ANI:</strong> {selectedRecord.ani || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>DNIS:</strong> {selectedRecord.dnis || '—'}</p>
          </div>
          
          {/* Extended Reporting Fields */}
          {(selectedRecord.suiteId || selectedRecord.twoBChannelTag || selectedRecord.callingEHDU || selectedRecord.calledEHDU || selectedRecord.callingLocation || selectedRecord.calledLocation) && (
            <div className="grid gap-2 md:grid-cols-3" style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '12px' }}>
              <p><strong style={{ color: 'var(--text)' }}>Suite ID:</strong> {selectedRecord.suiteId || '—'}</p>
              <p><strong style={{ color: 'var(--text)' }}>2B Channel Tag:</strong> {selectedRecord.twoBChannelTag || '—'}</p>
              <p><strong style={{ color: 'var(--text)' }}>EHDU (Calling):</strong> {selectedRecord.callingEHDU || '—'}</p>
              <p><strong style={{ color: 'var(--text)' }}>EHDU (Called):</strong> {selectedRecord.calledEHDU || '—'}</p>
              <p><strong style={{ color: 'var(--text)' }}>Location (Calling):</strong> {selectedRecord.callingLocation || '—'}</p>
              <p><strong style={{ color: 'var(--text)' }}>Location (Called):</strong> {selectedRecord.calledLocation || '—'}</p>
            </div>
          )}
          
          {/* System & Format Info */}
          <div className="grid gap-2 md:grid-cols-3" style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '12px' }}>
            <p><strong style={{ color: 'var(--text)' }}>System ID:</strong> {selectedRecord.systemId || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Route Opt:</strong> {selectedRecord.routeOptFlag === 'r' ? 'Pre-opt' : selectedRecord.routeOptFlag === 'R' ? 'Post-opt' : '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Record Format:</strong> {selectedRecord.recordFormat || '—'}</p>
            {selectedRecord.call_cost !== undefined && (
              <p><strong style={{ color: 'var(--text)' }}>Cost:</strong> <span style={{ color: 'var(--brand)', fontWeight: 700 }}>{formatCurrency(selectedRecord.call_cost, selectedRecord.bill_currency || 'PHP')}</span></p>
            )}
          </div>
          
          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
            <button className="btn bg2" style={{ fontSize: '11px', padding: '5px 10px' }} onClick={() => void copyToClipboard('Call ID', selectedRecord.callIdentifier)}>
              Copy Call ID
            </button>
            <button className="btn bg2" style={{ fontSize: '11px', padding: '5px 10px' }} onClick={() => void copyToClipboard('Assoc ID', selectedRecord.associatedCallIdentifier)}>
              Copy Assoc ID
            </button>
            <button className="btn bg2" style={{ fontSize: '11px', padding: '5px 10px' }} onClick={() => void copyToClipboard('Raw line', selectedRecord.rawLine)}>
              Copy Raw Line
            </button>
          </div>
          {copiedState && (
            <p style={{ marginTop: '8px', fontSize: '11px', color: 'var(--brand)', fontWeight: 700 }}>{copiedState}</p>
          )}
        </div>
      )}
    </div>
  );
}
