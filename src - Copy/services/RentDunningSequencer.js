const Redis = require('ioredis');
const crypto = require('crypto');

/**
 * Rent Dunning & Eviction Notice Sequencer
 * Orchestrates the sequence of communications and enforcement actions
 * when a lessee fails to pay rent on-chain.
 */
class RentDunningSequencer {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {NotificationService} notificationService - Service for sending emails/alerts
   * @param {IoT_Webhook_Dispatcher} iotDispatcher - Dispatcher for physical access revocation
   * @param {object} redisConfig - Redis configuration
   */
  constructor(database, notificationService, iotDispatcher, redisConfig = {}) {
    this.db = database;
    this.notifications = notificationService;
    this.iot = iotDispatcher;
    this.redisConfig = redisConfig;
  }

  /**
   * Initialize Pub/Sub listeners for rent events
   */
  setupPubSub() {
    const subscriber = new Redis(this.redisConfig);
    subscriber.subscribe('RentDelinquencyStarted', 'RentPaymentExecuted');

    subscriber.on('message', async (channel, message) => {
      console.log(`[Dunning Sequencer] Captured event ${channel}: ${message}`);
      try {
        const data = JSON.parse(message);
        if (channel === 'RentDelinquencyStarted') {
          await this.startDunningSequence(data);
        } else if (channel === 'RentPaymentExecuted') {
          await this.abortDunningSequence(data.leaseId);
        }
      } catch (err) {
        console.error(`[Dunning Sequencer] Error processing event: ${err.message}`);
      }
    });
  }

  /**
   * Start a new dunning sequence for a delinquent lease
   */
  async startDunningSequence(data) {
    const { leaseId, amountDue } = data;
    
    // Check if a sequence is already active for this lease
    const existing = this.db.db.prepare(`
      SELECT id FROM dunning_sequences WHERE lease_id = ? AND status = 'active'
    `).get(leaseId);

    if (existing) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    // Persist sequence state
    this.db.db.prepare(`
      INSERT INTO dunning_sequences (
        id, lease_id, current_step, last_step_at, status, created_at, updated_at
      ) VALUES (?, ?, 1, ?, 'active', ?, ?)
    `).run(id, leaseId, now, now, now);

    // Execute Day 1 Action
    await this.processStep(leaseId, 1, amountDue);
  }

  /**
   * Abort an active sequence if the user pays their rent
   */
  async abortDunningSequence(leaseId) {
    const now = new Date().toISOString();
    this.db.db.prepare(`
      UPDATE dunning_sequences 
      SET status = 'aborted', updated_at = ? 
      WHERE lease_id = ? AND status = 'active'
    `).run(now, leaseId);
    
    console.log(`[Dunning Sequencer] Sequence aborted for Lease ${leaseId} due to successful payment.`);
  }

  /**
   * Process a specific step in the Dunning schedule
   */
  async processStep(leaseId, step, amountDue = null) {
    const lease = this.db.getLeaseById(leaseId);
    if (!lease) return;

    // Fetch amountDue if not provided (for Day 3/5 ticks)
    if (amountDue === null) {
      const payment = this.db.db.prepare(`
        SELECT amount_due FROM rent_payments WHERE lease_id = ? AND status = 'pending' ORDER BY due_date ASC LIMIT 1
      `).get(leaseId);
      amountDue = payment?.amount_due || lease.rent_amount;
    }

    const now = new Date().toISOString();

    switch (step) {
      case 1:
        // Day 1: "Rent Payment Failed. You have 5 days to top up..."
        await this.notifications.sendNotification({
          recipientId: lease.tenantId,
          recipientRole: 'tenant',
          type: 'DUNNING_STEP_1',
          leaseId,
          message: `Rent Payment Failed. You have 5 days to top up your wallet before late fees are applied. Required amount: ${amountDue} ${lease.currency}.`
        });
        break;

      case 3:
        // Day 3: "Urgent: Late fees active..."
        await this.notifications.sendNotification({
          recipientId: lease.tenantId,
          recipientRole: 'tenant',
          type: 'DUNNING_STEP_3',
          leaseId,
          message: `Urgent: Your rent is now 3 days overdue. Late fees are active. Please fund your wallet to avoid lease termination and asset lockout.`
        });
        break;

      case 5:
        // Day 5: Trigger IoT Revocation and Final Notice
        console.log(`[Dunning Sequencer] Day 5 reached for Lease ${leaseId}. Triggering physical lockout.`);
        
        // 1. Trigger IoT Webhook Dispatcher to revoke access
        await this.iot.enqueueDispatch('LesseeAccessRevoked', { 
          leaseId, 
          state: 'Terminated',
          reason: 'Rent delinquency exceeding 5 days' 
        });

        // 2. Send final eviction notice
        await this.notifications.sendNotification({
          recipientId: lease.tenantId,
          recipientRole: 'tenant',
          type: 'DUNNING_STEP_5',
          leaseId,
          message: `Lease Terminated. Physical access to the property has been revoked. Please contact your lessor immediately.`
        });

        // 3. Update sequence to completed
        this.db.db.prepare(`
          UPDATE dunning_sequences SET status = 'completed', current_step = 5, updated_at = ? WHERE lease_id = ?
        `).run(now, leaseId);
        return;
    }

    // Update sequence progress
    this.db.db.prepare(`
      UPDATE dunning_sequences 
      SET current_step = ?, last_step_at = ?, updated_at = ? 
      WHERE lease_id = ? AND status = 'active'
    `).run(step, now, now, leaseId);
  }

  /**
   * Tick function to be called by a daily cron job
   * Iterates through active sequences and progresses them based on time elapsed
   */
  async runDailyTick() {
    console.log('[Dunning Sequencer] Running daily progression tick...');
    
    const activeSequences = this.db.db.prepare(`
      SELECT * FROM dunning_sequences WHERE status = 'active'
    `).all();

    const now = Date.now();

    for (const seq of activeSequences) {
      const lastStepTime = new Date(seq.last_step_at).getTime();
      const hoursSinceLastStep = (now - lastStepTime) / (1000 * 60 * 60);

      if (seq.current_step === 1 && hoursSinceLastStep >= 48) {
        // Day 1 to Day 3
        await this.processStep(seq.lease_id, 3);
      } else if (seq.current_step === 3 && hoursSinceLastStep >= 48) {
        // Day 3 to Day 5
        await this.processStep(seq.lease_id, 5);
      }
    }
  }
}

module.exports = { RentDunningSequencer };
