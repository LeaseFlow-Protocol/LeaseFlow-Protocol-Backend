const AvailabilityService = require('../services/availabilityService');

describe('AvailabilityService', () => {
  let service;
  let mockAlgodClient;

  beforeEach(() => {
    service = new AvailabilityService();

    mockAlgodClient = {
      getApplicationByID: jest.fn()
    };

    service.algodClient = mockAlgodClient;
  });

  describe('calculateExpiryDate', () => {
    it('should calculate expiry date correctly', () => {
      const leaseData = {
        start_timestamp: 1672531200, // 2023-01-01 00:00:00 UTC
        duration_blocks: 1000
      };

      const expiryDate = service.calculateExpiryDate(leaseData);

      const expectedSeconds = 1000 * 4.5; // 1000 blocks * 4.5 seconds per block
      const expectedTimestamp = 1672531200 + expectedSeconds;
      const expectedDate = new Date(expectedTimestamp * 1000);

      expect(expiryDate).toBeInstanceOf(Date);
      expect(expiryDate.getTime()).toBeCloseTo(expectedDate.getTime(), -3); // Allow millisecond variance
    });

    it('should return null if start_timestamp is missing', () => {
      const leaseData = {
        duration_blocks: 1000
      };

      const expiryDate = service.calculateExpiryDate(leaseData);
      expect(expiryDate).toBeNull();
    });

    it('should return null if duration_blocks is missing', () => {
      const leaseData = {
        start_timestamp: 1672531200
      };

      const expiryDate = service.calculateExpiryDate(leaseData);
      expect(expiryDate).toBeNull();
    });
  });

  describe('isLeaseExpired', () => {
    it('should return true if renter_balance is <= 0', () => {
      const leaseData = { renter_balance: 0 };
      const expiryDate = new Date(Date.now() + 86400000); // Tomorrow

      expect(service.isLeaseExpired(leaseData, expiryDate)).toBe(true);
    });

    it('should return true if expiryDate is in the past', () => {
      const leaseData = { renter_balance: 100 };
      const expiryDate = new Date(Date.now() - 86400000); // Yesterday

      expect(service.isLeaseExpired(leaseData, expiryDate)).toBe(true);
    });

    it('should return false if lease is active', () => {
      const leaseData = { renter_balance: 100 };
      const expiryDate = new Date(Date.now() + 86400000); // Tomorrow

      expect(service.isLeaseExpired(leaseData, expiryDate)).toBe(false);
    });

    it('should handle null expiryDate', () => {
      const leaseData = { renter_balance: 50 };

      expect(service.isLeaseExpired(leaseData, null)).toBe(false);
    });
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
        tenant: 'alice',
        start_timestamp: 1672531200,
        duration_blocks: 500
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

  describe('extractLeaseDataForAsset', () => {
    it('should extract lease data for specific asset', () => {
      const globalState = [
        {
          key: Buffer.from('lease_123').toString('base64'),
          value: { type: 1, uint: 100 }
        },
        {
          key: Buffer.from('lease_456').toString('base64'),
          value: { type: 1, uint: 50 }
        },
        {
          key: Buffer.from('other_data').toString('base64'),
          value: { type: 1, uint: 25 }
        }
      ];

      const result = service.extractLeaseDataForAsset(globalState, '123');
      expect(result).toEqual({ renter_balance: 100 });
    });

    it('should return null if asset not found', () => {
      const globalState = [
        {
          key: Buffer.from('lease_123').toString('base64'),
          value: { type: 1, uint: 100 }
        }
      ];

      const result = service.extractLeaseDataForAsset(globalState, '999');
      expect(result).toBeNull();
    });
  });

  describe('extractAllAssetIds', () => {
    it('should extract all asset IDs from global state', () => {
      const globalState = [
        {
          key: Buffer.from('lease_123').toString('base64'),
          value: { type: 1, uint: 100 }
        },
        {
          key: Buffer.from('lease_456').toString('base64'),
          value: { type: 1, uint: 50 }
        },
        {
          key: Buffer.from('other_data').toString('base64'),
          value: { type: 1, uint: 25 }
        }
      ];

      const assetIds = service.extractAllAssetIds(globalState);
      expect(assetIds).toEqual(expect.arrayContaining(['123', '456']));
      expect(assetIds).toHaveLength(2);
    });

    it('should return empty array if no leases found', () => {
      const globalState = [
        {
          key: Buffer.from('other_data').toString('base64'),
          value: { type: 1, uint: 25 }
        }
      ];

      const assetIds = service.extractAllAssetIds(globalState);
      expect(assetIds).toEqual([]);
    });
  });

  describe('getAssetAvailability', () => {
    it('should return availability for available asset', async () => {
      const mockAppInfo = {
        params: {
          'global-state': [
            {
              key: Buffer.from('lease_123').toString('base64'),
              value: { type: 1, uint: 0 }
            }
          ]
        }
      };

      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockResolvedValue(mockAppInfo)
      });

      const availability = await service.getAssetAvailability('123');

      expect(availability).toEqual({
        assetId: '123',
        status: 'available',
        currentLease: null,
        expiryDate: null,
        nextAvailableDate: expect.any(String)
      });
    });

    it('should return availability for leased asset', async () => {
      const leaseData = {
        renter_balance: 100,
        tenant: 'alice',
        start_timestamp: Math.floor(Date.now() / 1000), // Current timestamp
        duration_blocks: 1000
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

      const availability = await service.getAssetAvailability('123');

      expect(availability).toEqual({
        assetId: '123',
        status: 'leased',
        currentLease: {
          tenant: 'alice',
          startDate: new Date(leaseData.start_timestamp * 1000).toISOString(),
          renterBalance: 100
        },
        expiryDate: expect.any(String),
        nextAvailableDate: expect.any(String)
      });
    });

    it('should return available status for non-existent asset', async () => {
      const mockAppInfo = {
        params: {
          'global-state': []
        }
      };

      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockResolvedValue(mockAppInfo)
      });

      const availability = await service.getAssetAvailability('999');

      expect(availability).toEqual({
        assetId: '999',
        status: 'available',
        currentLease: null,
        expiryDate: null,
        nextAvailableDate: null
      });
    });

    it('should handle API errors gracefully', async () => {
      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockImplementation(() => {
          throw new Error('API Error');
        })
      });

      await expect(service.getAssetAvailability('123')).rejects.toThrow('API Error');
    });
  });

  describe('getMultipleAssetAvailability', () => {
    it('should return availability for multiple assets', async () => {
      const mockAppInfo = {
        params: {
          'global-state': [
            {
              key: Buffer.from('lease_123').toString('base64'),
              value: { type: 1, uint: 0 }
            },
            {
              key: Buffer.from('lease_456').toString('base64'),
              value: { type: 1, uint: 100 }
            }
          ]
        }
      };

      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockResolvedValue(mockAppInfo)
      });

      const availability = await service.getMultipleAssetAvailability(['123', '456']);

      expect(availability).toHaveLength(2);
      expect(availability[0].assetId).toBe('123');
      expect(availability[1].assetId).toBe('456');
    });

    it('should handle errors for individual assets', async () => {
      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockImplementation(() => {
          throw new Error('API Error');
        })
      });

      const availability = await service.getMultipleAssetAvailability(['123', '456']);

      expect(availability).toHaveLength(2);
      expect(availability[0]).toEqual({
        assetId: '123',
        status: 'error',
        error: 'API Error'
      });
      expect(availability[1]).toEqual({
        assetId: '456',
        status: 'error',
        error: 'API Error'
      });
    });
  });
});
