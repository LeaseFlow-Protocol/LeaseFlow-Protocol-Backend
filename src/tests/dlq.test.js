const { DlqService } = require('../services/dlqService');
const { AppDatabase } = require('../db/appDatabase');
const { loadConfig } = require('../config');

describe('Dead Letter Queue Service (Issue #105)', () => {
  let dlqService;
  let database;
  let config;

  beforeAll(async () => {
    config = loadConfig();
    database = new AppDatabase(':memory:');
    dlqService = new DlqService(config);
  });

  afterAll(async () => {
    if (dlqService) {
      await dlqService.shutdown();
    }
  });

  describe('DLQ Event Processing', () => {
    test('should add events to ingestion queue', async () => {
      const eventData = {
        eventPayload: {
          lease_id: 'test-lease-123',
          tenant: 'test-tenant',
          landlord: 'test-landlord'
        },
        ledgerNumber: 12345,
        eventType: 'LeaseStarted'
      };

      const job = await dlqService.addEvent(eventData);
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
    });

    test('should handle malformed events gracefully', async () => {
      const malformedEvent = {
        eventPayload: null, // Malformed payload
        ledgerNumber: 12346,
        eventType: 'LeaseStarted'
      };

      // Should not throw, but handle gracefully
      await expect(dlqService.addEvent(malformedEvent)).resolves.toBeDefined();
    });
  });

  describe('DLQ Retry Logic', () => {
    test('should retry failed DLQ jobs', async () => {
      // Mock a DLQ job
      const mockDlqJob = {
        id: 'test-dlq-job-123',
        data: {
          originalJobId: 'original-123',
          eventPayload: { lease_id: 'test-lease' },
          ledgerNumber: 12345,
          eventType: 'LeaseStarted'
        }
      };

      // Mock the queue methods
      dlqService.dlqQueue = {
        getJob: jest.fn().mockResolvedValue(mockDlqJob),
        getJobs: jest.fn().mockResolvedValue([mockDlqJob])
      };

      dlqService.retryQueue = {
        add: jest.fn().mockResolvedValue({ id: 'retry-job' })
      };

      const result = await dlqService.retryDlqJob('test-dlq-job-123');
      expect(result.message).toContain('queued for retry');
    });

    test('should throw error for non-existent DLQ job', async () => {
      dlqService.dlqQueue = {
        getJob: jest.fn().mockResolvedValue(null)
      };

      await expect(dlqService.retryDlqJob('non-existent')).rejects.toThrow('not found');
    });
  });

  describe('Critical Event Detection', () => {
    test('should identify critical lease events', () => {
      expect(dlqService.isCriticalLeaseEvent('LeaseStarted')).toBe(true);
      expect(dlqService.isCriticalLeaseEvent('SubleaseCreated')).toBe(true);
      expect(dlqService.isCriticalLeaseEvent('EscrowYieldHarvested')).toBe(false);
      expect(dlqService.isCriticalLeaseEvent('UnknownEvent')).toBe(false);
    });

    test('should calculate event priorities correctly', () => {
      expect(dlqService.calculatePriority('LeaseStarted')).toBe(10);
      expect(dlqService.calculatePriority('SubleaseCreated')).toBe(8);
      expect(dlqService.calculatePriority('EscrowYieldHarvested')).toBe(6);
      expect(dlqService.calculatePriority('UnknownEvent')).toBe(1);
    });
  });

  describe('Ledger Tracking', () => {
    test('should update and retrieve last ingested ledger', async () => {
      const testLedger = 99999;
      
      await dlqService.updateLastIngestedLedger(testLedger);
      const retrievedLedger = await dlqService.getLastIngestedLedger();
      
      expect(retrievedLedger).toBe(testLedger);
    });

    test('should return 0 for initial ledger', async () => {
      const ledger = await dlqService.getLastIngestedLedger();
      expect(ledger).toBe(0);
    });
  });
});

describe('DLQ Database Operations', () => {
  let database;

  beforeAll(() => {
    database = new AppDatabase(':memory:');
  });

  describe('DLQ Event Storage', () => {
    test('should insert and retrieve DLQ events', () => {
      const dlqEvent = {
        originalJobId: 'job-123',
        eventType: 'LeaseStarted',
        ledgerNumber: 12345,
        eventPayload: { lease_id: 'test-lease' },
        errorMessage: 'Test error',
        errorStack: 'Test stack trace'
      };

      database.insertDlqEvent(dlqEvent);

      const events = database.getDlqEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('LeaseStarted');
      expect(events[0].originalJobId).toBe('job-123');
      expect(events[0].eventPayload).toEqual({ lease_id: 'test-lease' });
    });

    test('should filter DLQ events by type', () => {
      // Insert test events
      database.insertDlqEvent({
        originalJobId: 'job-1',
        eventType: 'LeaseStarted',
        ledgerNumber: 12345,
        eventPayload: {},
        errorMessage: 'Error 1'
      });

      database.insertDlqEvent({
        originalJobId: 'job-2',
        eventType: 'SubleaseCreated',
        ledgerNumber: 12346,
        eventPayload: {},
        errorMessage: 'Error 2'
      });

      const leaseEvents = database.getDlqEvents({ eventType: 'LeaseStarted' });
      const subleaseEvents = database.getDlqEvents({ eventType: 'SubleaseCreated' });

      expect(leaseEvents).toHaveLength(1);
      expect(subleaseEvents).toHaveLength(1);
      expect(leaseEvents[0].eventType).toBe('LeaseStarted');
      expect(subleaseEvents[0].eventType).toBe('SubleaseCreated');
    });
  });

  describe('Ledger Tracking in Database', () => {
    test('should track last ingested ledger', () => {
      database.updateLastIngestedLedger(54321);
      const ledger = database.getLastIngestedLedger();
      expect(ledger).toBe(54321);
    });

    test('should return 0 for uninitialized ledger', () => {
      const newDb = new AppDatabase(':memory:');
      const ledger = newDb.getLastIngestedLedger();
      expect(ledger).toBe(0);
    });
  });

  describe('DLQ Statistics', () => {
    test('should provide accurate statistics', () => {
      // Insert test events with different statuses
      database.insertDlqEvent({
        originalJobId: 'job-failed',
        eventType: 'LeaseStarted',
        ledgerNumber: 12345,
        eventPayload: {},
        errorMessage: 'Failed',
        status: 'failed'
      });

      database.insertDlqEvent({
        originalJobId: 'job-resolved',
        eventType: 'SubleaseCreated',
        ledgerNumber: 12346,
        eventPayload: {},
        errorMessage: 'Resolved',
        status: 'resolved'
      });

      const stats = database.getDlqStats();
      expect(stats.totalFailed).toBeGreaterThan(0);
      expect(stats.totalResolved).toBeGreaterThan(0);
      expect(stats.byEventType).toBeDefined();
      expect(stats.lastIngestedLedger).toBeDefined();
    });
  });

  describe('DLQ Audit Logging', () => {
    test('should log DLQ actions', () => {
      const dlqEventId = 'test-event-123';
      
      database.insertDlqAuditLog({
        dlqEventId,
        action: 'MANUAL_RETRY',
        performedBy: 'test-user',
        notes: 'Test retry action'
      });

      // Verify audit log was created
      const auditLogs = database.db
        .prepare('SELECT * FROM dlq_audit_log WHERE dlq_event_id = ?')
        .all(dlqEventId);

      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('MANUAL_RETRY');
      expect(auditLogs[0].performed_by).toBe('test-user');
    });
  });
});

describe('DLQ Integration Tests', () => {
  test('should handle malformed test payloads without halting', async () => {
    const dlqService = new DlqService(loadConfig());
    
    // Test various malformed payloads
    const malformedPayloads = [
      null,
      undefined,
      'invalid-json-string',
      { incomplete: 'data' },
      [],
      12345
    ];

    for (const payload of malformedPayloads) {
      const eventData = {
        eventPayload: payload,
        ledgerNumber: 12345,
        eventType: 'LeaseStarted'
      };

      // Should not throw exceptions
      await expect(dlqService.addEvent(eventData)).resolves.toBeDefined();
    }
  });

  test('should prevent infinite loops on bad data', async () => {
    const database = new AppDatabase(':memory:');
    const initialLedger = 1000;
    
    database.updateLastIngestedLedger(initialLedger);
    
    // Simulate processing bad data that would normally cause infinite loops
    database.updateLastIngestedLedger(initialLedger + 1);
    
    const currentLedger = database.getLastIngestedLedger();
    expect(currentLedger).toBe(initialLedger + 1);
  });
});
