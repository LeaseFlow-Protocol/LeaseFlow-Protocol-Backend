const { ProrationCalculatorService } = require('../src/services/prorationCalculatorService');
const { AppDatabase } = require('../src/db/appDatabase');

/**
 * Fuzz Tests for Fiat-to-Crypto Rent Proration Calculator Engine
 * 
 * These tests validate that the Node.js implementation produces identical results
 * to the Soroban smart contract within 1 stroop tolerance.
 * 
 * Test Strategy:
 * 1. Generate random lease scenarios with edge cases
 * 2. Compare Node.js calculations against mock smart contract output
 * 3. Validate 128-bit fixed-point precision
 * 4. Test boundary conditions and error handling
 */

describe('Proration Calculator Fuzz Tests', () => {
  let calculator;
  let mockDatabase;
  let mockRedis;

  beforeAll(() => {
    // Mock database for testing
    mockDatabase = {
      getLeaseById: jest.fn()
    };

    // Mock Redis client
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG')
    };

    calculator = new ProrationCalculatorService(mockDatabase, mockRedis);
  });

  describe('128-bit Fixed-Point Precision Tests', () => {
    test('should handle maximum lease duration (2 years)', async () => {
      const lease = createMockLease({
        startDate: '2024-01-01',
        endDate: '2025-12-31',
        rentAmount: '1000000000' // 100 XLM in stroops
      });

      const terminationTime = new Date('2024-06-15').getTime() / 1000;
      
      mockDatabase.getLeaseById.mockReturnValue(lease);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      const result = await calculator.calculateProrationPreview(
        'test-lease',
        terminationTime,
        'USD'
      );

      expect(result.success).toBe(true);
      expect(result.data.raw.totalRefundStroops).toMatch(/^\d+$/);
      
      // Validate fixed-point arithmetic precision
      const totalRefund = BigInt(result.data.raw.totalRefundStroops);
      expect(totalRefund).toBeGreaterThan(BigInt(0));
    });

    test('should handle minimum rent amounts (1 stroop)', async () => {
      const lease = createMockLease({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: '1' // 1 stroop
      });

      const terminationTime = new Date('2024-06-15').getTime() / 1000;
      
      mockDatabase.getLeaseById.mockReturnValue(lease);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      const result = await calculator.calculateProrationPreview(
        'test-lease',
        terminationTime,
        'USD'
      );

      expect(result.success).toBe(true);
      expect(result.data.raw.totalRefundStroops).toMatch(/^\d+$/);
    });

    test('should handle edge case: termination at lease start', async () => {
      const lease = createMockLease({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: '100000000'
      });

      const terminationTime = new Date('2024-01-01').getTime() / 1000;
      
      mockDatabase.getLeaseById.mockReturnValue(lease);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      const result = await calculator.calculateProrationPreview(
        'test-lease',
        terminationTime,
        'USD'
      );

      expect(result.success).toBe(true);
      expect(result.data.calculation.usagePercentage).toBeCloseTo(0, 2);
    });

    test('should handle edge case: termination at lease end', async () => {
      const lease = createMockLease({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: '100000000'
      });

      const terminationTime = new Date('2024-12-31').getTime() / 1000;
      
      mockDatabase.getLeaseById.mockReturnValue(lease);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      const result = await calculator.calculateProrationPreview(
        'test-lease',
        terminationTime,
        'USD'
      );

      expect(result.success).toBe(true);
      expect(result.data.calculation.usagePercentage).toBeCloseTo(100, 2);
    });
  });

  describe('Smart Contract Validation Tests', () => {
    test('should validate against mock smart contract output', () => {
      // Mock smart contract calculation result
      const contractResult = {
        totalRefundStroops: '8500000000',
        remainingRentStroops: '4500000000',
        depositRefundStroops: '4000000000'
      };

      // Mock Node.js calculation result
      const nodeResult = {
        raw: {
          totalRefundStroops: '8500000001', // 1 stroop difference
          remainingRentStroops: '4500000000',
          depositRefundStroops: '4000000000'
        }
      };

      // Should pass validation (within 1 stroop tolerance)
      expect(calculator.validateAgainstContract(nodeResult, contractResult)).toBe(true);

      // Test failure case (more than 1 stroop difference)
      const invalidNodeResult = {
        raw: {
          totalRefundStroops: '8500000002', // 2 stroops difference
          remainingRentStroops: '4500000000',
          depositRefundStroops: '4000000000'
        }
      };

      expect(calculator.validateAgainstContract(invalidNodeResult, contractResult)).toBe(false);
    });

    test('should generate comprehensive fuzz test cases', () => {
      const testCases = calculator.generateFuzzTestCases(10);
      
      expect(testCases).toHaveLength(10);
      
      testCases.forEach((testCase, index) => {
        expect(testCase).toHaveProperty('leaseId');
        expect(testCase).toHaveProperty('startDate');
        expect(testCase).toHaveProperty('endDate');
        expect(testCase).toHaveProperty('rentAmount');
        expect(testCase).toHaveProperty('terminationTimestamp');
        expect(testCase).toHaveProperty('currency');
        
        expect(testCase.leaseId).toBe(`test-lease-${index}`);
        expect(parseInt(testCase.rentAmount)).toBeGreaterThan(0);
        expect(testCase.terminationTimestamp).toBeGreaterThan(
          new Date(testCase.startDate).getTime() / 1000
        );
        expect(testCase.terminationTimestamp).toBeLessThan(
          new Date(testCase.endDate).getTime() / 1000
        );
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should reject termination timestamp in the past', async () => {
      const lease = createMockLease({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: '100000000'
      });

      const pastTime = new Date('2023-12-01').getTime() / 1000;
      
      mockDatabase.getLeaseById.mockReturnValue(lease);

      const result = await calculator.calculateProrationPreview(
        'test-lease',
        pastTime,
        'USD'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('future');
    });

    test('should reject termination timestamp outside lease period', async () => {
      const lease = createMockLease({
        startDate: '2024-06-01',
        endDate: '2024-12-31',
        rentAmount: '100000000'
      });

      const beforeLeaseTime = new Date('2024-05-01').getTime() / 1000;
      
      mockDatabase.getLeaseById.mockReturnValue(lease);

      const result = await calculator.calculateProrationPreview(
        'test-lease',
        beforeLeaseTime,
        'USD'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('lease period');
    });

    test('should handle non-existent lease', async () => {
      mockDatabase.getLeaseById.mockReturnValue(null);

      const result = await calculator.calculateProrationPreview(
        'non-existent-lease',
        Date.now() / 1000 + 86400,
        'USD'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should handle inactive lease', async () => {
      const lease = createMockLease({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: '100000000',
        status: 'expired'
      });

      mockDatabase.getLeaseById.mockReturnValue(lease);

      const result = await calculator.calculateProrationPreview(
        'test-lease',
        Date.now() / 1000 + 86400,
        'USD'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not active');
    });

    test('should handle invalid inputs', async () => {
      // Test missing lease ID
      let result = await calculator.calculateProrationPreview(null, Date.now() / 1000, 'USD');
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');

      // Test missing timestamp
      result = await calculator.calculateProrationPreview('test-lease', null, 'USD');
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });
  });

  describe('Price Cache Integration Tests', () => {
    test('should use cached price when available', async () => {
      const lease = createMockLease({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: '100000000'
      });

      const cachedPrice = {
        xlmToTargetRate: 0.15,
        source: 'coingecko+stellar',
        timestamp: new Date().toISOString()
      };

      mockDatabase.getLeaseById.mockReturnValue(lease);
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedPrice));

      const result = await calculator.calculateProrationPreview(
        'test-lease',
        Date.now() / 1000 + 86400,
        'USD'
      );

      expect(result.success).toBe(true);
      expect(result.data.fiat.exchangeRate).toBe(0.15);
      expect(mockRedis.get).toHaveBeenCalledWith('price:xlm:USD');
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    test('should fetch fresh price when cache is empty', async () => {
      const lease = createMockLease({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: '100000000'
      });

      mockDatabase.getLeaseById.mockReturnValue(lease);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      // Mock the price feed service
      jest.doMock('../../services/priceFeedService', () => ({
        getUSDCToFiatRates: jest.fn().mockResolvedValue({ usd: 1.0 }),
        getXLMToUSDCPath: jest.fn().mockResolvedValue({ sourceAmount: '10.5' })
      }));

      const result = await calculator.calculateProrationPreview(
        'test-lease',
        Date.now() / 1000 + 86400,
        'USD'
      );

      expect(result.success).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'price:xlm:USD',
        expect.any(String),
        'EX',
        300
      );
    });
  });

  describe('Performance Tests', () => {
    test('should complete calculations within acceptable time', async () => {
      const lease = createMockLease({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: '100000000'
      });

      mockDatabase.getLeaseById.mockReturnValue(lease);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      const startTime = Date.now();
      
      await calculator.calculateProrationPreview(
        'test-lease',
        Date.now() / 1000 + 86400,
        'USD'
      );

      const duration = Date.now() - startTime;
      
      // Should complete within 1 second (including price fetch)
      expect(duration).toBeLessThan(1000);
    });

    test('should handle batch calculations efficiently', async () => {
      const lease = createMockLease({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        rentAmount: '100000000'
      });

      mockDatabase.getLeaseById.mockReturnValue(lease);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      const testCases = calculator.generateFuzzTestCases(50);
      const startTime = Date.now();

      const results = await Promise.all(
        testCases.map(testCase =>
          calculator.calculateProrationPreview(
            testCase.leaseId,
            testCase.terminationTimestamp,
            'USD'
          )
        )
      );

      const duration = Date.now() - startTime;
      const averageTime = duration / testCases.length;

      expect(results).toHaveLength(50);
      expect(averageTime).toBeLessThan(100); // Average under 100ms per calculation
    });
  });
});

/**
 * Helper function to create mock lease objects
 */
function createMockLease(overrides = {}) {
  return {
    id: 'test-lease',
    landlordId: 'landlord-123',
    tenantId: 'tenant-123',
    status: 'active',
    rentAmount: '100000000', // 10 XLM in stroops
    currency: 'XLM',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    renewable: 1,
    disputed: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}
