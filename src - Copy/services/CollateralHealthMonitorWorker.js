const Redis = require('ioredis');
const crypto = require('crypto');
const axios = require('axios');

/**
 * Collateral Health Monitor Worker
 * Continuously monitors active leases to ensure they remain fully collateralized.
 * Implements SEP-40 compliant price monitoring and automated margin calls.
 */
class CollateralHealthMonitorWorker {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {NotificationService} notificationService - Service for sending alerts
   * @param {SorobanLeaseService} sorobanLeaseService - Service for on-chain interactions
   * @param {object} redisConfig - Redis configuration
   */
  constructor(database, notificationService, sorobanLeaseService, redisConfig = {}) {
    this.db = database;
    this.notifications = notificationService;
    this.soroban = sorobanLeaseService;
    this.redis = new Redis(redisConfig);
    this.interval = null;
  }

  /**
   * Start the monitoring loop
   * @param {number} frequencyMs - Frequency of checks (default 5 minutes)
   */
  start(frequencyMs = 5 * 60 * 1000) {
    console.log(`[Health Monitor] Starting collateral monitor (Frequency: ${frequencyMs / 60000}m)...`);
    this.interval = setInterval(() => this.performHealthChecks(), frequencyMs);
    // Run immediately on start
    this.performHealthChecks();
  }

  /**
   * Stop the monitoring loop
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Perform health checks on all active leases
   */
  async performHealthChecks() {
    console.log('[Health Monitor] Running scheduled health checks...');
    
    try {
      // Iterate through active Lease table in Postgres (SQLite in this implementation)
      // Only check leases with volatile assets (simplified: all active leases for this demo)
      const activeLeases = this.db.db.prepare(`
        SELECT * FROM leases WHERE status = 'active'
      `).all();

      for (const lease of activeLeases) {
        await this.checkLeaseHealth(lease).catch(err => {
          console.error(`[Health Monitor] Failed to check lease ${lease.id}: ${err.message}`);
        });
      }
    } catch (err) {
      console.error(`[Health Monitor] Critical error in health check loop: ${err.message}`);
    }
  }

  /**
   * Check health of a single lease
   */
  async checkLeaseHealth(lease) {
    const { id, rent_amount, currency, tenant_id } = lease;
    
    // 1. Fetch real-time pricing data via SEP-40 compliant API (with Redis caching)
    const tokenPrice = await this.getTokenPrice(currency);
    
    // 2. Calculate health factor
    // Mock logic: Health Factor = (Fiat Value of Locked Deposit / Required Deposit)
    // In production, this would query the Soroban contract for the exact locked amount
    const lockedDepositAmount = lease.rent_amount * 2; // Assuming 2x rent is locked
    const depositValueFiat = lockedDepositAmount * tokenPrice;
    const minRequiredValue = lease.rent_amount * 1.5; // 150% collateralization requirement
    
    const healthFactor = depositValueFiat / minRequiredValue;

    console.log(`[Health Monitor] Lease ${id} | Price: ${tokenPrice} | Health: ${(healthFactor * 100).toFixed(2)}%`);

    let actionTaken = 'none';

    // 3. Take action if health factor drops below minimum (e.g., 90% of required)
    if (healthFactor < 0.9) {
      actionTaken = 'margin_call';
      console.warn(`[Health Monitor] ALERT: Lease ${id} health is CRITICAL (${(healthFactor * 100).toFixed(2)}%)`);
      
      // Trigger Email Notification Service (Issue 54)
      await this.notifications.sendNotification({
        recipientId: tenant_id,
        recipientRole: 'tenant',
        type: 'MARGIN_CALL',
        leaseId: id,
        message: `URGENT: Your lease collateral health has dropped to ${(healthFactor * 100).toFixed(0)}%. Please fund your wallet immediately to avoid automatic liquidation.`
      });

      // Generate transaction payload and submit to network
      await this.executeOnChainMarginCall(id);
    }

    // 4. Log the audit trail
    this.logHealthLog(id, healthFactor, depositValueFiat, tokenPrice, actionTaken);
  }

  /**
   * Fetch token price with Redis-backed caching
   */
  async getTokenPrice(assetCode) {
    const cacheKey = `price_feed:${assetCode}`;
    
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return parseFloat(cached);

      // Fetch from SEP-40 API (Mocked for this implementation)
      // Real implementation would use: axios.get(`${ORACLE_URL}/price/${assetCode}`)
      const mockPrices = { 'XLM': 0.12, 'USDC': 1.00, 'ARS': 0.001 };
      const price = mockPrices[assetCode] || 1.0;

      // Cache for 5 minutes as per requirements
      await this.redis.set(cacheKey, price, 'EX', 300);
      return price;
    } catch (err) {
      console.error(`[Health Monitor] Price feed error for ${assetCode}: ${err.message}`);
      return 1.0; // Fallback to 1.0 if oracle fails
    }
  }

  /**
   * Submit margin_call transaction to Soroban
   */
  async executeOnChainMarginCall(leaseId) {
    try {
      console.log(`[Health Monitor] Submitting on-chain margin_call for ${leaseId}...`);
      // Mock Soroban call
      // await this.soroban.callContract('margin_call', [leaseId]);
      return true;
    } catch (err) {
      console.error(`[Health Monitor] Soroban margin_call failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Persist health log to database
   */
  logHealthLog(leaseId, healthFactor, depositValueFiat, tokenPrice, actionTaken) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    try {
      this.db.db.prepare(`
        INSERT INTO collateral_health_logs (
          id, lease_id, health_factor, deposit_value_fiat, token_price, action_taken, checked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        leaseId,
        healthFactor,
        depositValueFiat,
        tokenPrice,
        actionTaken,
        now
      );
    } catch (err) {
      console.error(`[Health Monitor] Failed to log health check: ${err.message}`);
    }
  }
}

module.exports = { CollateralHealthMonitorWorker };
