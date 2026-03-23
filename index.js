const express = require('express');
const cors = require('cors');
const AvailabilityService = require('./services/availabilityService');
const AssetMetadataService = require('./services/assetMetadataService');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Initialize services
const availabilityService = new AvailabilityService();
const assetMetadataService = new AssetMetadataService();

app.get('/', (req, res) => {
  res.json({
    project: 'LeaseFlow Protocol',
    status: 'Active',
    contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4',
    services: {
      availability: 'active',
      metadata: 'active'
    }
  });
});

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

// Asset metadata endpoints
app.get('/api/asset/:id/metadata', async (req, res) => {
  try {
    const { id } = req.params;
    const { refresh } = req.query;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        error: 'Invalid asset ID. Must be a number.',
        code: 'INVALID_ASSET_ID'
      });
    }

    const metadata = await assetMetadataService.getAssetMetadata(id, refresh === 'true');

    if (!metadata) {
      return res.status(404).json({
        error: 'Asset metadata not found',
        code: 'METADATA_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: metadata
    });

  } catch (error) {
    console.error(`Error fetching metadata for asset ${req.params.id}:`, error);

    res.status(500).json({
      error: 'Failed to fetch asset metadata',
      code: 'METADATA_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/assets/metadata', async (req, res) => {
  try {
    const { ids, refresh } = req.query;

    if (ids) {
      const assetIds = ids.split(',').map(id => id.trim()).filter(id => id && !isNaN(id));

      if (assetIds.length === 0) {
        return res.status(400).json({
          error: 'No valid asset IDs provided',
          code: 'INVALID_ASSET_IDS'
        });
      }

      const metadata = await assetMetadataService.getMultipleAssetMetadata(assetIds, refresh === 'true');

      res.json({
        success: true,
        data: metadata
      });
    } else {
      const metadata = await assetMetadataService.getAllAssetMetadata();

      res.json({
        success: true,
        data: metadata
      });
    }

  } catch (error) {
    console.error('Error fetching assets metadata:', error);

    res.status(500).json({
      error: 'Failed to fetch assets metadata',
      code: 'METADATA_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/asset/:id/metadata', async (req, res) => {
  try {
    const { id } = req.params;
    const metadata = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        error: 'Invalid asset ID. Must be a number.',
        code: 'INVALID_ASSET_ID'
      });
    }

    const result = await assetMetadataService.saveAssetMetadata({
      assetId: id,
      ...metadata
    });

    res.status(201).json({
      success: true,
      message: 'Asset metadata saved successfully',
      data: result
    });

  } catch (error) {
    console.error(`Error saving metadata for asset ${req.params.id}:`, error);

    res.status(500).json({
      error: 'Failed to save asset metadata',
      code: 'SAVE_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.put('/api/asset/:id/metadata', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        error: 'Invalid asset ID. Must be a number.',
        code: 'INVALID_ASSET_ID'
      });
    }

    const result = await assetMetadataService.updateAssetMetadata(id, updates);

    res.json({
      success: true,
      message: 'Asset metadata updated successfully',
      data: result
    });

  } catch (error) {
    console.error(`Error updating metadata for asset ${req.params.id}:`, error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Asset not found',
        code: 'ASSET_NOT_FOUND'
      });
    }

    res.status(500).json({
      error: 'Failed to update asset metadata',
      code: 'UPDATE_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.delete('/api/asset/:id/metadata', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        error: 'Invalid asset ID. Must be a number.',
        code: 'INVALID_ASSET_ID'
      });
    }

    const result = await assetMetadataService.deleteAssetMetadata(id);

    if (!result) {
      return res.status(404).json({
        error: 'Asset metadata not found',
        code: 'METADATA_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Asset metadata deleted successfully',
      data: result
    });

  } catch (error) {
    console.error(`Error deleting metadata for asset ${req.params.id}:`, error);

    res.status(500).json({
      error: 'Failed to delete asset metadata',
      code: 'DELETE_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/assets/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        error: 'Search query is required',
        code: 'MISSING_QUERY'
      });
    }

    const results = await assetMetadataService.searchAssets(q.trim());

    res.json({
      success: true,
      data: results,
      query: q.trim(),
      count: results.length
    });

  } catch (error) {
    console.error(`Error searching assets with query "${req.query.q}":`, error);

    res.status(500).json({
      error: 'Failed to search assets',
      code: 'SEARCH_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/asset/:id/refresh', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        error: 'Invalid asset ID. Must be a number.',
        code: 'INVALID_ASSET_ID'
      });
    }

    const result = await assetMetadataService.refreshAssetCache(id);

    res.json({
      success: true,
      message: 'Asset cache refreshed successfully',
      data: result
    });

  } catch (error) {
    console.error(`Error refreshing cache for asset ${req.params.id}:`, error);

    res.status(500).json({
      error: 'Failed to refresh asset cache',
      code: 'REFRESH_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/metadata/stats', async (req, res) => {
  try {
    const stats = await assetMetadataService.getCacheStatistics();

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error fetching metadata statistics:', error);

    res.status(500).json({
      error: 'Failed to fetch metadata statistics',
      code: 'STATS_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const health = await assetMetadataService.healthCheck();

    res.json({
      success: true,
      data: health
    });

  } catch (error) {
    console.error('Error performing health check:', error);

    res.status(500).json({
      error: 'Failed to perform health check',
      code: 'HEALTH_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

if (require.main === module) {
  // Initialize and start services
  Promise.all([
    availabilityService.initialize(),
    assetMetadataService.initialize()
  ]).then(() => {
    app.locals.availabilityService = availabilityService;
    app.locals.assetMetadataService = assetMetadataService;

    app.listen(port, () => {
      console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
      console.log('Availability Service started');
      console.log('Asset Metadata Service started');
    });
  }).catch(error => {
    console.error('Failed to initialize services:', error);
    process.exit(1);
  });
}

module.exports = app;
