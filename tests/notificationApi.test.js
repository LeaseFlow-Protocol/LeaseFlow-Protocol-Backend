const request = require('supertest');
const app = require('../index');
const NotificationScheduler = require('../services/notificationScheduler');

describe('Notification API', () => {
  let notificationScheduler;

  beforeEach(() => {
    notificationScheduler = new NotificationScheduler();
    notificationScheduler.isRunning = false;
    app.locals.notificationScheduler = notificationScheduler;
  });

  describe('GET /api/notifications/status', () => {
    it('should return notification scheduler status', async () => {
      jest.spyOn(notificationScheduler, 'getSchedulerStatus').mockReturnValue({
        isRunning: false,
        activeTasks: [],
        configuration: {
          notificationThresholdHours: 1,
          checkIntervalMinutes: 15
        }
      });

      const response = await request(app)
        .get('/api/notifications/status')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          isRunning: false,
          activeTasks: [],
          configuration: {
            notificationThresholdHours: 1,
            checkIntervalMinutes: 15
          }
        }
      });
    });

    it('should handle status check errors', async () => {
      jest.spyOn(notificationScheduler, 'getSchedulerStatus').mockImplementation(() => {
        throw new Error('Status error');
      });

      const response = await request(app)
        .get('/api/notifications/status')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to fetch notification status',
        code: 'STATUS_ERROR',
        details: 'Status error'
      });
    });
  });

  describe('POST /api/notifications/start', () => {
    it('should start notification scheduler successfully', async () => {
      jest.spyOn(notificationScheduler, 'start').mockImplementation(() => {
        notificationScheduler.isRunning = true;
      });
      jest.spyOn(notificationScheduler, 'getSchedulerStatus').mockReturnValue({
        isRunning: true,
        activeTasks: ['leaseMonitoring']
      });

      const response = await request(app)
        .post('/api/notifications/start')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Notification scheduler started successfully',
        status: {
          isRunning: true,
          activeTasks: ['leaseMonitoring']
        }
      });
    });

    it('should return error if already running', async () => {
      notificationScheduler.isRunning = true;

      const response = await request(app)
        .post('/api/notifications/start')
        .expect(400);

      expect(response.body).toEqual({
        error: 'Notification scheduler is already running',
        code: 'ALREADY_RUNNING'
      });
    });

    it('should handle start errors', async () => {
      jest.spyOn(notificationScheduler, 'start').mockImplementation(() => {
        throw new Error('Start failed');
      });

      const response = await request(app)
        .post('/api/notifications/start')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to start notification scheduler',
        code: 'START_ERROR',
        details: 'Start failed'
      });
    });
  });

  describe('POST /api/notifications/stop', () => {
    it('should stop notification scheduler successfully', async () => {
      notificationScheduler.isRunning = true;
      jest.spyOn(notificationScheduler, 'stop').mockImplementation(() => {
        notificationScheduler.isRunning = false;
      });
      jest.spyOn(notificationScheduler, 'getSchedulerStatus').mockReturnValue({
        isRunning: false,
        activeTasks: []
      });

      const response = await request(app)
        .post('/api/notifications/stop')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Notification scheduler stopped successfully',
        status: {
          isRunning: false,
          activeTasks: []
        }
      });
    });

    it('should return error if not running', async () => {
      notificationScheduler.isRunning = false;

      const response = await request(app)
        .post('/api/notifications/stop')
        .expect(400);

      expect(response.body).toEqual({
        error: 'Notification scheduler is not running',
        code: 'NOT_RUNNING'
      });
    });

    it('should handle stop errors', async () => {
      jest.spyOn(notificationScheduler, 'stop').mockImplementation(() => {
        throw new Error('Stop failed');
      });

      const response = await request(app)
        .post('/api/notifications/stop')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to stop notification scheduler',
        code: 'STOP_ERROR',
        details: 'Stop failed'
      });
    });
  });

  describe('POST /api/notifications/check', () => {
    it('should run manual check successfully', async () => {
      const mockResult = {
        totalLeases: 5,
        endingSoon: 2,
        notifications: [
          { assetId: '123', success: true },
          { assetId: '456', success: true }
        ]
      };

      jest.spyOn(notificationScheduler, 'runManualCheck').mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/notifications/check')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Manual lease monitoring check completed',
        data: mockResult
      });
    });

    it('should handle manual check errors', async () => {
      jest.spyOn(notificationScheduler, 'runManualCheck').mockRejectedValue(
        new Error('Manual check failed')
      );

      const response = await request(app)
        .post('/api/notifications/check')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to run manual notification check',
        code: 'MANUAL_CHECK_ERROR',
        details: 'Manual check failed'
      });
    });
  });

  describe('GET /api/notifications/lease/:assetId', () => {
    it('should return lease status for valid asset ID', async () => {
      const mockStatus = {
        assetId: '123',
        renter_balance: 100,
        timeRemaining: { hours: 1, minutes: 30, expired: false },
        endingSoon: true,
        notificationSent: false
      };

      jest.spyOn(notificationScheduler, 'getLeaseStatus').mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/api/notifications/lease/123')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockStatus
      });

      expect(notificationScheduler.getLeaseStatus).toHaveBeenCalledWith('123');
    });

    it('should return 400 for invalid asset ID', async () => {
      const response = await request(app)
        .get('/api/notifications/lease/invalid')
        .expect(400);

      expect(response.body).toEqual({
        error: 'Invalid asset ID. Must be a number.',
        code: 'INVALID_ASSET_ID'
      });
    });

    it('should handle lease status errors', async () => {
      jest.spyOn(notificationScheduler, 'getLeaseStatus').mockRejectedValue(
        new Error('Lease status failed')
      );

      const response = await request(app)
        .get('/api/notifications/lease/123')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to fetch lease status',
        code: 'LEASE_STATUS_ERROR',
        details: 'Lease status failed'
      });
    });
  });

  describe('POST /api/notifications/clear-cache', () => {
    it('should clear notification cache successfully', async () => {
      jest.spyOn(notificationScheduler, 'clearNotificationCache').mockImplementation(() => {
        // Mock implementation
      });

      const response = await request(app)
        .post('/api/notifications/clear-cache')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Notification cache cleared successfully'
      });

      expect(notificationScheduler.clearNotificationCache).toHaveBeenCalled();
    });

    it('should handle cache clear errors', async () => {
      jest.spyOn(notificationScheduler, 'clearNotificationCache').mockImplementation(() => {
        throw new Error('Cache clear failed');
      });

      const response = await request(app)
        .post('/api/notifications/clear-cache')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Failed to clear notification cache',
        code: 'CLEAR_CACHE_ERROR',
        details: 'Cache clear failed'
      });
    });
  });

  describe('Root endpoint with notification status', () => {
    it('should include notification status in root response', async () => {
      notificationScheduler.isRunning = true;

      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body.services).toEqual({
        availability: 'active',
        notifications: 'active'
      });
    });

    it('should show notifications as inactive when not running', async () => {
      notificationScheduler.isRunning = false;

      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body.services).toEqual({
        availability: 'active',
        notifications: 'inactive'
      });
    });
  });
});
