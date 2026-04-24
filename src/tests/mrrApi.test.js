const request = require('supertest');
const express = require('express');
const { MrrController } = require('../controllers/MrrController');
const { AppDatabase } = require('../db/appDatabase');
const Redis = require('ioredis-mock');

/**
 * API endpoint tests for MRR functionality
 * Tests all HTTP endpoints, request validation, and response formats
 */
describe('MRR API Endpoints', () => {
  let app;
  let database;
  let redisClient;
  let mrrController;

  beforeAll(async () => {
    // Setup test environment
    database = new AppDatabase(':memory:');
    redisClient = new Redis();
    mrrController = new MrrController(database, redisClient);

    // Create Express app for testing
    app = express();
    app.use(express.json());
    
    // Setup routes
    const { createMrrRoutes } = require('../routes/mrrRoutes');
    app.use('/api/v1', createMrrRoutes(database, redisClient));
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
    await redisClient.flushall();
  });

  describe('GET /api/v1/lessors/:id/metrics/mrr', () => {
    test('should return current MRR for valid lessor', async () => {
      // Create test lease
      await createTestLease({
        landlord_id: 'lessor-123',
        rent_amount: 1500000, // 15 USDC
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      const response = await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr')
        .query({ currency: 'USD' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lessorId).toBe('lessor-123');
      expect(response.body.targetCurrency).toBe('USD');
      expect(response.body.currentMrr).toBeCloseTo(15, 2);
      expect(response.body.activeLeaseCount).toBe(1);
      expect(response.body.currencyBreakdown).toHaveLength(1);
      expect(response.body.calculatedAt).toBeDefined();
    });

    test('should return zero MRR for lessor with no active leases', async () => {
      const response = await request(app)
        .get('/api/v1/lessors/lessor-456/metrics/mrr');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.currentMrr).toBe(0);
      expect(response.body.activeLeaseCount).toBe(0);
      expect(response.body.currencyBreakdown).toHaveLength(0);
    });

    test('should validate lessor ID parameter', async () => {
      const response = await request(app)
        .get('/api/v1/lessors//metrics/mrr'); // Empty lessor ID

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Lessor ID is required');
    });

    test('should validate currency parameter', async () => {
      await createTestLease({
        landlord_id: 'lessor-123',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      const response = await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr')
        .query({ currency: 'INVALID' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid currency');
    });

    test('should use default currency when not specified', async () => {
      await createTestLease({
        landlord_id: 'lessor-123',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      const response = await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr');

      expect(response.status).toBe(200);
      expect(response.body.targetCurrency).toBe('USD');
    });
  });

  describe('GET /api/v1/lessors/:id/metrics/mrr?date=YYYY-MM', () => {
    test('should return historical MRR for valid date', async () => {
      await createTestLease({
        landlord_id: 'lessor-123',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        start_date: '2024-01-01',
        end_date: '2024-12-31'
      });

      const response = await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr')
        .query({ date: '2024-01', currency: 'USD' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lessorId).toBe('lessor-123');
      expect(response.body.date).toBe('2024-01');
      expect(response.body.historicalMrr).toBeCloseTo(10, 2);
      expect(response.body.activeLeaseCount).toBe(1);
    });

    test('should require date parameter for historical MRR', async () => {
      const response = await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr')
        .query({ currency: 'USD' }); // No date parameter

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Date parameter is required');
    });

    test('should validate date format', async () => {
      const invalidDates = ['2024', '2024-1', '2024-13', '2024-01-01', 'invalid'];

      for (const date of invalidDates) {
        const response = await request(app)
          .get('/api/v1/lessors/lessor-123/metrics/mrr')
          .query({ date, currency: 'USD' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Invalid date format');
      }
    });

    test('should return zero for dates with no active leases', async () => {
      // Create lease that starts after the query date
      await createTestLease({
        landlord_id: 'lessor-123',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        start_date: '2024-02-01',
        end_date: '2024-12-31'
      });

      const response = await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr')
        .query({ date: '2024-01', currency: 'USD' });

      expect(response.status).toBe(200);
      expect(response.body.historicalMrr).toBe(0);
      expect(response.body.activeLeaseCount).toBe(0);
    });
  });

  describe('GET /api/v1/lessors/:id/metrics/mrr/trends', () => {
    test('should return MRR trends', async () => {
      // Create leases with different start dates
      await createTestLease({
        landlord_id: 'lessor-123',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        start_date: '2024-01-01',
        end_date: '2024-12-31'
      });

      await createTestLease({
        landlord_id: 'lessor-123',
        rent_amount: 1200000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid',
        start_date: '2024-02-01',
        end_date: '2024-12-31'
      });

      const response = await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr/trends')
        .query({ months: 6, currency: 'USD' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.lessorId).toBe('lessor-123');
      expect(response.body.months).toBe(6);
      expect(response.body.trends).toBeDefined();
      expect(response.body.trends.length).toBeGreaterThan(0);
      
      // Verify trend structure
      const trend = response.body.trends[0];
      expect(trend).toHaveProperty('month');
      expect(trend).toHaveProperty('convertedAmount');
      expect(trend).toHaveProperty('currency');
      expect(trend).toHaveProperty('newLeasesCount');
    });

    test('should validate months parameter', async () => {
      const invalidMonths = ['invalid', 0, -1, 61]; // Invalid values

      for (const months of invalidMonths) {
        const response = await request(app)
          .get('/api/v1/lessors/lessor-123/metrics/mrr/trends')
          .query({ months, currency: 'USD' });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Months parameter must be a number between 1 and 60');
      }
    });

    test('should use default months parameter', async () => {
      const response = await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr/trends')
        .query({ currency: 'USD' }); // No months parameter

      expect(response.status).toBe(200);
      expect(response.body.months).toBe(12); // Default value
    });
  });

  describe('DELETE /api/v1/lessors/:id/metrics/mrr/cache', () => {
    test('should clear MRR cache for lessor', async () => {
      // Create some cache entries first
      await createTestLease({
        landlord_id: 'lessor-123',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      // Generate cache
      await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr')
        .query({ currency: 'USD' });

      // Clear cache
      const response = await request(app)
        .delete('/api/v1/lessors/lessor-123/metrics/mrr/cache');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('MRR cache cleared successfully');
      expect(response.body.lessorId).toBe('lessor-123');
      expect(response.body.clearedAt).toBeDefined();
    });

    test('should validate lessor ID for cache clear', async () => {
      const response = await request(app)
        .delete('/api/v1/lessors//metrics/mrr/cache'); // Empty lessor ID

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Lessor ID is required');
    });
  });

  describe('POST /api/v1/lessors/metrics/mrr/bulk', () => {
    test('should return bulk MRR for multiple lessors', async () => {
      // Create leases for multiple lessors
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      await createTestLease({
        landlord_id: 'lessor-2',
        rent_amount: 1500000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      await createTestLease({
        landlord_id: 'lessor-3',
        rent_amount: 2000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      const response = await request(app)
        .post('/api/v1/lessors/metrics/mrr/bulk')
        .send({
          lessorIds: ['lessor-1', 'lessor-2', 'lessor-3'],
          currency: 'USD'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.currency).toBe('USD');
      expect(response.body.totalLessors).toBe(3);
      expect(response.body.successfulCalculations).toBe(3);
      expect(response.body.results).toHaveLength(3);

      // Verify individual results
      const results = response.body.results;
      expect(results[0].lessorId).toBe('lessor-1');
      expect(results[0].currentMrr).toBeCloseTo(10, 2);
      expect(results[1].lessorId).toBe('lessor-2');
      expect(results[1].currentMrr).toBeCloseTo(15, 2);
      expect(results[2].lessorId).toBe('lessor-3');
      expect(results[2].currentMrr).toBeCloseTo(20, 2);
    });

    test('should handle mixed success/failure in bulk requests', async () => {
      // Create lease only for one lessor
      await createTestLease({
        landlord_id: 'lessor-1',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      const response = await request(app)
        .post('/api/v1/lessors/metrics/mrr/bulk')
        .send({
          lessorIds: ['lessor-1', 'lessor-nonexistent'],
          currency: 'USD'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.totalLessors).toBe(2);
      expect(response.body.successfulCalculations).toBe(2); // Both should succeed (one with zero MRR)
      expect(response.body.results).toHaveLength(2);

      // Verify one has MRR, one has zero
      const results = response.body.results;
      const withMrr = results.find(r => r.currentMrr > 0);
      const withZeroMrr = results.find(r => r.currentMrr === 0);
      
      expect(withMrr).toBeDefined();
      expect(withZeroMrr).toBeDefined();
    });

    test('should validate bulk request parameters', async () => {
      // Test missing lessorIds
      const response1 = await request(app)
        .post('/api/v1/lessors/metrics/mrr/bulk')
        .send({ currency: 'USD' });

      expect(response1.status).toBe(400);
      expect(response1.body.error).toContain('lessorIds array is required');

      // Test empty lessorIds array
      const response2 = await request(app)
        .post('/api/v1/lessors/metrics/mrr/bulk')
        .send({ lessorIds: [], currency: 'USD' });

      expect(response2.status).toBe(400);
      expect(response2.body.error).toContain('lessorIds array is required');

      // Test too many lessors
      const tooManyIds = Array.from({ length: 51 }, (_, i) => `lessor-${i}`);
      const response3 = await request(app)
        .post('/api/v1/lessors/metrics/mrr/bulk')
        .send({ lessorIds: tooManyIds, currency: 'USD' });

      expect(response3.status).toBe(400);
      expect(response3.body.error).toContain('Cannot process more than 50 lessors');

      // Test invalid currency
      const response4 = await request(app)
        .post('/api/v1/lessors/metrics/mrr/bulk')
        .send({ lessorIds: ['lessor-1'], currency: 'INVALID' });

      expect(response4.status).toBe(400);
      expect(response4.body.error).toContain('Invalid currency');
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      // Simulate database error by closing connection
      database.db.close();

      const response = await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr')
        .query({ currency: 'USD' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Internal server error');
    });

    test('should handle malformed JSON in bulk requests', async () => {
      const response = await request(app)
        .post('/api/v1/lessors/metrics/mrr/bulk')
        .send('invalid json')
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
    });
  });

  describe('Response Format Validation', () => {
    test('should maintain consistent response structure', async () => {
      await createTestLease({
        landlord_id: 'lessor-123',
        rent_amount: 1000000,
        currency: 'USDC',
        status: 'active',
        payment_status: 'paid'
      });

      const response = await request(app)
        .get('/api/v1/lessors/lessor-123/metrics/mrr')
        .query({ currency: 'USD' });

      // Verify required fields
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('lessorId');
      expect(response.body).toHaveProperty('targetCurrency');
      expect(response.body).toHaveProperty('currentMrr');
      expect(response.body).toHaveProperty('activeLeaseCount');
      expect(response.body).toHaveProperty('currencyBreakdown');
      expect(response.body).toHaveProperty('calculatedAt');

      // Verify currency breakdown structure
      const breakdown = response.body.currencyBreakdown[0];
      expect(breakdown).toHaveProperty('currency');
      expect(breakdown).toHaveProperty('originalAmount');
      expect(breakdown).toHaveProperty('convertedAmount');
      expect(breakdown).toHaveProperty('activeLeaseCount');
      expect(breakdown).toHaveProperty('avgMonthlyRent');
      expect(breakdown).toHaveProperty('maxMonthlyRent');
      expect(breakdown).toHaveProperty('minMonthlyRent');

      // Verify timestamp format
      expect(new Date(response.body.calculatedAt)).toBeInstanceOf(Date);
    });
  });

  // Helper function to create test leases
  async function createTestLease(leaseData) {
    const defaultData = {
      id: `lease-${Date.now()}-${Math.random()}`,
      landlord_id: 'lessor-123',
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
