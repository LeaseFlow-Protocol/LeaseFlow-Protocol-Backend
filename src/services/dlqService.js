const { Queue, Worker } = require('bullmq');
const { RedisService } = require('./redisService');
const crypto = require('crypto');

/**
 * Dead Letter Queue Service for Failed Soroban RPC Syncs
 * 
 * This service handles failed blockchain ingestion events by:
 * 1. Catching parsing errors after 3 retry attempts
 * 2. Routing failed events to a DLQ for manual inspection
 * 3. Advancing the last_ingested_ledger pointer to prevent infinite loops
 * 4. Providing administrative endpoints for manual retry
 */
class DlqService {
  constructor(config) {
    this.config = config;
    this.redisService = new RedisService(config);
    this.dlqQueue = null;
    this.retryQueue = null;
    this.ingestionQueue = null;
    this.alertService = null;
  }

  /**
   * Initialize DLQ queues and workers
   */
  async initialize() {
    const redisConnection = await this.redisService.getWorkingClient();
    
    // Main ingestion queue with retry logic
    this.ingestionQueue = new Queue('soroban-ingestion', {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    // Dead Letter Queue for failed events
    this.dlqQueue = new Queue('soroban-dlq', {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 10,
      },
    });

    // Retry queue for manual replay
    this.retryQueue = new Queue('soroban-retry', {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 10,
      },
    });

    // Start workers
    await this.startWorkers();
    
    console.log('[DLQ] Dead Letter Queue service initialized');
  }

  /**
   * Start queue workers for processing events
   */
  async startWorkers() {
    const redisConnection = await this.redisService.getWorkingClient();

    // Ingestion worker - processes normal blockchain events
    const ingestionWorker = new Worker('soroban-ingestion', async (job) => {
      return await this.processIngestionJob(job);
    }, {
      connection: redisConnection,
      concurrency: 5,
    });

    // DLQ worker - monitors for critical events and sends alerts
    const dlqWorker = new Worker('soroban-dlq', async (job) => {
      return await this.processDlqJob(job);
    }, {
      connection: redisConnection,
      concurrency: 2,
    });

    // Retry worker - processes manually retried jobs
    const retryWorker = new Worker('soroban-retry', async (job) => {
      return await this.processRetryJob(job);
    }, {
      connection: redisConnection,
      concurrency: 3,
    });

    // Handle worker errors
    ingestionWorker.on('failed', async (job, err) => {
      console.error('[DLQ] Ingestion job failed:', { jobId: job.id, error: err.message });
      
      // If this is the 3rd failure, move to DLQ
      if (job.attemptsMade >= 3) {
        await this.moveToDlq(job, err);
      }
    });

    dlqWorker.on('failed', (job, err) => {
      console.error('[DLQ] DLQ job failed:', { jobId: job.id, error: err.message });
    });

    retryWorker.on('failed', (job, err) => {
      console.error('[DLQ] Retry job failed:', { jobId: job.id, error: err.message });
    });

    console.log('[DLQ] Workers started successfully');
  }

  /**
   * Process a normal ingestion job
   */
  async processIngestionJob(job) {
    const { eventPayload, ledgerNumber, eventType } = job.data;
    
    try {
      // Process the Soroban event based on type
      switch (eventType) {
        case 'LeaseStarted':
          await this.processLeaseStartedEvent(eventPayload, ledgerNumber);
          break;
        case 'SubleaseCreated':
          await this.processSubleaseCreatedEvent(eventPayload, ledgerNumber);
          break;
        case 'EscrowYieldHarvested':
          await this.processYieldHarvestedEvent(eventPayload, ledgerNumber);
          break;
        default:
          console.warn(`[DLQ] Unknown event type: ${eventType}`);
      }

      // Update last ingested ledger
      await this.updateLastIngestedLedger(ledgerNumber);
      
      return { success: true, processedAt: new Date().toISOString() };
    } catch (error) {
      console.error(`[DLQ] Error processing ${eventType} event:`, error);
      throw error; // This will trigger retry logic
    }
  }

  /**
   * Move a failed job to the DLQ
   */
  async moveToDlq(job, error) {
    const dlqJobData = {
      originalJobId: job.id,
      eventPayload: job.data.eventPayload,
      ledgerNumber: job.data.ledgerNumber,
      eventType: job.data.eventType,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      failedAt: new Date().toISOString(),
      retryCount: job.attemptsMade,
    };

    // Add to DLQ
    await this.dlqQueue.add('failed-event', dlqJobData, {
      priority: this.calculatePriority(job.data.eventType),
    });

    // Check if this is a critical lease event
    if (this.isCriticalLeaseEvent(job.data.eventType)) {
      await this.sendCriticalAlert(dlqJobData);
    }

    // Advance the ledger pointer to prevent infinite loops
    await this.updateLastIngestedLedger(job.data.ledgerNumber);
    
    console.log(`[DLQ] Job ${job.id} moved to DLQ after ${job.attemptsMade} failures`);
  }

  /**
   * Process a DLQ job (mainly for alerting)
   */
  async processDlqJob(job) {
    const { eventPayload, ledgerNumber, error, eventType } = job.data;
    
    // Log the DLQ event for audit
    console.log(`[DLQ] Processing failed event: ${eventType} from ledger ${ledgerNumber}`);
    
    // Additional alerting logic if needed
    if (this.isCriticalLeaseEvent(eventType)) {
      await this.logCriticalFailure(job.data);
    }

    return { processed: true, timestamp: new Date().toISOString() };
  }

  /**
   * Process a manually retried job
   */
  async processRetryJob(job) {
    const { dlqJobId, originalEventData } = job.data;
    
    try {
      // Retry the original ingestion logic
      const result = await this.processIngestionJob({
        data: originalEventData,
        id: `retry-${dlqJobId}`,
      });

      // If successful, remove from DLQ
      await this.dlqQueue.getJob(dlqJobId).then(job => job?.remove());
      
      console.log(`[DLQ] Successfully retried job ${dlqJobId}`);
      return result;
    } catch (error) {
      console.error(`[DLQ] Retry failed for job ${dlqJobId}:`, error);
      throw error;
    }
  }

  /**
   * Add a new event to the ingestion queue
   */
  async addEvent(eventData) {
    const job = await this.ingestionQueue.add('process-event', eventData, {
      priority: this.calculatePriority(eventData.eventType),
    });
    
    return job;
  }

  /**
   * Manual retry endpoint for DLQ jobs
   */
  async retryDlqJob(dlqJobId) {
    const dlqJob = await this.dlqQueue.getJob(dlqJobId);
    
    if (!dlqJob) {
      throw new Error(`DLQ job ${dlqJobId} not found`);
    }

    const originalEventData = {
      eventPayload: dlqJob.data.eventPayload,
      ledgerNumber: dlqJob.data.ledgerNumber,
      eventType: dlqJob.data.eventType,
    };

    // Add to retry queue
    await this.retryQueue.add('manual-retry', {
      dlqJobId,
      originalEventData,
    });

    return { message: `Job ${dlqJobId} queued for retry` };
  }

  /**
   * Get all DLQ jobs with optional filtering
   */
  async getDlqJobs(options = {}) {
    const { eventType, limit = 50, offset = 0 } = options;
    
    let jobs = await this.dlqQueue.getJobs(['failed', 'waiting'], {
      start: offset,
      end: offset + limit - 1,
    });

    if (eventType) {
      jobs = jobs.filter(job => job.data.eventType === eventType);
    }

    return jobs.map(job => ({
      id: job.id,
      eventType: job.data.eventType,
      ledgerNumber: job.data.ledgerNumber,
      error: job.data.error,
      failedAt: job.data.failedAt,
      retryCount: job.data.retryCount,
      eventPayload: job.data.eventPayload,
    }));
  }

  /**
   * Update the last ingested ledger pointer
   */
  async updateLastIngestedLedger(ledgerNumber) {
    const redisConnection = await this.redisService.getWorkingClient();
    await redisConnection.set('last_ingested_ledger', ledgerNumber);
  }

  /**
   * Get the last ingested ledger number
   */
  async getLastIngestedLedger() {
    const redisConnection = await this.redisService.getWorkingClient();
    const ledger = await redisConnection.get('last_ingested_ledger');
    return ledger ? parseInt(ledger, 10) : 0;
  }

  /**
   * Calculate priority based on event type
   */
  calculatePriority(eventType) {
    const priorities = {
      'LeaseStarted': 10,
      'SubleaseCreated': 8,
      'EscrowYieldHarvested': 6,
      'DerivedHierarchyBurned': 4,
    };
    return priorities[eventType] || 1;
  }

  /**
   * Check if this is a critical lease event
   */
  isCriticalLeaseEvent(eventType) {
    return ['LeaseStarted', 'SubleaseCreated'].includes(eventType);
  }

  /**
   * Send critical alert for failed lease events
   */
  async sendCriticalAlert(jobData) {
    const alertData = {
      type: 'CRITICAL_LEASE_EVENT_FAILED',
      eventType: jobData.eventType,
      ledgerNumber: jobData.ledgerNumber,
      error: jobData.error.message,
      timestamp: jobData.failedAt,
      eventId: jobData.originalJobId,
    };

    // Log critical alert
    console.error('[DLQ] CRITICAL ALERT:', alertData);
    
    // Here you would integrate with PagerDuty, Slack, etc.
    // For now, we'll just log it prominently
    await this.logCriticalFailure(jobData);
  }

  /**
   * Log critical failure for audit
   */
  async logCriticalFailure(jobData) {
    const auditLog = {
      id: crypto.randomUUID(),
      type: 'DLQ_CRITICAL_FAILURE',
      eventType: jobData.eventType,
      ledgerNumber: jobData.ledgerNumber,
      error: jobData.error,
      failedAt: jobData.failedAt,
      retryCount: jobData.retryCount,
      eventPayload: jobData.eventPayload,
    };

    // Store in database audit log if available
    try {
      const { AppDatabase } = await import('../db/appDatabase.js');
      const database = new AppDatabase(this.config.database?.filename || './leases.db');
      
      // This would require adding an audit_log table to the schema
      console.log('[DLQ] Critical failure logged:', auditLog);
    } catch (error) {
      console.error('[DLQ] Failed to log critical failure:', error);
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const ingestionStats = await this.ingestionQueue.getJobCounts();
    const dlqStats = await this.dlqQueue.getJobCounts();
    const retryStats = await this.retryQueue.getJobCounts();
    const lastLedger = await this.getLastIngestedLedger();

    return {
      ingestion: ingestionStats,
      dlq: dlqStats,
      retry: retryStats,
      lastIngestedLedger: lastLedger,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.ingestionQueue) await this.ingestionQueue.close();
    if (this.dlqQueue) await this.dlqQueue.close();
    if (this.retryQueue) await this.retryQueue.close();
    console.log('[DLQ] Service shut down gracefully');
  }
}

module.exports = { DlqService };
