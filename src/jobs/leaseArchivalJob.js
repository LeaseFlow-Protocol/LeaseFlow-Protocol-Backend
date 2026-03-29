const cron = require('node-cron');
const { LeasePartitioningService } = require('../services/leasePartitioningService');

/**
 * Lease Archival Job
 * Periodically archives expired leases to cold storage
 * Keeps the active leases table lean and fast
 */
class LeaseArchivalJob {
  /**
   * @param {LeasePartitioningService} partitioningService - Partitioning service instance
   * @param {object} config - Job configuration
   */
  constructor(partitioningService, config = {}) {
    this.service = partitioningService;
    this.config = {
      cronExpression: config.cronExpression || '0 2 1 * *', // Default: 2 AM on 1st of every month
      monthsSinceExpiry: config.monthsSinceExpiry || 24,
      enabled: config.enabled !== false,
      ...config
    };
    
    this.scheduler = null;
  }

  /**
   * Start the archival job scheduler
   */
  start() {
    if (!this.config.enabled) {
      console.log('[LeaseArchivalJob] Job is disabled in configuration');
      return;
    }

    try {
      // Schedule the job using node-cron
      this.scheduler = cron.schedule(this.config.cronExpression, async () => {
        await this.execute();
      }, {
        scheduled: true,
        timezone: 'UTC'
      });

      console.log(`[LeaseArchivalJob] Scheduler started with cron expression: ${this.config.cronExpression}`);
    } catch (error) {
      console.error('[LeaseArchivalJob] Failed to start scheduler:', error.message);
      throw error;
    }
  }

  /**
   * Stop the archival job scheduler
   */
  stop() {
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
      console.log('[LeaseArchivalJob] Scheduler stopped');
    }
  }

  /**
   * Execute the archival job
   * Archives expired leases older than the configured threshold
   */
  async execute() {
    console.log(`[LeaseArchivalJob] Starting archival job at ${new Date().toISOString()}`);
    
    try {
      // Get recommendations before archival
      const recommendations = this.service.getArchivalRecommendations();
      console.log('[LeaseArchivalJob] Pre-archival analysis:', recommendations);
      
      // Archive expired leases
      const archivedCount = this.service.archiveExpiredLeases(this.config.monthsSinceExpiry);
      
      // Get updated statistics
      const stats = this.service.getLeaseStatistics();
      
      console.log(`[LeaseArchivalJob] Successfully archived ${archivedCount} leases`);
      console.log('[LeaseArchivalJob] Updated statistics:', stats);
      
      return {
        success: true,
        archivedCount,
        statistics: stats,
        executedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[LeaseArchivalJob] Execution failed:', error.message);
      return {
        success: false,
        error: error.message,
        executedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Run the job immediately (for testing/manual execution)
   */
  async runNow() {
    console.log('[LeaseArchivalJob] Running manual execution...');
    return await this.execute();
  }

  /**
   * Get job status and next scheduled run
   */
  getStatus() {
    return {
      enabled: this.config.enabled,
      cronExpression: this.config.cronExpression,
      monthsSinceExpiry: this.config.monthsSinceExpiry,
      running: this.scheduler !== null,
      nextRun: this.scheduler ? 'Check cron schedule' : 'Not scheduled'
    };
  }
}

module.exports = { LeaseArchivalJob };
