const RwaCacheSyncJob = require('../../src/jobs/rwaCacheSyncJob');
const RwaCacheService = require('../../src/services/rwa/rwaCacheService');
const RwaAdapterRegistry = require('../../src/services/rwa/rwaAdapterRegistry');
const StellarEventListener = require('../../src/services/rwa/stellarEventListener');
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');

/**
 * Integration tests for RWA Cache Synchronization
 * Tests the complete flow from blockchain events to cache updates
 */
describe('RWA Cache Sync Integration Tests', () => {
  let syncJob;
  let cacheService;
  let mockDatabase;
  let mockRedis;
  let mockConfig;
  let mockEventListener;

  beforeAll(async () => {
    // Setup test Redis connection
    mockRedis = new Redis({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true
    });

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

    mockConfig = {
      network: 'testnet',
      redis: {
        host: 'localhost',
        port: 6379
      },
      rwaCache: {
        cacheTtlMinutes: 10,
        fallbackEnabled: true,
        enabled: true
      },
      jobs: {
        rwaCacheSyncEnabled: true
      },
      maxRetries: 3,
      retryDelay: 1000
    };

    // Initialize services
    cacheService = new RwaCacheService(mockDatabase, mockConfig);
    mockEventListener = new MockStellarEventListener(mockConfig, mockDatabase);
    syncJob = new RwaCacheSyncJob(mockDatabase, mockConfig);
    syncJob.eventListener = mockEventListener;
  });

  afterAll(async () => {
    if (syncJob) {
      await syncJob.stop();
    }
    if (mockRedis) {
      await mockRedis.quit();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('End-to-End Cache Synchronization', () => {
    it('should sync asset ownership from blockchain events', async () => {
      // Setup mock contract
      const mockContract = {
        id: 'test-contract-1',
        contract_address: 'GBLTESTCONTRACTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        contract_name: 'Test Real Estate Contract',
        rwa_standard: 'tokenized-realty',
        asset_type: 'real_estate',
        network: 'testnet',
        is_active: 1,
        monitoring_enabled: 1
      };

      // Mock database responses
      mockDatabase.db.prepare()
        .mockReturnValueOnce({ all: () => [mockContract] }) // getActiveRwaContracts
        .mockReturnValueOnce({ all: () => [] }); // getCachedAssetsForContract

      // Mock blockchain event
      const mockEvent = {
        id: 'tx_123_0',
        assetId: 'REAL_ESTATE_TOKEN_001',
        fromOwnerPubkey: 'GBL...OLD_OWNER',
        toOwnerPubkey: 'GBL...NEW_OWNER',
        contractAddress: mockContract.contract_address,
        transactionHash: 'tx_hash_123',
        ledgerSequence: 12345,
        operationIndex: 0,
        eventType: 'transfer',
        eventData: {
          propertyId: 'PROP_001',
          jurisdiction: 'CA'
        },
        timestamp: new Date().toISOString()
      };

      // Start sync job
      await syncJob.start();

      // Simulate blockchain event
      mockEventListener.emit('rwaEvent', mockEvent);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify cache was updated
      expect(mockDatabase.db.prepare().run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO asset_ownership_cache'),
        expect.arrayContaining([
          expect.stringMatching(/asset_.+/),
          'REAL_ESTATE_TOKEN_001',
          'GBL...NEW_OWNER',
          mockContract.contract_address,
          mockContract.rwa_standard,
          mockContract.asset_type,
          expect.any(Number), // is_frozen
          expect.any(Number), // is_burned
          expect.any(Number), // transfer_count
          'tx_hash_123',
          expect.any(String), // last_transfer_at
          expect.any(String), // cache_updated_at
          expect.any(String), // blockchain_verified_at
          expect.any(String), // created_at
          expect.any(String)  // updated_at
        ])
      );
    });

    it('should handle asset freeze events correctly', async () => {
      const mockContract = {
        contract_address: 'GBLTESTCONTRACTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        rwa_standard: 'tokenized-realty',
        asset_type: 'real_estate'
      };

      const freezeEvent = {
        id: 'tx_456_0',
        assetId: 'REAL_ESTATE_TOKEN_002',
        contractAddress: mockContract.contract_address,
        eventType: 'freeze',
        timestamp: new Date().toISOString()
      };

      // Mock existing asset in cache
      mockDatabase.db.prepare().get.mockReturnValue({
        asset_id: 'REAL_ESTATE_TOKEN_002',
        owner_pubkey: 'GBL...OWNER',
        is_frozen: 0,
        is_burned: 0
      });

      // Simulate freeze event
      await mockEventListener.processEvent(freezeEvent, mockContract);

      // Verify asset was marked as frozen
      expect(mockDatabase.db.prepare().run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE asset_ownership_cache SET is_frozen = 1'),
        expect.any(String),
        expect.any(String),
        'REAL_ESTATE_TOKEN_002',
        mockContract.contract_address
      );
    });

    it('should handle asset burn events correctly', async () => {
      const mockContract = {
        contract_address: 'GBLTESTCONTRACTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        rwa_standard: 'vehicle-registry',
        asset_type: 'vehicle'
      };

      const burnEvent = {
        id: 'tx_789_0',
        assetId: 'VEHICLE_TOKEN_001',
        contractAddress: mockContract.contract_address,
        eventType: 'burn',
        timestamp: new Date().toISOString()
      };

      // Simulate burn event
      await mockEventListener.processEvent(burnEvent, mockContract);

      // Verify asset was marked as burned
      expect(mockDatabase.db.prepare().run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE asset_ownership_cache SET is_burned = 1'),
        expect.any(String),
        expect.any(String),
        'VEHICLE_TOKEN_001',
        mockContract.contract_address
      );
    });
  });

  describe('Multi-Standard Support', () => {
    it('should handle different RWA standards', async () => {
      const contracts = [
        {
          contract_address: 'GBL...STELLAR_ASSET',
          rwa_standard: 'stellar-asset',
          asset_type: 'real_estate'
        },
        {
          contract_address: 'GBL...TOKENIZED_REALTY',
          rwa_standard: 'tokenized-realty',
          asset_type: 'real_estate'
        },
        {
          contract_address: 'GBL...VEHICLE_REGISTRY',
          rwa_standard: 'vehicle-registry',
          asset_type: 'vehicle'
        }
      ];

      // Mock different contract responses
      mockDatabase.db.prepare().all.mockReturnValue(contracts);

      // Test adapter registry
      const adapterRegistry = new RwaAdapterRegistry(mockConfig);
      
      for (const contract of contracts) {
        const adapter = adapterRegistry.getAdapter(contract.rwa_standard);
        expect(adapter).toBeDefined();
        expect(adapter.getStandard()).toBe(contract.rwa_standard);
      }

      // Verify all standards are supported
      const supportedStandards = adapterRegistry.getSupportedStandards();
      expect(supportedStandards).toContain('stellar-asset');
      expect(supportedStandards).toContain('tokenized-realty');
      expect(supportedStandards).toContain('vehicle-registry');
    });
  });

  describe('Cache Performance and Fallback', () => {
    it('should achieve sub-50ms query times for cached data', async () => {
      const assetId = 'PERF_TEST_ASSET';
      const contractAddress = 'GBL...PERF_CONTRACT';

      // Mock fresh cached data
      const cachedData = {
        asset_id: assetId,
        owner_pubkey: 'GBL...OWNER',
        is_frozen: 0,
        is_burned: 0,
        cache_updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
      };

      mockDatabase.db.prepare().get.mockReturnValue(cachedData);

      const startTime = Date.now();
      const result = await cacheService.getAssetOwnership(assetId, contractAddress);
      const queryTime = Date.now() - startTime;

      expect(queryTime).toBeLessThan(50);
      expect(result.source).toBe('cache');
      expect(result.blockchainVerified).toBe(false);
    });

    it('should fallback to blockchain when cache is stale', async () => {
      const assetId = 'STALE_TEST_ASSET';
      const contractAddress = 'GBL...STALE_CONTRACT';

      // Mock stale cached data (15 minutes old)
      const staleData = {
        asset_id: assetId,
        owner_pubkey: 'GBL...OLD_OWNER',
        is_frozen: 0,
        is_burned: 0,
        cache_updated_at: new Date(Date.now() - 15 * 60 * 1000).toISOString()
      };

      // Mock contract info
      mockDatabase.db.prepare()
        .mockReturnValueOnce(staleData) // getCachedAssetOwnership
        .mockReturnValueOnce({ // getContractInfo
          rwa_standard: 'stellar-asset',
          asset_type: 'real_estate'
        });

      // Mock blockchain query
      const adapterRegistry = new RwaAdapterRegistry(mockConfig);
      const adapter = adapterRegistry.getAdapter('stellar-asset');
      adapter.queryAssetOwnership = jest.fn().mockResolvedValue({
        currentOwner: 'GBL...NEW_OWNER',
        isFrozen: false,
        isBurned: false,
        transferCount: 5
      });
      adapter.isAssetFrozen = jest.fn().mockResolvedValue(false);
      adapter.isAssetBurned = jest.fn().mockResolvedValue(false);

      cacheService.adapterRegistry = adapterRegistry;

      const result = await cacheService.getAssetOwnership(assetId, contractAddress);

      expect(result.source).toBe('blockchain');
      expect(result.blockchainVerified).toBe(true);
      expect(result.owner_pubkey).toBe('GBL...NEW_OWNER');
    });

    it('should protect users from attempting to lease frozen assets', async () => {
      const assetId = 'FROZEN_ASSET';
      const contractAddress = 'GBL...FROZEN_CONTRACT';

      // Mock frozen asset
      const frozenAsset = {
        asset_id: assetId,
        owner_pubkey: 'GBL...OWNER',
        is_frozen: 1,
        is_burned: 0,
        cache_updated_at: new Date().toISOString()
      };

      mockDatabase.db.prepare().get.mockReturnValue(frozenAsset);

      const isAvailable = await cacheService.isAssetAvailable(assetId, contractAddress);

      expect(isAvailable).toBe(false);
    });

    it('should protect users from attempting to lease burned assets', async () => {
      const assetId = 'BURNED_ASSET';
      const contractAddress = 'GBL...BURNED_CONTRACT';

      // Mock burned asset
      const burnedAsset = {
        asset_id: assetId,
        owner_pubkey: null,
        is_frozen: 0,
        is_burned: 1,
        cache_updated_at: new Date().toISOString()
      };

      mockDatabase.db.prepare().get.mockReturnValue(burnedAsset);

      const isAvailable = await cacheService.isAssetAvailable(assetId, contractAddress);

      expect(isAvailable).toBe(false);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle blockchain connection errors gracefully', async () => {
      const assetId = 'ERROR_TEST_ASSET';
      const contractAddress = 'GBL...ERROR_CONTRACT';

      // Mock no cache data
      mockDatabase.db.prepare().get.mockReturnValue(null);

      // Mock contract info
      mockDatabase.db.prepare()
        .mockReturnValueOnce(null) // getCachedAssetOwnership
        .mockReturnValueOnce({ // getContractInfo
          rwa_standard: 'stellar-asset',
          asset_type: 'real_estate'
        });

      // Mock blockchain error
      const adapterRegistry = new RwaAdapterRegistry(mockConfig);
      const adapter = adapterRegistry.getAdapter('stellar-asset');
      adapter.queryAssetOwnership = jest.fn().mockRejectedValue(new Error('Network error'));

      cacheService.adapterRegistry = adapterRegistry;

      const result = await cacheService.getAssetOwnership(assetId, contractAddress);

      expect(result.source).toBe('none');
      expect(result.error).toBe('Asset ownership data not available');
    });

    it('should handle database errors and continue processing', async () => {
      // Mock database error for one asset
      mockDatabase.db.prepare().get.mockImplementation((query) => {
        if (query.includes('asset_1')) {
          throw new Error('Database connection failed');
        }
        return {
          asset_id: 'asset_2',
          owner_pubkey: 'GBL...OWNER',
          is_frozen: 0,
          is_burned: 0,
          cache_updated_at: new Date().toISOString()
        };
      });

      const assetRequests = [
        { assetId: 'asset_1', contractAddress: 'GBL...CONTRACT1' },
        { assetId: 'asset_2', contractAddress: 'GBL...CONTRACT2' }
      ];

      const results = await cacheService.getMultipleAssetOwnership(assetRequests);

      expect(results).toHaveLength(2);
      expect(results[0].error).toBe('Database connection failed');
      expect(results[1].asset_id).toBe('asset_2');
    });
  });

  describe('Performance Metrics', () => {
    it('should track cache performance metrics', async () => {
      const assetId = 'METRICS_TEST_ASSET';
      const contractAddress = 'GBL...METRICS_CONTRACT';

      // Mock cached data
      const cachedData = {
        asset_id: assetId,
        owner_pubkey: 'GBL...OWNER',
        is_frozen: 0,
        is_burned: 0,
        cache_updated_at: new Date().toISOString()
      };

      mockDatabase.db.prepare().get.mockReturnValue(cachedData);

      // Perform multiple queries
      await cacheService.getAssetOwnership(assetId, contractAddress);
      await cacheService.getAssetOwnership(assetId, contractAddress);
      await cacheService.getAssetOwnership(assetId, contractAddress);

      const stats = cacheService.getCacheStats();

      expect(stats.metrics.cacheHits).toBe(3);
      expect(stats.metrics.totalQueries).toBe(3);
      expect(stats.metrics.avgQueryTime).toBeGreaterThan(0);
    });
  });
});

/**
 * Mock Stellar Event Listener for testing
 */
class MockStellarEventListener extends EventEmitter {
  constructor(config, database) {
    super();
    this.config = config;
    this.database = database;
    this.isRunning = false;
  }

  async start() {
    this.isRunning = true;
    this.emit('started');
  }

  async stop() {
    this.isRunning = false;
    this.emit('stopped');
  }

  async processEvent(event, contract) {
    // Store transfer event
    await this.storeTransferEvent(event);
    
    // Update ownership cache
    await this.updateAssetOwnershipCache(event, contract);
    
    // Emit event
    this.emit('rwaEvent', event);
    
    // Handle special events
    if (event.eventType === 'freeze') {
      this.emit('assetFrozen', event);
    } else if (event.eventType === 'burn') {
      this.emit('assetBurned', event);
    }
  }

  async storeTransferEvent(event) {
    const now = new Date().toISOString();
    this.database.db.prepare(`
      INSERT OR REPLACE INTO asset_transfer_events (
        id, event_id, asset_id, from_owner_pubkey, to_owner_pubkey,
        rwa_contract_address, transaction_hash, ledger_sequence, operation_index,
        event_type, event_data, processed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.id,
      event.assetId,
      event.fromOwnerPubkey,
      event.toOwnerPubkey,
      event.contractAddress,
      event.transactionHash,
      event.ledgerSequence,
      event.operationIndex,
      event.eventType,
      JSON.stringify(event.eventData),
      now,
      now
    );
  }

  async updateAssetOwnershipCache(event, contract) {
    const now = new Date().toISOString();
    
    if (event.eventType === 'transfer') {
      this.database.db.prepare(`
        INSERT OR REPLACE INTO asset_ownership_cache (
          id, asset_id, owner_pubkey, rwa_contract_address, rwa_standard,
          asset_type, is_frozen, is_burned, transfer_count, last_transfer_hash,
          last_transfer_at, cache_updated_at, blockchain_verified_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `asset_${event.assetId}_${contract.contract_address}`,
        event.assetId,
        event.toOwnerPubkey,
        contract.contract_address,
        contract.rwa_standard,
        contract.asset_type,
        0, // is_frozen
        0, // is_burned
        1, // transfer_count
        event.transactionHash,
        event.timestamp,
        now,
        now,
        now,
        now
      );
    }
    
    if (event.eventType === 'freeze') {
      this.database.db.prepare(`
        UPDATE asset_ownership_cache 
        SET is_frozen = 1, cache_updated_at = ?, updated_at = ?
        WHERE asset_id = ? AND rwa_contract_address = ?
      `).run(now, now, event.assetId, event.contractAddress);
    }
    
    if (event.eventType === 'burn') {
      this.database.db.prepare(`
        UPDATE asset_ownership_cache 
        SET is_burned = 1, cache_updated_at = ?, updated_at = ?
        WHERE asset_id = ? AND rwa_contract_address = ?
      `).run(now, now, event.assetId, event.contractAddress);
    }
  }
}
