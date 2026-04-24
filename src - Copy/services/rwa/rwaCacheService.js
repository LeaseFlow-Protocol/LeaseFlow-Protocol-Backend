const RwaAdapterRegistry = require('./rwaAdapterRegistry');

/**
 * RWA Cache Service
 * Provides fast access to RWA asset ownership data with fallback to blockchain queries
 */
class RwaCacheService {
  constructor(database, config) {
    this.database = database;
    this.config = config;
    this.adapterRegistry = new RwaAdapterRegistry(config);
    this.cacheTtlMinutes = config.rwaCache?.cacheTtlMinutes || 10;
    this.fallbackEnabled = config.rwaCache?.fallbackEnabled !== false;
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      blockchainFallbacks: 0,
      totalQueries: 0,
      avgQueryTime: 0
    };
  }

  /**
   * Get asset ownership with cache and fallback
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {object} options - Query options
   * @returns {Promise<object>} Asset ownership data
   */
  async getAssetOwnership(assetId, contractAddress, options = {}) {
    const startTime = Date.now();
    this.metrics.totalQueries++;

    try {
      // Try to get from cache first
      const cachedData = await this.getCachedAssetOwnership(assetId, contractAddress);
      
      if (cachedData && !this.isCacheStale(cachedData)) {
        this.metrics.cacheHits++;
        this.updateQueryTime(startTime);
        return {
          ...cachedData,
          source: 'cache',
          blockchainVerified: false
        };
      }

      // Cache miss or stale data, try fallback
      this.metrics.cacheMisses++;
      
      if (this.fallbackEnabled && (this.isCacheStale(cachedData) || !cachedData)) {
        this.metrics.blockchainFallbacks++;
        const blockchainData = await this.getBlockchainAssetOwnership(assetId, contractAddress);
        
        if (blockchainData) {
          // Update cache with fresh data
          await this.updateCache(assetId, contractAddress, blockchainData);
          this.updateQueryTime(startTime);
          return {
            ...blockchainData,
            source: 'blockchain',
            blockchainVerified: true
          };
        }
      }

      // Return cached data even if stale (better than nothing)
      if (cachedData) {
        this.updateQueryTime(startTime);
        return {
          ...cachedData,
          source: 'cache_stale',
          blockchainVerified: false,
          warning: 'Cache data may be outdated'
        };
      }

      // No data available
      this.updateQueryTime(startTime);
      return {
        assetId,
        contractAddress,
        owner_pubkey: null,
        is_frozen: false,
        is_burned: false,
        source: 'none',
        blockchainVerified: false,
        error: 'Asset ownership data not available'
      };

    } catch (error) {
      console.error(`[RwaCacheService] Error getting asset ownership for ${assetId}:`, error);
      this.updateQueryTime(startTime);
      throw error;
    }
  }

  /**
   * Get cached asset ownership
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @returns {Promise<object|null>} Cached data or null
   */
  async getCachedAssetOwnership(assetId, contractAddress) {
    try {
      const cached = this.database.db.prepare(`
        SELECT id, asset_id, owner_pubkey, rwa_contract_address, rwa_standard,
               asset_type, is_frozen, is_burned, transfer_count, last_transfer_hash,
               last_transfer_at, cache_updated_at, blockchain_verified_at,
               cache_ttl_minutes, created_at, updated_at
        FROM asset_ownership_cache
        WHERE asset_id = ? AND rwa_contract_address = ?
      `).get(assetId, contractAddress);

      if (cached) {
        // Convert integer fields to boolean
        cached.is_frozen = Boolean(cached.is_frozen);
        cached.is_burned = Boolean(cached.is_burned);
        return cached;
      }

      return null;
    } catch (error) {
      console.error('[RwaCacheService] Error getting cached asset ownership:', error);
      return null;
    }
  }

  /**
   * Get asset ownership directly from blockchain
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @returns {Promise<object|null>} Blockchain data or null
   */
  async getBlockchainAssetOwnership(assetId, contractAddress) {
    try {
      // Get contract info to determine the adapter
      const contract = this.getContractInfo(contractAddress);
      if (!contract) {
        console.warn(`[RwaCacheService] No contract found for address: ${contractAddress}`);
        return null;
      }

      // Get appropriate adapter
      const adapter = this.adapterRegistry.getAdapter(contract.rwa_standard);
      if (!adapter) {
        console.warn(`[RwaCacheService] No adapter found for standard: ${contract.rwa_standard}`);
        return null;
      }

      // Query blockchain
      const ownershipData = await adapter.queryAssetOwnership(assetId, contractAddress);
      
      if (!ownershipData) {
        return null;
      }

      // Format data for cache
      return {
        asset_id: assetId,
        owner_pubkey: ownershipData.currentOwner,
        rwa_contract_address: contractAddress,
        rwa_standard: contract.rwa_standard,
        asset_type: contract.asset_type,
        is_frozen: ownershipData.isFrozen || false,
        is_burned: ownershipData.isBurned || false,
        transfer_count: ownershipData.transferCount || 0,
        last_transfer_hash: ownershipData.lastTransferHash,
        last_transfer_at: ownershipData.lastTransferAt,
        cache_updated_at: new Date().toISOString(),
        blockchain_verified_at: new Date().toISOString(),
        cache_ttl_minutes: this.cacheTtlMinutes
      };

    } catch (error) {
      console.error(`[RwaCacheService] Error getting blockchain asset ownership:`, error);
      return null;
    }
  }

  /**
   * Check if cache is stale
   * @param {object} cachedData - Cached data
   * @returns {boolean} True if stale
   */
  isCacheStale(cachedData) {
    if (!cachedData || !cachedData.cache_updated_at) {
      return true;
    }

    const cacheTime = new Date(cachedData.cache_updated_at);
    const now = new Date();
    const ageMinutes = (now - cacheTime) / (1000 * 60);
    
    const ttlMinutes = cachedData.cache_ttl_minutes || this.cacheTtlMinutes;
    return ageMinutes > ttlMinutes;
  }

  /**
   * Update cache with fresh data
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {object} data - Fresh data
   * @returns {Promise<void>}
   */
  async updateCache(assetId, contractAddress, data) {
    try {
      const now = new Date().toISOString();
      const cacheId = `asset_${assetId}_${contractAddress}`;

      this.database.db.prepare(`
        INSERT OR REPLACE INTO asset_ownership_cache (
          id, asset_id, owner_pubkey, rwa_contract_address, rwa_standard,
          asset_type, is_frozen, is_burned, transfer_count, last_transfer_hash,
          last_transfer_at, cache_updated_at, blockchain_verified_at,
          cache_ttl_minutes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cacheId,
        data.asset_id || assetId,
        data.owner_pubkey,
        data.rwa_contract_address || contractAddress,
        data.rwa_standard,
        data.asset_type,
        data.is_frozen ? 1 : 0,
        data.is_burned ? 1 : 0,
        data.transfer_count || 0,
        data.last_transfer_hash,
        data.last_transfer_at,
        now,
        data.blockchain_verified_at || now,
        data.cache_ttl_minutes || this.cacheTtlMinutes,
        now,
        now
      );

    } catch (error) {
      console.error('[RwaCacheService] Error updating cache:', error);
    }
  }

  /**
   * Get contract information
   * @param {string} contractAddress - Contract address
   * @returns {object|null} Contract info or null
   */
  getContractInfo(contractAddress) {
    try {
      const contract = this.database.db.prepare(`
        SELECT contract_address, contract_name, rwa_standard, asset_type,
               network, is_active, monitoring_enabled
        FROM rwa_contract_registry
        WHERE contract_address = ? AND is_active = 1
      `).get(contractAddress);

      return contract;
    } catch (error) {
      console.error('[RwaCacheService] Error getting contract info:', error);
      return null;
    }
  }

  /**
   * Check if asset is available for leasing
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @returns {Promise<boolean>} True if available
   */
  async isAssetAvailable(assetId, contractAddress) {
    try {
      const ownership = await this.getAssetOwnership(assetId, contractAddress);
      
      // Asset is not available if frozen, burned, or has no owner
      if (ownership.is_frozen || ownership.is_burned || !ownership.owner_pubkey) {
        return false;
      }

      return true;
    } catch (error) {
      console.error('[RwaCacheService] Error checking asset availability:', error);
      return false;
    }
  }

  /**
   * Get multiple asset ownerships
   * @param {Array} assetRequests - Array of {assetId, contractAddress}
   * @param {object} options - Query options
   * @returns {Promise<Array>} Array of ownership data
   */
  async getMultipleAssetOwnership(assetRequests, options = {}) {
    const results = [];
    
    for (const request of assetRequests) {
      try {
        const ownership = await this.getAssetOwnership(
          request.assetId, 
          request.contractAddress, 
          options
        );
        results.push(ownership);
      } catch (error) {
        console.error(`[RwaCacheService] Error getting ownership for ${request.assetId}:`, error);
        results.push({
          assetId: request.assetId,
          contractAddress: request.contractAddress,
          error: error.message,
          source: 'error'
        });
      }
    }

    return results;
  }

  /**
   * Get assets owned by a public key
   * @param {string} ownerPubkey - Owner public key
   * @param {object} options - Query options
   * @returns {Promise<Array>} Array of owned assets
   */
  async getAssetsByOwner(ownerPubkey, options = {}) {
    try {
      const assets = this.database.db.prepare(`
        SELECT id, asset_id, owner_pubkey, rwa_contract_address, rwa_standard,
               asset_type, is_frozen, is_burned, transfer_count, last_transfer_hash,
               last_transfer_at, cache_updated_at, blockchain_verified_at
        FROM asset_ownership_cache
        WHERE owner_pubkey = ? AND is_frozen = 0 AND is_burned = 0
        ORDER BY cache_updated_at DESC
      `).all(ownerPubkey);

      // Check if cache is stale for each asset
      const results = [];
      for (const asset of assets) {
        if (this.isCacheStale(asset)) {
          // Refresh stale asset
          const freshData = await this.getAssetOwnership(asset.asset_id, asset.rwa_contract_address);
          results.push(freshData);
        } else {
          // Return cached data
          results.push({
            ...asset,
            source: 'cache',
            blockchainVerified: false
          });
        }
      }

      return results;
    } catch (error) {
      console.error('[RwaCacheService] Error getting assets by owner:', error);
      return [];
    }
  }

  /**
   * Get available assets for marketplace
   * @param {object} filters - Filter options
   * @returns {Promise<Array>} Array of available assets
   */
  async getAvailableAssets(filters = {}) {
    try {
      let query = `
        SELECT id, asset_id, owner_pubkey, rwa_contract_address, rwa_standard,
               asset_type, is_frozen, is_burned, transfer_count, last_transfer_hash,
               last_transfer_at, cache_updated_at, blockchain_verified_at
        FROM asset_ownership_cache
        WHERE is_frozen = 0 AND is_burned = 0 AND owner_pubkey IS NOT NULL
      `;

      const params = [];

      // Add filters
      if (filters.assetType) {
        query += ` AND asset_type = ?`;
        params.push(filters.assetType);
      }

      if (filters.rwaStandard) {
        query += ` AND rwa_standard = ?`;
        params.push(filters.rwaStandard);
      }

      query += ` ORDER BY cache_updated_at DESC`;

      if (filters.limit) {
        query += ` LIMIT ?`;
        params.push(filters.limit);
      }

      const assets = this.database.db.prepare(query).all(...params);

      // Filter out stale assets if requested
      const results = [];
      for (const asset of assets) {
        if (!filters.excludeStale || !this.isCacheStale(asset)) {
          results.push({
            ...asset,
            source: 'cache',
            blockchainVerified: false
          });
        }
      }

      return results;
    } catch (error) {
      console.error('[RwaCacheService] Error getting available assets:', error);
      return [];
    }
  }

  /**
   * Invalidate cache for an asset
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @returns {Promise<void>}
   */
  async invalidateCache(assetId, contractAddress) {
    try {
      this.database.db.prepare(`
        DELETE FROM asset_ownership_cache
        WHERE asset_id = ? AND rwa_contract_address = ?
      `).run(assetId, contractAddress);

      console.log(`[RwaCacheService] Invalidated cache for asset ${assetId}`);
    } catch (error) {
      console.error('[RwaCacheService] Error invalidating cache:', error);
    }
  }

  /**
   * Clear all cache data
   * @returns {Promise<void>}
   */
  async clearCache() {
    try {
      this.database.db.prepare(`DELETE FROM asset_ownership_cache`).run();
      console.log('[RwaCacheService] Cleared all cache data');
    } catch (error) {
      console.error('[RwaCacheService] Error clearing cache:', error);
    }
  }

  /**
   * Get cache statistics
   * @returns {object} Cache statistics
   */
  getCacheStats() {
    try {
      const stats = this.database.db.prepare(`
        SELECT 
          COUNT(*) as total_cached,
          COUNT(CASE WHEN is_frozen = 1 THEN 1 END) as frozen_count,
          COUNT(CASE WHEN is_burned = 1 THEN 1 END) as burned_count,
          COUNT(CASE WHEN owner_pubkey IS NULL THEN 1 END) as ownerless_count,
          AVG(CASE 
            WHEN datetime(cache_updated_at) > datetime('now', '-10 minutes') 
            THEN 1 ELSE 0 
          END) as freshness_ratio
        FROM asset_ownership_cache
      `).get();

      return {
        ...stats,
        metrics: this.metrics,
        cacheHitRatio: this.metrics.totalQueries > 0 
          ? (this.metrics.cacheHits / this.metrics.totalQueries * 100).toFixed(2) + '%'
          : '0%',
        fallbackRatio: this.metrics.totalQueries > 0
          ? (this.metrics.blockchainFallbacks / this.metrics.totalQueries * 100).toFixed(2) + '%'
          : '0%'
      };
    } catch (error) {
      console.error('[RwaCacheService] Error getting cache stats:', error);
      return { error: error.message };
    }
  }

  /**
   * Update query time metrics
   * @param {number} startTime - Query start time
   * @returns {void}
   */
  updateQueryTime(startTime) {
    const queryTime = Date.now() - startTime;
    this.metrics.avgQueryTime = (this.metrics.avgQueryTime + queryTime) / 2;
  }

  /**
   * Reset metrics
   * @returns {void}
   */
  resetMetrics() {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      blockchainFallbacks: 0,
      totalQueries: 0,
      avgQueryTime: 0
    };
  }
}

module.exports = RwaCacheService;
