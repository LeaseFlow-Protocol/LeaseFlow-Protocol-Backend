const SanctionsListScreeningWorker = require('../services/sanctionsListScreeningWorker');
const { AppDatabase } = require('../src/db/appDatabase');

describe('SanctionsListScreeningWorker', () => {
  let sanctionsWorker;
  let database;

  beforeEach(() => {
    // Use in-memory database for testing
    database = new AppDatabase(':memory:');
    sanctionsWorker = new SanctionsListScreeningWorker({
      screeningIntervalCron: '0 0 * * *', // Daily for testing
      cacheTtlMinutes: 60
    });
  });

  afterEach(() => {
    if (sanctionsWorker && sanctionsWorker.isRunning) {
      sanctionsWorker.stop();
    }
  });

  describe('initialization', () => {
    test('should initialize successfully', async () => {
      await expect(sanctionsWorker.initialize()).resolves.not.toThrow();
    });

    test('should load fallback data when APIs fail', async () => {
      const worker = new SanctionsListScreeningWorker({
        ofacApiUrl: 'http://invalid-url.com',
        euSanctionsApiUrl: 'http://invalid-url.com',
        ukSanctionsApiUrl: 'http://invalid-url.com'
      });

      await expect(worker.initialize()).resolves.not.toThrow();
      expect(worker.sanctionsCache.size).toBeGreaterThan(0);
    });
  });

  describe('address screening', () => {
    beforeEach(async () => {
      await sanctionsWorker.initialize();
      // Add some test data to cache
      sanctionsWorker.sanctionsCache.set('GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5', {
        source: 'OFAC',
        name: 'Test Sanctioned Entity',
        type: 'Entity',
        programs: ['SDN'],
        addedAt: new Date().toISOString()
      });
    });

    test('should detect sanctioned address', () => {
      const sanctionedAddress = 'GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5';
      const result = sanctionsWorker.checkAddress(sanctionedAddress);
      
      expect(result).toBeTruthy();
      expect(result.source).toBe('OFAC');
      expect(result.name).toBe('Test Sanctioned Entity');
    });

    test('should return null for non-sanctioned address', () => {
      const cleanAddress = 'GD7YEHQCK2VX7D7Z3J5Y6K8X9M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9';
      const result = sanctionsWorker.checkAddress(cleanAddress);
      
      expect(result).toBeNull();
    });

    test('should handle case-insensitive addresses', () => {
      const sanctionedAddress = 'gd5djqd7kn3yvzq7rjgk7s6j5l4m3n2o1p8q9r6s5t4u3v2w1x0y9z8a7b6c5';
      const result = sanctionsWorker.checkAddress(sanctionedAddress);
      
      expect(result).toBeTruthy();
    });
  });

  describe('lease screening', () => {
    beforeEach(async () => {
      await sanctionsWorker.initialize();
      // Add test data
      sanctionsWorker.sanctionsCache.set('GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5', {
        source: 'OFAC',
        name: 'Test Sanctioned Entity',
        type: 'Entity',
        programs: ['SDN'],
        addedAt: new Date().toISOString()
      });
    });

    test('should detect violations in lease', async () => {
      const lease = {
        id: 'test-lease-1',
        landlordStellarAddress: 'GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5',
        tenantStellarAddress: 'GD7YEHQCK2VX7D7Z3J5Y6K8X9M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9'
      };

      const violations = await sanctionsWorker.screenLease(lease);
      
      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('landlord');
      expect(violations[0].address).toBe(lease.landlordStellarAddress);
      expect(violations[0].source).toBe('OFAC');
    });

    test('should detect multiple violations', async () => {
      const lease = {
        id: 'test-lease-2',
        landlordStellarAddress: 'GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5',
        tenantStellarAddress: 'GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5'
      };

      const violations = await sanctionsWorker.screenLease(lease);
      
      expect(violations).toHaveLength(2);
      expect(violations[0].type).toBe('landlord');
      expect(violations[1].type).toBe('tenant');
    });

    test('should return no violations for clean lease', async () => {
      const lease = {
        id: 'test-lease-3',
        landlordStellarAddress: 'GD7YEHQCK2VX7D7Z3J5Y6K8X9M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9',
        tenantStellarAddress: 'GD8ZIFJ2K3L4M5N6O7P8Q9R0S1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0'
      };

      const violations = await sanctionsWorker.screenLease(lease);
      
      expect(violations).toHaveLength(0);
    });
  });

  describe('manual address screening', () => {
    beforeEach(async () => {
      await sanctionsWorker.initialize();
      sanctionsWorker.sanctionsCache.set('GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5', {
        source: 'OFAC',
        name: 'Test Sanctioned Entity',
        type: 'Entity',
        programs: ['SDN'],
        addedAt: new Date().toISOString()
      });
    });

    test('should return screening result for sanctioned address', async () => {
      const address = 'GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5';
      const result = await sanctionsWorker.screenAddress(address);
      
      expect(result.address).toBe(address);
      expect(result.isSanctioned).toBe(true);
      expect(result.violation).toBeTruthy();
      expect(result.violation.source).toBe('OFAC');
    });

    test('should return screening result for clean address', async () => {
      const address = 'GD7YEHQCK2VX7D7Z3J5Y6K8X9M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9';
      const result = await sanctionsWorker.screenAddress(address);
      
      expect(result.address).toBe(address);
      expect(result.isSanctioned).toBe(false);
      expect(result.violation).toBeNull();
    });
  });

  describe('statistics', () => {
    test('should return worker statistics', () => {
      const stats = sanctionsWorker.getStatistics();
      
      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('isRunning');
      expect(stats).toHaveProperty('sources');
      expect(stats.sources).toContain('OFAC');
      expect(stats.sources).toContain('EU');
      expect(stats.sources).toContain('UK');
    });
  });

  describe('worker lifecycle', () => {
    test('should start and stop worker', async () => {
      await sanctionsWorker.initialize();
      
      expect(sanctionsWorker.isRunning).toBe(false);
      
      sanctionsWorker.start();
      expect(sanctionsWorker.isRunning).toBe(true);
      
      sanctionsWorker.stop();
      expect(sanctionsWorker.isRunning).toBe(false);
    });

    test('should handle multiple start calls gracefully', async () => {
      await sanctionsWorker.initialize();
      
      sanctionsWorker.start();
      const isRunningAfterFirst = sanctionsWorker.isRunning;
      
      sanctionsWorker.start(); // Should not throw
      const isRunningAfterSecond = sanctionsWorker.isRunning;
      
      expect(isRunningAfterFirst).toBe(true);
      expect(isRunningAfterSecond).toBe(true);
    });
  });
});

describe('Sanctions Database Operations', () => {
  let database;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
  });

  describe('sanctions violations', () => {
    test('should log sanctions violation', () => {
      const violationData = {
        leaseId: 'test-lease-1',
        violations: [{
          type: 'landlord',
          address: 'GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5',
          source: 'OFAC',
          name: 'Test Entity',
          programs: ['SDN']
        }],
        detectedAt: new Date().toISOString()
      };

      const result = database.logSanctionsViolation(violationData);
      expect(result).toBe(true);
    });

    test('should retrieve sanctions violations for lease', () => {
      const leaseId = 'test-lease-1';
      
      // First log a violation
      const violationData = {
        leaseId,
        violations: [{
          type: 'tenant',
          address: 'GD7YEHQCK2VX7D7Z3J5Y6K8X9M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9',
          source: 'EU',
          name: 'Test Entity EU',
          programs: ['EU_SANCTIONS']
        }],
        detectedAt: new Date().toISOString()
      };
      
      database.logSanctionsViolation(violationData);
      
      // Retrieve violations
      const violations = database.getSanctionsViolations(leaseId);
      expect(violations).toHaveLength(1);
      expect(violations[0].leaseId).toBe(leaseId);
      expect(violations[0].violationType).toBe('tenant');
      expect(violations[0].sanctionsSource).toBe('EU');
    });
  });

  describe('sanctions cache', () => {
    test('should cache sanctions list entries', () => {
      const sanctionsData = [
        {
          address: 'GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5',
          source: 'OFAC',
          name: 'Test Entity',
          type: 'Entity',
          programs: ['SDN'],
          addedAt: new Date().toISOString()
        }
      ];

      const result = database.cacheSanctionsList(sanctionsData);
      expect(result).toBe(true);
    });

    test('should retrieve cached sanctions entry', () => {
      const address = 'GD5DJQD7KN3YVZQ7RJGK7S6J5L4M3N2O1P8Q9R6S5T4U3V2W1X0Y9Z8A7B6C5';
      
      // First cache an entry
      const sanctionsData = [
        {
          address,
          source: 'OFAC',
          name: 'Test Entity',
          type: 'Entity',
          programs: ['SDN'],
          addedAt: new Date().toISOString()
        }
      ];
      database.cacheSanctionsList(sanctionsData);
      
      // Retrieve cached entry
      const entry = database.getCachedSanctionsEntry(address);
      expect(entry).toBeTruthy();
      expect(entry.address).toBe(address);
      expect(entry.source).toBe('OFAC');
      expect(entry.name).toBe('Test Entity');
    });

    test('should return null for non-cached address', () => {
      const address = 'GD7YEHQCK2VX7D7Z3J5Y6K8X9M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9';
      const entry = database.getCachedSanctionsEntry(address);
      expect(entry).toBeNull();
    });
  });

  describe('lease status updates', () => {
    test('should update lease status for sanctions violation', () => {
      const leaseId = 'test-lease-1';
      
      // First create a lease
      database.seedLease({
        id: leaseId,
        landlord_id: 'landlord-1',
        tenant_id: 'tenant-1',
        status: 'ACTIVE',
        rent_amount: 1000,
        currency: 'USDC',
        start_date: '2024-01-01',
        end_date: '2024-12-31'
      });
      
      // Update status due to sanctions violation
      const result = database.updateLeaseStatus(leaseId, 'FROZEN', {
        reason: 'SANCTIONS_VIOLATION'
      });
      
      expect(result).toBe(true);
    });
  });

  describe('sanctions statistics', () => {
    test('should return sanctions statistics', () => {
      const stats = database.getSanctionsStatistics();
      
      expect(stats).toHaveProperty('totalActiveViolations');
      expect(stats).toHaveProperty('frozenLeases');
      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('violationsBySource');
      expect(Array.isArray(stats.violationsBySource)).toBe(true);
    });
  });
});
