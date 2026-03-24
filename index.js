require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { checkAndInitializeLease, getLeases, saveLeases } = require('./worker');
const leaseRoutes = require('./src/routes/leaseRoutes');
const ownerRoutes = require('./src/routes/ownerRoutes');

const app = express();
const port = process.env.PORT || 3000;

const cors = require('cors');
const express = require('express');

const { loadConfig } = require('./src/config');
const { AppDatabase } = require('./src/db/appDatabase');
const { ActorAuthService } = require('./src/services/actorAuthService');
const { NotificationService } = require('./src/services/notificationService');
const { SorobanLeaseService } = require('./src/services/sorobanLeaseService');
const { LeaseRenewalService } = require('./src/services/leaseRenewalService');
const { LeaseRenewalJob, startLeaseRenewalScheduler } = require('./src/jobs/leaseRenewalJob');

/**
 * Create the Express app with injectable services for testing.
 *
 * @param {object} [dependencies={}] Optional dependency overrides.
 * @returns {import('express').Express}
 */
function createApp(dependencies = {}) {
  const app = express();
  const config = dependencies.config || loadConfig();
  const database = dependencies.database || new AppDatabase(config.database.filename);
  const actorAuthService = dependencies.actorAuthService || new ActorAuthService(config);
  const notificationService = dependencies.notificationService || new NotificationService(database);
  const sorobanLeaseService =
    dependencies.sorobanLeaseService || new SorobanLeaseService(config);
  const leaseRenewalService =
    dependencies.leaseRenewalService ||
    new LeaseRenewalService(database, notificationService, sorobanLeaseService, config);

  app.use(cors());
  app.use(express.json());
const express = require('express');
const cors = require('cors');
const { randomUUID } = require('crypto');

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const app = express();
const port = 3000;
const creditScoreAggregator = new TenantCreditScoreAggregator();
const listings = [];
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon.stellar.org';

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/leases', leaseRoutes);
app.use('/api/owners', ownerRoutes);

app.get('/', (req, res) => {
  res.json({ 
    project: 'LeaseFlow Protocol Backend', 
    description: 'Secure Lease Indexer and Storage Facilitator',
    status: 'Operational',
    version: '1.0.0',
    contract_id: process.env.CONTRACT_ID || 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4',
    endpoints: {
      upload_lease: 'POST /api/leases/upload',
      view_lease_handshake: 'GET /api/leases/:leaseCID/handshake',
      top_owners: 'GET /api/owners/top'
    }
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
const {
  createConditionProofService,
  ConditionProofError,
} = require('./services/conditionProofService');
const {
  createFileConditionProofStore,
} = require('./services/conditionProofStore');

const port = process.env.PORT || 3000;

function createApp({ conditionProofService } = {}) {
  const app = express();
  const proofService =
    conditionProofService ||
    createConditionProofService({
      store: createFileConditionProofStore(),
    });

  app.use(cors());
  app.use(express.json({ limit: '15mb' }));

  app.get('/', (req, res) => {
    res.json({
      project: 'LeaseFlow Protocol',
      status: 'Active',
      contract_id: config.contracts.defaultContractId,
    });
  });

  app.get('/renewal-proposals/:proposalId', requireActorAuth(actorAuthService), (req, res) => {
    try {
      const proposal = leaseRenewalService.getProposalForActor({
        proposalId: req.params.proposalId,
        actorId: req.actor.id,
        actorRole: req.actor.role,
      });

      return res.status(200).json({ success: true, data: proposal });
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.post(
    '/renewal-proposals/:proposalId/accept',
    requireActorAuth(actorAuthService),
    (req, res) => {
      try {
        const result = leaseRenewalService.acceptProposal({
          proposalId: req.params.proposalId,
          actorId: req.actor.id,
          actorRole: req.actor.role,
        });

        return res.status(200).json({ success: true, data: result.proposal, warning: result.warning });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  app.post(
    '/renewal-proposals/:proposalId/reject',
    requireActorAuth(actorAuthService),
    (req, res) => {
      try {
        const proposal = leaseRenewalService.rejectProposal({
          proposalId: req.params.proposalId,
          actorId: req.actor.id,
          actorRole: req.actor.role,
        });

        return res.status(200).json({ success: true, data: proposal });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  app.use((req, res) => res.status(404).json({ success: false, error: 'Not found' }));

  return app;
}

/**
 * Build authentication middleware for landlords and tenants.
 *
 * @param {ActorAuthService} actorAuthService Auth service.
 * @returns {import('express').RequestHandler}
 */
function requireActorAuth(actorAuthService) {
  return (req, res, next) => {
    const token = extractBearerToken(req);

    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    try {
      req.actor = actorAuthService.verifyToken(token);
      return next();
    } catch (error) {
      return res.status(401).json({ success: false, error: error.message });
    }
  };
}

/**
 * Extract a bearer token from the incoming request.
 *
 * @param {import('express').Request} req Request object.
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim();
}

/**
 * Send a consistent JSON error response.
 *
 * @param {import('express').Response} res Response object.
 * @param {Error & {statusCode?: number}} error Error instance.
 * @returns {import('express').Response}
 */
function handleError(res, error) {
  return res
    .status(error.statusCode || 500)
    .json({ success: false, error: error.message || 'Request failed' });
}

const config = loadConfig();
const app = createApp({ config });
const port = config.port;
      contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4',
    });
  });

  app.post('/leases/:leaseId/condition-proofs', async (req, res) => {
    try {
      const proof = await proofService.createProof({
        leaseId: req.params.leaseId,
        moveInStartedAt: req.body?.move_in_started_at,
        submittedAt: req.body?.submitted_at,
        note: req.body?.note,
        photos: req.body?.photos,
      });

      res.status(201).json(proof);
    } catch (error) {
      if (error instanceof ConditionProofError) {
        return res.status(error.statusCode).json({
          error: error.code,
          message: error.message,
          details: error.details,
        });
      }

      return res.status(500).json({
        error: 'CONDITION_PROOF_CREATE_FAILED',
        message: 'Unable to record the property condition proof.',
      });
    }
  });

  app.get('/leases/:leaseId/condition-proofs', async (req, res) => {
    try {
      const proofs = await proofService.listProofs(req.params.leaseId);
      res.status(200).json({
        lease_id: req.params.leaseId,
        proofs,
      });
    } catch (error) {
      if (error instanceof ConditionProofError) {
        return res.status(error.statusCode).json({
          error: error.code,
          message: error.message,
          details: error.details,
        });
      }

      return res.status(500).json({
        error: 'CONDITION_PROOF_LIST_FAILED',
        message: 'Unable to load the property condition proofs.',
      });
    }
  });

  app.get('/leases/:leaseId/condition-proofs/arbitration-hook', async (req, res) => {
    try {
      const packet = await proofService.getArbitrationPacket(req.params.leaseId);
      res.status(200).json(packet);
    } catch (error) {
      if (error instanceof ConditionProofError) {
        return res.status(error.statusCode).json({
          error: error.code,
          message: error.message,
          details: error.details,
        });
      }

      return res.status(500).json({
        error: 'ARBITRATION_PACKET_BUILD_FAILED',
        message: 'Unable to build the immutable proof of condition packet.',
      });
require('dotenv').config();
const {
  createSecurityDepositLockService,
  requireLockedSecurityDeposit,
} = require('./services/securityDepositLock');

const port = process.env.PORT || 3000;
const AvailabilityService = require('./services/availabilityService');
const AssetMetadataService = require('./services/assetMetadataService');
const AutoReclaimWorker = require('./services/autoReclaimWorker');

const app = express();
const port = 3000;

function createApp({ securityDepositService } = {}) {
  const app = express();
  const depositGatekeeper =
    securityDepositService ?? createSecurityDepositLockService();

  app.use(cors());
  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({
      project: 'LeaseFlow Protocol',
      status: 'Active',
      contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4',
    });
// Initialize services
const availabilityService = new AvailabilityService();
const assetMetadataService = new AssetMetadataService();

function hasPositiveTrustline(balances, assetCode, assetIssuer) {
  return balances.some((balance) => {
    const isMatchingAsset =
      balance.asset_code === assetCode &&
      balance.asset_issuer === assetIssuer &&
      String(balance.asset_type || '').startsWith('credit_');

    if (!isMatchingAsset) {
      return false;
    }

    return Number.parseFloat(balance.balance || '0') > 0;
  });
}

async function verifyNftOwnership({ lister, assetCode, assetIssuer }) {
  const response = await fetch(
    `${HORIZON_URL.replace(/\/$/, '')}/accounts/${encodeURIComponent(lister)}`
  );

  if (response.status === 404) {
    return { isOwner: false, reason: 'ACCOUNT_NOT_FOUND' };
  }

  if (!response.ok) {
    throw new Error(`Horizon lookup failed with status ${response.status}`);
  }

  const account = await response.json();
  const balances = Array.isArray(account.balances) ? account.balances : [];

  return {
    isOwner: hasPositiveTrustline(balances, assetCode, assetIssuer),
    reason: 'TRUSTLINE_MISSING_OR_EMPTY',
  };
}

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

app.post('/tenant-credit-score', (req, res) => {
  return app;
}

const app = createApp();

app.post('/listings', async (req, res) => {
  const { title, price, currency } = req.body;
  const highValueThreshold = 10; // XLM/hr

  console.log(`New Listing: ${title} - ${price} ${currency}/hr`);

  // Acceptance Criteria: Post to discord for high-value items
  if (price >= highValueThreshold && currency === 'XLM') {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `🚀 New Listing: **${title}** - **${price} ${currency}/hr**`
          })
        });
        console.log('Discord notification sent.');
      } catch (error) {
        console.error('Error sending Discord notification:', error);
      }
    } else {
      console.warn('DISCORD_WEBHOOK_URL is not defined.');
    }
  }

  res.status(201).json({ 
    message: 'Listing created successfully',
    listing: { title, price, currency }
  });
// Availability endpoints
app.get('/api/asset/:id/availability', async (req, res) => {
  try {
    const { tenantId, metrics = {}, cacheTtlSeconds } = req.body || {};
    const result = creditScoreAggregator.getOrCompute(tenantId, metrics, cacheTtlSeconds);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/tenant-credit-score/:tenantId', (req, res) => {
  const cached = creditScoreAggregator.getCached(req.params.tenantId);
  if (!cached) {
    return res.status(404).json({ error: 'No cached score found for tenant' });
  }
  return res.status(200).json(cached);
});

app.post('/tenant-credit-score/share-token', (req, res) => {
// Error handling
app.use((err, req, res, next) => {
  console.error('[App] Unhandled Error:', err);
  res.status(500).json({ error: 'Internal server error.', details: err.message });
});

app.get('/api/assets/availability', async (req, res) => {
  try {
    const { tenantId, tokenTtlSeconds } = req.body || {};
    const result = creditScoreAggregator.generateShareToken(tenantId, tokenTtlSeconds);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/tenant-credit-score/verify-token', (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      throw new Error('token is required');
    }
    const payload = creditScoreAggregator.verifyShareToken(token);
    res.status(200).json({ valid: true, payload });
  } catch (error) {
    res.status(400).json({ valid: false, error: error.message });
  }
});

app.get('/leases', (req, res) => {
  res.json(getLeases());
});

app.post('/sign-lease', async (req, res) => {
  const { leaseId, role, signature } = req.body;
  const leases = getLeases();
  const lease = leases[leaseId];

  if (!lease) {
    return res.status(404).json({ error: `Lease ${leaseId} not found.` });
  }

  // SIWS Signature verification (Simulation)
  if (!signature) {
    return res.status(400).json({ error: 'Signature required.' });
  }

  if (role === 'LANDLORD') {
    lease.landlord_signed = true;
    lease.landlord_signature = signature;
  } else if (role === 'TENANT') {
    lease.tenant_signed = true;
    lease.tenant_signature = signature;
  } else {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  saveLeases(leases);
  console.log(`[API] Lease ${leaseId} signed by ${role}. Checking coordination...`);
  
  // Call coordination worker
  await checkAndInitializeLease(leaseId);
  
  res.json({ message: `Lease ${leaseId} signed by ${role}.`, state: leases[leaseId] });
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

app.get('/listings', (req, res) => {
  res.json({ listings });
});

app.post('/listings', async (req, res) => {
  const { lister, assetCode, assetIssuer, price, metadata } = req.body || {};

  if (!lister || !assetCode || !assetIssuer || price === undefined || price === null) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['lister', 'assetCode', 'assetIssuer', 'price'],
    });
  }

  try {
    const ownershipCheck = await verifyNftOwnership({ lister, assetCode, assetIssuer });

    if (!ownershipCheck.isOwner) {
      return res.status(403).json({
        error: 'Lister does not own the NFT on-chain',
        reason: ownershipCheck.reason,
      });
    }

    // The repo has no persistent database yet, so this in-memory insert marks the
    // exact point where verified listings would be written once a DB layer exists.
    const listing = {
      id: randomUUID(),
      lister,
      assetCode,
      assetIssuer,
      price,
      metadata: metadata || null,
      createdAt: new Date().toISOString(),
    };

    listings.push(listing);
    return res.status(201).json({ listing });
  } catch (error) {
    return res.status(502).json({
      error: 'Unable to verify ownership against Horizon',
      details: error.message,
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

app.post('/api/images/optimize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { width = 300, height = 300 } = req.query;
    const inputPath = req.file.path;
    const filename = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const outputFilename = `${filename}_${width}x${height}.webp`;
    const optimizedDir = path.join(__dirname, 'uploads', 'optimized');
    
    if (!fs.existsSync(optimizedDir)) {
      fs.mkdirSync(optimizedDir, { recursive: true });
    }

    const outputPath = path.join(optimizedDir, outputFilename);

    await sharp(inputPath)
      .resize(parseInt(width), parseInt(height), { fit: 'cover' })
      .toFormat('webp', { quality: 80 })
      .toFile(outputPath);

    res.json({
      success: true,
      original: req.file.filename,
      optimized: outputFilename,
      path: `/uploads/optimized/${outputFilename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/images/optimize/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads', 'optimized', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.set('Content-Type', 'image/webp');
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
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

  app.post(
    '/move-in/generate-digital-key',
    requireLockedSecurityDeposit({
      action: 'Generate Digital Key',
      service: depositGatekeeper,
    }),
    (req, res) => {
      res.status(200).json({
        action: 'Generate Digital Key',
        allowed: true,
        message:
          'Security deposit verified. Digital key generation is authorized.',
        verification: req.securityDepositVerification,
      });
    },
  );

  app.post(
    '/move-in/release-address',
    requireLockedSecurityDeposit({
      action: 'Release Address',
      service: depositGatekeeper,
    }),
    (req, res) => {
      res.status(200).json({
        action: 'Release Address',
        allowed: true,
        message: 'Security deposit verified. Address release is authorized.',
        verification: req.securityDepositVerification,
      });
    },
  );

  return app;
}

const app = createApp();

if (require.main === module) {
  let scheduler;

  if (config.jobs.renewalJobEnabled) {
    const database = new AppDatabase(config.database.filename);
    const notificationService = new NotificationService(database);
    const sorobanLeaseService = new SorobanLeaseService(config);
    const leaseRenewalService = new LeaseRenewalService(
      database,
      notificationService,
      sorobanLeaseService,
      config,
    );
    scheduler = startLeaseRenewalScheduler(new LeaseRenewalJob(leaseRenewalService), config);
  }

  app.listen(port, () => {
    console.log(`LeaseFlow Backend running at http://localhost:${port}`);
    console.log(`Lease Encryption Service: Active`);
    console.log(`IPFS Storage Service: Initialized (Host: ${process.env.IPFS_HOST || 'ipfs.infura.io'})`);
    console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
    if (scheduler) {
      console.log(`Lease renewal scheduler running every ${config.jobs.intervalMs}ms`);
    }
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

module.exports = {
  app,
  listings,
  resetListings() {
    listings.length = 0;
  },
  verifyNftOwnership,
  hasPositiveTrustline,
};
const availabilityService = new AvailabilityService();
module.exports = app;
module.exports.app = app;
module.exports.createApp = createApp;
