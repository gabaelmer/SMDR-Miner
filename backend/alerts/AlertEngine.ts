import { EventEmitter } from 'node:events';
import { AlertEvent, AlertRuleSet, SMDRRecord } from '../../shared/types';

interface BusyTrack {
  timestamps: number[];
}

export class AlertEngine extends EventEmitter {
  private busyTracker = new Map<string, BusyTrack>();

  constructor(private rules: AlertRuleSet) {
    super();
  }

  updateRules(rules: AlertRuleSet): void {
    this.rules = rules;
  }

  evaluate(record: SMDRRecord): AlertEvent[] {
    const events: AlertEvent[] = [];
    const durationSeconds = durationToSeconds(record.duration);

    if (durationSeconds >= this.rules.longCallMinutes * 60) {
      events.push(this.build('long-call', `Call exceeded ${this.rules.longCallMinutes} minutes`, record));
    }

    if (this.rules.watchNumbers.length > 0) {
      const hit = this.rules.watchNumbers.find(
        (number) => record.calledParty.includes(number) || (record.digitsDialed?.includes(number) ?? false)
      );
      if (hit) {
        events.push(this.build('watch-number', `Watched number matched: ${hit}`, record));
      }
    }

    if (record.callCompletionStatus === 'B') {
      const key = record.calledParty;
      const now = Date.now();
      const windowMs = this.rules.repeatedBusyWindowMinutes * 60_000;
      const entry = this.busyTracker.get(key) ?? { timestamps: [] };
      entry.timestamps = entry.timestamps.filter((timestamp) => now - timestamp <= windowMs);
      entry.timestamps.push(now);
      this.busyTracker.set(key, entry);

      if (entry.timestamps.length >= this.rules.repeatedBusyThreshold) {
        events.push(
          this.build(
            'repeated-busy',
            `Repeated busy calls detected for ${key} (${entry.timestamps.length} in ${this.rules.repeatedBusyWindowMinutes}m)`,
            record
          )
        );
      }
    }

    if (this.rules.detectTagCalls && (record.rawLine?.toUpperCase().includes('TAG') ?? false)) {
      events.push(this.build('tag-call', 'Tag call detected', record));
    }

    if (this.rules.detectTollDenied && record.callCompletionStatus === 'D') {
      events.push(this.build('toll-denied', 'Toll denied call detected', record));
    }

    for (const event of events) {
      this.emit('alert', event);
    }

    return events;
  }

  private build(type: string, message: string, record: SMDRRecord): AlertEvent {
    return {
      type,
      message,
      record,
      createdAt: new Date().toISOString()
    };
  }
}

function durationToSeconds(duration: string): number {
  const parts = duration.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
