const crypto = require('crypto');

/**
 * Lessee "Proof of History" Reputation Indexer (Issue #102)
 * 
 * This service builds a decentralized credit score system that helps lessors evaluate
 * the risk of potential tenants before approving a lease.
 * 
 * Key Features:
 * - Scans user's entire historical leasing lifecycle
 * - Calculates scores based on completed leases, payments, defaults, and deposit slashes
 * - Time-decay algorithm for fair scoring
 * - Fast API endpoint for lessor queries
 * - Transparent and fair algorithmic scoring
 */
class ReputationIndexerService {
  constructor(database) {
    this.database = database;
    this.scoreCache = new Map();
    this.cacheTimeout = 300000; // 5 minutes cache timeout
  }

  /**
   * Calculate reputation score for a lessee
   */
  async calculateReputationScore(pubkey, options = {}) {
    const {
      includeHistory = true,
      timeDecayMonths = 36,
      weighting = this.getDefaultWeighting()
    } = options;

    try {
      // Check cache first
      const cacheKey = `${pubkey}_${JSON.stringify(options)}`;
      const cached = this.scoreCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        return cached.data;
      }

      // Get historical data
      const history = await this.getLesseeHistory(pubkey);
      
      // Calculate base scores
      const completedLeasesScore = this.calculateCompletedLeasesScore(history.leases, weighting);
      const paymentScore = this.calculatePaymentScore(history.payments, weighting);
      const defaultScore = this.calculateDefaultScore(history.defaults, weighting);
      const depositScore = this.calculateDepositScore(history.deposits, weighting);

      // Apply time decay
      const timeDecayedScores = this.applyTimeDecay(
        { completedLeasesScore, paymentScore, defaultScore, depositScore },
        history,
        timeDecayMonths
      );

      // Calculate final score
      const finalScore = this.calculateFinalScore(timeDecayedScores, weighting);

      // Prepare result
      const result = {
        pubkey,
        score: finalScore.total,
        breakdown: finalScore.breakdown,
        history: includeHistory ? this.summarizeHistory(history) : undefined,
        calculatedAt: new Date().toISOString(),
        dataPoints: {
          totalLeases: history.leases.length,
          completedLeases: history.leases.filter(l => l.status === 'completed').length,
          totalPayments: history.payments.length,
          missedPayments: history.payments.filter(p => p.status === 'missed').length,
          defaults: history.defaults.length,
          depositSlashes: history.deposits.filter(d => d.type === 'slash').length
        }
      };

      // Cache result
      this.scoreCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      console.error('[ReputationIndexer] Error calculating reputation score:', error);
      throw new Error(`Failed to calculate reputation score: ${error.message}`);
    }
  }

  /**
   * Get comprehensive lessee history
   */
  async getLesseeHistory(pubkey) {
    try {
      // Get all leases for this lessee
      const leases = this.database.db
        .prepare(`
          SELECT 
            id, landlord_id, start_date, end_date, status, rent_amount,
            created_at, updated_at, payment_status, last_payment_at
          FROM leases 
          WHERE tenant_id = ?
          ORDER BY created_at DESC
        `)
        .all(pubkey);

      // Get payment history
      const payments = this.database.db
        .prepare(`
          SELECT 
            id, lease_id, period, due_date, amount_due, amount_paid,
            date_paid, status, created_at, updated_at
          FROM rent_payments 
          WHERE lease_id IN (
            SELECT id FROM leases WHERE tenant_id = ?
          )
          ORDER BY due_date DESC
        `)
        .all(pubkey);

      // Get late fee history
      const lateFees = this.database.db
        .prepare(`
          SELECT 
            id, lease_id, period, days_late, fee_amount,
            assessed_at, created_at
          FROM late_fee_ledger 
          WHERE lease_id IN (
            SELECT id FROM leases WHERE tenant_id = ?
          )
          ORDER BY assessed_at DESC
        `)
        .all(pubkey);

      // Get deposit history (would need to be implemented in schema)
      const deposits = this.database.db
        .prepare(`
          SELECT 
            id, lease_id, amount, type, reason,
            created_at, resolved_at
          FROM security_deposits 
          WHERE tenant_id = ?
          ORDER BY created_at DESC
        `)
        .all(pubkey) || [];

      // Get defaults/evictions
      const defaults = this.database.db
        .prepare(`
          SELECT 
            id, lease_id, reason, severity,
            created_at, resolved_at
          FROM lease_defaults 
          WHERE tenant_id = ?
          ORDER BY created_at DESC
        `)
        .all(pubkey) || [];

      return {
        leases,
        payments,
        lateFees,
        deposits,
        defaults
      };
    } catch (error) {
      console.error('[ReputationIndexer] Error fetching lessee history:', error);
      // Return empty history on error
      return {
        leases: [],
        payments: [],
        lateFees: [],
        deposits: [],
        defaults: []
      };
    }
  }

  /**
   * Calculate score based on completed leases
   */
  calculateCompletedLeasesScore(leases, weighting) {
    const totalLeases = leases.length;
    const completedLeases = leases.filter(l => l.status === 'completed').length;
    const activeLeases = leases.filter(l => l.status === 'active').length;
    const terminatedLeases = leases.filter(l => l.status === 'terminated').length;

    if (totalLeases === 0) {
      return { score: 0, weight: weighting.completedLeases, details: 'No lease history' };
    }

    // Base score from completion rate
    const completionRate = completedLeases / totalLeases;
    let score = completionRate * 100;

    // Bonus for active leases (shows current reliability)
    if (activeLeases > 0) {
      score += (activeLeases / totalLeases) * 10;
    }

    // Penalty for terminated leases
    if (terminatedLeases > 0) {
      score -= (terminatedLeases / totalLeases) * 20;
    }

    // Ensure score stays within bounds
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      weight: weighting.completedLeases,
      details: {
        totalLeases,
        completedLeases,
        activeLeases,
        terminatedLeases,
        completionRate: (completionRate * 100).toFixed(1) + '%'
      }
    };
  }

  /**
   * Calculate score based on payment history
   */
  calculatePaymentScore(payments, weighting) {
    const totalPayments = payments.length;
    if (totalPayments === 0) {
      return { score: 50, weight: weighting.payments, details: 'No payment history' }; // Neutral score
    }

    const onTimePayments = payments.filter(p => 
      p.status === 'paid' && new Date(p.date_paid) <= new Date(p.due_date)
    ).length;
    
    const latePayments = payments.filter(p => 
      p.status === 'paid' && new Date(p.date_paid) > new Date(p.due_date)
    ).length;
    
    const missedPayments = payments.filter(p => p.status === 'missed').length;

    // Calculate on-time payment rate
    const onTimeRate = onTimePayments / totalPayments;
    let score = onTimeRate * 100;

    // Penalty for missed payments
    const missedRate = missedPayments / totalPayments;
    score -= missedRate * 50;

    // Small penalty for late payments (less severe than missed)
    const lateRate = latePayments / totalPayments;
    score -= lateRate * 15;

    // Ensure score stays within bounds
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      weight: weighting.payments,
      details: {
        totalPayments,
        onTimePayments,
        latePayments,
        missedPayments,
        onTimeRate: (onTimeRate * 100).toFixed(1) + '%',
        missedRate: (missedRate * 100).toFixed(1) + '%'
      }
    };
  }

  /**
   * Calculate score based on defaults/evictions
   */
  calculateDefaultScore(defaults, weighting) {
    const totalDefaults = defaults.length;
    
    if (totalDefaults === 0) {
      return { score: 100, weight: weighting.defaults, details: 'No defaults' };
    }

    let score = 100;
    
    defaults.forEach(default_ => {
      // Heavy penalties based on severity
      switch (default_.severity) {
        case 'severe':
          score -= 40;
          break;
        case 'moderate':
          score -= 25;
          break;
        case 'minor':
          score -= 10;
          break;
        default:
          score -= 20;
      }
    });

    // Ensure score doesn't go below 0
    score = Math.max(0, score);

    return {
      score,
      weight: weighting.defaults,
      details: {
        totalDefaults,
        severityBreakdown: defaults.reduce((acc, d) => {
          acc[d.severity] = (acc[d.severity] || 0) + 1;
          return acc;
        }, {})
      }
    };
  }

  /**
   * Calculate score based on deposit history
   */
  calculateDepositScore(deposits, weighting) {
    const totalDeposits = deposits.length;
    
    if (totalDeposits === 0) {
      return { score: 75, weight: weighting.deposits, details: 'No deposit history' }; // Slightly positive neutral
    }

    let score = 100;
    
    deposits.forEach(deposit => {
      if (deposit.type === 'slash') {
        // Heavy penalty for deposit slashes
        score -= 30;
      } else if (deposit.type === 'dispute') {
        // Moderate penalty for disputes
        score -= 15;
      } else if (deposit.type === 'full_return') {
        // Bonus for full return
        score += 5;
      }
    });

    // Ensure score stays within bounds
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      weight: weighting.deposits,
      details: {
        totalDeposits,
        slashes: deposits.filter(d => d.type === 'slash').length,
        disputes: deposits.filter(d => d.type === 'dispute').length,
        fullReturns: deposits.filter(d => d.type === 'full_return').length
      }
    };
  }

  /**
   * Apply time decay to historical events
   */
  applyTimeDecay(scores, history, timeDecayMonths) {
    const now = new Date();
    const decayedScores = {};

    Object.keys(scores).forEach(key => {
      const scoreData = scores[key];
      let timeWeight = 1.0;

      // Find the most recent event for this score category
      let mostRecentEvent = null;
      
      switch (key) {
        case 'completedLeasesScore':
          mostRecentEvent = history.leases.length > 0 ? 
            new Date(Math.max(...history.leases.map(l => new Date(l.created_at)))) : null;
          break;
        case 'paymentScore':
          mostRecentEvent = history.payments.length > 0 ? 
            new Date(Math.max(...history.payments.map(p => new Date(p.created_at)))) : null;
          break;
        case 'defaultScore':
          mostRecentEvent = history.defaults.length > 0 ? 
            new Date(Math.max(...history.defaults.map(d => new Date(d.created_at)))) : null;
          break;
        case 'depositScore':
          mostRecentEvent = history.deposits.length > 0 ? 
            new Date(Math.max(...history.deposits.map(d => new Date(d.created_at)))) : null;
          break;
      }

      if (mostRecentEvent) {
        const monthsSinceEvent = (now - mostRecentEvent) / (1000 * 60 * 60 * 24 * 30);
        
        if (monthsSinceEvent > timeDecayMonths) {
          // Full decay for very old events
          timeWeight = 0.1;
        } else {
          // Linear decay
          timeWeight = 1.0 - (monthsSinceEvent / timeDecayMonths) * 0.9;
        }
      }

      decayedScores[key] = {
        ...scoreData,
        originalScore: scoreData.score,
        timeDecayedScore: scoreData.score * timeWeight,
        timeWeight: timeWeight.toFixed(3),
        mostRecentEvent: mostRecentEvent ? mostRecentEvent.toISOString() : null
      };
    });

    return decayedScores;
  }

  /**
   * Calculate final weighted score
   */
  calculateFinalScore(decayedScores, weighting) {
    let totalScore = 0;
    let totalWeight = 0;
    const breakdown = {};

    Object.keys(decayedScores).forEach(key => {
      const scoreData = decayedScores[key];
      const weight = scoreData.weight;
      const adjustedScore = scoreData.timeDecayedScore;
      
      totalScore += adjustedScore * weight;
      totalWeight += weight;
      
      breakdown[key] = {
        score: adjustedScore,
        weight: weight,
        contribution: adjustedScore * weight,
        details: scoreData.details
      };
    });

    // Normalize to 0-100 scale
    const finalScore = totalWeight > 0 ? (totalScore / totalWeight) : 0;

    return {
      total: Math.round(finalScore * 100) / 100, // Round to 2 decimal places
      breakdown,
      grading: this.getGrade(finalScore)
    };
  }

  /**
   * Get letter grade for score
   */
  getGrade(score) {
    if (score >= 90) return { grade: 'A+', description: 'Excellent' };
    if (score >= 85) return { grade: 'A', description: 'Very Good' };
    if (score >= 80) return { grade: 'A-', description: 'Good' };
    if (score >= 75) return { grade: 'B+', description: 'Above Average' };
    if (score >= 70) return { grade: 'B', description: 'Average' };
    if (score >= 65) return { grade: 'B-', description: 'Below Average' };
    if (score >= 60) return { grade: 'C+', description: 'Fair' };
    if (score >= 55) return { grade: 'C', description: 'Poor' };
    if (score >= 50) return { grade: 'C-', description: 'Very Poor' };
    if (score >= 40) return { grade: 'D', description: 'Bad' };
    return { grade: 'F', description: 'Very Bad' };
  }

  /**
   * Get default weighting for score calculation
   */
  getDefaultWeighting() {
    return {
      completedLeases: 0.25,    // 25% weight
      payments: 0.35,           // 35% weight (most important)
      defaults: 0.30,           // 30% weight (very important)
      deposits: 0.10            // 10% weight
    };
  }

  /**
   * Summarize history for API response
   */
  summarizeHistory(history) {
    return {
      leaseSummary: {
        total: history.leases.length,
        completed: history.leases.filter(l => l.status === 'completed').length,
        active: history.leases.filter(l => l.status === 'active').length,
        terminated: history.leases.filter(l => l.status === 'terminated').length
      },
      paymentSummary: {
        total: history.payments.length,
        onTime: history.payments.filter(p => 
          p.status === 'paid' && new Date(p.date_paid) <= new Date(p.due_date)
        ).length,
        late: history.payments.filter(p => 
          p.status === 'paid' && new Date(p.date_paid) > new Date(p.due_date)
        ).length,
        missed: history.payments.filter(p => p.status === 'missed').length
      },
      recentActivity: this.getRecentActivity(history)
    };
  }

  /**
   * Get recent activity summary
   */
  getRecentActivity(history) {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const recentLeases = history.leases.filter(l => 
      new Date(l.created_at) > threeMonthsAgo
    );
    
    const recentPayments = history.payments.filter(p => 
      new Date(p.created_at) > threeMonthsAgo
    );
    
    const recentDefaults = history.defaults.filter(d => 
      new Date(d.created_at) > threeMonthsAgo
    );

    return {
      leases: recentLeases.length,
      payments: recentPayments.length,
      defaults: recentDefaults.length,
      period: 'Last 3 months'
    };
  }

  /**
   * Clear cache for a specific pubkey
   */
  clearCache(pubkey) {
    const keysToDelete = [];
    for (const key of this.scoreCache.keys()) {
      if (key.startsWith(pubkey + '_')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.scoreCache.delete(key));
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let expiredCount = 0;
    let activeCount = 0;

    for (const [key, value] of this.scoreCache.entries()) {
      if ((now - value.timestamp) >= this.cacheTimeout) {
        expiredCount++;
      } else {
        activeCount++;
      }
    }

    return {
      totalEntries: this.scoreCache.size,
      activeEntries: activeCount,
      expiredEntries: expiredCount,
      cacheTimeout: this.cacheTimeout
    };
  }

  /**
   * Cleanup expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, value] of this.scoreCache.entries()) {
      if ((now - value.timestamp) >= this.cacheTimeout) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.scoreCache.delete(key));
    
    return keysToDelete.length;
  }
}

module.exports = { ReputationIndexerService };
