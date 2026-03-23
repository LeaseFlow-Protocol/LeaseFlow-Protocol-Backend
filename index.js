const express = require('express');
const cors = require('cors');
const AvailabilityService = require('./services/availabilityService');
const NotificationScheduler = require('./services/notificationScheduler');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Initialize services
const availabilityService = new AvailabilityService();
const notificationScheduler = new NotificationScheduler();

app.get('/', (req, res) => {
  res.json({
    project: 'LeaseFlow Protocol',
    status: 'Active',
    contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4',
    services: {
      availability: 'active',
      notifications: notificationScheduler.isRunning ? 'active' : 'inactive'
    }
  });
});

<<<<<<< Updated upstream
if (require.main === module) {
  app.listen(port, () => {
    console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
=======
// Availability endpoints
app.get('/api/asset/:id/availability', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        error: 'Invalid asset ID. Must be a number.',
        code: 'INVALID_ASSET_ID'
      });
    }

    const availability = await availabilityService.getAssetAvailability(id);

    res.json({
      success: true,
      data: availability
    });

  } catch (error) {
    console.error(`Error fetching availability for asset ${req.params.id}:`, error);

    res.status(500).json({
      error: 'Failed to fetch asset availability',
      code: 'FETCH_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/assets/availability', async (req, res) => {
  try {
    const { ids } = req.query;

    if (ids) {
      const assetIds = ids.split(',').map(id => id.trim()).filter(id => id && !isNaN(id));

      if (assetIds.length === 0) {
        return res.status(400).json({
          error: 'No valid asset IDs provided',
          code: 'INVALID_ASSET_IDS'
        });
      }

      const availability = await availabilityService.getMultipleAssetAvailability(assetIds);

      res.json({
        success: true,
        data: availability
      });
    } else {
      const availability = await availabilityService.getAllAssetsAvailability();

      res.json({
        success: true,
        data: availability
      });
    }

  } catch (error) {
    console.error('Error fetching assets availability:', error);

    res.status(500).json({
      error: 'Failed to fetch assets availability',
      code: 'FETCH_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Notification endpoints
app.get('/api/notifications/status', (req, res) => {
  try {
    const status = notificationScheduler.getSchedulerStatus();

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error fetching notification status:', error);

    res.status(500).json({
      error: 'Failed to fetch notification status',
      code: 'STATUS_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/notifications/start', async (req, res) => {
  try {
    if (notificationScheduler.isRunning) {
      return res.status(400).json({
        error: 'Notification scheduler is already running',
        code: 'ALREADY_RUNNING'
      });
    }

    notificationScheduler.start();

    res.json({
      success: true,
      message: 'Notification scheduler started successfully',
      status: notificationScheduler.getSchedulerStatus()
    });
  } catch (error) {
    console.error('Error starting notification scheduler:', error);

    res.status(500).json({
      error: 'Failed to start notification scheduler',
      code: 'START_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/notifications/stop', (req, res) => {
  try {
    if (!notificationScheduler.isRunning) {
      return res.status(400).json({
        error: 'Notification scheduler is not running',
        code: 'NOT_RUNNING'
      });
    }

    notificationScheduler.stop();

    res.json({
      success: true,
      message: 'Notification scheduler stopped successfully',
      status: notificationScheduler.getSchedulerStatus()
    });
  } catch (error) {
    console.error('Error stopping notification scheduler:', error);

    res.status(500).json({
      error: 'Failed to stop notification scheduler',
      code: 'STOP_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/notifications/check', async (req, res) => {
  try {
    const result = await notificationScheduler.runManualCheck();

    res.json({
      success: true,
      message: 'Manual lease monitoring check completed',
      data: result
    });
  } catch (error) {
    console.error('Error running manual notification check:', error);

    res.status(500).json({
      error: 'Failed to run manual notification check',
      code: 'MANUAL_CHECK_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/notifications/lease/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params;

    if (!assetId || isNaN(assetId)) {
      return res.status(400).json({
        error: 'Invalid asset ID. Must be a number.',
        code: 'INVALID_ASSET_ID'
      });
    }

    const status = await notificationScheduler.getLeaseStatus(assetId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error(`Error fetching lease status for asset ${req.params.assetId}:`, error);

    res.status(500).json({
      error: 'Failed to fetch lease status',
      code: 'LEASE_STATUS_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/notifications/clear-cache', (req, res) => {
  try {
    notificationScheduler.clearNotificationCache();

    res.json({
      success: true,
      message: 'Notification cache cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing notification cache:', error);

    res.status(500).json({
      error: 'Failed to clear notification cache',
      code: 'CLEAR_CACHE_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

if (require.main === module) {
  // Initialize and start services
  Promise.all([
    availabilityService.initialize(),
    notificationScheduler.initialize()
  ]).then(() => {
    app.locals.availabilityService = availabilityService;
    app.locals.notificationScheduler = notificationScheduler;

    // Start notification scheduler
    notificationScheduler.start();

    app.listen(port, () => {
      console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
      console.log('Availability Service started');
      console.log('Notification Scheduler started');
    });
  }).catch(error => {
    console.error('Failed to initialize services:', error);
    process.exit(1);
>>>>>>> Stashed changes
  });
}

module.exports = app;
