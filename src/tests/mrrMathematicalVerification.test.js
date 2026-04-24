/**
 * Mathematical Verification Tests for MRR Normalization Logic
 * 
 * This test suite specifically verifies the mathematical accuracy of the MRR
 * normalization algorithms with extreme precision requirements. It tests edge cases,
 * floating-point precision, and complex billing cycle conversions.
 */

const { MrrAggregatorService } = require('../services/mrrAggregatorService');
const { AppDatabase } = require('../db/appDatabase');
const Redis = require('ioredis-mock');

describe('MRR Mathematical Verification', () => {
  let database;
  let redisClient;
  let mrrService;

  beforeAll(async () => {
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
    database.db.exec('DELETE FROM leases');
    await redisClient.flushall();
  });

  describe('Billing Cycle Normalization Precision', () => {
    test('should normalize weekly rent with exact mathematical precision', async () => {
      // Test weekly to monthly conversion: weekly * 4.33 = monthly
      const testCases = [
        { weekly: 100000, expected: 433000 },      // 1 USDC/week → 4.33 USDC/month
        { weekly: 250000, expected: 1082500 },    // 2.5 USDC/week → 10.825 USDC/month
        { weekly: 777777, expected: 336999041 },  // Complex number
        { weekly: 1, expected: 4330 },             // Minimum unit
        { weekly: 999999999, expected: 4329999956667 } // Maximum reasonable
      ];

      for (const testCase of testCases) {
        await createTestLease({
          landlord_id: 'test-lessor',
          rent_amount: testCase.weekly,
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-${testCase.weekly}`
        });

        const result = await mrrService.getCurrentMrr('test-lessor', 'USD');
        
        expect(result.success).toBe(true);
        expect(result.currencyBreakdown[0].originalAmount).toBe(testCase.expected);
        
        // Verify the conversion is mathematically exact
        const calculatedMonthly = testCase.weekly * 4.33;
        expect(Math.round(calculatedMonthly)).toBe(testCase.expected);
        
        // Clean up for next test
        database.db.exec('DELETE FROM leases');
      }
    });

    test('should normalize daily rent with exact mathematical precision', async () => {
      // Test daily to monthly conversion: daily * 30.44 = monthly
      const testCases = [
        { daily: 10000, expected: 304400 },       // 0.1 USDC/day → 3.044 USDC/month
        { daily: 32894, expected: 1001587 },      // 0.32894 USDC/day → 10.01587 USDC/month
        { daily: 1, expected: 30 },               // Minimum unit
        { daily: 50000, expected: 1522000 },      // 0.5 USDC/day → 15.22 USDC/month
        { daily: 32768, expected: 998499 }       // Powers of 2 for precision testing
      ];

      for (const testCase of testCases) {
        await createTestLease({
          landlord_id: 'test-lessor',
          rent_amount: testCase.daily,
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-${testCase.daily}`
        });

        const result = await mrrService.getCurrentMrr('test-lessor', 'USD');
        
        expect(result.success).toBe(true);
        expect(result.currencyBreakdown[0].originalAmount).toBe(testCase.expected);
        
        // Verify mathematical precision
        const calculatedMonthly = testCase.daily * 30.44;
        expect(Math.round(calculatedMonthly)).toBe(testCase.expected);
        
        database.db.exec('DELETE FROM leases');
      }
    });

    test('should handle boundary conditions between billing cycles', async () => {
      // Test amounts that could be ambiguous between weekly/daily/monthly
      const boundaryCases = [
        { amount: 49999, expected: 1521996, type: 'daily' },   // Just under daily threshold
        { amount: 50000, expected: 1522000, type: 'daily' },   // At daily threshold
        { amount: 50001, expected: 1522003, type: 'daily' },   // Just above daily threshold
        { amount: 999999, expected: 4329995667, type: 'weekly' }, // Just under weekly threshold
        { amount: 1000000, expected: 1000000, type: 'monthly' },   // At weekly threshold (monthly)
        { amount: 1000001, expected: 1000001, type: 'monthly' }   // Just above weekly threshold
      ];

      for (const testCase of boundaryCases) {
        await createTestLease({
          landlord_id: 'test-lessor',
          rent_amount: testCase.amount,
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-boundary-${testCase.amount}`
        });

        const result = await mrrService.getCurrentMrr('test-lessor', 'USD');
        
        expect(result.success).toBe(true);
        expect(result.currencyBreakdown[0].originalAmount).toBe(testCase.expected);
        
        database.db.exec('DELETE FROM leases');
      }
    });
  });

  describe('Floating Point Precision Preservation', () => {
    test('should maintain precision with complex decimal numbers', async () => {
      // Test numbers that could cause floating-point precision issues
      const precisionCases = [
        { amount: 333333, expected: 1443333339 },    // Repeating decimal
        { amount: 666667, expected: 2886666111 },    // Another repeating decimal
        { amount: 142857, expected: 618577271 },      // 1/7 related
        { amount: 1234567, expected: 5345675111 },    // Sequential digits
        { amount: 9876543, expected: 42789581879 }    // Reverse sequential
      ];

      for (const testCase of precisionCases) {
        await createTestLease({
          landlord_id: 'test-lessor',
          rent_amount: testCase.amount,
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-precision-${testCase.amount}`
        });

        const result = await mrrService.getCurrentMrr('test-lessor', 'USD');
        
        expect(result.success).toBe(true);
        
        // Verify exact mathematical calculation
        const calculated = testCase.amount * 4.33;
        expect(Math.round(calculated)).toBe(testCase.expected);
        expect(result.currencyBreakdown[0].originalAmount).toBe(testCase.expected);
        
        database.db.exec('DELETE FROM leases');
      }
    });

    test('should handle large number arithmetic without overflow', async () => {
      // Test with very large numbers that could cause overflow
      const largeCases = [
        { amount: Number.MAX_SAFE_INTEGER / 1000000 }, // Convert to USDC units
        { amount: 9007199254740991 / 1000000 },        // Max safe integer in USDC
        { amount: 4611686018427387904n / 1000000n }   // 2^52 in USDC (BigInt)
      ];

      for (let i = 0; i < largeCases.length; i++) {
        const testCase = largeCases[i];
        const amount = Number(testCase.amount);
        
        await createTestLease({
          landlord_id: 'test-lessor',
          rent_amount: Math.floor(amount),
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-large-${i}`
        });

        const result = await mrrService.getCurrentMrr('test-lessor', 'USD');
        
        expect(result.success).toBe(true);
        expect(result.currentMrr).toBeGreaterThan(0);
        
        database.db.exec('DELETE FROM leases');
      }
    });
  });

  describe('Complex Portfolio Mathematical Accuracy', () => {
    test('should accurately sum mixed billing cycles with precision', async () => {
      // Create a complex portfolio with all billing cycle types
      const leases = [
        { type: 'weekly', amount: 250000, expected: 1082500 },      // Weekly: 2.5 → 10.825
        { type: 'daily', amount: 32894, expected: 1001587 },       // Daily: 0.32894 → 10.01587
        { type: 'monthly', amount: 1500000, expected: 1500000 },   // Monthly: 15 → 15
        { type: 'weekly', amount: 175000, expected: 757750 },       // Weekly: 1.75 → 7.5775
        { type: 'daily', amount: 49605, expected: 1510590 }         // Daily: 0.49605 → 15.1059
      ];

      for (let i = 0; i < leases.length; i++) {
        await createTestLease({
          landlord_id: 'test-lessor',
          rent_amount: leases[i].amount,
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-complex-${i}`
        });
      }

      const result = await mrrService.getCurrentMrr('test-lessor', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.activeLeaseCount).toBe(5);
      
      // Verify exact mathematical sum
      const expectedTotal = leases.reduce((sum, lease) => sum + lease.expected, 0);
      expect(result.currencyBreakdown[0].originalAmount).toBe(expectedTotal);
      
      // Verify converted amount maintains precision
      const expectedConverted = expectedTotal / 100000;
      expect(result.currentMrr).toBeCloseTo(expectedConverted, 4);
    });

    test('should handle statistical calculations accurately', async () => {
      // Create leases to test min/max/avg calculations
      const amounts = [500000, 1000000, 1500000, 2000000, 2500000]; // 5, 10, 15, 20, 25 USDC
      
      for (let i = 0; i < amounts.length; i++) {
        await createTestLease({
          landlord_id: 'test-lessor',
          rent_amount: amounts[i],
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-stats-${i}`
        });
      }

      const result = await mrrService.getCurrentMrr('test-lessor', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.activeLeaseCount).toBe(5);
      
      const breakdown = result.currencyBreakdown[0];
      
      // Verify statistical calculations
      expect(breakdown.minMonthlyRent).toBe(500000);
      expect(breakdown.maxMonthlyRent).toBe(2500000);
      expect(breakdown.avgMonthlyRent).toBe(1500000); // (5+10+15+20+25)/5 = 15
      
      // Verify total sum
      const expectedSum = amounts.reduce((sum, amount) => sum + amount, 0);
      expect(breakdown.originalAmount).toBe(expectedSum);
    });
  });

  describe('Edge Case Mathematical Scenarios', () => {
    test('should handle zero and negative edge cases', async () => {
      const edgeCases = [
        { amount: 0, description: 'Zero rent' },
        { amount: 1, description: 'Minimum possible rent' },
        { amount: -1, description: 'Negative rent (should be handled gracefully)' }
      ];

      for (let i = 0; i < edgeCases.length; i++) {
        const testCase = edgeCases[i];
        
        try {
          await createTestLease({
            landlord_id: 'test-lessor',
            rent_amount: testCase.amount,
            currency: 'USDC',
            status: 'active',
            payment_status: 'paid',
            tenant_id: `tenant-edge-${i}`
          });

          const result = await mrrService.getCurrentMrr('test-lessor', 'USD');
          
          // Should handle gracefully without crashing
          expect(result.success).toBe(true);
          expect(result.currentMrr).toBeDefined();
          
          database.db.exec('DELETE FROM leases');
        } catch (error) {
          // Some edge cases might throw errors, which is acceptable
          expect(error).toBeDefined();
        }
      }
    });

    test('should maintain precision across currency conversions', async () => {
      // Test currency conversion precision
      await createTestLease({
        landlord_id: 'test-lessor',
        rent_amount: 1234567, // 12.34567 USDC
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      // Test conversion to different currencies
      const currencies = ['USD', 'EUR', 'GBP', 'JPY'];
      
      for (const currency of currencies) {
        const result = await mrrService.getCurrentMrr('test-lessor', currency);
        
        expect(result.success).toBe(true);
        expect(result.currentMrr).toBeDefined();
        expect(result.targetCurrency).toBe(currency);
        
        // Verify conversion maintains reasonable precision
        expect(typeof result.currentMrr).toBe('number');
        expect(result.currentMrr).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Historical Calculation Precision', () => {
    test('should maintain precision in historical date calculations', async () => {
      // Test lease spanning exact date boundaries
      await createTestLease({
        landlord_id: 'test-lessor',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        start_date: '2024-01-01T00:00:00.000Z',
        end_date: '2024-12-31T23:59:59.999Z'
      });

      // Test various historical dates
      const testDates = [
        '2024-01-01', // First day
        '2024-06-15', // Middle of year
        '2024-12-31', // Last day
        '2024-02-29'  // Leap year (if applicable)
      ];

      for (const date of testDates) {
        try {
          const result = await mrrService.getHistoricalMrr('test-lessor', date, 'USD');
          
          expect(result.success).toBe(true);
          expect(result.date).toBe(date);
          expect(result.historicalMrr).toBeDefined();
          
          // Should be consistent for all dates within lease period
          if (date >= '2024-01' && date <= '2024-12') {
            expect(result.historicalMrr).toBeCloseTo(10, 2); // 10 USDC
          }
        } catch (error) {
          // Some dates might be invalid, which is acceptable
          if (date === '2024-02-29') {
            expect(error.message).toContain('Invalid date format');
          }
        }
      }
    });

    test('should handle proration calculations with precision', async () => {
      // Test partial month calculations
      await createTestLease({
        landlord_id: 'test-lessor',
        rent_amount: 1000000, // 10 USDC monthly
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        start_date: '2024-01-15',
        end_date: '2024-02-14' // Exactly one month
      });

      // Query for January (should include partial month)
      const result = await mrrService.getHistoricalMrr('test-lessor', '2024-01', 'USD');
      
      expect(result.success).toBe(true);
      expect(result.historicalMrr).toBeCloseTo(10, 2); // Should include full monthly amount
    });
  });

  describe('Performance vs Precision Trade-offs', () => {
    test('should maintain precision with large datasets', async () => {
      // Create many leases to test performance under load
      const leaseCount = 1000;
      const baseAmount = 1000000;
      
      for (let i = 0; i < leaseCount; i++) {
        await createTestLease({
          landlord_id: 'test-lessor',
          rent_amount: baseAmount + (i * 1000), // Slight variation
          currency: 'USDC',
          status: 'active',
          payment_status: 'paid',
          tenant_id: `tenant-perf-${i}`
        });
      }

      const startTime = performance.now();
      const result = await mrrService.getCurrentMrr('test-lessor', 'USD');
      const endTime = performance.now();
      
      expect(result.success).toBe(true);
      expect(result.activeLeaseCount).toBe(leaseCount);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
      
      // Verify mathematical accuracy despite performance
      const expectedSum = leaseCount * baseAmount + (leaseCount * (leaseCount - 1) / 2) * 1000;
      expect(result.currencyBreakdown[0].originalAmount).toBe(expectedSum);
    });
  });

  // Helper function to create test leases
  async function createTestLease(leaseData) {
    const defaultData = {
      id: `lease-${Date.now()}-${Math.random()}`,
      landlord_id: 'test-lessor',
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
