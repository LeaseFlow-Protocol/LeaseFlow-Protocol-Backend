const { Queue, Worker } = require('bullmq');
const { Worker: RedisWorker } = require('ioredis');
const LeasePdfService = require('../services/leasePdfService');
const IpfsService = require('../services/ipfsService');
const { AppDatabase } = require('../db/appDatabase');
const { loadConfig } = require('../config');

/**
 * BullMQ job for asynchronous PDF generation and IPFS upload
 */
class LeasePdfGenerationJob {
  constructor(database, config) {
    this.database = database;
    this.config = config;
    this.pdfService = new LeasePdfService();
    this.ipfsService = new IpfsService(config);
    
    // Redis connection for BullMQ
    this.redisConnection = new RedisWorker(config.redis);
    
    // Queue for PDF generation jobs
    this.queue = new Queue('lease-pdf-generation', {
      connection: this.redisConnection,
      defaultJobOptions: {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50,      // Keep last 50 failed jobs
        attempts: 3,           // Retry up to 3 times
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    });
    
    // Worker for processing jobs
    this.worker = new Worker(
      'lease-pdf-generation',
      this.processJob.bind(this),
      {
        connection: this.redisConnection,
        concurrency: 2 // Process 2 jobs concurrently
      }
    );
    
    this.setupEventListeners();
  }

  /**
   * Set up event listeners for the worker
   */
  setupEventListeners() {
    this.worker.on('completed', (job, result) => {
      console.log(`[LeasePdfGenerationJob] Job ${job.id} completed successfully. CID: ${result.ipfsCid}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[LeasePdfGenerationJob] Job ${job.id} failed:`, err);
      
      // Update lease record with error status if we have leaseId
      if (job.data.leaseId) {
        try {
          this.database.updateLeasePdfStatus(job.data.leaseId, 'failed', err.message);
        } catch (updateError) {
          console.error('[LeasePdfGenerationJob] Failed to update lease status:', updateError);
        }
      }
    });

    this.worker.on('error', (err) => {
      console.error('[LeasePdfGenerationJob] Worker error:', err);
    });
  }

  /**
   * Add a new PDF generation job to the queue
   * @param {string} leaseId - Lease ID
   * @param {object} options - Job options
   * @returns {Promise<object>} Job object
   */
  async addPdfGenerationJob(leaseId, options = {}) {
    try {
      console.log(`[LeasePdfGenerationJob] Adding PDF generation job for lease: ${leaseId}`);
      
      const job = await this.queue.add(
        'generate-lease-pdf',
        {
          leaseId,
          timestamp: new Date().toISOString(),
          ...options
        },
        {
          priority: options.priority || 'normal',
          delay: options.delay || 0,
          removeOnComplete: options.removeOnComplete || 100,
          removeOnFail: options.removeOnFail || 50
        }
      );

      console.log(`[LeasePdfGenerationJob] Job ${job.id} added to queue`);
      return job;
    } catch (error) {
      console.error('[LeasePdfGenerationJob] Error adding job to queue:', error);
      throw new Error(`Failed to add PDF generation job: ${error.message}`);
    }
  }

  /**
   * Process a PDF generation job
   * @param {object} job - BullMQ job object
   * @returns {Promise<object>} Result with IPFS CID and metadata
   */
  async processJob(job) {
    const { leaseId } = job.data;
    
    try {
      console.log(`[LeasePdfGenerationJob] Processing job ${job.id} for lease: ${leaseId}`);
      
      // Update job progress
      await job.updateProgress(10);
      
      // 1. Fetch lease data from database
      const leaseData = await this.fetchLeaseData(leaseId);
      if (!leaseData) {
        throw new Error(`Lease not found: ${leaseId}`);
      }
      
      await job.updateProgress(20);
      
      // 2. Fetch related data (lessor, lessee, asset)
      const [lessorData, lesseeData, assetData] = await Promise.all([
        this.fetchLessorData(leaseData.landlord_id),
        this.fetchLesseeData(leaseData.tenant_id),
        this.fetchAssetData(leaseId)
      ]);
      
      await job.updateProgress(30);
      
      // 3. Get transaction hash from lease data or recent payment
      const transactionHash = leaseData.transaction_hash || await this.getTransactionHash(leaseId);
      
      await job.updateProgress(40);
      
      // 4. Generate PDF
      console.log(`[LeasePdfGenerationJob] Generating PDF for lease: ${leaseId}`);
      const pdfBuffer = await this.pdfService.generateLeaseAgreement(
        leaseData,
        lessorData,
        lesseeData,
        assetData,
        transactionHash
      );
      
      await job.updateProgress(70);
      
      // 5. Upload to IPFS
      console.log(`[LeasePdfGenerationJob] Uploading PDF to IPFS for lease: ${leaseId}`);
      const ipfsCid = await this.ipfsService.uploadPdf(pdfBuffer, leaseId);
      
      await job.updateProgress(90);
      
      // 6. Update lease record with IPFS CID
      await this.updateLeaseWithPdfCid(leaseId, ipfsCid, transactionHash);
      
      await job.updateProgress(100);
      
      const result = {
        leaseId,
        ipfsCid,
        transactionHash,
        gatewayUrl: this.ipfsService.getGatewayUrl(ipfsCid),
        generatedAt: new Date().toISOString(),
        pdfSize: pdfBuffer.length
      };
      
      console.log(`[LeasePdfGenerationJob] Job ${job.id} completed. CID: ${ipfsCid}`);
      return result;
      
    } catch (error) {
      console.error(`[LeasePdfGenerationJob] Job ${job.id} failed:`, error);
      throw error;
    }
  }

  /**
   * Fetch lease data from database
   * @param {string} leaseId - Lease ID
   * @returns {Promise<object>} Lease data
   */
  async fetchLeaseData(leaseId) {
    try {
      const lease = this.database.getLeaseById(leaseId);
      if (!lease) {
        throw new Error(`Lease not found: ${leaseId}`);
      }
      
      // Add any additional lease metadata needed
      return {
        ...lease,
        security_deposit: lease.security_deposit || 0, // Add if not in base schema
        transaction_hash: lease.transaction_hash || null
      };
    } catch (error) {
      console.error('[LeasePdfGenerationJob] Error fetching lease data:', error);
      throw error;
    }
  }

  /**
   * Fetch lessor (landlord) data
   * @param {string} landlordId - Landlord ID
   * @returns {Promise<object>} Lessor data
   */
  async fetchLessorData(landlordId) {
    try {
      // Try to get from database first
      const landlord = this.database.getLandlordById(landlordId);
      if (landlord) {
        return landlord;
      }
      
      // Fallback to basic data if not found
      return {
        id: landlordId,
        name: `Landlord ${landlordId}`,
        address: 'N/A',
        email: 'N/A',
        phone: 'N/A'
      };
    } catch (error) {
      console.error('[LeasePdfGenerationJob] Error fetching lessor data:', error);
      // Return minimal data to prevent PDF generation failure
      return {
        id: landlordId,
        name: `Landlord ${landlordId}`,
        address: 'N/A'
      };
    }
  }

  /**
   * Fetch lessee (tenant) data
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<object>} Lessee data
   */
  async fetchLesseeData(tenantId) {
    try {
      // Try to get from database first
      const tenant = this.database.getTenantById(tenantId);
      if (tenant) {
        return tenant;
      }
      
      // Fallback to basic data if not found
      return {
        id: tenantId,
        name: `Tenant ${tenantId}`,
        address: 'N/A',
        email: 'N/A',
        phone: 'N/A'
      };
    } catch (error) {
      console.error('[LeasePdfGenerationJob] Error fetching lessee data:', error);
      // Return minimal data to prevent PDF generation failure
      return {
        id: tenantId,
        name: `Tenant ${tenantId}`,
        address: 'N/A'
      };
    }
  }

  /**
   * Fetch asset/property data
   * @param {string} leaseId - Lease ID
   * @returns {Promise<object>} Asset data
   */
  async fetchAssetData(leaseId) {
    try {
      // Try to get from database
      const asset = this.database.getAssetByLeaseId(leaseId);
      if (asset) {
        return asset;
      }
      
      // Fallback to lease property data
      const lease = this.database.getLeaseById(leaseId);
      return {
        leaseId,
        property_type: lease.property_type || 'Residential',
        address: 'N/A',
        bedrooms: lease.bedrooms,
        bathrooms: lease.bathrooms,
        square_footage: lease.square_footage
      };
    } catch (error) {
      console.error('[LeasePdfGenerationJob] Error fetching asset data:', error);
      // Return minimal data to prevent PDF generation failure
      return {
        leaseId,
        property_type: 'Residential',
        address: 'N/A'
      };
    }
  }

  /**
   * Get transaction hash for the lease
   * @param {string} leaseId - Lease ID
   * @returns {Promise<string>} Transaction hash
   */
  async getTransactionHash(leaseId) {
    try {
      // Try to get from lease record first
      const lease = this.database.getLeaseById(leaseId);
      if (lease.transaction_hash) {
        return lease.transaction_hash;
      }
      
      // Try to get from payment history
      const payments = this.database.getPaymentsByLeaseId(leaseId);
      if (payments && payments.length > 0) {
        return payments[0].transaction_hash;
      }
      
      // Generate a placeholder if no transaction hash found
      return `pending-lease-${leaseId}-${Date.now()}`;
    } catch (error) {
      console.error('[LeasePdfGenerationJob] Error getting transaction hash:', error);
      return `unknown-lease-${leaseId}`;
    }
  }

  /**
   * Update lease record with PDF IPFS CID
   * @param {string} leaseId - Lease ID
   * @param {string} ipfsCid - IPFS CID
   * @param {string} transactionHash - Transaction hash
   */
  async updateLeaseWithPdfCid(leaseId, ipfsCid, transactionHash) {
    try {
      // Add a new table or update existing lease record
      // For now, we'll use a simple approach - in production, you might want a dedicated table
      
      const now = new Date().toISOString();
      
      // Try to update lease record (assuming there's a pdf_cid column)
      // If not exists, this will fail gracefully
      try {
        this.database.db.prepare(`
          UPDATE leases 
          SET pdf_cid = ?, 
              transaction_hash = COALESCE(?, transaction_hash),
              pdf_generated_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(ipfsCid, transactionHash, now, now, leaseId);
      } catch (updateError) {
        console.warn('[LeasePdfGenerationJob] Could not update lease with PDF CID (column may not exist):', updateError.message);
        
        // Store in a separate table for PDF records
        this.createPdfRecordTable();
        this.database.db.prepare(`
          INSERT OR REPLACE INTO lease_pdf_records 
          (lease_id, ipfs_cid, transaction_hash, generated_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(leaseId, ipfsCid, transactionHash, now, now);
      }
      
      console.log(`[LeasePdfGenerationJob] Updated lease ${leaseId} with PDF CID: ${ipfsCid}`);
    } catch (error) {
      console.error('[LeasePdfGenerationJob] Error updating lease with PDF CID:', error);
      // Don't throw error - PDF generation was successful, just logging issue
    }
  }

  /**
   * Create table for PDF records if it doesn't exist
   */
  createPdfRecordTable() {
    try {
      this.database.db.exec(`
        CREATE TABLE IF NOT EXISTS lease_pdf_records (
          lease_id TEXT PRIMARY KEY,
          ipfs_cid TEXT NOT NULL,
          transaction_hash TEXT,
          generated_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          status TEXT DEFAULT 'completed',
          error_message TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_lease_pdf_records_cid 
        ON lease_pdf_records(ipfs_cid);
      `);
    } catch (error) {
      console.error('[LeasePdfGenerationJob] Error creating PDF records table:', error);
    }
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Promise<object>} Job status
   */
  async getJobStatus(jobId) {
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) {
        return { status: 'not_found' };
      }
      
      const state = await job.getState();
      const progress = job.progress;
      
      return {
        id: job.id,
        status: state,
        progress,
        data: job.data,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason
      };
    } catch (error) {
      console.error('[LeasePdfGenerationJob] Error getting job status:', error);
      throw error;
    }
  }

  /**
   * Get queue statistics
   * @returns {Promise<object>} Queue stats
   */
  async getQueueStats() {
    try {
      const [waiting, active, completed, failed] = await Promise.all([
        this.queue.getWaiting(),
        this.queue.getActive(),
        this.queue.getCompleted(),
        this.queue.getFailed()
      ]);
      
      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        total: waiting.length + active.length + completed.length + failed.length
      };
    } catch (error) {
      console.error('[LeasePdfGenerationJob] Error getting queue stats:', error);
      throw error;
    }
  }

  /**
   * Start the worker
   */
  start() {
    console.log('[LeasePdfGenerationJob] PDF generation worker started');
  }

  /**
   * Stop the worker
   */
  async stop() {
    console.log('[LeasePdfGenerationJob] Stopping PDF generation worker...');
    
    await this.worker.close();
    await this.queue.close();
    await this.redisConnection.quit();
    
    console.log('[LeasePdfGenerationJob] Worker stopped');
  }
}

module.exports = LeasePdfGenerationJob;
