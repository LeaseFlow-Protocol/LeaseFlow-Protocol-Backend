const express = require('express');
const router = express.Router();
const { SmartLockController } = require('../controllers/SmartLockController');
const { SmartLockGatewayService } = require('../services/smartLockGatewayService');
const { AppDatabase } = require('../db/appDatabase');

// Initialize services with database
const database = new AppDatabase(process.env.DATABASE_FILENAME || './data/leaseflow-protocol.sqlite');
const smartLockService = new SmartLockGatewayService(database, {
  augustApiKey: process.env.AUGUST_API_KEY,
  yaleApiKey: process.env.YALE_API_KEY
});
const smartLockController = new SmartLockController(smartLockService);

/**
 * @openapi
 * /api/smartlocks/register:
 *   post:
 *     summary: Register a new smart lock
 *     description: Pair a smart lock device with a property
 *     tags: [Smart Locks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - leaseId
 *               - lockProvider
 *               - deviceId
 *             properties:
 *               leaseId:
 *                 type: string
 *               lockProvider:
 *                 type: string
 *                 enum: [august, yale, schlage, other]
 *               deviceId:
 *                 type: string
 *               deviceName:
 *                 type: string
 *               accessToken:
 *                 type: string
 *               refreshToken:
 *                 type: string
 *     responses:
 *       201:
 *         description: Smart lock registered successfully
 *       400:
 *         description: Missing required fields
 */
router.post('/register', (req, res) => smartLockController.registerSmartLock(req, res));

/**
 * @openapi
 * /api/smartlocks/{lockId}:
 *   get:
 *     summary: Get smart lock details
 *     description: Retrieve smart lock information by ID
 *     tags: [Smart Locks]
 *     parameters:
 *       - in: path
 *         name: lockId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Smart lock details retrieved
 *       404:
 *         description: Smart lock not found
 */
router.get('/:lockId', (req, res) => smartLockController.getSmartLock(req, res));

/**
 * @openapi
 * /api/smartlocks/lease/{leaseId}:
 *   get:
 *     summary: Get smart lock by lease
 *     description: Retrieve the paired smart lock for a specific lease
 *     tags: [Smart Locks]
 *     parameters:
 *       - in: path
 *         name: leaseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Smart lock retrieved
 *       404:
 *         description: No paired lock found
 */
router.get('/lease/:leaseId', (req, res) => smartLockController.getSmartLockByLease(req, res));

/**
 * @openapi
 * /api/smartlocks/keys/issue:
 *   post:
 *     summary: Issue digital key to tenant
 *     description: Generate and issue a digital key to a tenant
 *     tags: [Digital Keys]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - leaseId
 *               - smartLockId
 *               - tenantId
 *               - validUntil
 *             properties:
 *               leaseId:
 *                 type: string
 *               smartLockId:
 *                 type: string
 *               tenantId:
 *                 type: string
 *               tenantAccountId:
 *                 type: string
 *               keyType:
 *                 type: string
 *                 enum: [bluetooth, wifi, cloud]
 *               keyData:
 *                 type: object
 *               validFrom:
 *                 type: string
 *                 format: date-time
 *               validUntil:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Digital key issued successfully
 *       400:
 *         description: Missing required fields or lease not active
 */
router.post('/keys/issue', (req, res) => smartLockController.issueDigitalKey(req, res));

/**
 * @openapi
 * /api/smartlocks/keys/tenant/{tenantId}:
 *   get:
 *     summary: Get active keys for tenant
 *     description: Retrieve all active digital keys for a tenant
 *     tags: [Digital Keys]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Active keys retrieved
 *       404:
 *         description: Tenant not found
 */
router.get('/keys/tenant/:tenantId', (req, res) => smartLockController.getTenantKeys(req, res));

/**
 * @openapi
 * /api/smartlocks/keys/{keyId}/revoke:
 *   post:
 *     summary: Revoke digital key
 *     description: Revoke a previously issued digital key
 *     tags: [Digital Keys]
 *     parameters:
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Key revoked successfully
 *       404:
 *         description: Key not found
 */
router.post('/keys/:keyId/revoke', (req, res) => smartLockController.revokeDigitalKey(req, res));

/**
 * @openapi
 * /api/smartlocks/enforce/{leaseId}:
 *   post:
 *     summary: Enforce lease status
 *     description: Check lease status and revoke keys if lease is breached or expired
 *     tags: [Physical Enforcement]
 *     parameters:
 *       - in: path
 *         name: leaseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Enforcement check completed
 *       404:
 *         description: Lease not found
 */
router.post('/enforce/:leaseId', (req, res) => smartLockController.enforceLease(req, res));

/**
 * @openapi
 * /api/smartlocks/{lockId}/unlock:
 *   post:
 *     summary: Unlock smart lock remotely
 *     description: Send unlock command to smart lock
 *     tags: [Smart Locks]
 *     parameters:
 *       - in: path
 *         name: lockId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               duration:
 *                 type: integer
 *                 description: Duration in milliseconds to keep door unlocked
 *                 default: 5000
 *     responses:
 *       200:
 *         description: Unlock command sent
 *       400:
 *         description: Lock not paired or provider error
 */
router.post('/:lockId/unlock', (req, res) => smartLockController.unlockLock(req, res));

/**
 * @openapi
 * /api/smartlocks/usage/log:
 *   post:
 *     summary: Record key usage
 *     description: Log a key usage event (unlock, lock, access denied, etc.)
 *     tags: [Digital Keys]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - keyId
 *               - action
 *               - result
 *             properties:
 *               keyId:
 *                 type: string
 *               action:
 *                 type: string
 *                 enum: [unlock, lock, access_granted, access_denied]
 *               result:
 *                 type: string
 *                 enum: [success, failure, denied]
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Usage logged successfully
 *       400:
 *         description: Missing required fields
 */
router.post('/usage/log', (req, res) => smartLockController.recordKeyUsage(req, res));

/**
 * @openapi
 * /api/smartlocks/maintenance/revoke-expired:
 *   post:
 *     summary: Revoke all expired keys
 *     description: Background maintenance task to clean up expired keys
 *     tags: [Maintenance]
 *     responses:
 *       200:
 *         description: Expired keys revoked
 */
router.post('/maintenance/revoke-expired', (req, res) => smartLockController.revokeExpiredKeys(req, res));

/**
 * @openapi
 * /api/smartlocks/{lockId}/status:
 *   put:
 *     summary: Update lock status
 *     description: Update battery level, firmware version, and sync status
 *     tags: [Smart Locks]
 *     parameters:
 *       - in: path
 *         name: lockId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               batteryLevel:
 *                 type: integer
 *                 description: Battery percentage (0-100)
 *               firmwareVersion:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated successfully
 *       404:
 *         description: Lock not found
 */
router.put('/:lockId/status', (req, res) => smartLockController.updateLockStatus(req, res));

module.exports = router;
