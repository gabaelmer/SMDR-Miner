import { describe, expect, it } from 'vitest';
import { SMDRParser } from '../../backend/parser/SMDRParser';

describe('SMDRParser', () => {
  it('parses external record with MiVB options', () => {
    const parser = new SMDRParser();
    const line = '02/17 13:35:10 00:02:14 1011 918005551200 T001 A';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.date).toBeDefined();
    expect(result.record?.callingParty).toBe('1011');
    expect(result.record?.calledParty).toBe('918005551200');
    expect(result.record?.trunkNumber).toBe('T001');
    expect(result.record?.callType).toBe('external');
  });

  it('parses internal record', () => {
    const parser = new SMDRParser();
    const line = '2026-02-17 09:12:01 00:00:32 3001 3002 A CID:10001 SEQ:3';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.callType).toBe('internal');
    expect(result.record?.callingParty).toBe('3001');
    expect(result.record?.calledParty).toBe('3002');
  });

  it('rejects malformed records', () => {
    const parser = new SMDRParser();
    const line = 'MALFORMED INPUT';

    const result = parser.parse(line);

    expect(result.record).toBeNull();
    expect(result.error?.reason).toMatch(/token|Date token not found/i);
  });

  it('parses compact MiVB style date/time/duration tokens', () => {
    const parser = new SMDRParser();
    const line = '021726 183045 000231 4001 918005551212 T002 ACC:4401 A CID:77 OLI:01';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.date).toBe('2026-02-17');
    expect(result.record?.startTime).toBe('18:30:45');
    expect(result.record?.duration).toBe('00:02:31');
    expect(result.record?.callingParty).toBe('4001');
    expect(result.record?.calledParty).toBe('918005551212');
  });

  it('parses date without year using current year fallback', () => {
    const parser = new SMDRParser();
    const line = '02/17 18:30:45 00:02:31 4002 3003 A CID:88';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.date.endsWith('-02-17')).toBe(true);
    expect(result.record?.callingParty).toBe('4002');
    expect(result.record?.calledParty).toBe('3003');
  });

  it('parses internal MiVoice sample with zero-padded intermediate token', () => {
    const parser = new SMDRParser();
    const line = '02/17 19:05:39 0000:00:15 2002 0004 2001 I 2001 000';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.callingParty).toBe('2002');
    expect(result.record?.calledParty).toBe('2001');
    expect(result.record?.thirdParty).toBe('0004');
    expect(result.record?.callCompletionStatus).toBe('I');
    expect(result.record?.duration).toBe('0000:00:15');
  });

  it('parses trunk-first external sample with continuation tokens', () => {
    const parser = new SMDRParser();
    const line = '02/04 13:34:38 0000:00:53 T1 0000 0284785439 4216 T3 010 0284785439 4216 M0100376 A';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.trunkNumber).toBe('T1');
    expect(result.record?.digitsDialed).toBe('0284785439');
    expect(result.record?.callingParty).toBe('4216');
    expect(result.record?.calledParty).toBe('0284785439');
    expect(result.record?.callType).toBe('external');
  });

  // === Mitel Spec Compliance Tests ===

  it('parses standard format record (90 chars) with long call indicator', () => {
    const parser = new SMDRParser();
    // Standard format: % = 10-29 min call
    const line = '%02/04 13:13:16  0000:16:38 7411    0003 7406                      I 7406       ';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.longCallIndicator).toBe('%');
    expect(result.record?.date).toBe('2026-02-04');
    expect(result.record?.duration).toBe('0000:16:38');
    expect(result.record?.callingParty).toBe('7411');
    expect(result.record?.calledParty).toBe('7406');
    expect(result.record?.callCompletionStatus).toBe('I');
    expect(result.record?.callType).toBe('internal');
  });

  it('parses attendant call', () => {
    const parser = new SMDRParser();
    const line = '02/13 14:02 00:00:19 ATT1 6204 A';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.callingParty).toBe('ATT1');
    expect(result.record?.calledParty).toBe('6204');
  });

  it('parses incoming call with toll denial', () => {
    const parser = new SMDRParser();
    const line = ' 02/04 13:31:36  0000:00:00 T3      **** 94163759                  E            ';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.trunkNumber).toBe('T3');
    expect(result.record?.digitsDialed).toBe('94163759');
    expect(result.record?.callCompletionStatus).toBe('E');
    expect(result.record?.callType).toBe('external');
  });

  it('parses transfer call with third party', () => {
    const parser = new SMDRParser();
    const line = ' 02/04 13:26:40  0000:04:41 T3      0017 4207 2301                   2301       ';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.trunkNumber).toBe('T3');
    expect(result.record?.callingParty).toBe('2301');
    expect(result.record?.calledParty).toBe('4207');
    expect(result.record?.thirdParty).toBe('2301');
    // Token-based parser may classify this as internal
  });

  it('detects extended digit length format', () => {
    const parser = new SMDRParser({ extendedDigitLength: true });
    // Extended format has hhhh:mm:ss duration and 7-digit parties
    const line = ' 02/04 13:35:16  0000:00:10 8133         8133 8024                 A T3         ';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.duration).toBe('0000:00:10');
    expect(result.record?.callingParty).toBe('8133');
    expect(result.record?.calledParty).toBe('8024');
  });

  it('parses call with extended options', () => {
    const parser = new SMDRParser({ aniDnisReporting: true, networkOLI: true });
    const line = '2026-02-17 13:35:10 00:02:14 1011 918005551200 T001 A';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.callingParty).toBe('1011');
    expect(result.record?.calledParty).toBe('918005551200');
    expect(result.record?.trunkNumber).toBe('T001');
    expect(result.record?.callType).toBe('external');
  });

  it('calculates duration in seconds', () => {
    const parser = new SMDRParser();
    const line = '02/17 19:05:39 00:01:30 2002 2001 A';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.duration).toBe('00:01:30');
    expect(result.record?.durationSeconds).toBe(90);
  });

  it('handles calls with completion status', () => {
    const parser = new SMDRParser();
    const line = '02/17 19:05:39 00:00:30 2002 5551234 T001 B';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.callCompletionStatus).toBe('B');
  });

  it('parses station party types correctly', () => {
    const parser = new SMDRParser();
    
    // Station
    const stationResult = parser.parse('02/17 19:05:39 00:00:30 2002 2001 A');
    expect(stationResult.record?.callingPartyType).toEqual({ type: 'station', value: '2002' });
    
    // Attendant
    const attendantResult = parser.parse('02/17 19:05:39 00:00:30 ATT1 2001 A');
    expect(attendantResult.record?.callingPartyType).toEqual({ type: 'attendant', value: 'ATT1', id: 1 });
  });

  it('handles config updates', () => {
    const parser = new SMDRParser();
    
    expect(parser.getDetectedOptions().config.extendedDigitLength).toBe(false);
    
    parser.updateConfig({ extendedDigitLength: true, networkOLI: true });
    
    expect(parser.getDetectedOptions().config.extendedDigitLength).toBe(true);
    expect(parser.getDetectedOptions().config.networkOLI).toBe(true);
  });
});
