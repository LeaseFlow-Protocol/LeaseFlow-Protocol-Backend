const { MrrAggregatorService } = require('../services/mrrAggregatorService');
const { AppDatabase } = require('../db/appDatabase');
const Redis = require('ioredis-mock');

/**
 * Comprehensive test suite for MRR Aggregator
 * Tests various lease cycles, billing frequencies, and mathematical accuracy
 */
describe('MrrAggregatorService', () => {
  let database;
  let redisClient;
  let mrrService;

  beforeAll(async () => {
    // Setup in-memory database for testing
    database = new AppDatabase(':memory:');
    redisClient = new Redis();
    mrrService = new MrrAggregatorService(database, redisClient);
  });

  afterAll(async () => {
    if (redisClient) {
      await redisClient.quit();
    }
    if (database) {
      database.db.close();
    }
  });

  beforeEach(async () => {
    // Clean database before each test
    database.db.exec('DELETE FROM leases');
    // Clear Redis cache
    await redisClient.flushall();
  });

  describe('Lease Payment Normalization', () => {
    test('should normalize weekly rent to monthly correctly', async () => {
      // Create a lease with weekly rent (small amount indicates weekly)
      const weeklyRent = 250000; // 0.025 USDC per week (weekly rate)
      const expectedMonthly = weeklyRent * 4.33; // ~1.0825 USDC monthly
      
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: weeklyRent,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      const result = await mrrService.getCurrentMrr('lessor-1', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.currentMrr).toBeCloseTo(expectedMonthly / 100000, 2); // Convert from stroops
      expect(result.activeLeaseCount).toBe(1);
      expect(result.currencyBreakdown[0].originalAmount).toBe(expectedMonthly);
    });

    test('should normalize daily rent to monthly correctly', async () => {
      // Create a lease with daily rent (very small amount indicates daily)
      const dailyRent = 35000; // 0.0035 USDC per day
      const expectedMonthly = dailyRent * 30.44; // ~1.0654 USDC monthly
      
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: dailyRent,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      const result = await mrrService.getCurrentMrr('lessor-1', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.currentMrr).toBeCloseTo(expectedMonthly / 100000, 2);
      expect(result.activeLeaseCount).toBe(1);
    });

    test('should handle monthly rent without normalization', async () => {
      // Create a lease with monthly rent (larger amount indicates monthly)
      const monthlyRent = 1500000; // 15 USDC per month
      
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: monthlyRent,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      const result = await mrrService.getCurrentMrr('lessor-1', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.currentMrr).toBeCloseTo(monthlyRent / 100000, 2);
      expect(result.activeLeaseCount).toBe(1);
    });

    test('should exclude leases with excluded statuses', async () => {
      // Create leases with different statuses
      const leases = [
        { status: 'active', payment_status: 'paid', shouldInclude: true },
        { status: 'Grace_Period', payment_status: 'paid', shouldInclude: false },
        { status: 'Delinquent', payment_status: 'paid', shouldInclude: false },
        { status: 'Terminated', payment_status: 'paid', shouldInclude: false },
        { status: 'terminated', payment_status: 'paid', shouldInclude: false },
        { status: 'active', payment_status: 'pending', shouldInclude: false }
      ];

      for (let i = 0; i < leases.length; i++) {
        await createTestLease({
          landlord_id: 'lessor-1',
          rent_amount: 1000000,
          currency: 'USDC',
          status: leases[i].status,
          payment_status: leases[i].payment_status,
          tenant_id: `tenant-${i}`
        });
      }

      const result = await mrrService.getCurrentMrr('lessor-1', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.activeLeaseCount).toBe(1); // Only the active/paid lease
      expect(result.currentMrr).toBeCloseTo(10, 2); // 10 USDC
    });
  });

  describe('Complex Lease Portfolio Scenarios', () => {
    test('should handle mixed billing frequencies in portfolio', async () => {
      // Create a complex portfolio with mixed billing cycles
      const leases = [
        { rent_amount: 250000, type: 'weekly', expected: 250000 * 4.33 },      // Weekly
        { rent_amount: 35000, type: 'daily', expected: 35000 * 30.44 },        // Daily
        { rent_amount: 2000000, type: 'monthly', expected: 2000000 },          // Monthly
        { rent_amount: 1800000, type: 'monthly', expected: 1800000 }           // Monthly
      ];

      for (const lease of leases) {
        await createTestLease({
          landlord_id: 'lessor-1',
          rent_amount: lease.rent_amount,
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-${lease.type}`
        });
      }

      const result = await mrrService.getCurrentMrr('lessor-1', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.activeLeaseCount).toBe(4);
      
      const expectedTotal = leases.reduce((sum, lease) => sum + lease.expected, 0);
      expect(result.currentMrr).toBeCloseTo(expectedTotal / 100000, 2);
      
      // Verify currency breakdown
      expect(result.currencyBreakdown[0].activeLeaseCount).toBe(4);
      expect(result.currencyBreakdown[0].originalAmount).toBe(expectedTotal);
    });

    test('should handle multiple currencies with conversion', async () => {
      // Create leases in different currencies
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        tenant_id: 'tenant-1'
      });

      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 800000,
        currency: 'EUR',
        status: 'active',
        payment_status: 'paid',
        tenant_id: 'tenant-2'
      });

      const result = await mrrService.getCurrentMrr('lessor-1', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.activeLeaseCount).toBe(2);
      expect(result.currencyBreakdown).toHaveLength(2);
      
      // Should have both USDC and EUR breakdowns
      const currencies = result.currencyBreakdown.map(cb => cb.currency);
      expect(currencies).toContain('USDC');
      expect(currencies).toContain('EUR');
    });

    test('should handle large portfolio efficiently', async () => {
      // Create a large portfolio to test performance
      const leaseCount = 100;
      const baseRent = 1000000; // 10 USDC

      for (let i = 0; i < leaseCount; i++) {
        await createTestLease({
          landlord_id: 'lessor-1',
          rent_amount: baseRent + (i * 10000), // Slight variation
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-${i}`
        });
      }

      const startTime = Date.now();
      const result = await mrrService.getCurrentMrr('lessor-1', 'USD');
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.activeLeaseCount).toBe(leaseCount);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
      
      // Verify mathematical accuracy
      const expectedTotal = leaseCount * baseRent + (leaseCount * (leaseCount - 1) / 2) * 10000;
      expect(result.currentMrr).toBeCloseTo(expectedTotal / 100000, 2);
    });
  });

  describe('Historical MRR Calculations', () => {
    test('should calculate historical MRR for past date', async () => {
      const pastDate = '2024-01';
      
      // Create leases that were active in January 2024
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        tenant_id: 'tenant-1'
      });

      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 1500000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        start_date: '2023-06-01',
        end_date: '2024-06-30',
        tenant_id: 'tenant-2'
      });

      // Create a lease that started after January 2024 (should be excluded)
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 2000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        start_date: '2024-02-01',
        end_date: '2024-12-31',
        tenant_id: 'tenant-3'
      });

      const result = await mrrService.getHistoricalMrr('lessor-1', pastDate, 'USD');
      
      expect(result.success).toBe(true);
      expect(result.date).toBe(pastDate);
      expect(result.activeLeaseCount).toBe(2); // Only 2 leases were active in January
      expect(result.historicalMrr).toBeCloseTo(25, 2); // 10 + 15 USDC
    });

    test('should handle edge cases for date boundaries', async () => {
      // Test lease that ends exactly on the query date
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        start_date: '2023-01-01',
        end_date: '2024-01-31', // Ends on January 31
        tenant_id: 'tenant-1'
      });

      const result = await mrrService.getHistoricalMrr('lessor-1', '2024-01', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.activeLeaseCount).toBe(1); // Should be included
    });

    test('should validate date format', async () => {
      const invalidDates = ['2024', '2024-1', '2024-13', '2024-01-01', 'invalid-date'];
      
      for (const date of invalidDates) {
        const result = await mrrService.getHistoricalMrr('lessor-1', date, 'USD');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid date format');
      }
    });
  });

  describe('MRR Trends Analysis', () => {
    test('should calculate MRR trends over time', async () => {
      // Create leases with different start dates to test trends
      const leases = [
        { start_date: '2024-01-01', rent: 1000000 },
        { start_date: '2024-01-15', rent: 1200000 },
        { start_date: '2024-02-01', rent: 1100000 },
        { start_date: '2024-03-01', rent: 1300000 }
      ];

      for (let i = 0; i < leases.length; i++) {
        await createTestLease({
          landlord_id: 'lessor-1',
          rent_amount: leases[i].rent,
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          start_date: leases[i].start_date,
          end_date: '2024-12-31',
          tenant_id: `tenant-${i}`
        });
      }

      const result = await mrrService.getMrrTrends('lessor-1', 6, 'USD');
      
      expect(result.success).toBe(true);
      expect(result.trends).toBeDefined();
      expect(result.trends.length).toBeGreaterThan(0);
      
      // Should have data for multiple months
      const months = result.trends.map(t => t.month);
      expect(months).toContain('2024-01');
      expect(months).toContain('2024-02');
      expect(months).toContain('2024-03');
    });

    test('should limit trends to specified months', async () => {
      // Create old leases
      for (let i = 0; i < 15; i++) {
        await createTestLease({
          landlord_id: 'lessor-1',
          rent_amount: 1000000,
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          start_date: `2023-${String(i + 1).padStart(2, '0')}-01`,
          end_date: '2024-12-31',
          tenant_id: `tenant-${i}`
        });
      }

      const result = await mrrService.getMrrTrends('lessor-1', 3, 'USD');
      
      expect(result.success).toBe(true);
      expect(result.months).toBe(3);
      expect(result.trends.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Redis Caching', () => {
    test('should cache current MRR results', async () => {
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      // First call should cache the result
      const result1 = await mrrService.getCurrentMrr('lessor-1', 'USD');
      expect(result1.success).toBe(true);

      // Check if cached
      const cacheKey = `mrr:current:lessor-1:USD`;
      const cached = await redisClient.get(cacheKey);
      expect(cached).toBeTruthy();
      
      const cachedData = JSON.parse(cached);
      expect(cachedData.currentMrr).toBe(result1.currentMrr);

      // Second call should use cache
      const result2 = await mrrService.getCurrentMrr('lessor-1', 'USD');
      expect(result2.currentMrr).toBe(result1.currentMrr);
    });

    test('should cache historical MRR results', async () => {
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      const result1 = await mrrService.getHistoricalMrr('lessor-1', '2024-01', 'USD');
      expect(result1.success).toBe(true);

      // Check if cached
      const cacheKey = `mrr:historical:lessor-1:2024-01:USD`;
      const cached = await redisClient.get(cacheKey);
      expect(cached).toBeTruthy();
    });

    test('should clear cache for lessor', async () => {
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      // Generate some cache entries
      await mrrService.getCurrentMrr('lessor-1', 'USD');
      await mrrService.getHistoricalMrr('lessor-1', '2024-01', 'USD');
      await mrrService.getMrrTrends('lessor-1', 12, 'USD');

      // Verify cache exists
      const keys = await redisClient.keys('mrr:*:lessor-1:*');
      expect(keys.length).toBeGreaterThan(0);

      // Clear cache
      await mrrService.clearCache('lessor-1');

      // Verify cache is cleared
      const keysAfter = await redisClient.keys('mrr:*:lessor-1:*');
      expect(keysAfter.length).toBe(0);
    });
  });

  describe('Mathematical Accuracy Verification', () => {
    test('should maintain precision in complex calculations', async () => {
      // Test with precise amounts that could cause floating point errors
      const preciseAmounts = [333333, 666667, 999999, 1234567, 2345678];
      
      for (let i = 0; i < preciseAmounts.length; i++) {
        await createTestLease({
          landlord_id: 'lessor-1',
          rent_amount: preciseAmounts[i],
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-${i}`
        });
      }

      const result = await mrrService.getCurrentMrr('lessor-1', 'USD');
      
      expect(result.success).toBe(true);
      
      // Verify mathematical precision
      const expectedSum = preciseAmounts.reduce((sum, amount) => sum + amount, 0);
      expect(result.currencyBreakdown[0].originalAmount).toBe(expectedSum);
      
      // Verify converted amount maintains precision
      const convertedExpected = expectedSum / 100000;
      expect(result.currentMrr).toBeCloseTo(convertedExpected, 4);
    });

    test('should handle edge case amounts correctly', async () => {
      // Test edge cases: minimum and maximum reasonable amounts
      const edgeCases = [
        1, // Minimum possible
        999999999, // Large amount
        0, // Zero amount
        500000 // Middle ground
      ];

      for (let i = 0; i < edgeCases.length; i++) {
        await createTestLease({
          landlord_id: 'lessor-1',
          rent_amount: edgeCases[i],
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-edge-${i}`
        });
      }

      const result = await mrrService.getCurrentMrr('lessor-1', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.activeLeaseCount).toBe(4);
      
      // Edge case amounts should be handled correctly
      const expectedSum = edgeCases.reduce((sum, amount) => sum + amount, 0);
      expect(result.currencyBreakdown[0].originalAmount).toBe(expectedSum);
    });
  });

  describe('Error Handling', () => {
    test('should handle non-existent lessor gracefully', async () => {
      const result = await mrrService.getCurrentMrr('non-existent-lessor', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.currentMrr).toBe(0);
      expect(result.activeLeaseCount).toBe(0);
      expect(result.currencyBreakdown).toHaveLength(0);
    });

    test('should handle invalid currency codes', async () => {
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      // This should be handled at the controller level, but test service resilience
      const result = await mrrService.getCurrentMrr('lessor-1', 'INVALID');
      
      expect(result.success).toBe(true);
      // Service should still work even with invalid currency
    });

    test('should handle database connection issues gracefully', async () => {
      // Close database connection to simulate error
      database.db.close();
      
      const result = await mrrService.getCurrentMrr('lessor-1', 'USD');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // Helper function to create test leases
  async function createTestLease(leaseData) {
    const defaultData = {
      id: `lease-${Date.now()}-${Math.random()}`,
      landlord_id: 'lessor-1',
      tenant_id: 'tenant-1',
      status: 'active',
      payment_status: 'paid',
      start_date: '2024-01-01',
      end_date: '2024-12-31',
      renewable: 1,
      disputed: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const finalLeaseData = { ...defaultData, ...leaseData };

    database.db.prepare(`
      INSERT INTO leases (
        id, landlord_id, tenant_id, status, rent_amount, currency,
        start_date, end_date, renewable, disputed, payment_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      finalLeaseData.id,
      finalLeaseData.landlord_id,
      finalLeaseData.tenant_id,
      finalLeaseData.status,
      finalLeaseData.rent_amount,
      finalLeaseData.currency,
      finalLeaseData.start_date,
      finalLeaseData.end_date,
      finalLeaseData.renewable,
      finalLeaseData.disputed,
      finalLeaseData.payment_status,
      finalLeaseData.created_at,
      finalLeaseData.updated_at
    );

    return finalLeaseData;
  }
});
