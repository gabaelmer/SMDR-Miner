import { InputSanitizer } from '../security/InputSanitizer';
import { ParseError, SMDRRecord } from '../../shared/types';

const DATE_PATTERN = /^(?:\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}(?:[/-]\d{2,4})?|\d{6}|\d{8})$/;
const TIME_PATTERN = /^(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?|(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?)$/;
const DURATION_PATTERN = /^(?:(?:\d{1,4}:)?[0-5]?\d:[0-5]\d|\d{4}|\d{6})$/;
const CALL_COMPLETION = new Set(['A', 'B', 'E', 'T', 'I', 'O', 'D', 'S', 'U']);
const TRANSFER_FLAGS = new Set(['T', 'X', 'C']);

export interface ParserOptionsState {
  standardizedCallId: boolean;
  networkOLI: boolean;
  extendedDigitLength: boolean;
  accountCodes: boolean;
}

export interface ParseResult {
  record: SMDRRecord | null;
  error?: ParseError;
}

function tokenize(line: string): string[] {
  const matches = line.match(/"[^"]*"|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ''));
}

function durationToSeconds(duration: string): number {
  const parts = duration.split(':').map((part) => Number(part));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function isExtensionToken(token: string): boolean {
  return /^\d{3,6}\*?$/.test(token);
}

function isRouteLikeToken(token: string): boolean {
  return token === '****' || /^0{2,}\d{0,4}$/.test(token) || /^0\d{2}$/.test(token);
}

function normalizeTime(token: string): string {
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

export class SMDRParser {
  private optionsState: ParserOptionsState = {
    standardizedCallId: false,
    networkOLI: false,
    extendedDigitLength: false,
    accountCodes: false
  };

  getDetectedOptions(): ParserOptionsState {
    return { ...this.optionsState };
  }

  parse(rawLine: string): ParseResult {
    const sanitized = InputSanitizer.sanitizeLine(rawLine).replace(/^%+/, '');
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
      date: normalizeDate(tokens[dateIndex]),
      startTime,
      duration,
      callingParty: '',
      calledParty: '',
      rawLine: sanitized
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
        parsed.callSequenceIdentifier = next;
        i += 1;
        continue;
      }

      const sequenceMatch = token.match(/^(?:SEQ|SEQUENCE|CALLSEQ)[:=](.+)$/i);
      if (sequenceMatch) {
        parsed.callSequenceIdentifier = sequenceMatch[1];
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
        parsed.callCompletionStatus = token.toUpperCase();
        continue;
      }

      if (TRANSFER_FLAGS.has(token.toUpperCase()) && !parsed.transferFlag) {
        parsed.transferFlag = token.toUpperCase();
        continue;
      }

      if (/^\+?\d{7,24}$/.test(token) && !parsed.digitsDialed) {
        parsed.digitsDialed = token;
        if (token.replace('+', '').length > 16) this.optionsState.extendedDigitLength = true;
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
    const extensionCandidates = nonOptionContext.filter((token) => isExtensionToken(token) && !isRouteLikeToken(token));
    const routeCandidates = nonOptionContext.filter((token) => isRouteLikeToken(token));
    const externalNumberCandidates = nonOptionContext.filter(
      (token) => /^\+?\d{7,24}$/.test(token) && !isRouteLikeToken(token)
    );

    if (parsed.trunkNumber) {
      if (parsed.digitsDialed) {
        const dialedIndex = nonOptionContext.findIndex((token) => token === parsed.digitsDialed);
        if (dialedIndex >= 0) {
          const extensionAfterDialed = nonOptionContext
            .slice(dialedIndex + 1)
            .find((token) => isExtensionToken(token) && !isRouteLikeToken(token));
          if (extensionAfterDialed) {
            parsed.callingParty = extensionAfterDialed;
          }
        }
      }

      if (!parsed.callingParty || isRouteLikeToken(parsed.callingParty)) {
        parsed.callingParty =
          [...extensionCandidates].reverse().find((token) => token !== parsed.calledParty) ??
          extensionCandidates[0] ??
          parsed.callingParty;
      }
      if (!parsed.calledParty || parsed.calledParty === parsed.callingParty || isRouteLikeToken(parsed.calledParty)) {
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
      (nonOptionContext.length === 0 || nonOptionContext.every((token) => isRouteLikeToken(token)))
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

    parsed.callType = parsed.digitsDialed || !isExtensionToken(parsed.calledParty) ? 'external' : 'internal';

    return { record: parsed };
  }
}

function normalizeDate(token: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;

  if (/^\d{8}$/.test(token)) {
    if (Number(token.slice(0, 4)) > 1900) {
      return `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}`;
    }
    const year = `20${token.slice(4, 6)}`;
    return `${year}-${token.slice(0, 2)}-${token.slice(2, 4)}`;
  }

  if (/^\d{6}$/.test(token)) {
    const year = `20${token.slice(4, 6)}`;
    return `${year}-${token.slice(0, 2)}-${token.slice(2, 4)}`;
  }

  if (/^\d{2}[/-]\d{2}$/.test(token)) {
    const [month, day] = token.split(/[/-]/);
    const year = String(new Date().getFullYear());
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const [first, second, third] = token.split(/[/-]/);
  const year = third.length === 2 ? `20${third}` : third;
  return `${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`;
}
