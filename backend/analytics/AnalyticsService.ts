import { AnalyticsSnapshot } from '../../shared/types';
import { DatabaseService } from '../db/DatabaseService';

export class AnalyticsService {
  constructor(private readonly db: DatabaseService) {}

  getSnapshot(startDate?: string, endDate?: string): AnalyticsSnapshot {
    return this.db.getAnalyticsSnapshot(startDate, endDate);
  }
}
