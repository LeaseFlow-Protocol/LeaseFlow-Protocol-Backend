const { Queue, Worker } = require('bullmq');
const { Worker: RedisWorker } = require('ioredis');
const StellarEventListener = require('../services/rwa/stellarEventListener');
const RwaAdapterRegistry = require('../services/rwa/rwaAdapterRegistry');
const { loadConfig } = require('../config');

/**
 * RWA Cache Synchronization Job
 * Handles synchronization of RWA asset ownership cache with blockchain data
 */
class RwaCacheSyncJob {
  constructor(database, config) {
    this.database = database;
    this.config = config;
    
    // Initialize services
    this.adapterRegistry = new RwaAdapterRegistry(config);
    this.eventListener = new StellarEventListener(config, database, this.adapterRegistry);
    
    // Redis connection for BullMQ
    this.redisConnection = new RedisWorker(config.redis);
    
    // Queue for cache sync jobs
    this.queue = new Queue('rwa-cache-sync', {
      connection: this.redisConnection,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 25,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    });
    
    // Worker for processing jobs
    this.worker = new Worker(
      'rwa-cache-sync',
      this.processJob.bind(this),
      {
        connection: this.redisConnection,
        concurrency: 2
      }
    );
    
    this.setupEventListeners();
    this.setupEventListener();
  }

  /**
   * Set up event listeners for the worker
   * @returns {void}
   */
  setupEventListeners() {
    this.worker.on('completed', (job, result) => {
      console.log(`[RwaCacheSyncJob] Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[RwaCacheSyncJob] Job ${job.id} failed:`, err);
      this.updateSyncStatus('error', err.message);
    });

    this.worker.on('error', (err) => {
      console.error('[RwaCacheSyncJob] Worker error:', err);
    });
  }

  /**
   * Set up event listener for blockchain events
   * @returns {void}
   */
  setupEventListener() {
    this.eventListener.on('rwaEvent', (event) => {
      console.log(`[RwaCacheSyncJob] Received RWA event: ${event.eventType} for asset ${event.assetId}`);
      // Events are already processed by the event listener
    });

    this.eventListener.on('assetFrozen', (event) => {
      console.log(`[RwaCacheSyncJob] Asset frozen: ${event.assetId}`);
      this.handleAssetFrozen(event);
    });

    this.eventListener.on('assetBurned', (event) => {
      console.log(`[RwaCacheSyncJob] Asset burned: ${event.assetId}`);
      this.handleAssetBurned(event);
    });

    this.eventListener.on('error', (error) => {
      console.error('[RwaCacheSyncJob] Event listener error:', error);
    });
  }

  /**
   * Add a cache sync job to the queue
   * @param {object} options - Job options
   * @returns {Promise<object>} Job object
   */
  async addCacheSyncJob(options = {}) {
    try {
      const job = await this.queue.add(
        'sync-rwa-cache',
        {
          timestamp: new Date().toISOString(),
          ...options
        },
        {
          priority: options.priority || 'normal',
          delay: options.delay || 0
        }
      );

      console.log(`[RwaCacheSyncJob] Added cache sync job: ${job.id}`);
      return job;
    } catch (error) {
      console.error('[RwaCacheSyncJob] Error adding cache sync job:', error);
      throw new Error(`Failed to add cache sync job: ${error.message}`);
    }
  }

  /**
   * Process a cache sync job
   * @param {object} job - BullMQ job object
   * @returns {Promise<object>} Job result
   */
  async processJob(job) {
    const startTime = Date.now();
    
    try {
      console.log(`[RwaCacheSyncJob] Processing job ${job.id}`);
      await job.updateProgress(10);

      // Get all active RWA contracts
      const contracts = this.getActiveRwaContracts();
      await job.updateProgress(20);

      let totalAssetsSynced = 0;
      let totalErrors = 0;
      const results = [];

      // Sync each contract
      for (const contract of contracts) {
        try {
          const contractResult = await this.syncContract(contract, job);
          results.push(contractResult);
          totalAssetsSynced += contractResult.assetsSynced;
          totalErrors += contractResult.errors;
        } catch (error) {
          console.error(`[RwaCacheSyncJob] Error syncing contract ${contract.contract_address}:`, error);
          totalErrors++;
          results.push({
            contractAddress: contract.contract_address,
            success: false,
            error: error.message
          });
        }
        
        // Update progress
        const progress = 20 + (results.length / contracts.length) * 70;
        await job.updateProgress(Math.round(progress));
      }

      // Update sync status
      const syncDuration = Date.now() - startTime;
      await this.updateSyncStatus('success', null, {
        totalAssetsSynced,
        totalErrors,
        syncDuration,
        contractsProcessed: contracts.length
      });

      await job.updateProgress(100);

      const result = {
        success: true,
        totalAssetsSynced,
        totalErrors,
        contractsProcessed: contracts.length,
        syncDuration,
        results,
        timestamp: new Date().toISOString()
      };

      console.log(`[RwaCacheSyncJob] Job ${job.id} completed. Synced ${totalAssetsSynced} assets`);
      return result;

    } catch (error) {
      console.error(`[RwaCacheSyncJob] Job ${job.id} failed:`, error);
      await this.updateSyncStatus('error', error.message);
      throw error;
    }
  }

  /**
   * Sync a specific contract
   * @param {object} contract - Contract object
   * @param {object} job - BullMQ job object
   * @returns {Promise<object>} Sync result
   */
  async syncContract(contract, job) {
    try {
      console.log(`[RwaCacheSyncJob] Syncing contract ${contract.contract_address}`);
      
      const adapter = this.adapterRegistry.getAdapter(contract.rwa_standard);
      if (!adapter) {
        throw new Error(`No adapter found for standard: ${contract.rwa_standard}`);
      }

      // Get all assets for this contract from cache
      const cachedAssets = this.getCachedAssetsForContract(contract.contract_address);
      
      let assetsSynced = 0;
      let errors = 0;
      const assetResults = [];

      // Sync each asset
      for (const asset of cachedAssets) {
        try {
          const assetResult = await this.syncAsset(asset, adapter, contract);
          assetResults.push(assetResult);
          
          if (assetResult.success) {
            assetsSynced++;
          } else {
            errors++;
          }
        } catch (error) {
          console.error(`[RwaCacheSyncJob] Error syncing asset ${asset.asset_id}:`, error);
          errors++;
          assetResults.push({
            assetId: asset.asset_id,
            success: false,
            error: error.message
          });
        }
      }

      // Update contract sync timestamp
      this.updateContractSyncTimestamp(contract.contract_address);

      return {
        contractAddress: contract.contract_address,
        success: true,
        assetsSynced,
        errors,
        totalAssets: cachedAssets.length,
        assetResults
      };

    } catch (error) {
      console.error(`[RwaCacheSyncJob] Error syncing contract ${contract.contract_address}:`, error);
      throw error;
    }
  }

  /**
   * Sync a specific asset
   * @param {object} asset - Cached asset object
   * @param {object} adapter - RWA adapter
   * @param {object} contract - Contract object
   * @returns {Promise<object>} Sync result
   */
  async syncAsset(asset, adapter, contract) {
    try {
      console.log(`[RwaCacheSyncJob] Syncing asset ${asset.asset_id}`);
      
      // Query current ownership from blockchain
      const ownershipData = await adapter.queryAssetOwnership(asset.asset_id, contract.contract_address);
      
      if (!ownershipData) {
        throw new Error('Failed to query ownership data from blockchain');
      }

      // Check if asset is frozen or burned
      const isFrozen = await adapter.isAssetFrozen(asset.asset_id, contract.contract_address);
      const isBurned = await adapter.isAssetBurned(asset.asset_id, contract.contract_address);

      // Update cache with latest data
      await this.updateAssetCache(asset.asset_id, contract.contract_address, {
        owner_pubkey: ownershipData.currentOwner || asset.owner_pubkey,
        is_frozen: isFrozen ? 1 : 0,
        is_burned: isBurned ? 1 : 0,
        cache_updated_at: new Date().toISOString(),
        blockchain_verified_at: new Date().toISOString(),
        transfer_count: ownershipData.transferCount || asset.transfer_count,
        last_transfer_hash: ownershipData.lastTransferHash || asset.last_transfer_hash,
        last_transfer_at: ownershipData.lastTransferAt || asset.last_transfer_at
      });

      return {
        assetId: asset.asset_id,
        success: true,
        ownerChanged: ownershipData.currentOwner !== asset.owner_pubkey,
        isFrozen,
        isBurned,
        blockchainVerified: true
      };

    } catch (error) {
      console.error(`[RwaCacheSyncJob] Error syncing asset ${asset.asset_id}:`, error);
      return {
        assetId: asset.asset_id,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle asset frozen event
   * @param {object} event - Asset frozen event
   * @returns {Promise<void>}
   */
  async handleAssetFrozen(event) {
    try {
      console.log(`[RwaCacheSyncJob] Handling asset freeze: ${event.assetId}`);
      
      // Update cache to mark asset as frozen
      await this.updateAssetCache(event.assetId, event.contractAddress, {
        is_frozen: 1,
        cache_updated_at: new Date().toISOString()
      });

      // Add job to hide frozen assets from marketplace
      await this.queue.add(
        'hide-frozen-asset',
        {
          assetId: event.assetId,
          contractAddress: event.contractAddress,
          timestamp: event.timestamp
        },
        {
          priority: 'high'
        }
      );

    } catch (error) {
      console.error(`[RwaCacheSyncJob] Error handling asset freeze:`, error);
    }
  }

  /**
   * Handle asset burned event
   * @param {object} event - Asset burned event
   * @returns {Promise<void>}
   */
  async handleAssetBurned(event) {
    try {
      console.log(`[RwaCacheSyncJob] Handling asset burn: ${event.assetId}`);
      
      // Update cache to mark asset as burned
      await this.updateAssetCache(event.assetId, event.contractAddress, {
        is_burned: 1,
        cache_updated_at: new Date().toISOString()
      });

      // Add job to remove burned assets from marketplace
      await this.queue.add(
        'remove-burned-asset',
        {
          assetId: event.assetId,
          contractAddress: event.contractAddress,
          timestamp: event.timestamp
        },
        {
          priority: 'high'
        }
      );

    } catch (error) {
      console.error(`[RwaCacheSyncJob] Error handling asset burn:`, error);
    }
  }

  /**
   * Get active RWA contracts from database
   * @returns {Array} Array of contract objects
   */
  getActiveRwaContracts() {
    try {
      const contracts = this.database.db.prepare(`
        SELECT id, contract_address, contract_name, rwa_standard, asset_type,
               network, is_active, monitoring_enabled, last_sync_at,
               sync_interval_minutes, created_at, updated_at
        FROM rwa_contract_registry
        WHERE is_active = 1
      `).all();
      
      return contracts;
    } catch (error) {
      console.error('[RwaCacheSyncJob] Error getting active contracts:', error);
      return [];
    }
  }

  /**
   * Get cached assets for a contract
   * @param {string} contractAddress - Contract address
   * @returns {Array} Array of cached assets
   */
  getCachedAssetsForContract(contractAddress) {
    try {
      const assets = this.database.db.prepare(`
        SELECT id, asset_id, owner_pubkey, rwa_contract_address, rwa_standard,
               asset_type, is_frozen, is_burned, transfer_count, last_transfer_hash,
               last_transfer_at, cache_updated_at, blockchain_verified_at
        FROM asset_ownership_cache
        WHERE rwa_contract_address = ?
      `).all(contractAddress);
      
      return assets;
    } catch (error) {
      console.error('[RwaCacheSyncJob] Error getting cached assets:', error);
      return [];
    }
  }

  /**
   * Update asset cache
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {object} updates - Fields to update
   * @returns {Promise<void>}
   */
  async updateAssetCache(assetId, contractAddress, updates) {
    try {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const values = Object.values(updates);
      
      this.database.db.prepare(`
        UPDATE asset_ownership_cache
        SET ${setClause}, updated_at = ?
        WHERE asset_id = ? AND rwa_contract_address = ?
      `).run(...values, new Date().toISOString(), assetId, contractAddress);
      
    } catch (error) {
      console.error('[RwaCacheSyncJob] Error updating asset cache:', error);
      throw error;
    }
  }

  /**
   * Update contract sync timestamp
   * @param {string} contractAddress - Contract address
   * @returns {void}
   */
  updateContractSyncTimestamp(contractAddress) {
    try {
      this.database.db.prepare(`
        UPDATE rwa_contract_registry
        SET last_sync_at = ?
        WHERE contract_address = ?
      `).run(new Date().toISOString(), contractAddress);
    } catch (error) {
      console.error('[RwaCacheSyncJob] Error updating contract sync timestamp:', error);
    }
  }

  /**
   * Update sync status
   * @param {string} status - Sync status
   * @param {string} errorMessage - Error message (if any)
   * @param {object} metrics - Sync metrics
   * @returns {void}
   */
  updateSyncStatus(status, errorMessage = null, metrics = {}) {
    try {
      const currentStatus = this.database.db.prepare(`
        SELECT * FROM rwa_cache_sync_status WHERE id = 'singleton'
      `).get();

      const updateData = {
        last_sync_at: new Date().toISOString(),
        sync_errors_count: (currentStatus?.sync_errors_count || 0) + (errorMessage ? 1 : 0),
        last_error_message: errorMessage,
        sync_duration_ms: metrics.syncDuration,
        next_sync_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes from now
        updated_at: new Date().toISOString()
      };

      if (status === 'success') {
        updateData.last_successful_sync_at = updateData.last_sync_at;
        updateData.total_assets_cached = metrics.totalAssetsSynced || currentStatus?.total_assets_cached || 0;
        updateData.active_contracts_monitored = metrics.contractsProcessed || currentStatus?.active_contracts_monitored || 0;
      }

      const setClause = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
      const values = Object.values(updateData);

      this.database.db.prepare(`
        UPDATE rwa_cache_sync_status
        SET ${setClause}
        WHERE id = 'singleton'
      `).run(...values);

    } catch (error) {
      console.error('[RwaCacheSyncJob] Error updating sync status:', error);
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
      console.error('[RwaCacheSyncJob] Error getting job status:', error);
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
      console.error('[RwaCacheSyncJob] Error getting queue stats:', error);
      throw error;
    }
  }

  /**
   * Get sync status
   * @returns {object} Sync status
   */
  getSyncStatus() {
    try {
      const status = this.database.db.prepare(`
        SELECT * FROM rwa_cache_sync_status WHERE id = 'singleton'
      `).get();
      
      return status || {
        id: 'singleton',
        last_sync_at: null,
        last_successful_sync_at: null,
        total_assets_cached: 0,
        active_contracts_monitored: 0,
        sync_errors_count: 0,
        last_error_message: null,
        sync_duration_ms: null,
        next_sync_at: null
      };
    } catch (error) {
      console.error('[RwaCacheSyncJob] Error getting sync status:', error);
      return {};
    }
  }

  /**
   * Start the sync worker
   * @returns {Promise<void>}
   */
  async start() {
    try {
      console.log('[RwaCacheSyncJob] Starting RWA cache sync worker...');
      
      // Start event listener
      await this.eventListener.start();
      
      // Schedule periodic sync jobs
      this.schedulePeriodicSync();
      
      console.log('[RwaCacheSyncJob] RWA cache sync worker started');
    } catch (error) {
      console.error('[RwaCacheSyncJob] Error starting sync worker:', error);
      throw error;
    }
  }

  /**
   * Stop the sync worker
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      console.log('[RwaCacheSyncJob] Stopping RWA cache sync worker...');
      
      // Stop event listener
      await this.eventListener.stop();
      
      // Close queue and worker
      await this.worker.close();
      await this.queue.close();
      await this.redisConnection.quit();
      
      console.log('[RwaCacheSyncJob] RWA cache sync worker stopped');
    } catch (error) {
      console.error('[RwaCacheSyncJob] Error stopping sync worker:', error);
    }
  }

  /**
   * Schedule periodic sync jobs
   * @returns {void}
   */
  schedulePeriodicSync() {
    // Schedule sync every 10 minutes
    setInterval(async () => {
      try {
        await this.addCacheSyncJob({
          priority: 'normal',
          scheduled: true
        });
      } catch (error) {
        console.error('[RwaCacheSyncJob] Error scheduling periodic sync:', error);
      }
    }, 10 * 60 * 1000); // 10 minutes
  }
}

module.exports = RwaCacheSyncJob;
