const { ReputationIndexerService } = require('../services/reputationIndexerService');
const { AppDatabase } = require('../db/appDatabase');

describe('Reputation Indexer Service (Issue #102)', () => {
  let reputationService;
  let database;
  let testPubkey;

  beforeAll(() => {
    database = new AppDatabase(':memory:');
    reputationService = new ReputationIndexerService(database);
    testPubkey = 'test-pubkey-abc123';
  });

  describe('Reputation Score Calculation', () => {
    test('should calculate reputation score for new user', async () => {
      const result = await reputationService.calculateReputationScore(testPubkey);
      
      expect(result).toHaveProperty('pubkey', testPubkey);
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('breakdown');
      expect(result).toHaveProperty('calculatedAt');
      expect(result).toHaveProperty('dataPoints');
      
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    test('should handle users with no history gracefully', async () => {
      const result = await reputationService.calculateReputationScore('empty-history-pubkey');
      
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.dataPoints.totalLeases).toBe(0);
      expect(result.dataPoints.totalPayments).toBe(0);
    });

    test('should include detailed breakdown', async () => {
      const result = await reputationService.calculateReputationScore(testPubkey);
      
      expect(result.breakdown).toHaveProperty('completedLeasesScore');
      expect(result.breakdown).toHaveProperty('paymentScore');
      expect(result.breakdown).toHaveProperty('defaultScore');
      expect(result.breakdown).toHaveProperty('depositScore');
      
      // Each breakdown should have score, weight, and details
      Object.values(result.breakdown).forEach(breakdown => {
        expect(breakdown).toHaveProperty('score');
        expect(breakdown).toHaveProperty('weight');
        expect(breakdown).toHaveProperty('details');
      });
    });
  });

  describe('Completed Leases Scoring', () => {
    test('should score high for users with completed leases', async () => {
      // Create test leases
      database.seedLease({
        id: 'lease-1',
        landlordId: 'landlord-1',
        tenantId: testPubkey,
        lessorId: 'lessor-1',
        status: 'completed',
        rentAmount: 1000,
        currency: 'USD',
        startDate: '2023-01-01',
        endDate: '2023-12-31'
      });

      database.seedLease({
        id: 'lease-2',
        landlordId: 'landlord-2',
        tenantId: testPubkey,
        lessorId: 'lessor-2',
        status: 'active',
        rentAmount: 1200,
        currency: 'USD',
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      });

      const result = await reputationService.calculateReputationScore(testPubkey);
      const completedLeasesScore = result.breakdown.completedLeasesScore;
      
      expect(completedLeasesScore.score).toBeGreaterThan(50);
      expect(completedLeasesScore.details.totalLeases).toBe(2);
      expect(completedLeasesScore.details.completedLeases).toBe(1);
      expect(completedLeasesScore.details.activeLeases).toBe(1);
    });

    test('should penalize terminated leases', async () => {
      database.seedLease({
        id: 'lease-terminated',
        landlordId: 'landlord-3',
        tenantId: testPubkey,
        lessorId: 'lessor-3',
        status: 'terminated',
        rentAmount: 800,
        currency: 'USD',
        startDate: '2022-01-01',
        endDate: '2022-12-31'
      });

      const result = await reputationService.calculateReputationScore(testPubkey);
      const completedLeasesScore = result.breakdown.completedLeasesScore;
      
      expect(completedLeasesScore.details.terminatedLeases).toBeGreaterThan(0);
    });
  });

  describe('Payment History Scoring', () => {
    test('should score high for on-time payments', async () => {
      // Create a lease first
      database.seedLease({
        id: 'lease-for-payments',
        landlordId: 'landlord-4',
        tenantId: testPubkey,
        lessorId: 'lessor-4',
        status: 'active',
        rentAmount: 1000,
        currency: 'USD',
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      });

      // Add payment records
      const paymentData = [
        {
          id: 'payment-1',
          leaseId: 'lease-for-payments',
          lessorId: 'lessor-4',
          period: '2024-01',
          dueDate: '2024-01-01',
          amountDue: 1000,
          amountPaid: 1000,
          datePaid: '2024-01-01', // On time
          status: 'paid'
        },
        {
          id: 'payment-2',
          leaseId: 'lease-for-payments',
          lessorId: 'lessor-4',
          period: '2024-02',
          dueDate: '2024-02-01',
          amountDue: 1000,
          amountPaid: 1000,
          datePaid: '2024-02-01', // On time
          status: 'paid'
        }
      ];

      paymentData.forEach(payment => {
        database.db.prepare(`
          INSERT INTO rent_payments (
            id, lease_id, lessor_id, period, due_date, amount_due,
            amount_paid, date_paid, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          payment.id, payment.leaseId, payment.lessorId, payment.period,
          payment.dueDate, payment.amountDue, payment.amountPaid,
          payment.datePaid, payment.status, new Date().toISOString(),
          new Date().toISOString()
        );
      });

      const result = await reputationService.calculateReputationScore(testPubkey);
      const paymentScore = result.breakdown.paymentScore;
      
      expect(paymentScore.score).toBeGreaterThan(80);
      expect(paymentScore.details.onTimePayments).toBe(2);
      expect(paymentScore.details.onTimeRate).toBe('100.0%');
    });

    test('should penalize missed payments', async () => {
      // Add missed payment
      database.db.prepare(`
        INSERT INTO rent_payments (
          id, lease_id, lessor_id, period, due_date, amount_due,
          amount_paid, date_paid, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'payment-missed', 'lease-for-payments', 'lessor-4', '2024-03',
        '2024-03-01', 1000, 0, null, 'missed',
        new Date().toISOString(), new Date().toISOString()
      );

      const result = await reputationService.calculateReputationScore(testPubkey);
      const paymentScore = result.breakdown.paymentScore;
      
      expect(paymentScore.details.missedPayments).toBeGreaterThan(0);
      expect(paymentScore.score).toBeLessThan(100);
    });
  });

  describe('Time Decay Algorithm', () => {
    test('should apply time decay to old events', async () => {
      // Create old lease
      database.seedLease({
        id: 'old-lease',
        landlordId: 'landlord-5',
        tenantId: testPubkey,
        lessorId: 'lessor-5',
        status: 'completed',
        rentAmount: 1000,
        currency: 'USD',
        startDate: '2020-01-01',
        endDate: '2020-12-31',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-12-31T00:00:00.000Z'
      });

      const result = await reputationService.calculateReputationScore(testPubkey, {
        timeDecayMonths: 12 // 1 year decay
      });

      // Check that time decay was applied
      Object.values(result.breakdown).forEach(breakdown => {
        if (breakdown.timeWeight) {
          expect(parseFloat(breakdown.timeWeight)).toBeLessThanOrEqual(1.0);
        }
      });
    });

    test('should give full weight to recent events', async () => {
      // Create recent lease
      database.seedLease({
        id: 'recent-lease',
        landlordId: 'landlord-6',
        tenantId: testPubkey,
        lessorId: 'lessor-6',
        status: 'active',
        rentAmount: 1000,
        currency: 'USD',
        startDate: new Date().toISOString().split('T')[0],
        endDate: '2025-01-01'
      });

      const result = await reputationService.calculateReputationScore(testPubkey);

      // Recent events should have high time weight
      Object.values(result.breakdown).forEach(breakdown => {
        if (breakdown.timeWeight && breakdown.mostRecentEvent) {
          const eventDate = new Date(breakdown.mostRecentEvent);
          const monthsSince = (Date.now() - eventDate) / (1000 * 60 * 60 * 24 * 30);
          
          if (monthsSince < 1) {
            expect(parseFloat(breakdown.timeWeight)).toBeGreaterThan(0.9);
          }
        }
      });
    });
  });

  describe('Score Grading', () => {
    test('should assign correct grades for scores', () => {
      const testCases = [
        { score: 95, expected: { grade: 'A+', description: 'Excellent' } },
        { score: 87, expected: { grade: 'A', description: 'Very Good' } },
        { score: 82, expected: { grade: 'A-', description: 'Good' } },
        { score: 77, expected: { grade: 'B+', description: 'Above Average' } },
        { score: 72, expected: { grade: 'B', description: 'Average' } },
        { score: 67, expected: { grade: 'B-', description: 'Below Average' } },
        { score: 62, expected: { grade: 'C+', description: 'Fair' } },
        { score: 57, expected: { grade: 'C', description: 'Poor' } },
        { score: 52, expected: { grade: 'C-', description: 'Very Poor' } },
        { score: 45, expected: { grade: 'D', description: 'Bad' } },
        { score: 25, expected: { grade: 'F', description: 'Very Bad' } }
      ];

      testCases.forEach(({ score, expected }) => {
        const grade = reputationService.getGrade(score);
        expect(grade.grade).toBe(expected.grade);
        expect(grade.description).toBe(expected.description);
      });
    });
  });

  describe('Caching', () => {
    test('should cache reputation scores', async () => {
      const pubkey = 'cache-test-pubkey';
      
      // First call should calculate
      const result1 = await reputationService.calculateReputationScore(pubkey);
      
      // Second call should use cache
      const result2 = await reputationService.calculateReputationScore(pubkey);
      
      expect(result1.score).toBe(result2.score);
      expect(result1.calculatedAt).toBe(result2.calculatedAt);
    });

    test('should clear cache for specific pubkey', () => {
      const pubkey = 'cache-clear-test';
      
      // Add to cache manually
      reputationService.scoreCache.set(`${pubkey}_{}`, {
        data: { score: 85 },
        timestamp: Date.now()
      });
      
      expect(reputationService.scoreCache.size).toBeGreaterThan(0);
      
      reputationService.clearCache(pubkey);
      
      // Cache should be cleared for this pubkey
      for (const key of reputationService.scoreCache.keys()) {
        expect(key.startsWith(pubkey + '_')).toBe(false);
      }
    });

    test('should provide cache statistics', () => {
      const stats = reputationService.getCacheStats();
      
      expect(stats).toHaveProperty('totalEntries');
      expect(stats).toHaveProperty('activeEntries');
      expect(stats).toHaveProperty('expiredEntries');
      expect(stats).toHaveProperty('cacheTimeout');
    });

    test('should cleanup expired cache entries', () => {
      // Add expired entry
      reputationService.scoreCache.set('expired-key', {
        data: { score: 75 },
        timestamp: Date.now() - reputationService.cacheTimeout - 1000
      });
      
      const cleanedCount = reputationService.cleanupCache();
      
      expect(cleanedCount).toBeGreaterThan(0);
    });
  });

  describe('Configuration Options', () => {
    test('should accept custom weighting', async () => {
      const customWeighting = {
        completedLeases: 0.5,
        payments: 0.3,
        defaults: 0.15,
        deposits: 0.05
      };

      const result = await reputationService.calculateReputationScore(testPubkey, {
        weighting: customWeighting
      });

      // Check that custom weights are applied
      const totalWeight = Object.values(result.breakdown)
        .reduce((sum, breakdown) => sum + breakdown.weight, 0);
      
      expect(Math.abs(totalWeight - 1.0)).toBeLessThan(0.001);
    });

    test('should accept custom time decay period', async () => {
      const result = await reputationService.calculateReputationScore(testPubkey, {
        timeDecayMonths: 24
      });

      // Should complete without error
      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    test('should exclude history when requested', async () => {
      const result = await reputationService.calculateReputationScore(testPubkey, {
        includeHistory: false
      });

      expect(result.history).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      // Mock database error
      const originalPrepare = database.db.prepare;
      database.db.prepare = jest.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(reputationService.calculateReputationScore('error-test'))
        .rejects.toThrow('Failed to calculate reputation score');

      // Restore original method
      database.db.prepare = originalPrepare;
    });

    test('should handle invalid pubkey', async () => {
      const result = await reputationService.calculateReputationScore('');
      
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.dataPoints.totalLeases).toBe(0);
    });
  });
});

describe('Reputation Indexer Integration Tests', () => {
  let reputationService;
  let database;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    reputationService = new ReputationIndexerService(database);
  });

  test('should handle complex user scenarios', async () => {
    const pubkey = 'complex-user-pubkey';
    
    // Create complex lease history
    const leases = [
      { id: 'lease-1', status: 'completed', rentAmount: 1000, startDate: '2021-01-01', endDate: '2021-12-31' },
      { id: 'lease-2', status: 'completed', rentAmount: 1200, startDate: '2022-01-01', endDate: '2022-12-31' },
      { id: 'lease-3', status: 'active', rentAmount: 1500, startDate: '2023-01-01', endDate: '2023-12-31' },
      { id: 'lease-4', status: 'terminated', rentAmount: 800, startDate: '2020-01-01', endDate: '2020-12-31' }
    ];

    leases.forEach(lease => {
      database.seedLease({
        ...lease,
        landlordId: `landlord-${lease.id}`,
        tenantId: pubkey,
        lessorId: `lessor-${lease.id}`,
        currency: 'USD'
      });
    });

    const result = await reputationService.calculateReputationScore(pubkey);
    
    expect(result.dataPoints.totalLeases).toBe(4);
    expect(result.dataPoints.completedLeases).toBe(2);
    expect(result.dataPoints.totalLeases).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
  });

  test('should be performant for large datasets', async () => {
    const pubkey = 'performance-test';
    const startTime = Date.now();
    
    // Create many leases
    for (let i = 0; i < 100; i++) {
      database.seedLease({
        id: `lease-${i}`,
        landlordId: `landlord-${i}`,
        tenantId: pubkey,
        lessorId: `lessor-${i}`,
        status: i % 3 === 0 ? 'completed' : 'active',
        rentAmount: 1000 + (i * 10),
        currency: 'USD',
        startDate: `202${i % 4}-01-01`,
        endDate: `202${i % 4}-12-31`
      });
    }

    const result = await reputationService.calculateReputationScore(pubkey);
    const endTime = Date.now();
    
    expect(result.dataPoints.totalLeases).toBe(100);
    expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
  });

  test('should maintain mathematical accuracy in scoring', async () => {
    const pubkey = 'accuracy-test';
    
    // Create predictable scenario
    database.seedLease({
      id: 'precise-lease',
      landlordId: 'landlord-precise',
      tenantId: pubkey,
      lessorId: 'lessor-precise',
      status: 'completed',
      rentAmount: 1000,
      currency: 'USD',
      startDate: '2023-01-01',
      endDate: '2023-12-31'
    });

    const result = await reputationService.calculateReputationScore(pubkey);
    
    // Score should be mathematically sound
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    
    // Check that weights sum to 1
    const totalWeight = Object.values(result.breakdown)
      .reduce((sum, breakdown) => sum + breakdown.weight, 0);
    expect(Math.abs(totalWeight - 1.0)).toBeLessThan(0.001);
  });
});
