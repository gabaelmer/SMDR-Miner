import { SMDRParser } from './SMDRParser';
import { SMDRRecord } from '../../shared/types';

export interface ParsedCallIdentifier {
  plane: string | null;
  system_id: string | null;
  call_number: string | null;
}

export interface ParsedCallRecord {
  record_type: 'standard' | 'extended';
  long_call: boolean;
  call_date: string;
  start_time: string;
  duration_raw: string;
  duration_seconds: number;
  time_to_answer: number | null;
  calling_party: string;
  called_party: string;
  digits_dialed: string | null;
  ani: string | null;
  dnis: string | null;
  system_id: string | null;
  call_identifier: ParsedCallIdentifier;
  is_ip_trunk: boolean;
  is_transfer: boolean;
  completion_status: string | null;
  account_code: string | null;
  parsing_errors: string[];
}

const defaultParser = new SMDRParser();

function parseDurationToSeconds(duration: string): number {
  const parts = duration.split(':').map((part) => Number(part));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function normalizeDate(value?: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{2}\/\d{2}$/.test(value)) {
    const year = new Date().getFullYear();
    const [month, day] = value.split('/');
    return `${year}-${month}-${day}`;
  }
  return value;
}

function normalizeStartTime(value?: string): string {
  if (!value) return '';

  const meridiem = value.trim().toUpperCase().match(/^(\d{1,2})(?::?([0-5]\d))(?::?([0-5]\d))?([AP])$/);
  if (meridiem) {
    const hourRaw = Number.parseInt(meridiem[1], 10);
    const minute = meridiem[2];
    const second = meridiem[3] ?? '00';
    let hour = hourRaw % 12;
    if (meridiem[4] === 'P') hour += 12;
    return `${String(hour).padStart(2, '0')}:${minute}:${second}`;
  }

  const hhmm = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (hhmm) return `${hhmm[1]}:${hhmm[2]}:00`;
  const hhmmss = value.match(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
  if (hhmmss) return value;
  return value;
}

function parseCallIdentifier(value?: string): ParsedCallIdentifier {
  if (!value) {
    return { plane: null, system_id: null, call_number: null };
  }
  const clean = value.trim().toUpperCase();
  const match = clean.match(/^([A-Z])(\d{3})([A-Z0-9]{4})$/);
  if (!match) {
    return { plane: null, system_id: null, call_number: clean || null };
  }
  return {
    plane: match[1],
    system_id: match[2],
    call_number: match[3]
  };
}

function isIpTrunk(record: SMDRRecord): boolean {
  const parties = [record.callingParty, record.calledParty, record.trunkNumber];
  if (parties.some((party) => /^X9999?$/i.test((party ?? '').trim()))) return true;
  if (/\bX9999?\b/i.test(record.rawLine ?? '')) return true;
  return record.callingPartyType?.type === 'ip_trunk' || record.calledPartyType?.type === 'ip_trunk';
}

function inferRecordType(record: SMDRRecord): 'standard' | 'extended' {
  if ((record.recordFormat ?? '').startsWith('extended')) return 'extended';
  if ((record.recordFormat ?? '').startsWith('standard')) return 'standard';
  const hoursPart = record.duration.split(':')[0] ?? '';
  if (hoursPart.length > 2) return 'extended';
  const partyCandidates = [record.callingParty, record.calledParty, record.thirdParty];
  if (partyCandidates.some((party) => /^[0-9*#]{5,7}$/.test((party ?? '').trim()))) return 'extended';
  if (partyCandidates.some((party) => /^[TX]\d{4}$/i.test((party ?? '').trim()))) return 'extended';
  return 'standard';
}

export function parseSmdrRecord(record: string, parser: SMDRParser = defaultParser): ParsedCallRecord {
  const parsed = parser.parse(record);
  if (!parsed.record) {
    return {
      record_type: 'standard',
      long_call: false,
      call_date: '',
      start_time: '',
      duration_raw: '',
      duration_seconds: 0,
      time_to_answer: null,
      calling_party: '',
      called_party: '',
      digits_dialed: null,
      ani: null,
      dnis: null,
      system_id: null,
      call_identifier: { plane: null, system_id: null, call_number: null },
      is_ip_trunk: false,
      is_transfer: false,
      completion_status: null,
      account_code: null,
      parsing_errors: parsed.error?.reason ? [parsed.error.reason] : ['Unable to parse record']
    };
  }

  const recordType = inferRecordType(parsed.record);
  const durationSeconds = parsed.record.durationSeconds ?? parseDurationToSeconds(parsed.record.duration);

  return {
    record_type: recordType,
    long_call: ['-', '%', '+'].includes(parsed.record.longCallIndicator ?? ''),
    call_date: normalizeDate(parsed.record.date),
    start_time: normalizeStartTime(parsed.record.startTime),
    duration_raw: parsed.record.duration,
    duration_seconds: durationSeconds,
    time_to_answer: parsed.record.timeToAnswer ?? null,
    calling_party: parsed.record.callingParty,
    called_party: parsed.record.calledParty,
    digits_dialed: parsed.record.digitsDialed ?? null,
    ani: parsed.record.ani ?? null,
    dnis: parsed.record.dnis ?? null,
    system_id: parsed.record.systemId ?? null,
    call_identifier: parseCallIdentifier(parsed.record.callIdentifier),
    is_ip_trunk: isIpTrunk(parsed.record),
    is_transfer: ['T', 'X', 'C'].includes(parsed.record.transferConference ?? ''),
    completion_status: parsed.record.callCompletionStatus ?? null,
    account_code: parsed.record.accountCode ?? null,
    parsing_errors: parsed.record.parsingErrors ?? []
  };
}
