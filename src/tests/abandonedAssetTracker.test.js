const { AppDatabase } = require('../../db/appDatabase');
const { AbandonedAssetTracker } = require('../services/abandonedAssetTracker');
const { NotificationService } = require('../services/notificationService');

describe('AbandonedAssetTracker', () => {
  let database;
  let tracker;
  let notificationService;
  let mockNotificationService;

  beforeEach(() => {
    // Use in-memory database for testing
    database = new AppDatabase(':memory:');
    
    // Mock notification service
    mockNotificationService = {
      sendNotification: jest.fn().mockResolvedValue(true)
    };
    
    notificationService = mockNotificationService;
    tracker = new AbandonedAssetTracker(database, notificationService);
    
    // Initialize the abandonment tracking fields
    database.db.exec(`
      ALTER TABLE leases ADD COLUMN last_interaction_timestamp TEXT;
      ALTER TABLE leases ADD COLUMN abandonment_status TEXT DEFAULT 'active';
      ALTER TABLE leases ADD COLUMN abandonment_alert_sent INTEGER DEFAULT 0;
    `);
  });

  afterEach(() => {
    database.db.close();
  });

  describe('calculatePreciseTimeDifference', () => {
    test('should calculate exact time difference for 30 days', () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const result = tracker.calculatePreciseTimeDifference(thirtyDaysAgo.toISOString());
      
      expect(result.daysSinceInteraction).toBe(30);
      expect(result.remainingDays).toBe(0);
      expect(result.isReadyForSeizure).toBe(true);
    });

    test('should handle leap year calculations correctly', () => {
      // Test with Feb 29, 2024 (leap year)
      const leapDate = new Date('2024-02-29T12:00:00Z');
      const after30Days = new Date('2024-03-30T12:00:00Z');
      
      // Mock current time as 30 days after leap day
      jest.spyOn(Date, 'now').mockReturnValue(after30Days.getTime());
      
      const result = tracker.calculatePreciseTimeDifference(leapDate.toISOString());
      
      expect(result.daysSinceInteraction).toBe(30);
      expect(result.remainingDays).toBe(0);
      expect(result.isReadyForSeizure).toBe(true);
      
      Date.now.mockRestore();
    });

    test('should handle different month lengths correctly', () => {
      // Test from Jan 31 to Mar 1 (should be exactly 30 days in non-leap year)
      const jan31 = new Date('2024-01-31T12:00:00Z');
      const mar1 = new Date('2024-03-01T12:00:00Z');
      
      jest.spyOn(Date, 'now').mockReturnValue(mar1.getTime());
      
      const result = tracker.calculatePreciseTimeDifference(jan31.toISOString());
      
      expect(result.daysSinceInteraction).toBe(30);
      expect(result.remainingDays).toBe(0);
      expect(result.isReadyForSeizure).toBe(true);
      
      Date.now.mockRestore();
    });

    test('should calculate remaining time for partially elapsed period', () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      tenDaysAgo.setHours(tenDaysAgo.getHours() - 6); // 10 days and 6 hours ago
      
      const result = tracker.calculatePreciseTimeDifference(tenDaysAgo.toISOString());
      
      expect(result.daysSinceInteraction).toBe(10);
      expect(result.remainingDays).toBe(19);
      expect(result.remainingHours).toBe(18); // 24 - 6 = 18 hours remaining in current day
      expect(result.isReadyForSeizure).toBe(false);
    });
  });

  describe('getExpiredLeasesForTracking', () => {
    test('should return only expired/terminated leases', () => {
      // Create test leases
      database.db.run(`
        INSERT INTO leases (id, landlord_id, tenant_id, status, rent_amount, currency, start_date, end_date, created_at, updated_at)
        VALUES 
          ('lease1', 'landlord1', 'tenant1', 'expired', 1000, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31'),
          ('lease2', 'landlord1', 'tenant2', 'active', 1500, 'USD', '2024-01-01', '2024-12-31', '2024-01-01', '2024-01-01'),
          ('lease3', 'landlord2', 'tenant3', 'terminated', 2000, 'USD', '2023-06-01', '2023-11-30', '2023-06-01', '2023-11-30')
      `);
      
      const leases = tracker.getExpiredLeasesForTracking();
      
      expect(leases).toHaveLength(2);
      expect(leases.map(l => l.id)).toEqual(['lease1', 'lease3']);
    });

    test('should exclude seized leases', () => {
      database.db.run(`
        INSERT INTO leases (id, landlord_id, tenant_id, status, rent_amount, currency, start_date, end_date, created_at, updated_at, abandonment_status)
        VALUES 
          ('lease1', 'landlord1', 'tenant1', 'expired', 1000, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31', 'seized'),
          ('lease2', 'landlord1', 'tenant2', 'expired', 1500, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31', 'active')
      `);
      
      const leases = tracker.getExpiredLeasesForTracking();
      
      expect(leases).toHaveLength(1);
      expect(leases[0].id).toBe('lease2');
    });
  });

  describe('updateLeasesReadyForSeizure', () => {
    test('should update leases that have been abandoned for 30+ days', () => {
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
      
      database.db.run(`
        INSERT INTO leases (id, landlord_id, tenant_id, status, rent_amount, currency, start_date, end_date, created_at, updated_at, last_interaction_timestamp, abandonment_status)
        VALUES 
          ('lease1', 'landlord1', 'tenant1', 'expired', 1000, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31', ?, 'active'),
          ('lease2', 'landlord1', 'tenant2', 'expired', 1500, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31', ?, 'pending_seizure')
      `, thirtyOneDaysAgo.toISOString(), thirtyOneDaysAgo.toISOString());
      
      const updatedLeases = tracker.updateLeasesReadyForSeizure();
      
      expect(updatedLeases).toContain('lease1');
      expect(updatedLeases).not.toContain('lease2'); // Already pending_seizure
      
      // Verify lease1 was updated
      const lease1 = database.db.prepare('SELECT abandonment_status FROM leases WHERE id = ?').get('lease1');
      expect(lease1.abandonment_status).toBe('pending_seizure');
    });
  });

  describe('sendSeizureAlerts', () => {
    test('should send alerts for leases ready for seizure', async () => {
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
      
      database.db.run(`
        INSERT INTO leases (id, landlord_id, tenant_id, status, rent_amount, currency, start_date, end_date, created_at, updated_at, last_interaction_timestamp, abandonment_status, abandonment_alert_sent)
        VALUES 
          ('lease1', 'landlord1', 'tenant1', 'expired', 1000, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31', ?, 'pending_seizure', 0),
          ('lease2', 'landlord1', 'tenant2', 'expired', 1500, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31', ?, 'pending_seizure', 1)
      `, thirtyOneDaysAgo.toISOString(), thirtyOneDaysAgo.toISOString());
      
      const alertedLeases = await tracker.sendSeizureAlerts();
      
      expect(alertedLeases).toContain('lease1');
      expect(alertedLeases).not.toContain('lease2'); // Alert already sent
      
      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient_id: 'landlord1',
          recipient_role: 'landlord',
          type: 'asset_ready_for_seizure',
          lease_id: 'lease1',
          message: expect.stringContaining('Asset Ready for Seizure')
        })
      );
      
      // Verify alert was marked as sent
      const lease1 = database.db.prepare('SELECT abandonment_alert_sent FROM leases WHERE id = ?').get('lease1');
      expect(lease1.abandonment_alert_sent).toBe(1);
    });
  });

  describe('resetAbandonmentTimer', () => {
    test('should reset abandonment timer on lessee interaction', () => {
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
      
      database.db.run(`
        INSERT INTO leases (id, landlord_id, tenant_id, status, rent_amount, currency, start_date, end_date, created_at, updated_at, last_interaction_timestamp, abandonment_status, abandonment_alert_sent)
        VALUES 
          ('lease1', 'landlord1', 'tenant1', 'expired', 1000, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31', ?, 'pending_seizure', 1)
      `, thirtyOneDaysAgo.toISOString());
      
      const success = tracker.resetAbandonmentTimer('lease1');
      
      expect(success).toBe(true);
      
      // Verify timer was reset
      const lease1 = database.db.prepare(`
        SELECT last_interaction_timestamp, abandonment_status, abandonment_alert_sent 
        FROM leases WHERE id = ?
      `).get('lease1');
      
      expect(lease1.abandonment_status).toBe('active');
      expect(lease1.abandonment_alert_sent).toBe(0);
      expect(new Date(lease1.last_interaction_timestamp)).toBeInstanceOf(Date);
    });

    test('should return false for non-existent lease', () => {
      const success = tracker.resetAbandonmentTimer('nonexistent');
      expect(success).toBe(false);
    });
  });

  describe('getAbandonedAssetsData', () => {
    test('should return formatted abandoned assets data', () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      
      database.db.run(`
        INSERT INTO leases (id, landlord_id, tenant_id, status, rent_amount, currency, start_date, end_date, created_at, updated_at, last_interaction_timestamp, abandonment_status)
        VALUES 
          ('lease1', 'landlord1', 'tenant1', 'expired', 1000, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31', ?, 'active')
      `, tenDaysAgo.toISOString());
      
      const data = tracker.getAbandonedAssetsData();
      
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        lease_id: 'lease1',
        landlord_id: 'landlord1',
        tenant_id: 'tenant1',
        status: 'expired',
        rent_amount: 1000,
        currency: 'USD',
        abandonment_status: 'active',
        countdown: {
          days_since_interaction: expect.any(Number),
          remaining_days: expect.any(Number),
          remaining_hours: expect.any(Number),
          remaining_minutes: expect.any(Number),
          remaining_seconds: expect.any(Number),
          total_seconds_remaining: expect.any(Number),
          is_ready_for_seizure: expect.any(Boolean),
          exact_time_to_seizure: expect.any(String)
        }
      });
    });
  });

  describe('runTrackingProcess', () => {
    test('should run complete tracking process', async () => {
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
      
      database.db.run(`
        INSERT INTO leases (id, landlord_id, tenant_id, status, rent_amount, currency, start_date, end_date, created_at, updated_at, last_interaction_timestamp, abandonment_status, abandonment_alert_sent)
        VALUES 
          ('lease1', 'landlord1', 'tenant1', 'expired', 1000, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31', ?, 'active', 0)
      `, thirtyOneDaysAgo.toISOString());
      
      const results = await tracker.runTrackingProcess();
      
      expect(results).toMatchObject({
        timestamp: expect.any(String),
        leases_updated_for_seizure: expect.arrayContaining(['lease1']),
        seizure_alerts_sent: expect.arrayContaining(['lease1']),
        total_abandoned_assets_tracked: expect.any(Number),
        assets_ready_for_seizure: expect.any(Number),
        assets_pending_seizure: expect.any(Number)
      });
    });
  });
});

describe('AbandonedAssetTracker Integration Tests', () => {
  let database;
  let tracker;
  let notificationService;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    
    // Initialize the abandonment tracking fields
    database.db.exec(`
      ALTER TABLE leases ADD COLUMN last_interaction_timestamp TEXT;
      ALTER TABLE leases ADD COLUMN abandonment_status TEXT DEFAULT 'active';
      ALTER TABLE leases ADD COLUMN abandonment_alert_sent INTEGER DEFAULT 0;
    `);
    
    notificationService = new NotificationService(database);
    tracker = new AbandonedAssetTracker(database, notificationService);
  });

  afterEach(() => {
    database.db.close();
  });

  test('should handle complete abandonment lifecycle', async () => {
    // Create an expired lease
    const leaseId = 'integration-lease';
    const landlordId = 'integration-landlord';
    const tenantId = 'integration-tenant';
    
    database.db.run(`
      INSERT INTO leases (id, landlord_id, tenant_id, status, rent_amount, currency, start_date, end_date, created_at, updated_at)
      VALUES (?, ?, ?, 'expired', 1000, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31')
    `, leaseId, landlordId, tenantId);
    
    // Simulate 31 days ago interaction
    const thirtyOneDaysAgo = new Date();
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
    
    database.db.run(`
      UPDATE leases SET last_interaction_timestamp = ? WHERE id = ?
    `, thirtyOneDaysAgo.toISOString(), leaseId);
    
    // Run tracking process
    const results = await tracker.runTrackingProcess();
    
    // Verify lease is marked for seizure
    expect(results.leases_updated_for_seizure).toContain(leaseId);
    expect(results.seizure_alerts_sent).toContain(leaseId);
    
    // Simulate lessee interaction
    const resetSuccess = tracker.resetAbandonmentTimer(leaseId);
    expect(resetSuccess).toBe(true);
    
    // Verify timer was reset
    const lease = database.db.prepare(`
      SELECT abandonment_status, abandonment_alert_sent, last_interaction_timestamp 
      FROM leases WHERE id = ?
    `).get(leaseId);
    
    expect(lease.abandonment_status).toBe('active');
    expect(lease.abandonment_alert_sent).toBe(0);
    expect(new Date(lease.last_interaction_timestamp).getTime()).toBeGreaterThan(thirtyOneDaysAgo.getTime());
  });

  test('should handle edge case of exactly 30 days', async () => {
    const leaseId = 'exact-30-days-lease';
    
    database.db.run(`
      INSERT INTO leases (id, landlord_id, tenant_id, status, rent_amount, currency, start_date, end_date, created_at, updated_at)
      VALUES (?, 'landlord1', 'tenant1', 'expired', 1000, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31')
    `, leaseId);
    
    // Set exactly 30 days ago
    const exactlyThirtyDaysAgo = new Date();
    exactlyThirtyDaysAgo.setDate(exactlyThirtyDaysAgo.getDate() - 30);
    exactlyThirtyDaysAgo.setHours(exactlyThirtyDaysAgo.getHours(), exactlyThirtyDaysAgo.getMinutes(), exactlyThirtyDaysAgo.getSeconds(), 0);
    
    database.db.run(`
      UPDATE leases SET last_interaction_timestamp = ? WHERE id = ?
    `, exactlyThirtyDaysAgo.toISOString(), leaseId);
    
    const timeData = tracker.calculatePreciseTimeDifference(exactlyThirtyDaysAgo.toISOString());
    
    // Should be exactly at seizure threshold
    expect(timeData.isReadyForSeizure).toBe(true);
    expect(timeData.remainingDays).toBe(0);
  });
});
