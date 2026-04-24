const express = require('express');
const router = express.Router();

/**
 * @openapi
 * /api/v1/rwa/assets/{assetId}/ownership:
 *   get:
 *     summary: Get asset ownership information
 *     description: Returns ownership data for a specific RWA asset with cache fallback to blockchain
 *     tags: [RWA Assets]
 *     parameters:
 *       - in: path
 *         name: assetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Asset identifier
 *       - in: query
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: RWA contract address
 *       - in: query
 *         name: forceRefresh
 *         required: false
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Force refresh from blockchain
 *     responses:
 *       200:
 *         description: Asset ownership data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     assetId:
 *                       type: string
 *                     owner_pubkey:
 *                       type: string
 *                     is_frozen:
 *                       type: boolean
 *                     is_burned:
 *                       type: boolean
 *                     source:
 *                       type: string
 *                     isAvailable:
 *                       type: boolean
 *                     queryTime:
 *                       type: string
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
router.get('/:assetId/ownership', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.getAssetOwnership(req, res);
});

/**
 * @openapi
 * /api/v1/rwa/assets/ownership/batch:
 *   post:
 *     summary: Get multiple asset ownerships
 *     description: Returns ownership data for multiple RWA assets in a single request
 *     tags: [RWA Assets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assets:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     assetId:
 *                       type: string
 *                     contractAddress:
 *                       type: string
 *               forceRefresh:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Multiple asset ownerships retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                     totalRequested:
 *                       type: integer
 *                     totalReturned:
 *                       type: integer
 *                     queryTime:
 *                       type: string
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
router.post('/ownership/batch', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.getMultipleAssetOwnership(req, res);
});

/**
 * @openapi
 * /api/v1/rwa/assets/{assetId}/availability:
 *   get:
 *     summary: Check asset availability for leasing
 *     description: Returns whether an asset is available for leasing and the reason if not
 *     tags: [RWA Assets]
 *     parameters:
 *       - in: path
 *         name: assetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Asset identifier
 *       - in: query
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: RWA contract address
 *     responses:
 *       200:
 *         description: Asset availability checked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     assetId:
 *                       type: string
 *                     contractAddress:
 *                       type: string
 *                     isAvailable:
 *                       type: boolean
 *                     reason:
 *                       type: string
 *                     queryTime:
 *                       type: string
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
router.get('/:assetId/availability', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.checkAssetAvailability(req, res);
});

/**
 * @openapi
 * /api/v1/rwa/assets/{assetId}/refresh:
 *   post:
 *     summary: Refresh asset cache
 *     description: Forces a refresh of the asset cache by querying the blockchain directly
 *     tags: [RWA Assets]
 *     parameters:
 *       - in: path
 *         name: assetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Asset identifier
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contractAddress:
 *                 type: string
 *                 description: RWA contract address
 *     responses:
 *       200:
 *         description: Asset cache refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     assetId:
 *                       type: string
 *                     contractAddress:
 *                       type: string
 *                     ownership:
 *                       type: object
 *                     refreshedAt:
 *                       type: string
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
router.post('/:assetId/refresh', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.refreshAssetCache(req, res);
});

/**
 * @openapi
 * /api/v1/rwa/assets/available:
 *   get:
 *     summary: Get available assets for marketplace
 *     description: Returns a list of assets available for leasing with optional filtering
 *     tags: [RWA Assets]
 *     parameters:
 *       - in: query
 *         name: assetType
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by asset type (real_estate, vehicle, etc.)
 *       - in: query
 *         name: rwaStandard
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by RWA standard
 *       - in: query
 *         name: excludeStale
 *         required: false
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Exclude stale cache data
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of results
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *     responses:
 *       200:
 *         description: Available assets retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     assets:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         pageSize:
 *                           type: integer
 *                         totalAssets:
 *                           type: integer
 *                         totalPages:
 *                           type: integer
 *                         hasNextPage:
 *                           type: boolean
 *                         hasPreviousPage:
 *                           type: boolean
 *                     filters:
 *                       type: object
 *                     queryTime:
 *                       type: string
 *       500:
 *         description: Internal server error
 */
router.get('/available', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.getAvailableAssets(req, res);
});

/**
 * @openapi
 * /api/v1/rwa/owners/{ownerPubkey}/assets:
 *   get:
 *     summary: Get assets owned by a public key
 *     description: Returns all assets owned by a specific Stellar public key
 *     tags: [RWA Assets]
 *     parameters:
 *       - in: path
 *         name: ownerPubkey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key
 *       - in: query
 *         name: assetType
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by asset type
 *       - in: query
 *         name: rwaStandard
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by RWA standard
 *       - in: query
 *         name: excludeStale
 *         required: false
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Exclude stale cache data
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of results
 *     responses:
 *       200:
 *         description: Assets by owner retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     ownerPubkey:
 *                       type: string
 *                     assets:
 *                       type: array
 *                       items:
 *                         type: object
 *                     totalAssets:
 *                       type: integer
 *                     queryTime:
 *                       type: string
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
router.get('/owners/:ownerPubkey/assets', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.getAssetsByOwner(req, res);
});

/**
 * @openapi
 * /api/v1/rwa/cache/stats:
 *   get:
 *     summary: Get cache statistics
 *     description: Returns performance metrics and cache statistics
 *     tags: [RWA Cache]
 *     responses:
 *       200:
 *         description: Cache statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     cache:
 *                       type: object
 *                       properties:
 *                         total_cached:
 *                           type: integer
 *                         frozen_count:
 *                           type: integer
 *                         burned_count:
 *                           type: integer
 *                         ownerless_count:
 *                           type: integer
 *                         freshness_ratio:
 *                           type: number
 *                         metrics:
 *                           type: object
 *                     sync:
 *                       type: object
 *                     queue:
 *                       type: object
 *                     timestamp:
 *                       type: string
 *       500:
 *         description: Internal server error
 */
router.get('/cache/stats', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.getCacheStats(req, res);
});

/**
 * @openapi
 * /api/v1/rwa/cache/sync:
 *   post:
 *     summary: Trigger cache synchronization
 *     description: Triggers a manual synchronization of the RWA cache with blockchain data
 *     tags: [RWA Cache]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high]
 *                 default: normal
 *               force:
 *                 type: boolean
 *                 default: false
 *                 description: Force full cache refresh
 *     responses:
 *       202:
 *         description: Cache synchronization triggered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobId:
 *                       type: string
 *                     priority:
 *                       type: string
 *                     force:
 *                       type: boolean
 *                     statusUrl:
 *                       type: string
 *       500:
 *         description: Internal server error
 */
router.post('/cache/sync', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.triggerCacheSync(req, res);
});

/**
 * @openapi
 * /api/v1/rwa/cache/sync/status:
 *   get:
 *     summary: Get cache synchronization status
 *     description: Returns the status of cache synchronization jobs
 *     tags: [RWA Cache]
 *     parameters:
 *       - in: query
 *         name: jobId
 *         required: false
 *         schema:
 *           type: string
 *         description: Specific job ID to check
 *     responses:
 *       200:
 *         description: Sync status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     sync:
 *                       type: object
 *                     queue:
 *                       type: object
 *                     jobId:
 *                       type: string
 *                     jobStatus:
 *                       type: object
 *                     timestamp:
 *                       type: string
 *       500:
 *         description: Internal server error
 */
router.get('/cache/sync/status', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.getCacheSyncStatus(req, res);
});

/**
 * @openapi
 * /api/v1/rwa/contracts:
 *   get:
 *     summary: Get RWA contracts
 *     description: Returns a list of monitored RWA contracts
 *     tags: [RWA Contracts]
 *     parameters:
 *       - in: query
 *         name: network
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by network (testnet, public)
 *       - in: query
 *         name: isActive
 *         required: false
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Filter by active status
 *       - in: query
 *         name: rwaStandard
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by RWA standard
 *     responses:
 *       200:
 *         description: RWA contracts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     contracts:
 *                       type: array
 *                       items:
 *                         type: object
 *                     totalContracts:
 *                       type: integer
 *       500:
 *         description: Internal server error
 */
router.get('/contracts', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.getRwaContracts(req, res);
});

/**
 * @openapi
 * /api/v1/rwa/contracts:
 *   post:
 *     summary: Add RWA contract for monitoring
 *     description: Adds a new RWA contract to the monitoring system
 *     tags: [RWA Contracts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contractAddress
 *               - contractName
 *               - rwaStandard
 *               - assetType
 *             properties:
 *               contractAddress:
 *                 type: string
 *                 description: Stellar contract address
 *               contractName:
 *                 type: string
 *                 description: Human-readable contract name
 *               rwaStandard:
 *                 type: string
 *                 description: RWA standard (stellar-asset, tokenized-realty, vehicle-registry)
 *               assetType:
 *                 type: string
 *                 description: Asset type (real_estate, vehicle, etc.)
 *               network:
 *                 type: string
 *                 default: testnet
 *                 description: Network (testnet, public)
 *               isActive:
 *                 type: boolean
 *                 default: true
 *                 description: Whether contract is active
 *               monitoringEnabled:
 *                 type: boolean
 *                 default: true
 *                 description: Whether monitoring is enabled
 *     responses:
 *       201:
 *         description: RWA contract added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     contract:
 *                       type: object
 *                     addedAt:
 *                       type: string
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
router.post('/contracts', (req, res) => {
  const controller = req.app.locals.rwaAssetController;
  return controller.addRwaContract(req, res);
});

module.exports = router;
