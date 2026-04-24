const axios = require('axios');
const cron = require('node-cron');
const { AppDatabase } = require('../src/db/appDatabase');
const { NotificationService } = require('../src/services/notificationService');

/**
 * Sanctions List Screening Worker
 * 
 * Periodically checks landlord and tenant Stellar addresses against OFAC and other sanctions lists.
 * If a match is found, the backend freezes the lease and pauses all rent flows to the affected party.
 */
class SanctionsListScreeningWorker {
  constructor(config = {}) {
    this.config = {
      ofacApiUrl: config.ofacApiUrl || 'https://api.treasury.gov/ofac/v1/sdn',
      euSanctionsApiUrl: config.euSanctionsApiUrl || 'https://webgate.ec.europa.eu/fsd/fsf/public/files/',
      ukSanctionsApiUrl: config.ukSanctionsApiUrl || 'https://www.gov.uk/government/publications/the-uk-sanctions-list',
      screeningIntervalCron: config.screeningIntervalCron || '0 */6 * * *', // Every 6 hours
      cacheTtlMinutes: config.cacheTtlMinutes || 360, // 6 hours cache
      ...config
    };
    
    this.database = new AppDatabase(process.env.DATABASE_PATH || './database.sqlite');
    this.notificationService = new NotificationService(this.database);
    this.sanctionsCache = new Map();
    this.isRunning = false;
    this.cronJob = null;
  }

  /**
   * Initialize the worker
   */
  async initialize() {
    console.log('[SanctionsWorker] Initializing sanctions screening worker...');
    
    try {
      // Test database connection
      await this.database.initialize();
      
      // Load initial sanctions data
      await this.refreshSanctionsLists();
      
      // Schedule periodic screening
      this.scheduleScreening();
      
      console.log('[SanctionsWorker] Sanctions screening worker initialized successfully');
    } catch (error) {
      console.error('[SanctionsWorker] Failed to initialize:', error.message);
      throw error;
    }
  }

  /**
   * Start the worker
   */
  start() {
    if (this.isRunning) {
      console.warn('[SanctionsWorker] Worker is already running');
      return;
    }

    this.isRunning = true;
    console.log('[SanctionsWorker] Starting sanctions screening worker...');
    
    // Run initial screening
    this.performScreening().catch(error => {
      console.error('[SanctionsWorker] Initial screening failed:', error.message);
    });
  }

  /**
   * Stop the worker
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    
    console.log('[SanctionsWorker] Sanctions screening worker stopped');
  }

  /**
   * Schedule periodic screening
   */
  scheduleScreening() {
    if (this.cronJob) {
      this.cronJob.stop();
    }

    this.cronJob = cron.schedule(this.config.screeningIntervalCron, async () => {
      if (!this.isRunning) return;
      
      try {
        console.log('[SanctionsWorker] Starting scheduled screening...');
        await this.performScreening();
        console.log('[SanctionsWorker] Scheduled screening completed');
      } catch (error) {
        console.error('[SanctionsWorker] Scheduled screening failed:', error.message);
      }
    });

    console.log(`[SanctionsWorker] Screening scheduled with cron: ${this.config.screeningIntervalCron}`);
  }

  /**
   * Refresh sanctions lists from various sources
   */
  async refreshSanctionsLists() {
    console.log('[SanctionsWorker] Refreshing sanctions lists...');
    
    try {
      // Clear cache
      this.sanctionsCache.clear();
      
      // Fetch from different sources
      await Promise.all([
        this.fetchOFACList(),
        this.fetchEUSanctionsList(),
        this.fetchUKSanctionsList()
      ]);
      
      console.log(`[SanctionsWorker] Refreshed sanctions lists with ${this.sanctionsCache.size} entries`);
    } catch (error) {
      console.error('[SanctionsWorker] Failed to refresh sanctions lists:', error.message);
      throw error;
    }
  }

  /**
   * Fetch OFAC (Office of Foreign Assets Control) sanctions list
   */
  async fetchOFACList() {
    try {
      // Note: In production, you would use the official OFAC API
      // For demo purposes, we'll use a mock implementation
      const response = await axios.get(this.config.ofacApiUrl, {
        timeout: 30000,
        headers: {
          'User-Agent': 'LeaseFlow-Protocol/1.0'
        }
      });

      const sanctions = response.data.sanctions || [];
      sanctions.forEach(entry => {
        const addresses = entry.digital_currency_addresses || [];
        addresses.forEach(address => {
          if (address.currency === 'XLM' || address.currency === 'STELLAR') {
            this.sanctionsCache.set(address.address.toUpperCase(), {
              source: 'OFAC',
              name: entry.name,
              type: entry.type,
              programs: entry.programs,
              addedAt: new Date().toISOString()
            });
          }
        });
      });

      console.log(`[SanctionsWorker] Loaded ${sanctions.length} entries from OFAC`);
    } catch (error) {
      console.warn('[SanctionsWorker] OFAC API failed, using fallback data:', error.message);
      // Fallback to known sanctioned addresses for demo
      this.loadFallbackOFACData();
    }
  }

  /**
   * Fetch EU sanctions list
   */
  async fetchEUSanctionsList() {
    try {
      const response = await axios.get(this.config.euSanctionsApiUrl, {
        timeout: 30000
      });

      // Parse EU sanctions format (simplified for demo)
      const sanctions = response.data.sanctions || [];
      sanctions.forEach(entry => {
        const addresses = entry.cryptoAddresses || [];
        addresses.forEach(address => {
          if (address.asset === 'XLM') {
            this.sanctionsCache.set(address.address.toUpperCase(), {
              source: 'EU',
              name: entry.name,
              type: entry.type,
              regulation: entry.regulation,
              addedAt: new Date().toISOString()
            });
          }
        });
      });

      console.log(`[SanctionsWorker] Loaded ${sanctions.length} entries from EU sanctions`);
    } catch (error) {
      console.warn('[SanctionsWorker] EU sanctions API failed:', error.message);
    }
  }

  /**
   * Fetch UK sanctions list
   */
  async fetchUKSanctionsList() {
    try {
      const response = await axios.get(this.config.ukSanctionsApiUrl, {
        timeout: 30000
      });

      // Parse UK sanctions format (simplified for demo)
      const sanctions = response.data.sanctions || [];
      sanctions.forEach(entry => {
        const addresses = entry.cryptoAddresses || [];
        addresses.forEach(address => {
          if (address.currency === 'XLM') {
            this.sanctionsCache.set(address.address.toUpperCase(), {
              source: 'UK',
              name: entry.name,
              type: entry.type,
              addedAt: new Date().toISOString()
            });
          }
        });
      });

      console.log(`[SanctionsWorker] Loaded ${sanctions.length} entries from UK sanctions`);
    } catch (error) {
      console.warn('[SanctionsWorker] UK sanctions API failed:', error.message);
    }
  }

  /**
   * Load fallback OFAC data for demo purposes
   */
  loadFallbackOFACData() {
    // These are example addresses for demonstration
    const fallbackAddresses = [
      'GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5',
      'GA2TK6NPEJUH7X5L3M9Q8R7S6T5U4V3W2X1Y0Z9A8B7C6D5E4F3G2H1I0J9'
    ];

    fallbackAddresses.forEach(address => {
      this.sanctionsCache.set(address, {
        source: 'OFAC_FALLBACK',
        name: 'Sanctioned Entity',
        type: 'Entity',
        programs: ['SDN', 'FTS'],
        addedAt: new Date().toISOString()
      });
    });

    console.log('[SanctionsWorker] Loaded fallback sanctions data');
  }

  /**
   * Perform screening of all active leases
   */
  async performScreening() {
    console.log('[SanctionsWorker] Performing sanctions screening...');
    
    try {
      // Get all active leases
      const activeLeases = await this.database.getActiveLeases();
      console.log(`[SanctionsWorker] Screening ${activeLeases.length} active leases`);

      const violations = [];

      for (const lease of activeLeases) {
        const leaseViolations = await this.screenLease(lease);
        if (leaseViolations.length > 0) {
          violations.push({
            leaseId: lease.id,
            violations: leaseViolations
          });
        }
      }

      // Process violations
      if (violations.length > 0) {
        await this.handleViolations(violations);
      }

      console.log(`[SanctionsWorker] Screening completed. Found ${violations.length} leases with violations`);
    } catch (error) {
      console.error('[SanctionsWorker] Screening failed:', error.message);
      throw error;
    }
  }

  /**
   * Screen a single lease for sanctions violations
   */
  async screenLease(lease) {
    const violations = [];

    // Screen landlord address
    if (lease.landlordStellarAddress) {
      const landlordViolation = this.checkAddress(lease.landlordStellarAddress);
      if (landlordViolation) {
        violations.push({
          type: 'landlord',
          address: lease.landlordStellarAddress,
          ...landlordViolation
        });
      }
    }

    // Screen tenant address
    if (lease.tenantStellarAddress) {
      const tenantViolation = this.checkAddress(lease.tenantStellarAddress);
      if (tenantViolation) {
        violations.push({
          type: 'tenant',
          address: lease.tenantStellarAddress,
          ...tenantViolation
        });
      }
    }

    return violations;
  }

  /**
   * Check if a Stellar address is on any sanctions list
   */
  checkAddress(address) {
    const normalizedAddress = address.toUpperCase().trim();
    return this.sanctionsCache.get(normalizedAddress);
  }

  /**
   * Handle sanctions violations
   */
  async handleViolations(violations) {
    console.log(`[SanctionsWorker] Handling ${violations.length} sanctions violations`);

    for (const violation of violations) {
      try {
        // Freeze the lease
        await this.freezeLease(violation.leaseId, violation.violations);

        // Send notifications
        await this.sendViolationNotifications(violation);

        // Log the violation
        await this.logViolation(violation);

        console.log(`[SanctionsWorker] Processed violation for lease ${violation.leaseId}`);
      } catch (error) {
        console.error(`[SanctionsWorker] Failed to process violation for lease ${violation.leaseId}:`, error.message);
      }
    }
  }

  /**
   * Freeze a lease due to sanctions violation
   */
  async freezeLease(leaseId, violations) {
    console.log(`[SanctionsWorker] Freezing lease ${leaseId} due to sanctions violations`);

    // Update lease status to frozen
    await this.database.updateLeaseStatus(leaseId, 'FROZEN', {
      reason: 'SANCTIONS_VIOLATION',
      violations: violations,
      frozenAt: new Date().toISOString()
    });

    // Pause all rent payment flows for this lease
    await this.pauseRentFlows(leaseId);

    console.log(`[SanctionsWorker] Lease ${leaseId} frozen successfully`);
  }

  /**
   * Pause rent payment flows for a lease
   */
  async pauseRentFlows(leaseId) {
    try {
      // Update payment schedules to paused
      await this.database.pausePaymentSchedules(leaseId, {
        reason: 'SANCTIONS_COMPLIANCE',
        pausedAt: new Date().toISOString()
      });

      console.log(`[SanctionsWorker] Rent flows paused for lease ${leaseId}`);
    } catch (error) {
      console.error(`[SanctionsWorker] Failed to pause rent flows for lease ${leaseId}:`, error.message);
      throw error;
    }
  }

  /**
   * Send notifications about sanctions violations
   */
  async sendViolationNotifications(violation) {
    const notifications = [];

    // Notify compliance team
    notifications.push({
      type: 'SANCTIONS_VIOLATION',
      recipient: 'COMPLIANCE_TEAM',
      leaseId: violation.leaseId,
      message: `Sanctions violation detected for lease ${violation.leaseId}`,
      details: violation.violations,
      priority: 'HIGH',
      createdAt: new Date().toISOString()
    });

    // Send notifications
    for (const notification of notifications) {
      try {
        await this.notificationService.sendNotification(notification);
      } catch (error) {
        console.error('[SanctionsWorker] Failed to send notification:', error.message);
      }
    }
  }

  /**
   * Log sanctions violations for audit purposes
   */
  async logViolation(violation) {
    try {
      await this.database.logSanctionsViolation({
        leaseId: violation.leaseId,
        violations: violation.violations,
        detectedAt: new Date().toISOString(),
        workerVersion: '1.0.0'
      });

      console.log(`[SanctionsWorker] Violation logged for lease ${violation.leaseId}`);
    } catch (error) {
      console.error('[SanctionsWorker] Failed to log violation:', error.message);
    }
  }

  /**
   * Get current sanctions statistics
   */
  getStatistics() {
    return {
      cacheSize: this.sanctionsCache.size,
      isRunning: this.isRunning,
      lastRefresh: this.lastRefresh,
      nextScreening: this.cronJob ? this.cronJob.nextDate().toISOString() : null,
      sources: ['OFAC', 'EU', 'UK']
    };
  }

  /**
   * Manual screening of a specific address
   */
  async screenAddress(address) {
    const violation = this.checkAddress(address);
    
    return {
      address,
      isSanctioned: !!violation,
      violation: violation || null,
      screenedAt: new Date().toISOString()
    };
  }
}

module.exports = SanctionsListScreeningWorker;
