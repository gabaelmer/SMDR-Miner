import { describe, expect, it } from 'vitest';
import { SMDRParser } from '../../backend/parser/SMDRParser';

describe('SMDRParser', () => {
  it('parses external record with MiVB options', () => {
    const parser = new SMDRParser();
    const line =
      '2026-02-17 13:35:10 00:02:14 1011 918005551200 T001 +18005551200 ACC:76211 A T CID:90233201 SEQ:77 ACID:90199100 OLI:02';

    const result = parser.parse(line);

    expect(result.record).toBeTruthy();
    expect(result.record?.date).toBe('2026-02-17');
    expect(result.record?.callingParty).toBe('1011');
    expect(result.record?.calledParty).toBe('918005551200');
    expect(result.record?.trunkNumber).toBe('T001');
    expect(result.record?.accountCode).toBe('76211');
    expect(result.record?.callIdentifier).toBe('90233201');
    expect(result.record?.networkOLI).toBe('02');
    expect(result.record?.callType).toBe('external');

    expect(parser.getDetectedOptions()).toEqual({
      standardizedCallId: true,
      networkOLI: true,
      extendedDigitLength: false,
      accountCodes: true
    });
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
});
