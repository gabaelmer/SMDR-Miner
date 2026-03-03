import { InputSanitizer } from '../security/InputSanitizer';
import {
  ParseError,
  SMDRRecord,
  SMDRFormatVariant,
  LongCallIndicator,
  CallCompletionCode,
  TransferConferenceCode,
  SpeedCallForwardCode,
  RouteOptCode,
  PartyType,
  SMDRParserConfig,
  DEFAULT_SMDR_PARSER_CONFIG
} from '../../shared/types';

/**
 * MiVoice Business 10.5 SMDR Data Parsing Specification Implementation
 *
 * Supports all record format variants:
 * - Standard (90 chars)
 * - Standard + ANI/DNIS (112 chars)
 * - Standard + Network OLI (131 chars)
 * - Extended Digit Length (101 chars)
 * - Extended + ANI/DNIS (120 chars)
 * - Extended + Network OLI (139 chars)
 * - Extended Reporting Level 1 & 2 (up to 207 chars)
 */

// ─── Valid Record Lengths per Mitel Spec ──────────────────────────────────────

const VALID_RECORD_LENGTHS = [90, 101, 112, 120, 131, 139, 207];

// ─── Clock Malfunction Detection ──────────────────────────────────────────────

const CLOCK_MALFUNCTION_PATTERN = /CLOCK MALFUNCTION/i;

// ─── MCD (Mitel Call Distribution) Detection ─────────────────────────────────

const MCD_TRANSFER_PATTERN = /\s+(dd\d+\s+dd\d+\s+dd\d+)\s+/i;
const MCD_DEVICE_SEQUENCE_PATTERN = /\d+\s+\d+\s+\d+/;

// ─── Format Variant Definitions ──────────────────────────────────────────────

interface FormatDefinition {
  variant: SMDRFormatVariant;
  minLength: number;
  maxLength: number;
  fields: FieldDefinition[];
}

interface FieldDefinition {
  name: keyof SMDRRecord;
  start: number;  // 0-based column index
  length: number;
  parser?: (value: string) => unknown;
}

// Standard format field definitions (90 chars)
const STANDARD_FIELDS: FieldDefinition[] = [
  { name: 'longCallIndicator', start: 0, length: 1, parser: parseLongCallIndicator },
  { name: 'date', start: 1, length: 5, parser: parseDate },
  { name: 'startTime', start: 7, length: 7, parser: parseStartTime },
  { name: 'duration', start: 15, length: 8, parser: parseDuration },
  { name: 'callingParty', start: 24, length: 4, parser: trimAndNormalize },
  { name: 'attendantFlag', start: 28, length: 1 },
  { name: 'timeToAnswer', start: 29, length: 3, parser: parseTimeToAnswer },
  { name: 'digitsDialed', start: 34, length: 26, parser: trimAndNormalize },
  { name: 'meterPulses', start: 55, length: 5, parser: parseMeterPulses },
  { name: 'callCompletionStatus', start: 60, length: 1, parser: parseCallCompletion },
  { name: 'speedCallForwardFlag', start: 61, length: 1, parser: parseSpeedCallForward },
  { name: 'calledParty', start: 62, length: 4, parser: trimAndNormalize },
  { name: 'transferConference', start: 66, length: 1, parser: parseTransferConference },
  { name: 'thirdParty', start: 68, length: 4, parser: trimAndNormalize },
  { name: 'accountCode', start: 73, length: 12, parser: trimAndNormalize },
  { name: 'routeOptFlag', start: 85, length: 1, parser: parseRouteOpt },
  { name: 'systemId', start: 86, length: 3, parser: trimAndNormalize },
  { name: 'mlppLevel', start: 89, length: 1 },
];

// Extended digit length fields (101 chars)
const EXTENDED_DIGIT_FIELDS: FieldDefinition[] = [
  { name: 'longCallIndicator', start: 0, length: 1, parser: parseLongCallIndicator },
  { name: 'date', start: 1, length: 5, parser: parseDate },
  { name: 'startTime', start: 7, length: 7, parser: parseStartTime },
  { name: 'duration', start: 15, length: 10, parser: parseDuration },  // hhhh:mm:ss
  { name: 'callingParty', start: 26, length: 7, parser: trimAndNormalize },  // 7 digits
  { name: 'attendantFlag', start: 33, length: 1 },
  { name: 'timeToAnswer', start: 34, length: 4, parser: parseTimeToAnswer },
  { name: 'digitsDialed', start: 39, length: 24, parser: trimAndNormalize },
  { name: 'meterPulses', start: 58, length: 5, parser: parseMeterPulses },
  { name: 'callCompletionStatus', start: 63, length: 1, parser: parseCallCompletion },
  { name: 'speedCallForwardFlag', start: 64, length: 1, parser: parseSpeedCallForward },
  { name: 'calledParty', start: 65, length: 7, parser: trimAndNormalize },  // 7 digits
  { name: 'transferConference', start: 72, length: 1, parser: parseTransferConference },
  { name: 'thirdParty', start: 74, length: 7, parser: trimAndNormalize },  // 7 digits
  { name: 'accountCode', start: 82, length: 12, parser: trimAndNormalize },
  { name: 'routeOptFlag', start: 94, length: 1, parser: parseRouteOpt },
  { name: 'systemId', start: 95, length: 3, parser: trimAndNormalize },
  { name: 'mlppLevel', start: 100, length: 1 },
];

// ANI/DNIS extension fields (adds 22 chars)
const ANI_DNIS_FIELDS: FieldDefinition[] = [
  { name: 'ani', start: 91, length: 10, parser: trimAndNormalize },
  { name: 'dnis', start: 102, length: 10, parser: trimAndNormalize },
];

// Extended ANI/DNIS fields (for extended digit format)
const EXTENDED_ANI_DNIS_FIELDS: FieldDefinition[] = [
  { name: 'ani', start: 102, length: 10, parser: trimAndNormalize },
  { name: 'dnis', start: 113, length: 7, parser: trimAndNormalize },
];

// Network OLI fields (adds 19 chars)
const NETWORK_OLI_FIELDS: FieldDefinition[] = [
  { name: 'callIdentifier', start: 113, length: 8, parser: parseCallIdentifier },
  { name: 'callSequence', start: 121, length: 1, parser: trimAndNormalize },
  { name: 'associatedCallIdentifier', start: 123, length: 8, parser: parseCallIdentifier },
];

// Extended Network OLI fields
const EXTENDED_NETWORK_OLI_FIELDS: FieldDefinition[] = [
  { name: 'callIdentifier', start: 121, length: 8, parser: parseCallIdentifier },
  { name: 'callSequence', start: 129, length: 1, parser: trimAndNormalize },
  { name: 'associatedCallIdentifier', start: 131, length: 8, parser: parseCallIdentifier },
];

// Extended Reporting Level 1 & 2 fields
const EXTENDED_REPORTING_FIELDS: FieldDefinition[] = [
  { name: 'suiteId', start: 146, length: 7, parser: trimAndNormalize },
  { name: 'twoBChannelTag', start: 174, length: 6, parser: trimAndNormalize },
  { name: 'callingEHDU', start: 181, length: 7, parser: trimAndNormalize },
  { name: 'calledEHDU', start: 189, length: 7, parser: trimAndNormalize },
  { name: 'callingLocation', start: 197, length: 5, parser: trimAndNormalize },
  { name: 'calledLocation', start: 203, length: 5, parser: trimAndNormalize },
];

// Format variant definitions
const FORMAT_VARIANTS: FormatDefinition[] = [
  { variant: 'standard', minLength: 90, maxLength: 90, fields: STANDARD_FIELDS },
  { variant: 'standard_ani_dnis', minLength: 112, maxLength: 112, fields: [...STANDARD_FIELDS, ...ANI_DNIS_FIELDS] },
  { variant: 'standard_network_oli', minLength: 131, maxLength: 131, fields: [...STANDARD_FIELDS, ...ANI_DNIS_FIELDS, ...NETWORK_OLI_FIELDS] },
  { variant: 'extended_digit', minLength: 101, maxLength: 101, fields: EXTENDED_DIGIT_FIELDS },
  { variant: 'extended_ani_dnis', minLength: 120, maxLength: 120, fields: [...EXTENDED_DIGIT_FIELDS, ...EXTENDED_ANI_DNIS_FIELDS] },
  { variant: 'extended_network_oli', minLength: 139, maxLength: 139, fields: [...EXTENDED_DIGIT_FIELDS, ...EXTENDED_ANI_DNIS_FIELDS, ...EXTENDED_NETWORK_OLI_FIELDS] },
  { variant: 'extended_reporting', minLength: 197, maxLength: 207, fields: [...EXTENDED_DIGIT_FIELDS, ...EXTENDED_ANI_DNIS_FIELDS, ...EXTENDED_NETWORK_OLI_FIELDS, ...EXTENDED_REPORTING_FIELDS] },
];

// ─── Parser Options and State ────────────────────────────────────────────────

export interface ParserOptionsState {
  standardizedCallId: boolean;
  networkOLI: boolean;
  extendedDigitLength: boolean;
  accountCodes: boolean;
  detectedFormat: SMDRFormatVariant;
  config: SMDRParserConfig;
}

export interface ParseResult {
  record: SMDRRecord | null;
  error?: ParseError;
}

// ─── Field Parser Functions ──────────────────────────────────────────────────

function trimAndNormalize(value: string): string {
  return value.trim();
}

function parseLongCallIndicator(value: string): LongCallIndicator | undefined {
  if (value === ' ') return ' ';
  const trimmed = value.trim();
  if (['-', '%', '+'].includes(trimmed)) {
    return trimmed as LongCallIndicator;
  }
  return undefined;
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  // Handle mm/dd format (add year)
  if (/^\d{2}\/\d{2}$/.test(trimmed)) {
    const [month, day] = trimmed.split('/');
    const year = new Date().getFullYear();
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  // Handle mm-dd format
  if (/^\d{2}-\d{2}$/.test(trimmed)) {
    const [month, day] = trimmed.split('-');
    const year = new Date().getFullYear();
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // Handle MMDDYY format
  if (/^\d{6}$/.test(trimmed)) {
    const year = `20${trimmed.slice(4, 6)}`;
    return `${year}-${trimmed.slice(0, 2)}-${trimmed.slice(2, 4)}`;
  }
  // Handle MMDDYYYY format
  if (/^\d{8}$/.test(trimmed)) {
    if (Number(trimmed.slice(0, 4)) > 1900) {
      return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
    }
    const year = `20${trimmed.slice(4, 6)}`;
    return `${year}-${trimmed.slice(0, 2)}-${trimmed.slice(2, 4)}`;
  }
  return trimmed;
}

function parseStartTime(value: string): string {
  const trimmed = value.trim();
  const meridiemNormalized = normalizeMeridiemTime(trimmed);
  if (meridiemNormalized) {
    return meridiemNormalized;
  }
  // Already valid 24-hour format
  if (/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(trimmed)) {
    return trimmed;
  }
  // Handle HHMM format
  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}:${trimmed.slice(2, 4)}`;
  }
  // Handle HHMMSS format
  if (/^\d{6}$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}:${trimmed.slice(2, 4)}:${trimmed.slice(4, 6)}`;
  }
  return trimmed;
}

function normalizeMeridiemTime(token: string): string | undefined {
  const compact = token.trim().toUpperCase();
  const match = compact.match(/^(\d{1,2})(?::?([0-5]\d))(?::?([0-5]\d))?([AP])$/);
  if (!match) return undefined;

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const second = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (!Number.isFinite(hour) || hour < 1 || hour > 12) return undefined;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return undefined;
  if (!Number.isFinite(second) || second < 0 || second > 59) return undefined;

  let normalizedHour = hour % 12;
  if (match[4] === 'P') normalizedHour += 12;
  return `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function parseDuration(value: string): string {
  const trimmed = value.trim();
  // Already valid format
  if (/^(?:\d{1,4}:)?[0-5]?\d:[0-5]\d$/.test(trimmed)) {
    return trimmed;
  }
  // Handle HHMMSS format
  if (/^\d{6}$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}:${trimmed.slice(2, 4)}:${trimmed.slice(4, 6)}`;
  }
  // Handle MMSS format
  if (/^\d{4}$/.test(trimmed)) {
    return `00:${trimmed.slice(0, 2)}:${trimmed.slice(2, 4)}`;
  }
  return trimmed;
}

function parseTimeToAnswer(value: string): number | null | undefined {
  const trimmed = value.trim();
  // Unanswered call indicator
  if (trimmed === '*?*' || trimmed === '') {
    return null;
  }
  const num = parseInt(trimmed, 10);
  if (!Number.isNaN(num) && num >= 0) {
    return num;
  }
  return undefined;
}

function parseMeterPulses(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '00000') {
    return null;
  }
  const num = parseInt(trimmed, 10);
  if (!Number.isNaN(num) && num >= 0 && num <= 64000) {
    return num;
  }
  return undefined;
}

function parseCallCompletion(value: string): CallCompletionCode {
  const trimmed = value.trim().toUpperCase();
  const validCodes: CallCompletionCode[] = ['A', 'B', 'E', 'T', 'I', 'O', 'D', 'S', 'U', 'C', 'R', ''];
  if (validCodes.includes(trimmed as CallCompletionCode)) {
    return trimmed as CallCompletionCode;
  }
  return '';
}

function parseSpeedCallForward(value: string): SpeedCallForwardCode {
  const trimmed = value.trim().toUpperCase();
  if (trimmed === 'S' || trimmed === 'F') {
    return trimmed as SpeedCallForwardCode;
  }
  return '';
}

function parseTransferConference(value: string): TransferConferenceCode {
  const trimmed = value.trim().toUpperCase();
  const validCodes: TransferConferenceCode[] = ['T', 'X', 'C', 'U', 'I', 'R', ''];
  if (validCodes.includes(trimmed as TransferConferenceCode)) {
    return trimmed as TransferConferenceCode;
  }
  return '';
}

function parseRouteOpt(value: string): RouteOptCode {
  const trimmed = value.trim();
  if (trimmed === 'r' || trimmed === 'R') {
    return trimmed as RouteOptCode;
  }
  return '';
}

function parseCallIdentifier(value: string): string | undefined {
  const trimmed = value.trim();
  // Network OLI format: pssscccc (priority + switch + call number)
  if (/^[A-Z]\d{3}[A-Z\d]{4}$/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed === '') {
    return undefined;
  }
  return trimmed;
}

function durationToSeconds(duration: string): number {
  const parts = duration.split(':').map((part) => Number(part));
  if (parts.some(Number.isNaN)) return 0;

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

// ─── Party Type Detection ────────────────────────────────────────────────────

function parsePartyType(party: string): PartyType {
  const trimmed = party.trim();

  // Attendant: ATTm or ATmm (m = 0-99)
  const attendantMatch = trimmed.match(/^ATT(\d{1,2})$/i);
  if (attendantMatch) {
    return { type: 'attendant', value: trimmed, id: parseInt(attendantMatch[1], 10) };
  }

  // CO Trunk: Tn ... Tnnnn (left-padded on some systems, compact on others)
  const coTrunkMatch = trimmed.match(/^T(\d{1,4})$/i);
  if (coTrunkMatch) {
    return { type: 'co_trunk', value: trimmed, number: parseInt(coTrunkMatch[1], 10) };
  }

  // Non-CO Trunk: Xn ... Xnnnn
  const nonCoTrunkMatch = trimmed.match(/^X(\d{1,4})$/i);
  if (nonCoTrunkMatch) {
    // IP Trunk: X999 or X9999
    if (nonCoTrunkMatch[1].startsWith('99')) {
      return { type: 'ip_trunk', value: trimmed };
    }
    return { type: 'non_co_trunk', value: trimmed, number: parseInt(nonCoTrunkMatch[1], 10) };
  }

  // Station: 3-7 digits, may include * or #
  if (/^[0-9*#]{3,7}$/.test(trimmed)) {
    return { type: 'station', value: trimmed };
  }

  return { type: 'unknown', value: trimmed };
}

// ─── Format Detection ────────────────────────────────────────────────────────

function detectFormatVariant(line: string): SMDRFormatVariant {
  const length = line.length;

  if (length >= 197 && length <= 207) {
    return 'extended_reporting';
  }

  if (length >= 138 && length <= 140) {
    return 'extended_network_oli';
  }

  if (length >= 130 && length <= 132) {
    return 'standard_network_oli';
  }

  if (length >= 119 && length <= 121) {
    return 'extended_ani_dnis';
  }

  if (length >= 111 && length <= 113) {
    return 'standard_ani_dnis';
  }

  if (length >= 100 && length <= 102) {
    return 'extended_digit';
  }

  if (length >= 89 && length <= 91) {
    return 'standard';
  }

  return 'unknown';
}

function getFormatDefinition(variant: SMDRFormatVariant): FormatDefinition | undefined {
  return FORMAT_VARIANTS.find(f => f.variant === variant);
}

// ─── Token-based Parser (Fallback) ───────────────────────────────────────────

// Updated to handle long call indicator prefixes (+, -, %)
const DATE_PATTERN = /^(?:@\d{8}@|[\+\-\%]?\d{4}-\d{2}-\d{2}|[\+\-\%]?\d{2}[/-]\d{2}(?:[/-]\d{2,4})?|[\+\-\%]?\d{6}|[\+\-\%]?\d{8})$/;
const TIME_PATTERN = /^(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?|(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?)$/;
const DURATION_PATTERN = /^(?:(?:\d{1,4}:)?[0-5]?\d:[0-5]\d|\d{4}|\d{6}|\d{2,4}:\d{2}:\d{2})$/;
const CALL_COMPLETION = new Set(['A', 'B', 'E', 'T', 'I', 'O', 'D', 'S', 'U', 'C', 'R']);
const TRANSFER_FLAGS = new Set(['T', 'X', 'C']);

function tokenize(line: string): string[] {
  const matches = line.match(/"[^"]*"|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ''));
}

function normalizeTime(token: string): string {
  const meridiemNormalized = normalizeMeridiemTime(token);
  if (meridiemNormalized) {
    return meridiemNormalized;
  }
  if (/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(token)) {
    return token;
  }
  if (/^\d{4}$/.test(token)) {
    return `${token.slice(0, 2)}:${token.slice(2, 4)}`;
  }
  if (/^\d{6}$/.test(token)) {
    return `${token.slice(0, 2)}:${token.slice(2, 4)}:${token.slice(4, 6)}`;
  }
  return token;
}

function normalizeDuration(token: string): string {
  if (/^(?:\d{1,2}:)?[0-5]?\d:[0-5]\d$/.test(token)) return token;
  if (/^\d{2,4}:\d{2}:\d{2}$/.test(token)) return token;
  if (/^\d{4}$/.test(token)) return `${token.slice(0, 2)}:${token.slice(2, 4)}`;
  if (/^\d{6}$/.test(token)) return `${token.slice(0, 2)}:${token.slice(2, 4)}:${token.slice(4, 6)}`;
  return token;
}

function isLikelyOptionToken(token?: string): boolean {
  if (!token) return false;
  if (/^[TX]\d{1,4}$/i.test(token)) return true;
  if (/^(?:ACC|ACCOUNT|ACCT|CID|CALLID|CALL_IDENTIFIER|SEQ|SEQUENCE|CALLSEQ|ACID|ASSOC|ASSOCIATED|ASSOCID)(?::|=|$)/i.test(token)) return true;
  if (/^OLI(?::|=|$)/i.test(token)) return true;
  if (CALL_COMPLETION.has(token.toUpperCase())) return true;
  if (TRANSFER_FLAGS.has(token.toUpperCase())) return true;
  return false;
}

function normalizeDate(token: string): string {
  const envelopeMatch = token.match(/^@(\d{8})@$/);
  if (envelopeMatch) {
    return normalizeDate(envelopeMatch[1]);
  }
  // Strip long call indicator prefix if present
  const clean = token.replace(/^[\+\-\%]+/, '');
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

  if (/^\d{8}$/.test(clean)) {
    if (Number(clean.slice(0, 4)) > 1900) {
      return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
    }
    const year = `20${clean.slice(4, 6)}`;
    return `${year}-${clean.slice(0, 2)}-${clean.slice(2, 4)}`;
  }

  if (/^\d{6}$/.test(clean)) {
    const year = `20${clean.slice(4, 6)}`;
    return `${year}-${clean.slice(0, 2)}-${clean.slice(2, 4)}`;
  }

  if (/^\d{2}[/-]\d{2}$/.test(clean)) {
    const [month, day] = clean.split(/[/-]/);
    const year = String(new Date().getFullYear());
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const [first, second, third] = clean.split(/[/-]/);
  const year = third.length === 2 ? `20${third}` : third;
  return `${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`;
}

// ─── Main Parser Class ───────────────────────────────────────────────────────

export class SMDRParser {
  private optionsState: ParserOptionsState = {
    standardizedCallId: false,
    networkOLI: false,
    extendedDigitLength: false,
    accountCodes: false,
    detectedFormat: 'unknown',
    config: { ...DEFAULT_SMDR_PARSER_CONFIG }
  };

  constructor(config?: Partial<SMDRParserConfig>) {
    if (config) {
      this.optionsState.config = { ...DEFAULT_SMDR_PARSER_CONFIG, ...config };
    }
  }

  updateConfig(config: Partial<SMDRParserConfig>): void {
    this.optionsState.config = { ...this.optionsState.config, ...config };
  }

  getDetectedOptions(): ParserOptionsState {
    return { ...this.optionsState };
  }

  /**
   * Parse an SMDR record line using fixed-width or token-based parsing
   */
  parse(rawLine: string): ParseResult {
    const sanitized = InputSanitizer.sanitizeLine(rawLine);
    const { normalizedLine, envelopeDate } = this.stripMitelEnvelopeDate(sanitized);

    // Remove long call indicators from start for processing
    const longCallIndicator = this.extractLongCallIndicator(normalizedLine);
    const cleanLine = normalizedLine.replace(/^[%+\-\s]+/, '').trim();

    if (!cleanLine) {
      return { record: null, error: { line: rawLine, reason: 'Blank line after sanitization' } };
    }

    // Check for clock malfunction (special case per Mitel spec)
    if (CLOCK_MALFUNCTION_PATTERN.test(rawLine)) {
      return {
        record: {
          date: '',
          startTime: '',
          duration: '',
          callingParty: 'CLOCK_MALFUNCTION',
          calledParty: '',
          rawLine: rawLine.trim(),
          recordFormat: 'unknown',
          recordLength: rawLine.length,
          parsedAt: new Date().toISOString(),
          parsingErrors: ['Clock malfunction detected - system time may be incorrect']
        },
        error: { line: rawLine, reason: 'Clock malfunction - start time invalid' }
      };
    }

    // Validate record length (Mitel spec compliance)
    const lengthValid = VALID_RECORD_LENGTHS.some(len =>
      Math.abs(normalizedLine.length - len) <= 5  // Allow 5 char tolerance for whitespace
    );

    if (this.isLikelyFixedWidth(normalizedLine)) {
      const fixedWidthResult = this.parseFixedWidth(normalizedLine, longCallIndicator, envelopeDate);
      if (fixedWidthResult.record) {
        this.finalizeParsedRecord(fixedWidthResult.record, sanitized, envelopeDate);
        if (!lengthValid && fixedWidthResult.record.recordFormat !== 'unknown') {
          fixedWidthResult.record.parsingErrors = [
            ...(fixedWidthResult.record.parsingErrors || []),
            `Non-standard record length: ${normalizedLine.length} chars (expected: ${VALID_RECORD_LENGTHS.join(', ')})`
          ];
        }
        return fixedWidthResult;
      }
    }

    // Fallback to token-based parsing for non-standard formats
    const tokenResult = this.parseTokenBased(normalizedLine, longCallIndicator, envelopeDate);
    if (tokenResult.record) {
      this.finalizeParsedRecord(tokenResult.record, sanitized, envelopeDate);
      tokenResult.record.parsingErrors = [
        ...(tokenResult.record.parsingErrors || []),
        'Parsed using token-based fallback (non-standard format)'
      ];
      if (!lengthValid) {
        tokenResult.record.parsingErrors.push(
          `Non-standard record length: ${normalizedLine.length} chars`
        );
      }
    }
    return tokenResult;
  }

  private stripMitelEnvelopeDate(line: string): { normalizedLine: string; envelopeDate?: string } {
    const match = line.match(/^@(\d{8})@\s*(.*)$/);
    if (!match) {
      return { normalizedLine: line };
    }
    const envelopeDate = normalizeDate(match[1]);
    const normalizedLine = (match[2] ?? '').trimStart();
    return { normalizedLine, envelopeDate };
  }

  private finalizeParsedRecord(record: SMDRRecord, rawSanitizedLine: string, envelopeDate?: string): void {
    if (envelopeDate) {
      record.date = envelopeDate;
    }
    record.rawLine = rawSanitizedLine;
    record.recordLength = rawSanitizedLine.length;
    if (!record.parsedAt) {
      record.parsedAt = new Date().toISOString();
    }
  }

  /**
   * Heuristic guard to avoid treating tokenized non-fixed records as fixed-width.
   */
  private isLikelyFixedWidth(line: string): boolean {
    const trimmed = line.trimEnd();
    if (!trimmed) return false;
    if (!/^(?:[ %+\-])?\d{2}[/-]\d{2}\b/.test(trimmed)) return false;
    if (!VALID_RECORD_LENGTHS.some((len) => Math.abs(trimmed.length - len) <= 2)) return false;
    const durationProbe = trimmed.substring(15, 25).trim();
    return /^\d{2,4}:\d{2}:\d{2}$/.test(durationProbe);
  }

  /**
   * Extract long call indicator from the start of the line
   */
  private extractLongCallIndicator(line: string): LongCallIndicator | undefined {
    const firstChar = line.charAt(0);
    if ([' ', '-', '%', '+'].includes(firstChar)) {
      // Check if it's followed by a date pattern
      if (/^[\s%+\-]\d{2}[/-]\d{2}/.test(line)) {
        return firstChar as LongCallIndicator;
      }
    }
    return undefined;
  }

  /**
   * Parse using fixed-width column positions (Mitel spec compliant)
   */
  private parseFixedWidth(rawLine: string, longCallIndicator?: LongCallIndicator, envelopeDate?: string): ParseResult {
    const detectedFormat = detectFormatVariant(rawLine);
    const formatDef = getFormatDefinition(detectedFormat);

    if (!formatDef || detectedFormat === 'unknown') {
      return { record: null, error: { line: rawLine, reason: 'Unable to detect record format' } };
    }

    // Update detected format in state
    this.optionsState.detectedFormat = detectedFormat;
    if (detectedFormat.startsWith('extended')) {
      this.optionsState.extendedDigitLength = true;
    }
    if (detectedFormat.includes('network_oli') || detectedFormat === 'extended_reporting') {
      this.optionsState.networkOLI = true;
    }

    const record: SMDRRecord = {
      date: '',
      startTime: '',
      duration: '',
      callingParty: '',
      calledParty: '',
      rawLine,
      recordFormat: detectedFormat,
      recordLength: rawLine.length,
      parsedAt: new Date().toISOString(),
      longCallIndicator
    };

    const errors: string[] = [];

    // Parse each field based on format definition
    for (const field of formatDef.fields) {
      if (field.start + field.length > rawLine.length) {
        // Field extends beyond line - may be optional or format mismatch
        if (field.start >= rawLine.length) {
          continue;  // Field not present
        }
        // Partial field - use what's available
        const value = rawLine.substring(field.start).padEnd(field.length, ' ');
        const parsed = field.parser ? field.parser(value) : value.trim();
        if (parsed !== undefined && parsed !== null && parsed !== '') {
          (record as any)[field.name] = parsed;
        }
        continue;
      }

      const value = rawLine.substring(field.start, field.start + field.length);
      const parsed = field.parser ? field.parser(value) : value.trim();

      if (parsed !== undefined && parsed !== null && parsed !== '') {
        (record as any)[field.name] = parsed;
      }
    }

    // Validate required fields
    if (!record.date || !record.startTime || !record.duration) {
      errors.push('Missing required fields (date, startTime, or duration)');
    }
    if (envelopeDate) {
      record.date = envelopeDate;
    }

    // Parse party types
    if (record.callingParty) {
      record.callingPartyType = parsePartyType(record.callingParty);
    }
    if (record.calledParty) {
      record.calledPartyType = parsePartyType(record.calledParty);
    }
    if (record.callIdentifier) {
      this.optionsState.standardizedCallId = true;
    }
    if (record.accountCode) {
      this.optionsState.accountCodes = true;
    }

    // Calculate duration in seconds
    if (record.duration) {
      record.durationSeconds = durationToSeconds(record.duration);
    }

    // Determine call type
    record.callType = this.determineCallType(record);

    if (errors.length > 0) {
      record.parsingErrors = errors;
    }

    // Validate that we have minimum required data
    if (!record.date || !record.callingParty || !record.calledParty) {
      return {
        record: null,
        error: { line: rawLine, reason: 'Missing required fields after fixed-width parsing' }
      };
    }

    if (/\s/.test(record.callingParty) || /\s/.test(record.calledParty)) {
      return {
        record: null,
        error: { line: rawLine, reason: 'Fixed-width parse produced invalid party fields' }
      };
    }

    // Extract account code from continuation line if not found in standard position
    // Mitel systems output account codes on continuation lines
    // After sanitization and combining: "header  continuation_data" where continuation_data might be "110110 000"
    if (!record.accountCode && rawLine.length > 72) {
      const extractedCode = this.extractAccountCodeFromContinuation(rawLine);
      if (extractedCode) {
        record.accountCode = extractedCode;
        this.optionsState.accountCodes = true;
      }
    }
    record.transferFlag = record.transferConference;

    return { record };
  }

  /**
   * Extract account code from continuation line portion
   * Mitel SMDR continuation lines have format:
   * Original: "                    110110 000" (account code + space + additional data)
   * After sanitization and combining: "header_line 110110 000"
   */
  private extractAccountCodeFromContinuation(rawLine: string): string | undefined {
    // Account codes in Mitel SMDR appear AFTER the standard 90-character record
    // They have a very specific format: account_code (2-12 digits) + space + 3 digits (like "000")
    // The key is: account codes appear BEYOND position 90, not within the standard record
    
    // Only check for account codes if line is longer than standard 90-char record
    // This prevents matching extension numbers within the standard record
    if (rawLine.length <= 90) {
      return undefined;
    }
    
    // Pattern 1: Look for account code pattern at end of line (beyond standard record)
    // Must be: space + 2-12 digits + space + exactly 3 digits at end of line
    const endPattern = /\s(\d{2,12})\s+(\d{3})\s*$/;
    const endMatch = rawLine.match(endPattern);
    if (endMatch && endMatch[1]) {
      const potentialCode = endMatch[1].trim();
      const trailingDigits = endMatch[2].trim();
      // Verify this is beyond the standard record (position 90+)
      const matchIndex = endMatch.index || 0;
      if (matchIndex >= 85) {  // Account code should start around position 85-90+
        if (/^\d{2,12}$/.test(potentialCode) && 
            potentialCode !== '000' && 
            potentialCode !== '0000' &&
            trailingDigits.length === 3) {
          return potentialCode;
        }
      }
    }

    // Pattern 2: Look for account code in extended portion (after position 90)
    // Must be: 2-12 digits + space + exactly 3 digits
    if (rawLine.length > 90) {
      const extendedPortion = rawLine.substring(90).trim();
      // Must match: digits (2-12) + space + exactly 3 digits, nothing else after
      const accountCodeMatch = extendedPortion.match(/^(\d{2,12}[*#]?)\s+(\d{3})\s*$/);
      if (accountCodeMatch && accountCodeMatch[1]) {
        const code = accountCodeMatch[1].trim();
        const trailingDigits = accountCodeMatch[2].trim();
        if (!/^\d{2}:\d{2}/.test(code) && 
            code !== '000' && 
            code !== '0000' &&
            trailingDigits.length === 3) {
          return code;
        }
      }
    }

    return undefined;
  }

  /**
   * Parse using token-based approach (fallback for non-standard formats)
   */
  private parseTokenBased(rawLine: string, longCallIndicator?: LongCallIndicator, envelopeDate?: string): ParseResult {
    const sanitized = InputSanitizer.sanitizeLine(rawLine).replace(/^[%+\-]+/, '').trim();
    if (!sanitized) {
      return { record: null, error: { line: rawLine, reason: 'Blank line after sanitization' } };
    }

    const tokens = tokenize(sanitized);
    if (tokens.length < 4) {
      return { record: null, error: { line: rawLine, reason: 'Insufficient token count' } };
    }

    const dateIndex = tokens.findIndex((token) => DATE_PATTERN.test(token));
    if (dateIndex < 0) {
      return { record: null, error: { line: rawLine, reason: 'Date token not found' } };
    }

    const startTime = normalizeTime(tokens[dateIndex + 1]);
    if (!TIME_PATTERN.test(startTime)) {
      return {
        record: null,
        error: { line: rawLine, reason: 'Start time format invalid' }
      };
    }

    let duration = normalizeDuration(tokens[dateIndex + 2] ?? '');
    let detailStartIndex = dateIndex + 3;
    if (!DURATION_PATTERN.test(duration)) {
      duration = '00:00:00';
      detailStartIndex = dateIndex + 2;
    }

    const details = tokens.slice(detailStartIndex);
    const firstOptionIndex = details.findIndex((token) => isLikelyOptionToken(token));
    const partyTokens = firstOptionIndex >= 0 ? details.slice(0, firstOptionIndex) : details;
    const optionTokens = firstOptionIndex >= 0 ? details.slice(firstOptionIndex) : [];

    const parsed: SMDRRecord = {
      date: envelopeDate ?? normalizeDate(tokens[dateIndex]),
      startTime,
      duration,
      callingParty: '',
      calledParty: '',
      rawLine: sanitized,
      longCallIndicator,
      recordFormat: 'unknown',
      recordLength: rawLine.length,
      parsedAt: new Date().toISOString()
    };

    const remaining: string[] = [];
    for (let i = 0; i < optionTokens.length; i += 1) {
      const token = optionTokens[i];
      const next = optionTokens[i + 1];

      if (/^[TX]\d{1,4}$/i.test(token) && !parsed.trunkNumber) {
        parsed.trunkNumber = token.toUpperCase();
        continue;
      }

      if (/^(?:ACC|ACCOUNT|ACCT)[:=]$/i.test(token) && next) {
        parsed.accountCode = next;
        this.optionsState.accountCodes = true;
        i += 1;
        continue;
      }

      const accountMatch = token.match(/^(?:ACC|ACCOUNT|ACCT)[:=](.+)$/i);
      if (accountMatch) {
        parsed.accountCode = accountMatch[1];
        this.optionsState.accountCodes = true;
        continue;
      }

      if (/^(?:CID|CALLID|CALL_IDENTIFIER)[:=]$/i.test(token) && next) {
        parsed.callIdentifier = next;
        this.optionsState.standardizedCallId = true;
        i += 1;
        continue;
      }

      const callIdMatch = token.match(/^(?:CID|CALLID|CALL_IDENTIFIER)[:=](.+)$/i);
      if (callIdMatch) {
        parsed.callIdentifier = callIdMatch[1];
        this.optionsState.standardizedCallId = true;
        continue;
      }

      if (/^(?:SEQ|SEQUENCE|CALLSEQ)[:=]$/i.test(token) && next) {
        parsed.callSequence = next;
        i += 1;
        continue;
      }

      const sequenceMatch = token.match(/^(?:SEQ|SEQUENCE|CALLSEQ)[:=](.+)$/i);
      if (sequenceMatch) {
        parsed.callSequence = sequenceMatch[1];
        continue;
      }

      if (/^(?:ACID|ASSOC|ASSOCIATED|ASSOCID)[:=]$/i.test(token) && next) {
        parsed.associatedCallIdentifier = next;
        i += 1;
        continue;
      }

      const assocMatch = token.match(/^(?:ACID|ASSOC|ASSOCIATED|ASSOCID)[:=](.+)$/i);
      if (assocMatch) {
        parsed.associatedCallIdentifier = assocMatch[1];
        continue;
      }

      if (/^OLI[:=]?/i.test(token)) {
        const value = token.includes(':') || token.includes('=') ? token.split(/[:=]/)[1] : next;
        if (value) {
          parsed.networkOLI = value;
          this.optionsState.networkOLI = true;
          if (!token.includes(':') && !token.includes('=')) i += 1;
        }
        continue;
      }

      if (CALL_COMPLETION.has(token.toUpperCase()) && !parsed.callCompletionStatus) {
        parsed.callCompletionStatus = token.toUpperCase() as CallCompletionCode;
        continue;
      }

      if (TRANSFER_FLAGS.has(token.toUpperCase()) && !parsed.transferConference) {
        parsed.transferConference = token.toUpperCase() as TransferConferenceCode;
        continue;
      }

      // Digits dialed: external numbers (7-24 digits)
      // BUT exclude patterns that look like account codes:
      // - Account codes followed by 3 digits (e.g., "110110 000")
      // - Standalone 2-12 digit numbers at end of line (account codes)
      if (/^\+?\d{7,24}$/.test(token) && !parsed.digitsDialed) {
        if (parsed.trunkNumber) {
          parsed.digitsDialed = token;
          if (token.replace('+', '').length > 16) {
            this.optionsState.extendedDigitLength = true;
          }
          continue;
        }

        // Check if this looks like an account code pattern
        // Account codes are typically 2-12 digits and appear at the end followed by 3 digits like "000"
        const tokenIndex = optionTokens.indexOf(token);
        const nextToken = optionTokens[tokenIndex + 1];
        
        // If followed by a 3-digit number (like "000"), this is likely an account code, not digits dialed
        if (nextToken && /^\d{3}$/.test(nextToken)) {
          // Skip this token - it's an account code, will be extracted later
          remaining.push(token);
          continue;
        }
        
        // If this is a 7-12 digit number and there are no more significant tokens after it,
        // it's likely an account code, not an external number
        const digitLength = token.replace('+', '').length;
        if (digitLength >= 7 && digitLength <= 12) {
          const remainingTokens = optionTokens.slice(tokenIndex + 1).filter(t => !isLikelyOptionToken(t) && t !== 'C' && t !== 'I');
          if (remainingTokens.length <= 1) {
            // Not enough context for this to be an external number - likely an account code
            remaining.push(token);
            continue;
          }
        }
        
        parsed.digitsDialed = token;
        if (token.replace('+', '').length > 16) {
          this.optionsState.extendedDigitLength = true;
        }
        continue;
      }

      remaining.push(token);
    }

    const sanitizedPartyTokens = partyTokens
      .map((token) => InputSanitizer.sanitizeField(token))
      .filter((token): token is string => Boolean(token));

    parsed.callingParty = sanitizedPartyTokens[0] ?? '';
    parsed.calledParty = sanitizedPartyTokens[1] ?? '';
    parsed.thirdParty = sanitizedPartyTokens[2] ?? InputSanitizer.sanitizeField(remaining[0]);

    // MiVB internal records may include a zero-padded intermediate token before called party.
    if (
      sanitizedPartyTokens.length >= 3 &&
      /^0{2,}\d{1,4}$/.test(sanitizedPartyTokens[1]) &&
      /^\d{2,}$/.test(sanitizedPartyTokens[2]) &&
      sanitizedPartyTokens[2] !== sanitizedPartyTokens[1]
    ) {
      parsed.calledParty = sanitizedPartyTokens[2];
      parsed.thirdParty = sanitizedPartyTokens[1];
    }

    if (!parsed.callingParty || !parsed.calledParty || isLikelyOptionToken(parsed.callingParty) || isLikelyOptionToken(parsed.calledParty)) {
      const fallbackCandidates = [...partyTokens, ...remaining]
        .map((token) => InputSanitizer.sanitizeField(token))
        .filter((token): token is string => Boolean(token) && !isLikelyOptionToken(token));

      parsed.callingParty = fallbackCandidates[0] ?? '';
      parsed.calledParty = fallbackCandidates[1] ?? '';
      parsed.thirdParty = fallbackCandidates[2];
    }

    const nonOptionContext = details
      .map((token) => InputSanitizer.sanitizeField(token))
      .filter((token): token is string => Boolean(token) && !isLikelyOptionToken(token));
    const extensionCandidates = nonOptionContext.filter((token) => this.isExtensionToken(token) && !this.isRouteLikeToken(token));
    const routeCandidates = nonOptionContext.filter((token) => this.isRouteLikeToken(token));
    const externalNumberCandidates = nonOptionContext.filter(
      (token) => /^\+?\d{7,24}$/.test(token) && !this.isRouteLikeToken(token)
    );

    if (parsed.trunkNumber) {
      if (parsed.digitsDialed) {
        const dialedIndex = nonOptionContext.findIndex((token) => token === parsed.digitsDialed);
        if (dialedIndex >= 0) {
          const extensionAfterDialed = nonOptionContext
            .slice(dialedIndex + 1)
            .find((token) => this.isExtensionToken(token) && !this.isRouteLikeToken(token));
          if (extensionAfterDialed) {
            parsed.callingParty = extensionAfterDialed;
          }
        }
      }

      if (!parsed.callingParty || this.isRouteLikeToken(parsed.callingParty)) {
        parsed.callingParty =
          [...extensionCandidates].reverse().find((token) => token !== parsed.calledParty) ??
          extensionCandidates[0] ??
          parsed.callingParty;
      }
      if (!parsed.calledParty || parsed.calledParty === parsed.callingParty || this.isRouteLikeToken(parsed.calledParty)) {
        parsed.calledParty =
          parsed.digitsDialed ??
          externalNumberCandidates.find((token) => token !== parsed.callingParty) ??
          extensionCandidates.find((token) => token !== parsed.callingParty) ??
          parsed.calledParty;
      }
      if (!parsed.thirdParty) {
        parsed.thirdParty = routeCandidates[0];
      }
    } else {
      if (parsed.calledParty === parsed.callingParty && extensionCandidates.length > 1) {
        parsed.calledParty = extensionCandidates.find((token) => token !== parsed.callingParty) ?? parsed.calledParty;
      }
    }

    if (
      (!parsed.callingParty || !parsed.calledParty) &&
      parsed.trunkNumber &&
      (nonOptionContext.length === 0 || nonOptionContext.every((token) => this.isRouteLikeToken(token)))
    ) {
      parsed.callingParty = 'UNKNOWN';
      parsed.calledParty = 'UNKNOWN';
    }

    if (!parsed.callingParty || !parsed.calledParty) {
      return {
        record: null,
        error: { line: rawLine, reason: 'Could not resolve calling/called party' }
      };
    }

    // Parse party types
    parsed.callingPartyType = parsePartyType(parsed.callingParty);
    parsed.calledPartyType = parsePartyType(parsed.calledParty);

    // Calculate duration in seconds
    parsed.durationSeconds = durationToSeconds(parsed.duration);

    // Determine call type
    parsed.callType = this.determineCallType(parsed);

    // Extract account code from raw line if not already found
    // This handles cases where account codes are appended to standard format records
    if (!parsed.accountCode) {
      const extractedCode = this.extractAccountCodeFromContinuation(rawLine);
      if (extractedCode) {
        parsed.accountCode = extractedCode;
        this.optionsState.accountCodes = true;
      }
    }
    parsed.transferFlag = parsed.transferConference;

    return { record: parsed };
  }

  private isExtensionToken(token: string): boolean {
    return /^[0-9*#]{3,7}$/.test(token);
  }

  private isRouteLikeToken(token: string): boolean {
    return token === '****' || /^0{2,}\d{0,4}$/.test(token) || /^0\d{2}$/.test(token);
  }

  private determineCallType(record: SMDRRecord): 'internal' | 'external' {
    // Internal if both parties are stations and no digits dialed
    const callingIsStation = record.callingPartyType?.type === 'station';
    const calledIsStation = record.calledPartyType?.type === 'station';
    
    if (callingIsStation && calledIsStation && !record.digitsDialed) {
      return 'internal';
    }
    
    // External if there are digits dialed or called party is a trunk/external number
    if (record.digitsDialed || record.calledPartyType?.type === 'co_trunk' || 
        record.calledPartyType?.type === 'non_co_trunk' || record.calledPartyType?.type === 'ip_trunk') {
      return 'external';
    }
    
    // Default to external for unknown cases
    return 'external';
  }
}
