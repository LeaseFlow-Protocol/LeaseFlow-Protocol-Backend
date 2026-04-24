const RwaCacheService = require('../../src/services/rwa/rwaCacheService');
const RwaAdapterRegistry = require('../../src/services/rwa/rwaAdapterRegistry');

// Mock dependencies
jest.mock('../../src/services/rwa/rwaAdapterRegistry');

describe('RwaCacheService', () => {
  let cacheService;
  let mockDatabase;
  let mockAdapterRegistry;
  let mockAdapter;

  beforeEach(() => {
    // Mock database
    mockDatabase = {
      db: {
        prepare: jest.fn().mockReturnValue({
          get: jest.fn(),
          all: jest.fn(),
          run: jest.fn()
        })
      }
    };

    // Mock adapter registry
    mockAdapterRegistry = {
      getAdapter: jest.fn()
    };

    // Mock adapter
    mockAdapter = {
      queryAssetOwnership: jest.fn(),
      isAssetFrozen: jest.fn(),
      isAssetBurned: jest.fn()
    };

    mockAdapterRegistry.getAdapter.mockReturnValue(mockAdapter);

    const config = {
      rwaCache: {
        cacheTtlMinutes: 10,
        fallbackEnabled: true
      },
      redis: {
        host: 'localhost',
        port: 6379
      }
    };

    cacheService = new RwaCacheService(mockDatabase, config);
    cacheService.adapterRegistry = mockAdapterRegistry;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAssetOwnership', () => {
    it('should return cached data when cache is fresh', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const cachedData = {
        asset_id: assetId,
        owner_pubkey: 'GBL...OWNER',
        is_frozen: false,
        is_burned: false,
        cache_updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 minutes ago
      };

      mockDatabase.db.prepare().get.mockReturnValue(cachedData);

      const result = await cacheService.getAssetOwnership(assetId, contractAddress);

      expect(result.source).toBe('cache');
      expect(result.blockchainVerified).toBe(false);
      expect(result.owner_pubkey).toBe('GBL...OWNER');
      expect(cacheService.metrics.cacheHits).toBe(1);
    });

    it('should fallback to blockchain when cache is stale', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const staleCachedData = {
        asset_id: assetId,
        owner_pubkey: 'GBL...OLD_OWNER',
        is_frozen: false,
        is_burned: false,
        cache_updated_at: new Date(Date.now() - 15 * 60 * 1000).toISOString() // 15 minutes ago
      };

      const blockchainData = {
        currentOwner: 'GBL...NEW_OWNER',
        isFrozen: false,
        isBurned: false,
        transferCount: 5
      };

      mockDatabase.db.prepare().get.mockReturnValue(staleCachedData);
      mockAdapter.queryAssetOwnership.mockResolvedValue(blockchainData);
      mockAdapter.isAssetFrozen.mockResolvedValue(false);
      mockAdapter.isAssetBurned.mockResolvedValue(false);

      const result = await cacheService.getAssetOwnership(assetId, contractAddress);

      expect(result.source).toBe('blockchain');
      expect(result.blockchainVerified).toBe(true);
      expect(result.owner_pubkey).toBe('GBL...NEW_OWNER');
      expect(cacheService.metrics.cacheMisses).toBe(1);
      expect(cacheService.metrics.blockchainFallbacks).toBe(1);
    });

    it('should fallback to blockchain when no cache exists', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const blockchainData = {
        currentOwner: 'GBL...OWNER',
        isFrozen: false,
        isBurned: false,
        transferCount: 1
      };

      mockDatabase.db.prepare().get.mockReturnValue(null); // No cache
      mockAdapter.queryAssetOwnership.mockResolvedValue(blockchainData);
      mockAdapter.isAssetFrozen.mockResolvedValue(false);
      mockAdapter.isAssetBurned.mockResolvedValue(false);

      const result = await cacheService.getAssetOwnership(assetId, contractAddress);

      expect(result.source).toBe('blockchain');
      expect(result.blockchainVerified).toBe(true);
      expect(result.owner_pubkey).toBe('GBL...OWNER');
      expect(cacheService.metrics.cacheMisses).toBe(1);
      expect(cacheService.metrics.blockchainFallbacks).toBe(1);
    });

    it('should return stale cache data when blockchain query fails', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const staleCachedData = {
        asset_id: assetId,
        owner_pubkey: 'GBL...OWNER',
        is_frozen: false,
        is_burned: false,
        cache_updated_at: new Date(Date.now() - 15 * 60 * 1000).toISOString()
      };

      mockDatabase.db.prepare().get.mockReturnValue(staleCachedData);
      mockAdapter.queryAssetOwnership.mockRejectedValue(new Error('Blockchain error'));

      const result = await cacheService.getAssetOwnership(assetId, contractAddress);

      expect(result.source).toBe('cache_stale');
      expect(result.warning).toBe('Data may be outdated. Consider refreshing.');
      expect(result.owner_pubkey).toBe('GBL...OWNER');
    });

    it('should handle frozen assets correctly', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const blockchainData = {
        currentOwner: 'GBL...OWNER',
        isFrozen: true,
        isBurned: false,
        transferCount: 3
      };

      mockDatabase.db.prepare().get.mockReturnValue(null);
      mockAdapter.queryAssetOwnership.mockResolvedValue(blockchainData);
      mockAdapter.isAssetFrozen.mockResolvedValue(true);
      mockAdapter.isAssetBurned.mockResolvedValue(false);

      const result = await cacheService.getAssetOwnership(assetId, contractAddress);

      expect(result.is_frozen).toBe(true);
      expect(result.is_burned).toBe(false);
    });

    it('should handle burned assets correctly', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const blockchainData = {
        currentOwner: null,
        isFrozen: false,
        isBurned: true,
        transferCount: 2
      };

      mockDatabase.db.prepare().get.mockReturnValue(null);
      mockAdapter.queryAssetOwnership.mockResolvedValue(blockchainData);
      mockAdapter.isAssetFrozen.mockResolvedValue(false);
      mockAdapter.isAssetBurned.mockResolvedValue(true);

      const result = await cacheService.getAssetOwnership(assetId, contractAddress);

      expect(result.is_frozen).toBe(false);
      expect(result.is_burned).toBe(true);
      expect(result.owner_pubkey).toBeNull();
    });
  });

  describe('isAssetAvailable', () => {
    it('should return true for available assets', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const ownershipData = {
        owner_pubkey: 'GBL...OWNER',
        is_frozen: false,
        is_burned: false
      };

      mockDatabase.db.prepare().get.mockReturnValue(ownershipData);

      const result = await cacheService.isAssetAvailable(assetId, contractAddress);

      expect(result).toBe(true);
    });

    it('should return false for frozen assets', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const ownershipData = {
        owner_pubkey: 'GBL...OWNER',
        is_frozen: true,
        is_burned: false
      };

      mockDatabase.db.prepare().get.mockReturnValue(ownershipData);

      const result = await cacheService.isAssetAvailable(assetId, contractAddress);

      expect(result).toBe(false);
    });

    it('should return false for burned assets', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const ownershipData = {
        owner_pubkey: 'GBL...OWNER',
        is_frozen: false,
        is_burned: true
      };

      mockDatabase.db.prepare().get.mockReturnValue(ownershipData);

      const result = await cacheService.isAssetAvailable(assetId, contractAddress);

      expect(result).toBe(false);
    });

    it('should return false for assets with no owner', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const ownershipData = {
        owner_pubkey: null,
        is_frozen: false,
        is_burned: false
      };

      mockDatabase.db.prepare().get.mockReturnValue(ownershipData);

      const result = await cacheService.isAssetAvailable(assetId, contractAddress);

      expect(result).toBe(false);
    });
  });

  describe('getMultipleAssetOwnership', () => {
    it('should handle multiple asset requests', async () => {
      const assetRequests = [
        { assetId: 'asset-1', contractAddress: 'GBL...CONTRACT1' },
        { assetId: 'asset-2', contractAddress: 'GBL...CONTRACT2' }
      ];

      const cachedData1 = {
        asset_id: 'asset-1',
        owner_pubkey: 'GBL...OWNER1',
        is_frozen: false,
        is_burned: false,
        cache_updated_at: new Date().toISOString()
      };

      const cachedData2 = {
        asset_id: 'asset-2',
        owner_pubkey: 'GBL...OWNER2',
        is_frozen: false,
        is_burned: false,
        cache_updated_at: new Date().toISOString()
      };

      mockDatabase.db.prepare()
        .mockReturnValueOnce(cachedData1)
        .mockReturnValueOnce(cachedData2);

      const results = await cacheService.getMultipleAssetOwnership(assetRequests);

      expect(results).toHaveLength(2);
      expect(results[0].asset_id).toBe('asset-1');
      expect(results[1].asset_id).toBe('asset-2');
    });

    it('should handle errors in batch requests gracefully', async () => {
      const assetRequests = [
        { assetId: 'asset-1', contractAddress: 'GBL...CONTRACT1' },
        { assetId: 'asset-2', contractAddress: 'GBL...CONTRACT2' }
      ];

      mockDatabase.db.prepare().mockImplementation(() => {
        throw new Error('Database error');
      });

      const results = await cacheService.getMultipleAssetOwnership(assetRequests);

      expect(results).toHaveLength(2);
      expect(results[0].error).toBe('Database error');
      expect(results[1].error).toBe('Database error');
    });
  });

  describe('getAssetsByOwner', () => {
    it('should return assets owned by a public key', async () => {
      const ownerPubkey = 'GBL...OWNER';
      
      const assets = [
        {
          asset_id: 'asset-1',
          owner_pubkey: ownerPubkey,
          is_frozen: false,
          is_burned: false,
          cache_updated_at: new Date().toISOString()
        },
        {
          asset_id: 'asset-2',
          owner_pubkey: ownerPubkey,
          is_frozen: false,
          is_burned: false,
          cache_updated_at: new Date().toISOString()
        }
      ];

      mockDatabase.db.prepare().all.mockReturnValue(assets);

      const result = await cacheService.getAssetsByOwner(ownerPubkey);

      expect(result).toHaveLength(2);
      expect(result[0].asset_id).toBe('asset-1');
      expect(result[1].asset_id).toBe('asset-2');
    });

    it('should filter out frozen and burned assets', async () => {
      const ownerPubkey = 'GBL...OWNER';
      
      const assets = [
        {
          asset_id: 'asset-1',
          owner_pubkey: ownerPubkey,
          is_frozen: false,
          is_burned: false,
          cache_updated_at: new Date().toISOString()
        },
        {
          asset_id: 'asset-2',
          owner_pubkey: ownerPubkey,
          is_frozen: true,
          is_burned: false,
          cache_updated_at: new Date().toISOString()
        },
        {
          asset_id: 'asset-3',
          owner_pubkey: ownerPubkey,
          is_frozen: false,
          is_burned: true,
          cache_updated_at: new Date().toISOString()
        }
      ];

      mockDatabase.db.prepare().all.mockReturnValue(assets);

      const result = await cacheService.getAssetsByOwner(ownerPubkey);

      expect(result).toHaveLength(1); // Only asset-1 should be returned
      expect(result[0].asset_id).toBe('asset-1');
    });
  });

  describe('getAvailableAssets', () => {
    it('should return available assets for marketplace', async () => {
      const assets = [
        {
          asset_id: 'asset-1',
          owner_pubkey: 'GBL...OWNER1',
          is_frozen: false,
          is_burned: false,
          cache_updated_at: new Date().toISOString()
        },
        {
          asset_id: 'asset-2',
          owner_pubkey: 'GBL...OWNER2',
          is_frozen: false,
          is_burned: false,
          cache_updated_at: new Date().toISOString()
        }
      ];

      mockDatabase.db.prepare().all.mockReturnValue(assets);

      const result = await cacheService.getAvailableAssets();

      expect(result).toHaveLength(2);
      expect(result[0].asset_id).toBe('asset-1');
      expect(result[1].asset_id).toBe('asset-2');
    });

    it('should filter by asset type', async () => {
      const filters = { assetType: 'real_estate' };
      
      const assets = [
        {
          asset_id: 'asset-1',
          owner_pubkey: 'GBL...OWNER1',
          is_frozen: false,
          is_burned: false,
          asset_type: 'real_estate',
          cache_updated_at: new Date().toISOString()
        }
      ];

      mockDatabase.db.prepare().all.mockReturnValue(assets);

      const result = await cacheService.getAvailableAssets(filters);

      expect(result).toHaveLength(1);
      expect(result[0].asset_type).toBe('real_estate');
    });
  });

  describe('invalidateCache', () => {
    it('should invalidate cache for an asset', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';

      await cacheService.invalidateCache(assetId, contractAddress);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe('clearCache', () => {
    it('should clear all cache data', async () => {
      await cacheService.clearCache();

      expect(mockDatabase.db.prepare().run).toHaveBeenCalledWith('DELETE FROM asset_ownership_cache');
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = {
        total_cached: 100,
        frozen_count: 5,
        burned_count: 2,
        ownerless_count: 3,
        freshness_ratio: 0.85
      };

      mockDatabase.db.prepare().get.mockReturnValue(stats);

      const result = cacheService.getCacheStats();

      expect(result.total_cached).toBe(100);
      expect(result.frozen_count).toBe(5);
      expect(result.burned_count).toBe(2);
      expect(result.ownerless_count).toBe(3);
      expect(result.freshness_ratio).toBe(0.85);
      expect(result.metrics).toBeDefined();
    });
  });

  describe('updateCache', () => {
    it('should update cache with fresh data', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      const data = {
        owner_pubkey: 'GBL...NEW_OWNER',
        is_frozen: false,
        is_burned: false
      };

      await cacheService.updateCache(assetId, contractAddress, data);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'asset_123_GBL...CONTRACT',
          'asset-123',
          'GBL...NEW_OWNER',
          'GBL...CONTRACT',
          expect.any(Number), // is_frozen
          expect.any(Number), // is_burned
          expect.any(String), // cache_updated_at
          expect.any(String), // blockchain_verified_at
          expect.any(Number), // cache_ttl_minutes
          expect.any(String), // created_at
          expect.any(String)  // updated_at
        ])
      );
    });
  });

  describe('isCacheStale', () => {
    it('should return true for stale cache', () => {
      const staleData = {
        cache_updated_at: new Date(Date.now() - 15 * 60 * 1000).toISOString() // 15 minutes ago
      };

      const result = cacheService.isCacheStale(staleData);

      expect(result).toBe(true);
    });

    it('should return false for fresh cache', () => {
      const freshData = {
        cache_updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 minutes ago
      };

      const result = cacheService.isCacheStale(freshData);

      expect(result).toBe(false);
    });

    it('should return true for cache with no timestamp', () => {
      const noTimestampData = {};

      const result = cacheService.isCacheStale(noTimestampData);

      expect(result).toBe(true);
    });
  });

  describe('getContractInfo', () => {
    it('should return contract information', () => {
      const contractAddress = 'GBL...CONTRACT';
      const contract = {
        contract_address: contractAddress,
        contract_name: 'Test Contract',
        rwa_standard: 'stellar-asset',
        asset_type: 'real_estate',
        is_active: 1
      };

      mockDatabase.db.prepare().get.mockReturnValue(contract);

      const result = cacheService.getContractInfo(contractAddress);

      expect(result.contract_address).toBe(contractAddress);
      expect(result.rwa_standard).toBe('stellar-asset');
    });

    it('should return null for non-existent contract', () => {
      const contractAddress = 'GBL...NONEXISTENT';

      mockDatabase.db.prepare().get.mockReturnValue(null);

      const result = cacheService.getContractInfo(contractAddress);

      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';

      mockDatabase.db.prepare().get.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      await expect(cacheService.getAssetOwnership(assetId, contractAddress))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle blockchain query errors gracefully', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';

      mockDatabase.db.prepare().get.mockReturnValue(null); // No cache
      mockAdapter.queryAssetOwnership.mockRejectedValue(new Error('Network error'));

      const result = await cacheService.getAssetOwnership(assetId, contractAddress);

      expect(result.error).toBe('Asset ownership data not available');
      expect(result.source).toBe('none');
    });
  });

  describe('metrics', () => {
    it('should track query metrics correctly', async () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT';
      
      const cachedData = {
        asset_id: assetId,
        owner_pubkey: 'GBL...OWNER',
        is_frozen: false,
        is_burned: false,
        cache_updated_at: new Date().toISOString()
      };

      mockDatabase.db.prepare().get.mockReturnValue(cachedData);

      // First query - cache hit
      await cacheService.getAssetOwnership(assetId, contractAddress);
      expect(cacheService.metrics.cacheHits).toBe(1);
      expect(cacheService.metrics.totalQueries).toBe(1);

      // Second query - cache miss
      mockDatabase.db.prepare().get.mockReturnValue(null);
      mockAdapter.queryAssetOwnership.mockResolvedValue({
        currentOwner: 'GBL...OWNER',
        isFrozen: false,
        isBurned: false
      });
      mockAdapter.isAssetFrozen.mockResolvedValue(false);
      mockAdapter.isAssetBurned.mockResolvedValue(false);

      await cacheService.getAssetOwnership(assetId, contractAddress);
      expect(cacheService.metrics.cacheMisses).toBe(1);
      expect(cacheService.metrics.blockchainFallbacks).toBe(1);
      expect(cacheService.metrics.totalQueries).toBe(2);
    });

    it('should reset metrics', () => {
      cacheService.metrics.cacheHits = 10;
      cacheService.metrics.cacheMisses = 5;
      cacheService.metrics.blockchainFallbacks = 3;
      cacheService.metrics.totalQueries = 18;

      cacheService.resetMetrics();

      expect(cacheService.metrics.cacheHits).toBe(0);
      expect(cacheService.metrics.cacheMisses).toBe(0);
      expect(cacheService.metrics.blockchainFallbacks).toBe(0);
      expect(cacheService.metrics.totalQueries).toBe(0);
    });
  });
});
