const RwaCacheService = require('../services/rwa/rwaCacheService');
const RwaCacheSyncJob = require('../jobs/rwaCacheSyncJob');

/**
 * Controller for RWA Asset operations
 * Handles API endpoints for asset ownership queries and management
 */
class RwaAssetController {
  constructor(database, config) {
    this.database = database;
    this.config = config;
    this.cacheService = new RwaCacheService(database, config);
    this.syncJob = new RwaCacheSyncJob(database, config);
  }

  /**
   * Get asset ownership information
   * @route GET /api/v1/rwa/assets/:assetId/ownership
   */
  async getAssetOwnership(req, res) {
    try {
      const { assetId } = req.params;
      const { contractAddress, forceRefresh = false } = req.query;

      if (!contractAddress) {
        return res.status(400).json({
          success: false,
          error: 'contractAddress parameter is required'
        });
      }

      // Force refresh if requested
      if (forceRefresh === 'true') {
        await this.cacheService.invalidateCache(assetId, contractAddress);
      }

      const startTime = Date.now();
      const ownership = await this.cacheService.getAssetOwnership(assetId, contractAddress);
      const queryTime = Date.now() - startTime;

      // Check if asset is available for leasing
      const isAvailable = await this.cacheService.isAssetAvailable(assetId, contractAddress);

      const response = {
        success: true,
        data: {
          ...ownership,
          isAvailable,
          queryTime: `${queryTime}ms`
        }
      };

      // Add warnings for stale data
      if (ownership.source === 'cache_stale') {
        response.warning = 'Data may be outdated. Consider refreshing.';
      }

      res.status(200).json(response);

    } catch (error) {
      console.error('[RwaAssetController] Error getting asset ownership:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get multiple asset ownerships
   * @route POST /api/v1/rwa/assets/ownership/batch
   */
  async getMultipleAssetOwnership(req, res) {
    try {
      const { assets, forceRefresh = false } = req.body;

      if (!Array.isArray(assets) || assets.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'assets array is required and must not be empty'
        });
      }

      // Validate each asset request
      for (const asset of assets) {
        if (!asset.assetId || !asset.contractAddress) {
          return res.status(400).json({
            success: false,
            error: 'Each asset must have assetId and contractAddress'
          });
        }
      }

      // Force refresh if requested
      if (forceRefresh) {
        for (const asset of assets) {
          await this.cacheService.invalidateCache(asset.assetId, asset.contractAddress);
        }
      }

      const startTime = Date.now();
      const results = await this.cacheService.getMultipleAssetOwnership(assets);
      const queryTime = Date.now() - startTime;

      res.status(200).json({
        success: true,
        data: {
          results,
          totalRequested: assets.length,
          totalReturned: results.length,
          queryTime: `${queryTime}ms`
        }
      });

    } catch (error) {
      console.error('[RwaAssetController] Error getting multiple asset ownership:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get assets owned by a public key
   * @route GET /api/v1/rwa/owners/:ownerPubkey/assets
   */
  async getAssetsByOwner(req, res) {
    try {
      const { ownerPubkey } = req.params;
      const { assetType, rwaStandard, excludeStale = false, limit = 50 } = req.query;

      // Validate public key format
      if (!/^[G][A-Z0-9]{55}$/.test(ownerPubkey)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Stellar public key format'
        });
      }

      const filters = {
        assetType,
        rwaStandard,
        excludeStale: excludeStale === 'true',
        limit: parseInt(limit) || 50
      };

      const startTime = Date.now();
      const assets = await this.cacheService.getAssetsByOwner(ownerPubkey, filters);
      const queryTime = Date.now() - startTime;

      res.status(200).json({
        success: true,
        data: {
          ownerPubkey,
          assets,
          totalAssets: assets.length,
          queryTime: `${queryTime}ms`
        }
      });

    } catch (error) {
      console.error('[RwaAssetController] Error getting assets by owner:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get available assets for marketplace
   * @route GET /api/v1/rwa/assets/available
   */
  async getAvailableAssets(req, res) {
    try {
      const { 
        assetType, 
        rwaStandard, 
        excludeStale = false, 
        limit = 50,
        page = 1 
      } = req.query;

      const filters = {
        assetType,
        rwaStandard,
        excludeStale: excludeStale === 'true',
        limit: parseInt(limit) || 50
      };

      const startTime = Date.now();
      const assets = await this.cacheService.getAvailableAssets(filters);
      const queryTime = Date.now() - startTime;

      // Pagination
      const pageSize = parseInt(limit) || 50;
      const pageNum = parseInt(page) || 1;
      const startIndex = (pageNum - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedAssets = assets.slice(startIndex, endIndex);

      res.status(200).json({
        success: true,
        data: {
          assets: paginatedAssets,
          pagination: {
            page: pageNum,
            pageSize,
            totalAssets: assets.length,
            totalPages: Math.ceil(assets.length / pageSize),
            hasNextPage: endIndex < assets.length,
            hasPreviousPage: pageNum > 1
          },
          filters,
          queryTime: `${queryTime}ms`
        }
      });

    } catch (error) {
      console.error('[RwaAssetController] Error getting available assets:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Check if asset is available for leasing
   * @route GET /api/v1/rwa/assets/:assetId/availability
   */
  async checkAssetAvailability(req, res) {
    try {
      const { assetId } = req.params;
      const { contractAddress } = req.query;

      if (!contractAddress) {
        return res.status(400).json({
          success: false,
          error: 'contractAddress parameter is required'
        });
      }

      const startTime = Date.now();
      const isAvailable = await this.cacheService.isAssetAvailable(assetId, contractAddress);
      const ownership = await this.cacheService.getAssetOwnership(assetId, contractAddress);
      const queryTime = Date.now() - startTime;

      res.status(200).json({
        success: true,
        data: {
          assetId,
          contractAddress,
          isAvailable,
          ownership,
          reason: this.getAvailabilityReason(ownership),
          queryTime: `${queryTime}ms`
        }
      });

    } catch (error) {
      console.error('[RwaAssetController] Error checking asset availability:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get cache statistics
   * @route GET /api/v1/rwa/cache/stats
   */
  async getCacheStats(req, res) {
    try {
      const stats = this.cacheService.getCacheStats();
      const syncStatus = this.syncJob.getSyncStatus();
      const queueStats = await this.syncJob.getQueueStats();

      res.status(200).json({
        success: true,
        data: {
          cache: stats,
          sync: syncStatus,
          queue: queueStats,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('[RwaAssetController] Error getting cache stats:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Refresh asset cache
   * @route POST /api/v1/rwa/assets/:assetId/refresh
   */
  async refreshAssetCache(req, res) {
    try {
      const { assetId } = req.params;
      const { contractAddress } = req.body;

      if (!contractAddress) {
        return res.status(400).json({
          success: false,
          error: 'contractAddress is required in request body'
        });
      }

      // Invalidate cache
      await this.cacheService.invalidateCache(assetId, contractAddress);

      // Get fresh data
      const ownership = await this.cacheService.getAssetOwnership(assetId, contractAddress);

      res.status(200).json({
        success: true,
        message: 'Asset cache refreshed successfully',
        data: {
          assetId,
          contractAddress,
          ownership,
          refreshedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('[RwaAssetController] Error refreshing asset cache:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Trigger cache synchronization
   * @route POST /api/v1/rwa/cache/sync
   */
  async triggerCacheSync(req, res) {
    try {
      const { priority = 'normal', force = false } = req.body;

      if (force) {
        // Clear cache and force full sync
        await this.cacheService.clearCache();
      }

      // Add sync job to queue
      const job = await this.syncJob.addCacheSyncJob({
        priority,
        force,
        triggeredBy: 'api',
        timestamp: new Date().toISOString()
      });

      res.status(202).json({
        success: true,
        message: 'Cache synchronization triggered',
        data: {
          jobId: job.id,
          priority,
          force,
          statusUrl: `/api/v1/rwa/cache/sync/status?jobId=${job.id}`
        }
      });

    } catch (error) {
      console.error('[RwaAssetController] Error triggering cache sync:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get cache sync status
   * @route GET /api/v1/rwa/cache/sync/status
   */
  async getCacheSyncStatus(req, res) {
    try {
      const { jobId } = req.query;

      if (jobId) {
        // Get specific job status
        const jobStatus = await this.syncJob.getJobStatus(jobId);
        res.status(200).json({
          success: true,
          data: {
            jobId,
            jobStatus,
            timestamp: new Date().toISOString()
          }
        });
      } else {
        // Get overall sync status
        const syncStatus = this.syncJob.getSyncStatus();
        const queueStats = await this.syncJob.getQueueStats();

        res.status(200).json({
          success: true,
          data: {
            sync: syncStatus,
            queue: queueStats,
            timestamp: new Date().toISOString()
          }
        });
      }

    } catch (error) {
      console.error('[RwaAssetController] Error getting cache sync status:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Add RWA contract for monitoring
   * @route POST /api/v1/rwa/contracts
   */
  async addRwaContract(req, res) {
    try {
      const {
        contractAddress,
        contractName,
        rwaStandard,
        assetType,
        network = 'testnet',
        isActive = true,
        monitoringEnabled = true
      } = req.body;

      // Validate required fields
      if (!contractAddress || !contractName || !rwaStandard || !assetType) {
        return res.status(400).json({
          success: false,
          error: 'contractAddress, contractName, rwaStandard, and assetType are required'
        });
      }

      // Validate contract address format
      if (!/^[G][A-Z0-9]{55}$/.test(contractAddress)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Stellar contract address format'
        });
      }

      // Check if adapter exists for this standard
      const adapter = this.cacheService.adapterRegistry.getAdapter(rwaStandard);
      if (!adapter) {
        return res.status(400).json({
          success: false,
          error: `No adapter available for RWA standard: ${rwaStandard}`
        });
      }

      // Validate contract address with adapter
      if (!adapter.validateContractAddress(contractAddress)) {
        return res.status(400).json({
          success: false,
          error: 'Contract address validation failed for the specified RWA standard'
        });
      }

      const contract = {
        id: `contract_${contractAddress}`,
        contract_address: contractAddress,
        contract_name: contractName,
        rwa_standard: rwaStandard,
        asset_type: assetType,
        network,
        is_active: isActive,
        monitoring_enabled: monitoringEnabled
      };

      // Add contract to monitoring
      await this.syncJob.eventListener.addContract(contract);

      res.status(201).json({
        success: true,
        message: 'RWA contract added successfully',
        data: {
          contract,
          addedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('[RwaAssetController] Error adding RWA contract:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get RWA contracts
   * @route GET /api/v1/rwa/contracts
   */
  async getRwaContracts(req, res) {
    try {
      const { network, isActive, rwaStandard } = req.query;

      let query = `
        SELECT id, contract_address, contract_name, rwa_standard, asset_type,
               network, is_active, monitoring_enabled, last_sync_at,
               sync_interval_minutes, created_at, updated_at
        FROM rwa_contract_registry
        WHERE 1=1
      `;

      const params = [];

      if (network) {
        query += ` AND network = ?`;
        params.push(network);
      }

      if (isActive !== undefined) {
        query += ` AND is_active = ?`;
        params.push(isActive === 'true' ? 1 : 0);
      }

      if (rwaStandard) {
        query += ` AND rwa_standard = ?`;
        params.push(rwaStandard);
      }

      query += ` ORDER BY created_at DESC`;

      const contracts = this.database.db.prepare(query).all(...params);

      res.status(200).json({
        success: true,
        data: {
          contracts,
          totalContracts: contracts.length
        }
      });

    } catch (error) {
      console.error('[RwaAssetController] Error getting RWA contracts:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get availability reason for an asset
   * @param {object} ownership - Asset ownership data
   * @returns {string} Availability reason
   */
  getAvailabilityReason(ownership) {
    if (!ownership.owner_pubkey) {
      return 'Asset has no owner';
    }

    if (ownership.is_frozen) {
      return 'Asset is frozen by issuer';
    }

    if (ownership.is_burned) {
      return 'Asset has been burned';
    }

    return 'Asset is available';
  }

  /**
   * Initialize the controller
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      await this.syncJob.start();
      console.log('[RwaAssetController] Initialized RWA asset controller');
    } catch (error) {
      console.error('[RwaAssetController] Error initializing controller:', error);
    }
  }

  /**
   * Shutdown the controller
   * @returns {Promise<void>}
   */
  async shutdown() {
    try {
      await this.syncJob.stop();
      console.log('[RwaAssetController] RWA asset controller shutdown complete');
    } catch (error) {
      console.error('[RwaAssetController] Error during shutdown:', error);
    }
  }
}

module.exports = RwaAssetController;
