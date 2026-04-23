const request = require('supertest');
const { createApp } = require('../index');
const { AppDatabase } = require('../src/db/appDatabase');

/**
 * Integration Tests for Fiat-to-Crypto Rent Proration Calculator Engine
 * 
 * Tests the complete API endpoint including:
 * - HTTP request/response handling
 * - Rate limiting functionality
 * - Error handling and validation
 * - Database integration
 * - Redis caching integration
 */

describe('Proration Calculator Integration Tests', () => {
  let app;
  let database;
  let server;

  beforeAll(async () => {
    // Create in-memory database for testing
    database = new AppDatabase(':memory:');
    
    // Seed test data
    await seedTestData();
    
    // Create app with test dependencies
    app = createApp({
      database,
      config: {
        port: 0, // Use random port for testing
        redis: {
          host: 'localhost',
          port: 6379,
          password: null
        }
      }
    });

    // Start server for testing
    server = app.listen(0);
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (database) {
      database.db.close();
    }
  });

  describe('GET /api/v1/leases/:leaseId/proration-preview', () => {
    test('should return successful proration calculation', async () => {
      const leaseId = 'test-lease-1';
      const terminationTimestamp = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days from now

      const response = await request(app)
        .get(`/api/v1/leases/${leaseId}/proration-preview`)
        .query({
          termination_timestamp: terminationTimestamp,
          target_currency: 'USD'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('leaseId', leaseId);
      expect(response.body.data).toHaveProperty('terminationTimestamp', terminationTimestamp);
      expect(response.body.data).toHaveProperty('targetCurrency', 'USD');
      expect(response.body.data).toHaveProperty('raw');
      expect(response.body.data).toHaveProperty('calculation');
      expect(response.body.data).toHaveProperty('amounts');
      expect(response.body.data).toHaveProperty('fiat');
      expect(response.body.data).toHaveProperty('priceData');
      expect(response.body.meta).toHaveProperty('calculationTimeMs');
      expect(response.body.meta).toHaveProperty('endpoint');
      expect(response.body.meta).toHaveProperty('version');

      // Validate calculation structure
      expect(response.body.data.raw).toHaveProperty('elapsedSeconds');
      expect(response.body.data.raw).toHaveProperty('totalLeaseSeconds');
      expect(response.body.data.raw).toHaveProperty('totalRefundStroops');
      
      expect(response.body.data.calculation).toHaveProperty('elapsedDays');
      expect(response.body.data.calculation).toHaveProperty('usagePercentage');
      
      expect(response.body.data.amounts).toHaveProperty('totalRefund');
      expect(response.body.data.amounts.totalRefund).toHaveProperty('stroops');
      expect(response.body.data.amounts.totalRefund).toHaveProperty('xlm');
      
      expect(response.body.data.fiat).toHaveProperty('formatted');
      expect(response.body.data.fiat).toHaveProperty('totalRefund');
    });

    test('should handle different target currencies', async () => {
      const leaseId = 'test-lease-1';
      const terminationTimestamp = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

      const currencies = ['USD', 'EUR', 'NGN'];
      
      for (const currency of currencies) {
        const response = await request(app)
          .get(`/api/v1/leases/${leaseId}/proration-preview`)
          .query({
            termination_timestamp: terminationTimestamp,
            target_currency: currency
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.targetCurrency).toBe(currency);
        expect(response.body.data.fiat.formatted).toContain(currency);
      }
    });

    test('should return 400 for missing lease ID', async () => {
      const response = await request(app)
        .get('/api/v1/leases//proration-preview')
        .query({
          termination_timestamp: Math.floor(Date.now() / 1000) + 86400
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
      expect(response.body.code).toBe('MISSING_LEASE_ID');
    });

    test('should return 400 for missing termination timestamp', async () => {
      const response = await request(app)
        .get('/api/v1/leases/test-lease/proration-preview')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
      expect(response.body.code).toBe('MISSING_TIMESTAMP');
    });

    test('should return 400 for invalid timestamp format', async () => {
      const response = await request(app)
        .get('/api/v1/leases/test-lease/proration-preview')
        .query({
          termination_timestamp: 'invalid-timestamp'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('format');
      expect(response.body.code).toBe('INVALID_TIMESTAMP');
    });

    test('should return 400 for invalid target currency', async () => {
      const response = await request(app)
        .get('/api/v1/leases/test-lease/proration-preview')
        .query({
          termination_timestamp: Math.floor(Date.now() / 1000) + 86400,
          target_currency: 'INVALID'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('currency');
      expect(response.body.code).toBe('INVALID_CURRENCY');
    });

    test('should return 400 for non-existent lease', async () => {
      const response = await request(app)
        .get('/api/v1/leases/non-existent-lease/proration-preview')
        .query({
          termination_timestamp: Math.floor(Date.now() / 1000) + 86400
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
      expect(response.body.code).toBe('CALCULATION_FAILED');
    });

    test('should return 400 for termination timestamp in the past', async () => {
      const leaseId = 'test-lease-1';
      const pastTimestamp = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60); // 30 days ago

      const response = await request(app)
        .get(`/api/v1/leases/${leaseId}/proration-preview`)
        .query({
          termination_timestamp: pastTimestamp
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('CALCULATION_FAILED');
    });

    test('should return 400 for termination timestamp outside lease period', async () => {
      const leaseId = 'test-lease-1';
      // Use a timestamp far in the future (beyond lease end)
      const futureTimestamp = new Date('2026-01-01').getTime() / 1000;

      const response = await request(app)
        .get(`/api/v1/leases/${leaseId}/proration-preview`)
        .query({
          termination_timestamp: futureTimestamp
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('CALCULATION_FAILED');
    });
  });

  describe('Rate Limiting Tests', () => {
    test('should allow requests within rate limit', async () => {
      const leaseId = 'test-lease-1';
      const terminationTimestamp = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

      // Make 5 requests (should be within limit)
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .get(`/api/v1/leases/${leaseId}/proration-preview`)
          .query({
            termination_timestamp: terminationTimestamp,
            target_currency: 'USD'
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }
    });

    test('should enforce rate limit after threshold', async () => {
      const leaseId = 'test-lease-1';
      const terminationTimestamp = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

      // Make requests until rate limit is hit
      let rateLimitHit = false;
      for (let i = 0; i < 15; i++) { // Try more than the limit
        const response = await request(app)
          .get(`/api/v1/leases/${leaseId}/proration-preview`)
          .query({
            termination_timestamp: terminationTimestamp + i, // Vary timestamp slightly
            target_currency: 'USD'
          });

        if (response.status === 429) {
          rateLimitHit = true;
          expect(response.body.success).toBe(false);
          expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED');
          expect(response.body.retryAfter).toBeGreaterThan(0);
          break;
        }
      }

      expect(rateLimitHit).toBe(true);
    });
  });

  describe('Health Check Tests', () => {
    test('should return healthy status', async () => {
      const response = await request(app)
        .get('/api/v1/proration/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('services');
      expect(response.body.services).toHaveProperty('database');
      expect(response.body.services).toHaveProperty('redis');
      expect(response.body).toHaveProperty('version');
    });
  });

  describe('Fuzz Test Generation Tests', () => {
    test('should generate fuzz test cases', async () => {
      const response = await request(app)
        .get('/api/v1/proration/fuzz-tests')
        .query({ count: 5 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('count', 5);
      expect(response.body.data).toHaveProperty('testCases');
      expect(response.body.data.testCases).toHaveLength(5);

      // Validate test case structure
      const testCase = response.body.data.testCases[0];
      expect(testCase).toHaveProperty('leaseId');
      expect(testCase).toHaveProperty('startDate');
      expect(testCase).toHaveProperty('endDate');
      expect(testCase).toHaveProperty('rentAmount');
      expect(testCase).toHaveProperty('terminationTimestamp');
      expect(testCase).toHaveProperty('currency');
    });

    test('should limit fuzz test count to maximum', async () => {
      const response = await request(app)
        .get('/api/v1/proration/fuzz-tests')
        .query({ count: 200 }) // Request more than max allowed
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.count).toBeLessThanOrEqual(100);
    });
  });

  describe('Error Handling Tests', () => {
    test('should handle database connection errors gracefully', async () => {
      // Create app with broken database
      const brokenApp = createApp({
        database: null, // No database
        config: { port: 0 }
      });

      const response = await request(brokenApp)
        .get('/api/v1/leases/test-lease/proration-preview')
        .query({
          termination_timestamp: Math.floor(Date.now() / 1000) + 86400
        })
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('DATABASE_UNAVAILABLE');
    });

    test('should handle malformed requests', async () => {
      const response = await request(app)
        .get('/api/v1/leases/test-lease/proration-preview')
        .query({
          termination_timestamp: 'abc123',
          target_currency: 'USD'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_TIMESTAMP');
    });
  });

  /**
   * Seed test data for integration tests
   */
  async function seedTestData() {
    const now = new Date().toISOString();
    
    // Create test leases
    const testLeases = [
      {
        id: 'test-lease-1',
        landlordId: 'landlord-1',
        tenantId: 'tenant-1',
        status: 'active',
        rentAmount: '100000000', // 10 XLM in stroops
        currency: 'XLM',
        startDate: '2024-01-01',
        endDate: '2025-01-01',
        renewable: 1,
        disputed: 0,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'test-lease-2',
        landlordId: 'landlord-2',
        tenantId: 'tenant-2',
        status: 'expired', // Inactive lease for testing
        rentAmount: '50000000', // 5 XLM in stroops
        currency: 'XLM',
        startDate: '2023-01-01',
        endDate: '2023-12-31',
        renewable: 1,
        disputed: 0,
        createdAt: now,
        updatedAt: now
      }
    ];

    // Seed leases
    testLeases.forEach(lease => {
      database.seedLease(lease);
    });

    console.log('Test data seeded successfully');
  }
});
