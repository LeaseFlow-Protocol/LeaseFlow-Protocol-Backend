const LeaseMonitoringService = require('../services/leaseMonitoringService');

describe('LeaseMonitoringService', () => {
  let service;
  let mockAlgodClient;
  let mockNotificationService;

  beforeEach(() => {
    service = new LeaseMonitoringService();
    
    mockAlgodClient = {
      getApplicationByID: jest.fn()
    };
    
    mockNotificationService = {
      sendLeaseEndingSoonNotification: jest.fn().mockResolvedValue([
        { type: 'email', success: true },
        { type: 'sms', success: true }
      ])
    };
    
    service.algodClient = mockAlgodClient;
    service.notificationService = mockNotificationService;
  });

  describe('parseLeaseData', () => {
    it('should parse uint values correctly', () => {
      const value = { type: 1, uint: 50 };
      const result = service.parseLeaseData(value);
      expect(result).toEqual({ renter_balance: 50 });
    });

    it('should parse byte values correctly', () => {
      const leaseData = { 
        renter_balance: 25, 
        renterEmail: 'test@example.com',
        renterPhone: '+1234567890',
        assetName: 'Premium Car',
        renterAddress: 'X2F7A3N3D5A2B6C8E9F1G4H7J0K3L6M9N2O5P8Q1R4S7T0U3V6W9Y2Z5A8B1C4',
        start_timestamp: Math.floor(Date.now() / 1000) - 3600,
        duration_blocks: 800
      };
      const value = { type: 2, bytes: Buffer.from(JSON.stringify(leaseData)).toString('base64') };
      const result = service.parseLeaseData(value);
      expect(result).toEqual(leaseData);
    });

    it('should handle invalid byte values', () => {
      const value = { type: 2, bytes: Buffer.from('invalid-json').toString('base64') };
      const result = service.parseLeaseData(value);
      expect(result).toEqual({ renter_balance: 0 });
    });

    it('should handle unknown types', () => {
      const value = { type: 3, bytes: 'some-data' };
      const result = service.parseLeaseData(value);
      expect(result).toEqual({ renter_balance: 0 });
    });
  });

  describe('extractAllLeases', () => {
    it('should extract all leases from global state', () => {
      const leaseData1 = { renter_balance: 100, assetName: 'Car 1' };
      const leaseData2 = { renter_balance: 50, assetName: 'Car 2' };
      
      const globalState = [
        {
          key: Buffer.from('lease_123').toString('base64'),
          value: { type: 2, bytes: Buffer.from(JSON.stringify(leaseData1)).toString('base64') }
        },
        {
          key: Buffer.from('lease_456').toString('base64'),
          value: { type: 2, bytes: Buffer.from(JSON.stringify(leaseData2)).toString('base64') }
        },
        {
          key: Buffer.from('other_data').toString('base64'),
          value: { type: 1, uint: 25 }
        }
      ];

      const leases = service.extractAllLeases(globalState);
      expect(leases).toHaveLength(2);
      expect(leases[0]).toEqual({ assetId: '123', ...leaseData1 });
      expect(leases[1]).toEqual({ assetId: '456', ...leaseData2 });
    });

    it('should handle leases with missing data', () => {
      const globalState = [
        {
          key: Buffer.from('lease_123').toString('base64'),
          value: { type: 1, uint: 100 }
        }
      ];

      const leases = service.extractAllLeases(globalState);
      expect(leases).toHaveLength(1);
      expect(leases[0].assetId).toBe('123');
      expect(leases[0].assetName).toBe('Asset 123');
    });
  });

  describe('calculateTimeRemaining', () => {
    it('should calculate time remaining correctly', () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const lease = {
        start_timestamp: currentTimestamp - 1800, // 30 minutes ago
        duration_blocks: 400 // 400 blocks = 30 minutes
      };

      const timeRemaining = service.calculateTimeRemaining(lease);
      expect(timeRemaining.hours).toBe(0);
      expect(timeRemaining.minutes).toBeCloseTo(30, -1);
      expect(timeRemaining.expired).toBe(false);
    });

    it('should return expired when lease has ended', () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const lease = {
        start_timestamp: currentTimestamp - 7200, // 2 hours ago
        duration_blocks: 400 // 30 minutes
      };

      const timeRemaining = service.calculateTimeRemaining(lease);
      expect(timeRemaining.hours).toBe(0);
      expect(timeRemaining.minutes).toBe(0);
      expect(timeRemaining.expired).toBe(true);
    });

    it('should return null for incomplete lease data', () => {
      const lease = { start_timestamp: 1234567890 };
      const timeRemaining = service.calculateTimeRemaining(lease);
      expect(timeRemaining).toBeNull();
    });
  });

  describe('isLeaseEndingSoon', () => {
    beforeEach(() => {
      service.processedNotifications.clear();
    });

    it('should identify lease ending within 1 hour', () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const lease = {
        assetId: '123',
        start_timestamp: currentTimestamp - 1800, // 30 minutes ago
        duration_blocks: 400, // 30 minutes total
        renter_balance: 100
      };

      const result = service.isLeaseEndingSoon(lease);
      expect(result).toBe(true);
    });

    it('should not identify lease ending in more than 1 hour', () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const lease = {
        assetId: '123',
        start_timestamp: currentTimestamp - 1800, // 30 minutes ago
        duration_blocks: 1600, // 2 hours total
        renter_balance: 100
      };

      const result = service.isLeaseEndingSoon(lease);
      expect(result).toBe(false);
    });

    it('should not identify lease with zero balance', () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const lease = {
        assetId: '123',
        start_timestamp: currentTimestamp - 1800,
        duration_blocks: 400,
        renter_balance: 0
      };

      const result = service.isLeaseEndingSoon(lease);
      expect(result).toBe(false);
    });

    it('should not identify already processed lease', () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const lease = {
        assetId: '123',
        start_timestamp: currentTimestamp - 1800,
        duration_blocks: 400,
        renter_balance: 100
      };

      // Add to processed notifications
      const notificationKey = `${lease.assetId}_${lease.start_timestamp}_${lease.duration_blocks}`;
      service.processedNotifications.add(notificationKey);

      const result = service.isLeaseEndingSoon(lease);
      expect(result).toBe(false);
    });
  });

  describe('checkLeasesEndingSoon', () => {
    it('should check leases and send notifications', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const leaseData = {
        renter_balance: 100,
        renterEmail: 'test@example.com',
        renterPhone: '+1234567890',
        assetName: 'Premium Car',
        renterAddress: 'X2F7A3N3D5A2B6C8E9F1G4H7J0K3L6M9N2O5P8Q1R4S7T0U3V6W9Y2Z5A8B1C4',
        start_timestamp: currentTimestamp - 1800,
        duration_blocks: 400
      };

      const mockAppInfo = {
        params: {
          'global-state': [
            {
              key: Buffer.from('lease_123').toString('base64'),
              value: { type: 2, bytes: Buffer.from(JSON.stringify(leaseData)).toString('base64') }
            }
          ]
        }
      };

      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockResolvedValue(mockAppInfo)
      });

      const result = await service.checkLeasesEndingSoon();

      expect(result.totalLeases).toBe(1);
      expect(result.endingSoon).toBe(1);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0].success).toBe(true);
      expect(mockNotificationService.sendLeaseEndingSoonNotification).toHaveBeenCalled();
    });

    it('should handle no leases ending soon', async () => {
      const mockAppInfo = {
        params: {
          'global-state': []
        }
      };

      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockResolvedValue(mockAppInfo)
      });

      const result = await service.checkLeasesEndingSoon();

      expect(result.totalLeases).toBe(0);
      expect(result.endingSoon).toBe(0);
      expect(result.notifications).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockRejectedValue(new Error('API Error'))
      });

      await expect(service.checkLeasesEndingSoon()).rejects.toThrow('API Error');
    });
  });

  describe('getLeaseStatus', () => {
    it('should return lease status for specific asset', async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const leaseData = {
        renter_balance: 100,
        start_timestamp: currentTimestamp - 1800,
        duration_blocks: 400
      };

      const mockAppInfo = {
        params: {
          'global-state': [
            {
              key: Buffer.from('lease_123').toString('base64'),
              value: { type: 2, bytes: Buffer.from(JSON.stringify(leaseData)).toString('base64') }
            }
          ]
        }
      };

      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockResolvedValue(mockAppInfo)
      });

      const status = await service.getLeaseStatus('123');

      expect(status.assetId).toBe('123');
      expect(status.renter_balance).toBe(100);
      expect(status.timeRemaining).toBeDefined();
      expect(status.endingSoon).toBeDefined();
      expect(status.notificationSent).toBeDefined();
    });

    it('should return not found for non-existent asset', async () => {
      const mockAppInfo = {
        params: {
          'global-state': []
        }
      };

      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockResolvedValue(mockAppInfo)
      });

      const status = await service.getLeaseStatus('999');

      expect(status.assetId).toBe('999');
      expect(status.status).toBe('not_found');
    });
  });

  describe('getConfiguration', () => {
    it('should return service configuration', () => {
      service.processedNotifications.add('test_key');
      service.notificationService = {
        getConfigurationStatus: jest.fn().mockReturnValue({ email: 'configured', sms: 'configured' })
      };

      const config = service.getConfiguration();

      expect(config.contractId).toBe('CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4');
      expect(config.notificationThresholdHours).toBe(1);
      expect(config.checkIntervalMinutes).toBe(15);
      expect(config.processedNotificationsCount).toBe(1);
      expect(config.notificationService.getConfigurationStatus).toHaveBeenCalled();
    });
  });
});
