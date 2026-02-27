import { useEffect, useMemo, useState } from 'react';
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
  U: 'sb2'
};

const CAT_STYLE: Record<string, string> = {
  local: 'bl',
  national: 'bn',
  mobile: 'bm',
  international: 'bi',
  unclassified: 'bu'
};

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

  return (
    <div className="card" style={{ padding: '12px 14px', position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
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
              onChange={column.getToggleVisibilityHandler()}
              style={{ accentColor: 'var(--brand)' }}
            />
            {String(column.columnDef.header)}
          </label>
        ))}
      </div>

      <div className="twrap">
        <table>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} style={{ fontSize: '14px', fontWeight: 700, padding: '14px 12px', borderBottom: '2px solid var(--border)' }}>
                    <button
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
            {table.getRowModel().rows.map((row) => {
              const key = recordKey(row.original);
              const isSelected = selectedKey === key;
              return (
                <tr
                  key={row.id}
                  onClick={() => setSelectedKey(key)}
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
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} style={{ textAlign: 'center', padding: '40px 12px', color: 'var(--muted2)', fontSize: '15px' }}>
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px' }}>
        <div style={{ fontSize: '11px', color: 'var(--muted2)' }}>
          Showing {table.getRowModel().rows.length} of {totalRecords ?? rows.length} records
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            className="btn bg2"
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >
            First
          </button>
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="btn bg2"
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >
            Prev
          </button>
          <span style={{ fontSize: '11px', color: 'var(--text)' }}>
            Page {table.getState().pagination.pageIndex + 1} of {pageCount}
          </span>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="btn bg2"
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >
            Next
          </button>
          <button
            onClick={() => table.setPageIndex(Math.max(table.getPageCount() - 1, 0))}
            disabled={!table.getCanNextPage()}
            className="btn bg2"
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >
            Last
          </button>
          <select
            value={table.getState().pagination.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            style={{ fontSize: '11px', padding: '4px 8px', background: 'var(--surface-alt)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '7px' }}
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
            marginTop: '12px',
            borderColor: 'var(--border)',
            background: 'var(--surface-alt)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <p style={{ fontSize: '12px', color: 'var(--text)', fontWeight: 700 }}>Record Details</p>
            <button
              className="btn bg2"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() => setSelectedKey(null)}
            >
              Close
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-2" style={{ fontSize: '11px', color: 'var(--muted)' }}>
            <p><strong style={{ color: 'var(--text)' }}>Date/Time:</strong> {selectedRecord.date} {selectedRecord.startTime}</p>
            <p><strong style={{ color: 'var(--text)' }}>Duration:</strong> {selectedRecord.duration}</p>
            <p><strong style={{ color: 'var(--text)' }}>Calling:</strong> {selectedRecord.callingParty || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Called:</strong> {selectedRecord.calledParty || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Call ID:</strong> {selectedRecord.callIdentifier || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Assoc ID:</strong> {selectedRecord.associatedCallIdentifier || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Network OLI:</strong> {selectedRecord.networkOLI || '—'}</p>
            <p><strong style={{ color: 'var(--text)' }}>Transfer Flag:</strong> {selectedRecord.transferFlag || '—'}</p>
          </div>
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
