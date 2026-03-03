import Database from 'better-sqlite3';
import { BillingImpactAnalysis, CallCategory, RateConfig } from '../../shared/types';
import dayjs from 'dayjs';

export class BillingImpactService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  analyzeRateChange(
    category: CallCategory,
    currentRate: number,
    proposedRate: number,
    periodDays = 30
  ): {
    affectedCalls: number;
    currentRevenue: number;
    projectedRevenue: number;
    revenueChange: number;
    revenueChangePercent: number;
  } {
    const cutoffDate = dayjs().subtract(periodDays, 'day').format('YYYY-MM-DD');
    
    // Get call statistics for this category
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as callCount,
        COALESCE(SUM(duration_seconds), 0) as totalDuration,
        COALESCE(SUM(call_cost), 0) as currentCost
      FROM smdr_records
      WHERE call_category = ?
      AND date >= ?
    `).get(category, cutoffDate) as {
      callCount: number;
      totalDuration: number;
      currentCost: number;
    };

    const affectedCalls = stats.callCount;
    const totalMinutes = stats.totalDuration / 60;
    
    // Calculate revenue impact
    const currentRevenue = stats.currentCost;
    const projectedRevenue = totalMinutes * proposedRate;
    const revenueChange = projectedRevenue - currentRevenue;
    const revenueChangePercent = currentRevenue > 0 ? (revenueChange / currentRevenue) * 100 : 0;

    return {
      affectedCalls,
      currentRevenue,
      projectedRevenue,
      revenueChange,
      revenueChangePercent
    };
  }

  analyzeFullImpact(
    rates: RateConfig[],
    periodDays = 30
  ): BillingImpactAnalysis {
    const byCategory: Array<BillingImpactAnalysis['byCategory'][0]> = [];
    let totalCurrentRevenue = 0;
    let totalProjectedRevenue = 0;
    let totalAffectedCalls = 0;

    for (const rate of rates) {
      const impact = this.analyzeRateChange(
        rate.category,
        rate.ratePerMinute, // This is current rate
        rate.ratePerMinute, // This would be proposed rate (same for now)
        periodDays
      );

      byCategory.push({
        category: rate.category,
        currentRate: rate.ratePerMinute,
        proposedRate: rate.ratePerMinute,
        rateChange: 0,
        rateChangePercent: 0,
        affectedCalls: impact.affectedCalls,
        currentRevenue: impact.currentRevenue,
        projectedRevenue: impact.projectedRevenue,
        revenueChange: impact.revenueChange,
        revenueChangePercent: impact.revenueChangePercent,
        periodDays
      });

      totalCurrentRevenue += impact.currentRevenue;
      totalProjectedRevenue += impact.projectedRevenue;
      totalAffectedCalls += impact.affectedCalls;
    }

    return {
      overall: {
        currentRevenue: totalCurrentRevenue,
        projectedRevenue: totalProjectedRevenue,
        revenueChange: totalProjectedRevenue - totalCurrentRevenue,
        revenueChangePercent: totalCurrentRevenue > 0 
          ? ((totalProjectedRevenue - totalCurrentRevenue) / totalCurrentRevenue) * 100 
          : 0,
        totalAffectedCalls
      },
      byCategory,
      periodDays,
      generatedAt: new Date().toISOString()
    };
  }

  analyzeProposedRateChange(
    category: CallCategory,
    currentRate: number,
    proposedRate: number,
    periodDays = 30
  ): BillingImpactAnalysis {
    const impact = this.analyzeRateChange(category, currentRate, proposedRate, periodDays);
    
    return {
      overall: {
        currentRevenue: impact.currentRevenue,
        projectedRevenue: impact.projectedRevenue,
        revenueChange: impact.revenueChange,
        revenueChangePercent: impact.revenueChangePercent,
        totalAffectedCalls: impact.affectedCalls
      },
      byCategory: [{
        category,
        currentRate,
        proposedRate,
        rateChange: proposedRate - currentRate,
        rateChangePercent: currentRate > 0 ? ((proposedRate - currentRate) / currentRate) * 100 : 0,
        affectedCalls: impact.affectedCalls,
        currentRevenue: impact.currentRevenue,
        projectedRevenue: impact.projectedRevenue,
        revenueChange: impact.revenueChange,
        revenueChangePercent: impact.revenueChangePercent,
        periodDays
      }],
      periodDays,
      generatedAt: new Date().toISOString()
    };
  }
}
