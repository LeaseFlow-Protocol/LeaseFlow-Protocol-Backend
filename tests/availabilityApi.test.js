const request = require('supertest');
const app = require('../index');
const AvailabilityService = require('../services/availabilityService');

describe('Availability API', () => {
  let availabilityService;

  beforeEach(() => {
    availabilityService = new AvailabilityService();
    availabilityService.algodClient = {
      getApplicationByID: jest.fn()
    };
  });

  describe('GET /api/asset/:id/availability', () => {
    it('should return 400 for invalid asset ID', async () => {
      const response = await request(app)
        .get('/api/asset/invalid/availability')
        .expect(400);

      expect(response.body).toEqual({
        error: 'Invalid asset ID. Must be a number.',
        code: 'INVALID_ASSET_ID'
      });
    });

    it('should return 404 for missing asset ID', async () => {
      const response = await request(app)
        .get('/api/asset//availability')
        .expect(404);

      expect(response.status).toBe(404);
    });

    it('should return availability for valid asset ID', async () => {
      jest.spyOn(availabilityService, 'getAssetAvailability').mockResolvedValue({
        assetId: '123',
        status: 'available',
        currentLease: null,
        expiryDate: null,
        nextAvailableDate: new Date().toISOString()
      });

      // Mock the global availabilityService in the app
      global.availabilityService = availabilityService;

      const response = await request(app)
        .get('/api/asset/123/availability')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          assetId: '123',
          status: 'available',
          currentLease: null,
          expiryDate: null,
          nextAvailableDate: expect.any(String)
        }
      });

      expect(availabilityService.getAssetAvailability).toHaveBeenCalledWith('123');
    });

    it('should return 500 when service throws error', async () => {
      jest.spyOn(availabilityService, 'getAssetAvailability').mockRejectedValue(
        new Error('Service error')
      );

      global.availabilityService = availabilityService;

      const response = await request(app)
        .get('/api/asset/123/availability')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to fetch asset availability',
        code: 'FETCH_ERROR',
        details: 'Service error'
      });
    });

    it('should hide error details in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      jest.spyOn(availabilityService, 'getAssetAvailability').mockRejectedValue(
        new Error('Service error')
      );

      global.availabilityService = availabilityService;

      const response = await request(app)
        .get('/api/asset/123/availability')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to fetch asset availability',
        code: 'FETCH_ERROR'
      });
      expect(response.body.details).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('GET /api/assets/availability', () => {
    it('should return availability for all assets when no IDs provided', async () => {
      const mockAvailability = [
        { assetId: '123', status: 'available' },
        { assetId: '456', status: 'leased' }
      ];

      jest.spyOn(availabilityService, 'getAllAssetsAvailability').mockResolvedValue(mockAvailability);

      global.availabilityService = availabilityService;

      const response = await request(app)
        .get('/api/assets/availability')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockAvailability
      });

      expect(availabilityService.getAllAssetsAvailability).toHaveBeenCalled();
    });

    it('should return availability for specific asset IDs', async () => {
      const mockAvailability = [
        { assetId: '123', status: 'available' },
        { assetId: '456', status: 'leased' }
      ];

      jest.spyOn(availabilityService, 'getMultipleAssetAvailability').mockResolvedValue(mockAvailability);

      global.availabilityService = availabilityService;

      const response = await request(app)
        .get('/api/assets/availability?ids=123,456')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockAvailability
      });

      expect(availabilityService.getMultipleAssetAvailability).toHaveBeenCalledWith(['123', '456']);
    });

    it('should return 400 for invalid asset IDs', async () => {
      const response = await request(app)
        .get('/api/assets/availability?ids=invalid,abc')
        .expect(400);

      expect(response.body).toEqual({
        error: 'No valid asset IDs provided',
        code: 'INVALID_ASSET_IDS'
      });
    });

    it('should handle mixed valid and invalid asset IDs', async () => {
      const mockAvailability = [
        { assetId: '123', status: 'available' }
      ];

      jest.spyOn(availabilityService, 'getMultipleAssetAvailability').mockResolvedValue(mockAvailability);

      global.availabilityService = availabilityService;

      const response = await request(app)
        .get('/api/assets/availability?ids=123,invalid,456')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockAvailability
      });

      expect(availabilityService.getMultipleAssetAvailability).toHaveBeenCalledWith(['123', '456']);
    });

    it('should return 500 when service throws error', async () => {
      jest.spyOn(availabilityService, 'getAllAssetsAvailability').mockRejectedValue(
        new Error('Service error')
      );

      global.availabilityService = availabilityService;

      const response = await request(app)
        .get('/api/assets/availability')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to fetch assets availability',
        code: 'FETCH_ERROR',
        details: 'Service error'
      });
    });
  });
});
