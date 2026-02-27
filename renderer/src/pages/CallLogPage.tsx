import { useMemo, useState } from 'react';
import { RecordFilters } from '../../../shared/types';
import { CallLogTable } from '../components/CallLogTable';
import { useAppStore } from '../state/appStore';

interface FilterChip {
  id: string;
  label: string;
  clear: Partial<RecordFilters>;
}

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0s';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  if (minutes > 0) return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  return `${seconds}s`;
}

function transferFlagLabel(flag: string | undefined): string {
  if (!flag) return '';
  if (flag === 'none') return 'None';
  if (flag === 'T') return 'T - Transfer';
  if (flag === 'X') return 'X - Conference';
  if (flag === 'C') return 'C - Conference';
  return flag;
}

export function CallLogPage() {
  const records = useAppStore((state) => state.records);
  const recordsTotal = useAppStore((state) => state.recordsTotal);
  const callLogSummary = useAppStore((state) => state.callLogSummary);
  const filters = useAppStore((state) => state.filters);
  const setFilters = useAppStore((state) => state.setFilters);
  const refreshRecords = useAppStore((state) => state.refreshRecords);
  const recordsLoading = useAppStore((state) => state.recordsLoading);
  const exportRecords = useAppStore((state) => state.exportRecords);

  const [paginationResetToken, setPaginationResetToken] = useState(0);

  const totalCalls = callLogSummary.totalCalls;
  const totalTalkTime = formatDuration(callLogSummary.totalDurationSeconds);
  const topExtensionsMade = callLogSummary.topExtensionsMade;
  const topExtensionsReceived = callLogSummary.topExtensionsReceived;

  const activeFilterChips = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    if (filters.dateFrom || filters.dateTo) {
      chips.push({
        id: 'date-range',
        label: `Date: ${filters.dateFrom ?? '...'} to ${filters.dateTo ?? '...'}`,
        clear: { date: undefined, dateFrom: undefined, dateTo: undefined }
      });
    }
    if (filters.extension) chips.push({ id: 'extension', label: `Extension: ${filters.extension}`, clear: { extension: undefined } });
    if (filters.accountCode) chips.push({ id: 'account', label: `Account: ${filters.accountCode}`, clear: { accountCode: undefined } });
    if (filters.hour) chips.push({ id: 'hour', label: `Hour: ${String(filters.hour).padStart(2, '0')}:00`, clear: { hour: undefined } });
    if (filters.transferFlag) {
      chips.push({
        id: 'transfer',
        label: `Transfer: ${transferFlagLabel(filters.transferFlag)}`,
        clear: { transferFlag: undefined }
      });
    }
    if (filters.callType) chips.push({ id: 'call-type', label: `Type: ${filters.callType}`, clear: { callType: undefined } });
    if (filters.completionStatus) {
      chips.push({
        id: 'status',
        label: `Status: ${filters.completionStatus}`,
        clear: { completionStatus: undefined }
      });
    }
    if (filters.callIdentifier) {
      chips.push({
        id: 'call-id',
        label: `Call ID: ${filters.callIdentifier}`,
        clear: { callIdentifier: undefined }
      });
    }
    if (filters.associatedCallIdentifier) {
      chips.push({
        id: 'assoc-id',
        label: `Assoc ID: ${filters.associatedCallIdentifier}`,
        clear: { associatedCallIdentifier: undefined }
      });
    }
    if (filters.networkOLI) chips.push({ id: 'oli', label: `OLI: ${filters.networkOLI}`, clear: { networkOLI: undefined } });
    return chips;
  }, [
    filters.accountCode,
    filters.associatedCallIdentifier,
    filters.callIdentifier,
    filters.callType,
    filters.completionStatus,
    filters.dateFrom,
    filters.dateTo,
    filters.extension,
    filters.hour,
    filters.networkOLI,
    filters.transferFlag
  ]);

  const triggerRefresh = () => {
    void refreshRecords();
  };

  const clearFilters = () => {
    setFilters({
      date: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      extension: undefined,
      accountCode: undefined,
      hour: undefined,
      callType: undefined,
      completionStatus: undefined,
      transferFlag: undefined,
      callIdentifier: undefined,
      associatedCallIdentifier: undefined,
      networkOLI: undefined,
      offset: 0
    });
    setPaginationResetToken((value) => value + 1);
    triggerRefresh();
  };

  const handleApplyFilters = () => {
    const nextDateFrom = filters.dateFrom;
    const nextDateTo = filters.dateTo;
    if (nextDateFrom && nextDateTo && nextDateFrom > nextDateTo) {
      setFilters({
        dateFrom: nextDateTo,
        dateTo: nextDateFrom,
        offset: 0
      });
      setPaginationResetToken((value) => value + 1);
      triggerRefresh();
      return;
    }
    setFilters({ offset: 0 });
    setPaginationResetToken((value) => value + 1);
    triggerRefresh();
  };

  const clearSingleFilter = (partial: Partial<RecordFilters>) => {
    setFilters({
      ...partial,
      offset: 0
    });
    setPaginationResetToken((value) => value + 1);
    triggerRefresh();
  };

  const handlePaginationChange = (pageIndex: number, pageSize: number) => {
    setFilters({
      limit: pageSize,
      offset: pageIndex * pageSize
    });
    triggerRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="grid gap-3 md:grid-cols-12">
          <div className="md:col-span-2">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>From:</label>
            <input
              value={filters.dateFrom ?? ''}
              type="date"
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ dateFrom: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>To:</label>
            <input
              value={filters.dateTo ?? ''}
              type="date"
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ dateTo: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Extension:</label>
            <input
              value={filters.extension ?? ''}
              placeholder="e.g. 1001"
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ extension: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Account Code:</label>
            <input
              value={filters.accountCode ?? ''}
              placeholder="e.g. ACC-001"
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ accountCode: e.target.value })}
            />
          </div>
          <div className="md:col-span-1">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Call Type:</label>
            <select
              value={filters.callType ?? ''}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ callType: (e.target.value || undefined) as 'internal' | 'external' | undefined })}
            >
              <option value="">Any</option>
              <option value="internal">Internal</option>
              <option value="external">External</option>
            </select>
          </div>
          <div className="md:col-span-1">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Status:</label>
            <select
              value={filters.completionStatus ?? ''}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ completionStatus: e.target.value || undefined })}
            >
              <option value="">Any</option>
              <option value="A">Answered (A)</option>
              <option value="B">Busy (B)</option>
              <option value="E">Error (E)</option>
              <option value="T">Toll Denied (T)</option>
              <option value="I">Internal (I)</option>
              <option value="O">Outbound (O)</option>
              <option value="D">No Answer (D)</option>
              <option value="S">Surfaced (S)</option>
              <option value="U">Unknown (U)</option>
            </select>
          </div>
          <div className="md:col-span-1 flex items-end">
            <button
              onClick={handleApplyFilters}
              disabled={recordsLoading}
              className="rounded-2xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white w-full"
            >
              {recordsLoading ? 'Applying...' : 'Apply'}
            </button>
          </div>
          <div className="md:col-span-1 flex items-end">
            <button
              onClick={clearFilters}
              className="rounded-2xl border px-3 py-2 text-sm font-semibold w-full"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-12">
          <div className="md:col-span-1">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Hour:</label>
            <input
              value={filters.hour ?? ''}
              placeholder="00-23"
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ hour: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Transfer/Conference:</label>
            <select
              value={filters.transferFlag ?? ''}
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ transferFlag: e.target.value || undefined })}
            >
              <option value="">Any</option>
              <option value="none">None</option>
              <option value="T">T - Transfer</option>
              <option value="X">X - Conference</option>
              <option value="C">C - Conference</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Call ID:</label>
            <input
              value={filters.callIdentifier ?? ''}
              placeholder="Call Identifier"
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ callIdentifier: e.target.value || undefined })}
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Assoc Call ID:</label>
            <input
              value={filters.associatedCallIdentifier ?? ''}
              placeholder="Associated Call Identifier"
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ associatedCallIdentifier: e.target.value || undefined })}
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs" style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Network OLI:</label>
            <input
              value={filters.networkOLI ?? ''}
              placeholder="Network OLI"
              className="rounded-2xl border px-3 py-2 w-full"
              style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text)' }}
              onChange={(e) => setFilters({ networkOLI: e.target.value || undefined })}
            />
          </div>
        </div>

        {activeFilterChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeFilterChips.map((chip) => (
              <button
                key={chip.id}
                onClick={() => clearSingleFilter(chip.clear)}
                className="rounded-full border px-3 py-1 text-xs font-semibold"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                  background: 'var(--surface-alt)'
                }}
                title="Click to remove this filter"
              >
                {chip.label} ×
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="card p-4 flex flex-col justify-center" style={{ minHeight: '220px', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '16px', left: '16px' }}>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--brand)' }}></div>
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Total Calls
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <p className="font-bold mb-2" style={{ color: 'var(--brand)', fontSize: '72px', lineHeight: 1 }}>
              {totalCalls.toLocaleString()}
            </p>
            <p className="text-xs" style={{ color: 'var(--muted2)' }}>
              from filtered result set
            </p>
          </div>
          <div style={{ textAlign: 'center', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Total Talk Time
            </p>
            <p className="font-bold" style={{ color: 'var(--green)', fontSize: '28px', lineHeight: 1, marginTop: '4px' }}>
              {totalTalkTime}
            </p>
          </div>
        </div>

        <div className="card p-4 flex flex-col" style={{ minHeight: '220px' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--green)' }}></div>
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Top Extensions (Made)
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: '170px' }}>
            {topExtensionsMade.map((ext, idx) => (
              <div key={ext.extension} className="flex justify-between items-center py-2" style={{ borderBottom: idx < topExtensionsMade.length - 1 ? '1px solid var(--border2)' : 'none' }}>
                <span className="mono text-sm" style={{ color: 'var(--text)', fontWeight: 600 }}>{ext.extension}</span>
                <span className="text-xs" style={{ color: 'var(--muted2)' }}>{ext.count} calls</span>
              </div>
            ))}
            {topExtensionsMade.length === 0 && (
              <p className="text-xs text-center py-4" style={{ color: 'var(--muted)' }}>No calls yet</p>
            )}
          </div>
        </div>

        <div className="card p-4 flex flex-col" style={{ minHeight: '220px' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--purple)' }}></div>
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Top Extensions (Received)
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: '170px' }}>
            {topExtensionsReceived.map((ext, idx) => (
              <div key={ext.extension} className="flex justify-between items-center py-2" style={{ borderBottom: idx < topExtensionsReceived.length - 1 ? '1px solid var(--border2)' : 'none' }}>
                <span className="mono text-sm" style={{ color: 'var(--text)', fontWeight: 600 }}>{ext.extension}</span>
                <span className="text-xs" style={{ color: 'var(--muted2)' }}>{ext.count} calls</span>
              </div>
            ))}
            {topExtensionsReceived.length === 0 && (
              <p className="text-xs text-center py-4" style={{ color: 'var(--muted)' }}>No calls yet</p>
            )}
          </div>
        </div>

        <div className="card p-4 flex flex-col justify-between" style={{ minHeight: '220px' }}>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide mb-3 block" style={{ color: 'var(--muted)' }}>
              Export Data
            </span>
            <p className="text-xs mb-4" style={{ color: 'var(--muted2)' }}>
              Export filtered call logs to CSV or PDF format
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => exportRecords('csv')}
              className="flex-1 rounded-2xl px-3 py-3 text-sm font-semibold flex flex-col items-center gap-1 text-white"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              <span style={{ fontSize: '18px' }}>📄</span>
              <span>CSV</span>
            </button>
            <button
              onClick={() => exportRecords('pdf')}
              className="flex-1 rounded-2xl px-3 py-3 text-sm font-semibold flex flex-col items-center gap-1 text-white"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              <span style={{ fontSize: '18px' }}>📕</span>
              <span>PDF</span>
            </button>
          </div>
          <p className="mt-3 text-xs text-center" style={{ color: 'var(--muted2)' }}>
            Includes timestamp in filename
          </p>
        </div>
      </div>

      <CallLogTable
        rows={records}
        loading={recordsLoading}
        totalRecords={recordsTotal}
        onPaginationChange={handlePaginationChange}
        initialPageSize={filters.limit ?? 50}
        resetPaginationToken={paginationResetToken}
      />
    </div>
  );
}
