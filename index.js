const express = require('express');
const cors = require('cors');
const AvailabilityService = require('./services/availabilityService');
const AutoReclaimWorker = require('./services/autoReclaimWorker');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    project: 'LeaseFlow Protocol',
    status: 'Active',
    contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4'
  });
});

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

if (require.main === module) {
  const availabilityService = new AvailabilityService();

  availabilityService.initialize().then(() => {
    app.locals.availabilityService = availabilityService;
    app.listen(port, () => {
      console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
      console.log('Availability Service started');
    });
  }).catch(error => {
    console.error('Failed to initialize Availability Service:', error);
app.get('/status', (req, res) => {
  res.json({
    auto_reclaim_worker: 'Active',
    schedule: 'Every 10 minutes',
    last_check: new Date().toISOString()
  });
});

if (require.main === module) {
  const autoReclaimWorker = new AutoReclaimWorker();

  autoReclaimWorker.initialize().then(() => {
    autoReclaimWorker.start();
    app.listen(port, () => {
      console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
      console.log('Auto-Reclaim Worker started');
    });
  }).catch(error => {
    console.error('Failed to initialize Auto-Reclaim Worker:', error);
    process.exit(1);
  });
}

const availabilityService = new AvailabilityService();
module.exports = app;
