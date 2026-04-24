const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const crypto = require('crypto');
const axios = require('axios');

/**
 * IoT Webhook Dispatcher
 * Bridges on-chain protocol events with physical IoT assets.
 * Uses BullMQ for reliable delivery with exponential backoff.
 */
class IoT_Webhook_Dispatcher {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {object} redisConfig - Redis configuration { host, port, etc. }
   */
  constructor(database, redisConfig = {}) {
    this.db = database;
    this.redisConfig = redisConfig;
    
    // Redis connection for BullMQ
    this.connection = new Redis(this.redisConfig);
    
    // BullMQ Queue for dispatching webhooks
    this.queue = new Queue('iot-webhook-dispatch', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 10, // Strict retry logic
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    this.setupPubSub();
    this.setupWorker();
  }

  /**
   * Listen to Redis Pub/Sub for protocol events
   */
  setupPubSub() {
    const subscriber = new Redis(this.redisConfig);
    subscriber.subscribe('LesseeAccessGranted', 'LesseeAccessRevoked');

    subscriber.on('message', async (channel, message) => {
      console.log(`[IoT Dispatcher] Captured event ${channel}: ${message}`);
      try {
        const data = JSON.parse(message);
        await this.enqueueDispatch(channel, data);
      } catch (err) {
        console.error(`[IoT Dispatcher] Failed to process Pub/Sub message: ${err.message}`);
      }
    });
  }

  /**
   * Enqueue a dispatch job
   */
  async enqueueDispatch(eventType, data) {
    // Revocation webhooks have absolute highest priority
    const priority = (data.state === 'Evicted' || data.state === 'Terminated' || eventType === 'LesseeAccessRevoked') ? 1 : 10;
    
    await this.queue.add(eventType, {
      leaseId: data.leaseId,
      eventType,
      ...data
    }, { priority });

    console.log(`[IoT Dispatcher] Enqueued job: ${eventType} for Lease ${data.leaseId} (Priority: ${priority})`);
  }

  /**
   * Setup worker to process dispatch jobs
   */
  setupWorker() {
    this.worker = new Worker('iot-webhook-dispatch', async (job) => {
      const { leaseId, eventType } = job.data;
      
      // Query physical asset hardware endpoint from database
      const lock = this.db.db.prepare(`
        SELECT device_id, lock_provider, access_token 
        FROM smart_locks 
        WHERE lease_id = ? AND pairing_status = 'paired'
        LIMIT 1
      `).get(leaseId);

      if (!lock) {
        console.warn(`[IoT Dispatcher] No paired smart lock found for lease ${leaseId}. Skipping dispatch.`);
        return;
      }

      // Fetch lease details for payload
      const lease = this.db.getLeaseById(leaseId);
      if (!lease) {
        throw new Error(`Lease ${leaseId} not found in database`);
      }

      // Format secure payload (compatible with IoT standards)
      // Never expose sensitive PII, transmitting only required cryptographic identifiers.
      const payload = {
        deviceId: lock.device_id,
        eventType,
        expiration: lease.endDate,
        lesseePublicKey: lease.tenantStellarAddress || 'anonymous',
        timestamp: Math.floor(Date.now() / 1000)
      };

      // Generate HMAC-SHA256 signature to prove request origin
      const secret = process.env.IOT_WEBHOOK_SECRET || 'leaseflow_iot_secret_key';
      const signature = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

      // Dispatch to IoT backend
      try {
        const endpoint = process.env.IOT_BACKEND_URL || 'https://api.leaseflow-iot.com/v1/webhook';
        
        await axios.post(endpoint, payload, {
          headers: {
            'X-Hub-Signature-256': `sha256=${signature}`,
            'Content-Type': 'application/json',
            'X-LeaseFlow-Event': eventType
          },
          timeout: 10000 // 10s timeout
        });

        console.log(`[IoT Dispatcher] Successfully dispatched ${eventType} for lease ${leaseId}`);
        this.logAudit(leaseId, lock.device_id, eventType, payload, 'success');
      } catch (error) {
        const errorMessage = error.response ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}` : error.message;
        console.error(`[IoT Dispatcher] Dispatch failed for ${leaseId}: ${errorMessage}`);
        
        this.logAudit(leaseId, lock.device_id, eventType, payload, 'failed', errorMessage, job.attemptsMade);
        
        // Throw error to trigger BullMQ retry logic with exponential backoff
        throw new Error(`Dispatch failed: ${errorMessage}`);
      }
    }, { 
      connection: this.connection,
      concurrency: 5 // Process 5 jobs concurrently
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[IoT Dispatcher] Job ${job.id} for lease ${job.data.leaseId} failed permanently after ${job.attemptsMade} attempts.`);
    });
  }

  /**
   * Log attempt to IoT Audit Log
   */
  logAudit(leaseId, assetId, eventType, payload, status, errorMessage = null, retryCount = 0) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    try {
      this.db.db.prepare(`
        INSERT INTO iot_audit_logs (
          id, lease_id, asset_id, event_type, payload, status, 
          retry_count, error_message, dispatched_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        leaseId,
        assetId,
        eventType,
        JSON.stringify(payload),
        status,
        retryCount,
        errorMessage,
        now,
        now
      );
    } catch (err) {
      console.error(`[IoT Dispatcher] Failed to log audit: ${err.message}`);
    }
  }
}

module.exports = { IoT_Webhook_Dispatcher };
