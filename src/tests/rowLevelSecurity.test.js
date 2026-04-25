const { RowLevelSecurityService } = require('../services/rowLevelSecurityService');
const { AppDatabase } = require('../db/appDatabase');

describe('Row-Level Security Service (Issue #103)', () => {
  let rlsService;
  let database;
  let testLessor1;
  let testLessor2;

  beforeAll(async () => {
    database = new AppDatabase(':memory:');
    rlsService = new RowLevelSecurityService(database);
    
    testLessor1 = 'lessor-abc-123';
    testLessor2 = 'lessor-xyz-789';
    
    await rlsService.initialize();
  });

  describe('RLS Context Management', () => {
    test('should set lessor context', () => {
      expect(() => rlsService.setLessorContext(testLessor1)).not.toThrow();
      expect(rlsService.currentLessorId).toBe(testLessor1);
    });

    test('should clear lessor context', () => {
      rlsService.setLessorContext(testLessor1);
      rlsService.clearLessorContext();
      expect(rlsService.currentLessorId).toBeNull();
    });

    test('should throw error for invalid lessor ID', () => {
      expect(() => rlsService.setLessorContext(null)).toThrow('Lessor ID is required');
      expect(() => rlsService.setLessorContext('')).toThrow('Lessor ID is required');
    });
  });

  describe('Cross-Tenant Data Isolation', () => {
    test('should prevent cross-tenant data access', async () => {
      // Create test leases for different lessors
      database.seedLease({
        id: 'lease-1',
        landlordId: 'landlord-1',
        tenantId: 'tenant-1',
        lessorId: testLessor1,
        status: 'active',
        rentAmount: 1000,
        currency: 'USD',
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      });

      database.seedLease({
        id: 'lease-2',
        landlordId: 'landlord-2',
        tenantId: 'tenant-2',
        lessorId: testLessor2,
        status: 'active',
        rentAmount: 1500,
        currency: 'USD',
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      });

      // Test isolation
      const isolation = await rlsService.verifyCrossTenantIsolation(testLessor1, testLessor2);
      expect(isolation.isolated).toBe(true);
      expect(isolation.attemptedAccess).toBe(0);
    });

    test('should allow access to own data', async () => {
      // Set context to lessor 1
      rlsService.setLessorContext(testLessor1);
      
      // Should be able to access own leases
      const leases = rlsService.getLeasesForCurrentLessor();
      expect(leases.length).toBeGreaterThan(0);
      
      // All returned leases should belong to current lessor
      leases.forEach(lease => {
        expect(lease.lessorId).toBe(testLessor1);
      });
    });
  });

  describe('RLS-Protected Operations', () => {
    test('should create lease with automatic lessor assignment', () => {
      const leaseData = {
        id: 'lease-new',
        landlordId: 'landlord-new',
        tenantId: 'tenant-new',
        status: 'pending',
        rentAmount: 2000,
        currency: 'USD',
        startDate: '2024-02-01',
        endDate: '2025-01-31'
      };

      expect(() => {
        rlsService.createLeaseWithRls(leaseData, testLessor1);
      }).not.toThrow();

      const createdLease = database.getLeaseById('lease-new');
      expect(createdLease.lessorId).toBe(testLessor1);
    });

    test('should update own lease successfully', () => {
      rlsService.setLessorContext(testLessor1);
      
      const updatedLease = rlsService.updateLeaseWithRls('lease-1', {
        status: 'updated',
        rentAmount: 1100
      }, testLessor1);

      expect(updatedLease.status).toBe('updated');
      expect(updatedLease.rentAmount).toBe(1100);
    });

    test('should prevent updating other lessor\'s lease', () => {
      rlsService.setLessorContext(testLessor1);
      
      expect(() => {
        rlsService.updateLeaseWithRls('lease-2', {
          status: 'hacked'
        }, testLessor1);
      }).toThrow('not found or access denied');
    });

    test('should delete own lease successfully', () => {
      rlsService.setLessorContext(testLessor1);
      
      expect(() => {
        rlsService.deleteLeaseWithRls('lease-1', testLessor1);
      }).not.toThrow();
    });

    test('should prevent deleting other lessor\'s lease', () => {
      rlsService.setLessorContext(testLessor1);
      
      expect(() => {
        rlsService.deleteLeaseWithRls('lease-2', testLessor1);
      }).toThrow('not found or access denied');
    });
  });

  describe('RLS Context Wrapper', () => {
    test('should execute operations within lessor context', () => {
      const result = rlsService.withLessorContext(testLessor1, () => {
        return rlsService.currentLessorId;
      });
      
      expect(result).toBe(testLessor1);
      expect(rlsService.currentLessorId).toBeNull(); // Should be cleared after
    });

    test('should restore original context after operation', () => {
      rlsService.setLessorContext(testLessor1);
      
      rlsService.withLessorContext(testLessor2, () => {
        expect(rlsService.currentLessorId).toBe(testLessor2);
      });
      
      expect(rlsService.currentLessorId).toBe(testLessor1);
    });
  });

  describe('Security Audit', () => {
    test('should perform security audit', async () => {
      const audit = await rlsService.performSecurityAudit();
      
      expect(audit.timestamp).toBeDefined();
      expect(audit.rlsEnabled).toBe(true);
      expect(audit.checks).toBeInstanceOf(Array);
      expect(audit.checks.length).toBeGreaterThan(0);
      
      // Check that all critical tables have lessor_id column
      const lessorIdChecks = audit.checks.filter(check => 
        check.check.includes('lessor_id_column')
      );
      
      expect(lessorIdChecks.length).toBeGreaterThan(0);
      lessorIdChecks.forEach(check => {
        expect(check.passed).toBe(true);
      });
    });
  });

  describe('RLS Statistics', () => {
    test('should provide RLS statistics', () => {
      rlsService.setLessorContext(testLessor1);
      
      const stats = rlsService.getRlsStats();
      
      expect(stats.enabled).toBe(true);
      expect(stats.currentLessorId).toBe(testLessor1);
      expect(stats.protectedTables).toContain('leases');
      expect(stats.protectedTables).toContain('renewal_proposals');
      expect(stats.protectedTables).toContain('rent_payments');
    });
  });

  describe('Integration Tests', () => {
    test('should handle complex multi-tenant scenarios', async () => {
      // Create multiple leases for different lessors
      const lessors = [testLessor1, testLessor2, 'lessor-3'];
      const leaseIds = [];
      
      lessors.forEach((lessorId, index) => {
        const leaseId = `lease-multi-${index}`;
        leaseIds.push(leaseId);
        
        database.seedLease({
          id: leaseId,
          landlordId: `landlord-${index}`,
          tenantId: `tenant-${index}`,
          lessorId: lessorId,
          status: 'active',
          rentAmount: 1000 + (index * 500),
          currency: 'USD',
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        });
      });

      // Each lessor should only see their own leases
      for (const lessorId of lessors) {
        rlsService.setLessorContext(lessorId);
        const leases = rlsService.getLeasesForCurrentLessor();
        
        expect(leases.length).toBe(1);
        expect(leases[0].lessorId).toBe(lessorId);
      }
    });

    test('should prevent data leakage through SELECT * queries', async () => {
      // Set context to lessor 1
      rlsService.setLessorContext(testLessor1);
      
      // Even SELECT * should be filtered by RLS
      const allLeases = database.db
        .prepare('SELECT * FROM leases')
        .all();
      
      // Should only return leases for current lessor
      allLeases.forEach(lease => {
        expect(lease.lessorId).toBe(testLessor1);
      });
    });

    test('should ensure SOC2 compliance requirements are met', async () => {
      const audit = await rlsService.performSecurityAudit();
      
      // Check for critical compliance requirements
      const criticalChecks = audit.checks.filter(check => 
        check.check.includes('lessor_id_column')
      );
      
      // All critical checks should pass
      const failedChecks = criticalChecks.filter(check => !check.passed);
      expect(failedChecks.length).toBe(0);
      
      // RLS should be enabled
      expect(audit.rlsEnabled).toBe(true);
    });
  });
});

describe('RLS Error Handling', () => {
  let rlsService;
  let database;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    rlsService = new RowLevelSecurityService(database);
  });

  test('should handle database errors gracefully', () => {
    expect(() => {
      rlsService.setLessorContext('test-lessor');
    }).not.toThrow();
  });

  test('should provide meaningful error messages', () => {
    expect(() => {
      rlsService.setLessorContext('');
    }).toThrow('Lessor ID is required');
  });

  test('should handle operations without context', () => {
    expect(() => {
      rlsService.getLeasesForCurrentLessor();
    }).toThrow('No lessor context set');
  });
});
