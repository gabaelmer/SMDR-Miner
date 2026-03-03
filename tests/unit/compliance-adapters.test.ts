import { describe, expect, it } from 'vitest';
import { parseSmdrRecord } from '../../backend/parser/parseSmdrRecord';
import { rate_call } from '../../backend/billing/rate_call';

describe('compliance adapters', () => {
  it('normalizes @YYYYMMDD@ envelope and 12-hour PM time', () => {
    const line = '@20200507@ 05/07 02:36P 0000:00:42 T1      0007 190595378355#039537835      X9999 001 T11 9059537835 A0010788 A';
    const parsed = parseSmdrRecord(line);

    expect(parsed.call_date).toBe('2020-05-07');
    expect(parsed.start_time).toBe('14:36:00');
    expect(parsed.duration_seconds).toBe(42);
    expect(parsed.completion_status).toBe('A');
    expect(parsed.parsing_errors.some((err) => /Start time format invalid/i.test(err))).toBe(false);
  });

  it('extracts call identifier components into strict contract shape', () => {
    const parsed = parseSmdrRecord('03/03 10:15:00 00:01:00 2001 09171234567 T3 A CID:A0010788');

    expect(parsed.call_identifier).toEqual({
      plane: 'A',
      system_id: '001',
      call_number: '0788'
    });
  });

  it('rates internal calls as free by default', () => {
    const result = rate_call(
      {
        record_type: 'standard',
        long_call: false,
        call_date: '2026-03-03',
        start_time: '10:00:00',
        duration_raw: '00:00:35',
        duration_seconds: 35,
        time_to_answer: null,
        calling_party: '2001',
        called_party: '2002',
        digits_dialed: null,
        ani: null,
        dnis: null,
        system_id: null,
        call_identifier: { plane: null, system_id: null, call_number: null },
        is_ip_trunk: false,
        is_transfer: false,
        completion_status: 'I',
        account_code: null,
        parsing_errors: []
      },
      {
        free_internal: true,
        defaults: {
          outgoing: { rate_per_minute: 2.5 }
        }
      }
    );

    expect(result.billing_type).toBe('internal');
    expect(result.billable_seconds).toBe(0);
    expect(result.total_cost).toBe(0);
  });

  it('applies trunk-based rates before destination prefix rates', () => {
    const result = rate_call(
      {
        record_type: 'standard',
        long_call: false,
        call_date: '2026-03-03',
        start_time: '10:00:00',
        duration_raw: '00:01:01',
        duration_seconds: 61,
        time_to_answer: null,
        calling_party: '2001',
        called_party: 'T3',
        digits_dialed: '09171234567',
        ani: null,
        dnis: null,
        system_id: null,
        call_identifier: { plane: null, system_id: null, call_number: null },
        is_ip_trunk: false,
        is_transfer: false,
        completion_status: 'A',
        account_code: null,
        parsing_errors: []
      },
      {
        free_internal: true,
        defaults: {
          outgoing: { rate_per_minute: 1 }
        },
        prefix_rates: {
          '09': { rate_per_minute: 5 }
        },
        trunk_rates: {
          T3: { rate_per_minute: 2 }
        }
      }
    );

    expect(result.billing_type).toBe('outgoing');
    expect(result.billable_seconds).toBe(120);
    expect(result.rate_applied).toBe(2);
    expect(result.total_cost).toBe(4);
  });

  it('supports per-second pricing with minimum billable duration', () => {
    const result = rate_call(
      {
        record_type: 'standard',
        long_call: false,
        call_date: '2026-03-03',
        start_time: '10:00:00',
        duration_raw: '00:00:06',
        duration_seconds: 6,
        time_to_answer: null,
        calling_party: '2001',
        called_party: '09171234567',
        digits_dialed: '001122',
        ani: null,
        dnis: null,
        system_id: null,
        call_identifier: { plane: null, system_id: null, call_number: null },
        is_ip_trunk: false,
        is_transfer: false,
        completion_status: 'A',
        account_code: null,
        parsing_errors: []
      },
      {
        free_internal: false,
        prefix_rates: {
          '00': {
            rate_per_second: 0.1,
            minimum_billable_seconds: 10,
            increment_seconds: 1
          }
        }
      }
    );

    expect(result.billing_type).toBe('outgoing');
    expect(result.billable_seconds).toBe(10);
    expect(result.rate_applied).toBe(0.1);
    expect(result.total_cost).toBe(1);
  });
});
