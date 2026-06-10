const { AppDatabase } = require('../db/appDatabase');
const { YieldService } = require('../services/yieldService');
const { PriceCacheService } = require('../services/priceCacheService');

describe('Yield Analytics Tests', () => {
  let database;
  let yieldService;
  let mockRedisClient;

  const testLeaseId = 'test-lease-123';
  const testTxHash = 'test-tx-hash-456';
  const testLessorPubkey = 'GBB2X7LJ5NHY6DUZ7YK5L3FQX2Z2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q';
  const testLesseePubkey = 'GAB2X7LJ5NHY6DUZ7YK5L3FQX2Z2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q2Q';

  beforeAll(async () => {
    // Initialize in-memory database for testing
    database = new AppDatabase(':memory:');
    
    // Mock Redis client for testing
    mockRedisClient = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([])
    };

    yieldService = new YieldService(database, mockRedisClient);
  });

  afterAll(async () => {
    // Clean up database connection if needed
    if (database.db) {
      database.db.close();
    }
  });

  describe('Yield Earnings Database Operations', () => {

    test('should insert and retrieve lessor yield earnings', async () => {
      const earningsData = {
        leaseId: testLeaseId,
        lessorPubkey: testLessorPubkey,
        harvestTxHash: testTxHash,
        assetCode: 'XLM',
        assetIssuer: null,
        amountStroops: 12345678, // 1.2345678 XLM
        amountDecimal: 1.2345678,
        fiatEquivalent: 0.12345678, // Assuming 0.1 USD/XLM rate
        fiatCurrency: 'usd',
        priceAtHarvest: 0.1,
        harvestedAt: '2024-01-15T10:30:00Z'
      };

      const result = await database.insertYieldEarningsLessor(earningsData);
      
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.leaseId).toBe(testLeaseId);
      expect(result.lessorPubkey).toBe(testLessorPubkey);
      expect(result.amountDecimal).toBe(1.2345678);
      expect(result.amountStroops).toBe(12345678);
      expect(result.fiatEquivalent).toBe(0.12345678);
    });

    test('should insert and retrieve lessee yield earnings', async () => {
      const earningsData = {
        leaseId: testLeaseId,
        lesseePubkey: testLesseePubkey,
        harvestTxHash: testTxHash,
        assetCode: 'XLM',
        assetIssuer: null,
        amountStroops: 87654321, // 8.7654321 XLM
        amountDecimal: 8.7654321,
        fiatEquivalent: 0.87654321, // Assuming 0.1 USD/XLM rate
        fiatCurrency: 'usd',
        priceAtHarvest: 0.1,
        harvestedAt: '2024-01-15T10:30:00Z'
      };

      const result = await database.insertYieldEarningsLessee(earningsData);
      
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.leaseId).toBe(testLeaseId);
      expect(result.lesseePubkey).toBe(testLesseePubkey);
      expect(result.amountDecimal).toBe(8.7654321);
      expect(result.amountStroops).toBe(87654321);
      expect(result.fiatEquivalent).toBe(0.87654321);
    });

    test('should aggregate yield history by pubkey and month', async () => {
      // Insert test data for multiple months
      const testData = [
        {
          leaseId: testLeaseId,
          lessorPubkey: testLessorPubkey,
          harvestTxHash: testTxHash + '-1',
          assetCode: 'XLM',
          amountStroops: 50000000, // 5 XLM
          amountDecimal: 5.0,
          fiatEquivalent: 0.5,
          harvestedAt: '2024-01-15T10:30:00Z'
        },
        {
          leaseId: testLeaseId,
          lessorPubkey: testLessorPubkey,
          harvestTxHash: testTxHash + '-2',
          assetCode: 'XLM',
          amountStroops: 30000000, // 3 XLM
          amountDecimal: 3.0,
          fiatEquivalent: 0.3,
          harvestedAt: '2024-01-20T15:45:00Z'
        },
        {
          leaseId: testLeaseId,
          lessorPubkey: testLessorPubkey,
          harvestTxHash: testTxHash + '-3',
          assetCode: 'USDC',
          amountStroops: 2000000, // 0.2 USDC (USDC has 7 decimals too)
          amountDecimal: 0.2,
          fiatEquivalent: 0.2,
          harvestedAt: '2024-02-10T09:15:00Z'
        }
      ];

      // Insert test data
      for (const data of testData) {
        await database.insertYieldEarningsLessor(data);
      }

      const history = database.getYieldHistoryByPubkey(testLessorPubkey);
      
      expect(history).toHaveLength(2); // Should be grouped by month
      expect(history[0].month).toBe('2024-02'); // Most recent first
      expect(history[0].asset_code).toBe('USDC');
      expect(history[0].total_amount).toBe(0.2);
      expect(history[0].total_fiat_equivalent).toBe(0.2);
      expect(history[0].transaction_count).toBe(1);
      
      expect(history[1].month).toBe('2024-01');
      expect(history[1].asset_code).toBe('XLM');
      expect(history[1].total_amount).toBe(8.0); // 5 + 3
      expect(history[1].total_fiat_equivalent).toBe(0.8); // 0.5 + 0.3
      expect(history[1].transaction_count).toBe(2);
    });

    test('should calculate total yield earnings correctly', async () => {
      const totals = database.getTotalYieldEarningsByPubkey(testLessorPubkey);
      
      expect(totals.lessor.total_amount).toBe(8.2); // 8 XLM + 0.2 USDC
      expect(totals.lessor.total_fiat_equivalent).toBe(1.0); // 0.8 + 0.2
      expect(totals.lessor.transaction_count).toBe(5); // All lessor transactions
    });
  });

  describe('Fractional Stroops Verification', () => {
    const testLeaseId = 'test-lease-stroops';
    const testTxHash = 'test-tx-stroops';

    test('should verify fractional stroops match aggregated sums', async () => {
      // Simulate an EscrowYieldHarvested event with 10 XLM total yield
      const totalYieldStroops = 100000000; // 10 XLM in stroops
      const lessorShare = Math.floor(totalYieldStroops * 0.5); // 5 XLM
      const lesseeShare = totalYieldStroops - lessorShare; // 5 XLM (no rounding loss)

      // Insert the split earnings
      await database.insertYieldEarningsLessor({
        leaseId: testLeaseId,
        lessorPubkey: testLessorPubkey,
        harvestTxHash: testTxHash,
        assetCode: 'XLM',
        amountStroops: lessorShare,
        amountDecimal: lessorShare / 10000000,
        harvestedAt: '2024-01-15T10:30:00Z'
      });

      await database.insertYieldEarningsLessee({
        leaseId: testLeaseId,
        lesseePubkey: testLesseePubkey,
        harvestTxHash: testTxHash,
        assetCode: 'XLM',
        amountStroops: lesseeShare,
        amountDecimal: lesseeShare / 10000000,
        harvestedAt: '2024-01-15T10:30:00Z'
      });

      // Verify aggregation
      const verification = database.verifyYieldAggregation(testLeaseId, testTxHash);

      expect(verification.lessor.total_stroops).toBe(lessorShare);
      expect(verification.lessor.total_decimal).toBe(lessorShare / 10000000);
      expect(verification.lessee.total_stroops).toBe(lesseeShare);
      expect(verification.lessee.total_decimal).toBe(lesseeShare / 10000000);
      expect(verification.combined.total_stroops).toBe(totalYieldStroops);
      expect(verification.combined.total_decimal).toBe(totalYieldStroops / 10000000);
    });

    test('should handle fractional stroops correctly with odd numbers', async () => {
      // Test with an odd number that can't be split evenly
      const totalYieldStroops = 100000001; // 10.0000001 XLM
      const lessorShare = Math.floor(totalYieldStroops * 0.5); // 5 XLM
      const lesseeShare = totalYieldStroops - lessorShare; // 5.0000001 XLM

      await database.insertYieldEarningsLessor({
        leaseId: testLeaseId + '-odd',
        lessorPubkey: testLessorPubkey,
        harvestTxHash: testTxHash + '-odd',
        assetCode: 'XLM',
        amountStroops: lessorShare,
        amountDecimal: lessorShare / 10000000,
        harvestedAt: '2024-01-15T10:30:00Z'
      });

      await database.insertYieldEarningsLessee({
        leaseId: testLeaseId + '-odd',
        lesseePubkey: testLesseePubkey,
        harvestTxHash: testTxHash + '-odd',
        assetCode: 'XLM',
        amountStroops: lesseeShare,
        amountDecimal: lesseeShare / 10000000,
        harvestedAt: '2024-01-15T10:30:00Z'
      });

      const verification = database.verifyYieldAggregation(testLeaseId + '-odd', testTxHash + '-odd');

      expect(verification.combined.total_stroops).toBe(totalYieldStroops);
      expect(verification.combined.total_decimal).toBe(totalYieldStroops / 10000000);
      
      // Verify no stroops are lost in the split
      expect(verification.lessor.total_stroops + verification.lessee.total_stroops).toBe(totalYieldStroops);
    });
  });

  describe('YieldService Integration', () => {
    test('should process EscrowYieldHarvested event correctly', async () => {
      const eventData = {
        lease_id: 'test-lease-integration',
        harvest_tx_hash: 'test-tx-integration',
        asset_code: 'XLM',
        asset_issuer: null,
        total_yield_stroops: 200000000, // 20 XLM
        lessor_pubkey: testLessorPubkey,
        lessee_pubkey: testLesseePubkey,
        harvested_at: '2024-01-15T10:30:00Z'
      };

      // Mock the price cache service
      const mockPriceData = {
        currency: 'usd',
        price: 0.1,
        lessorFiatEquivalent: 1.0, // 10 XLM * 0.1 USD/XLM
        lesseeFiatEquivalent: 1.0,  // 10 XLM * 0.1 USD/XLM
        priceSource: 'test',
        timestamp: eventData.harvested_at
      };

      jest.spyOn(yieldService.priceCacheService, 'calculateFiatEquivalent')
          .mockResolvedValue(mockPriceData);

      const result = await yieldService.processYieldHarvestEvent(eventData);

      expect(result.success).toBe(true);
      expect(result.lessorEarnings).toBeDefined();
      expect(result.lesseeEarnings).toBeDefined();
      expect(result.totalProcessed).toBe(200000000);
      
      // Verify the split
      expect(result.lessorEarnings.amountStroops).toBe(100000000); // 10 XLM
      expect(result.lesseeEarnings.amountStroops).toBe(100000000); // 10 XLM
      expect(result.lessorEarnings.fiatEquivalent).toBe(1.0);
      expect(result.lesseeEarnings.fiatEquivalent).toBe(1.0);
    });

    test('should handle yield history with caching', async () => {
      const pubkey = testLessorPubkey;
      const startDate = '2024-01-01';
      const endDate = '2024-12-31';

      // First call should hit database and cache result
      mockRedisClient.get.mockResolvedValue(null); // Cache miss
      const history1 = await yieldService.getYieldHistoryByPubkey(pubkey, startDate, endDate);
      
      expect(mockRedisClient.get).toHaveBeenCalled();
      expect(mockRedisClient.setex).toHaveBeenCalled();
      expect(Array.isArray(history1)).toBe(true);

      // Second call should hit cache
      mockRedisClient.get.mockResolvedValue(JSON.stringify(history1)); // Cache hit
      const history2 = await yieldService.getYieldHistoryByPubkey(pubkey, startDate, endDate);
      
      expect(history2).toEqual(history1);
    });
  });

  describe('Price Cache Service', () => {
    let priceCacheService;

    beforeAll(() => {
      priceCacheService = new PriceCacheService(mockRedisClient);
    });

    test('should cache and retrieve price data', async () => {
      const assetCode = 'XLM';
      const timestamp = '2024-01-15T10:30:00Z';
      const currency = 'usd';

      const mockPriceData = {
        assetCode,
        currency,
        price: 0.1,
        timestamp,
        source: 'test'
      };

      // Mock cache miss
      mockRedisClient.get.mockResolvedValue(null);
      
      // Mock the current price method
      jest.spyOn(priceCacheService, 'getCurrentPrice')
          .mockResolvedValue(mockPriceData);

      const result = await priceCacheService.getPriceAtTime(assetCode, timestamp, currency);

      expect(result).toEqual(mockPriceData);
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        expect.stringContaining('price:XLM:usd:'),
        300, // TTL for current prices
        JSON.stringify(mockPriceData)
      );
    });

    test('should handle cache hits', async () => {
      const assetCode = 'USDC';
      const timestamp = '2024-01-15T10:30:00Z';
      const currency = 'usd';

      const cachedData = {
        assetCode,
        currency,
        price: 1.0,
        timestamp,
        source: 'cached'
      };

      // Mock cache hit
      mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await priceCacheService.getPriceAtTime(assetCode, timestamp, currency);

      expect(result).toEqual(cachedData);
      expect(mockRedisClient.setex).not.toHaveBeenCalled(); // Should not cache on hit
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      // Mock database error
      const mockDb = {
        prepare: jest.fn().mockReturnValue({
          run: jest.fn().mockImplementation(() => {
            throw new Error('Database connection failed');
          })
        })
      };

      const errorDatabase = new AppDatabase(':memory:');
      errorDatabase.db = mockDb.db;

      const errorYieldService = new YieldService(errorDatabase, mockRedisClient);

      await expect(errorYieldService.processYieldHarvestEvent({
        lease_id: 'test-error',
        harvest_tx_hash: 'error-tx',
        total_yield_stroops: 1000000,
        lessor_pubkey: testLessorPubkey,
        lessee_pubkey: testLesseePubkey,
        harvested_at: '2024-01-15T10:30:00Z'
      })).rejects.toThrow('Failed to process yield harvest');
    });

    test('should handle Redis errors gracefully', async () => {
      // Mock Redis error
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'));
      mockRedisClient.setex.mockRejectedValue(new Error('Redis connection failed'));

      // Should still work even if Redis fails
      const history = await yieldService.getYieldHistoryByPubkey(testLessorPubkey);
      expect(Array.isArray(history)).toBe(true);
    });
  });
});
