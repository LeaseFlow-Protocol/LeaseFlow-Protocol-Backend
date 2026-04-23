const express = require('express');
const router = express.Router();
const multer = require('multer');
const LeaseController = require('../controllers/LeaseController');

// Multer setup (using memory storage for immediate encryption)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * @openapi
 * /api/leases/upload:
 *   post:
 *     summary: Upload a new PDF lease agreement
 *     description: Encrypts the PDF content and stores it on IPFS. Returns the Metadata CID. Validates KYC compliance if actor IDs are provided.
 *     tags: [Leases]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               leaseFile:
 *                 type: string
 *                 format: binary
 *               tenantPubKey:
 *                 type: string
 *                 description: Tenant's public key for encryption
 *               landlordPubKey:
 *                 type: string
 *                 description: Landlord's public key for encryption
 *               landlordId:
 *                 type: string
 *                 description: Landlord identifier for KYC validation (optional)
 *               tenantId:
 *                 type: string
 *                 description: Tenant identifier for KYC validation (optional)
 *     responses:
 *       201:
 *         description: Lease stored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 leaseCID:
 *                   type: string
 *                 kycVerified:
 *                   type: boolean
 *                   nullable: true
 *       400:
 *         description: Missing required fields
 *       403:
 *         description: KYC verification required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 *                 compliance:
 *                   type: object
 *                 kycRequired:
 *                   type: boolean
 */
router.post('/upload', upload.single('leaseFile'), (req, res) => LeaseController.uploadLease(req, res));

/**
 * @openapi
 * /api/leases/{leaseCID}/handshake:
 *   get:
 *     summary: Initiate decryption handshake
 *     description: Retrieves encrypted symmetric keys for an authorized party via lease CID.
 *     tags: [Leases]
 *     parameters:
 *       - in: path
 *         name: leaseCID
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: userPubKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Handshake data retrieved
 *       403:
 *         description: Unauthorized
 */
router.get('/:leaseCID/handshake', (req, res) => LeaseController.getHandshake(req, res));

/**
 * @openapi
 * /api/leases/active:
 *   get:
 *     summary: Retrieve active leases
 *     description: Returns a list of all currently active leases from the database.
 *     tags: [Leases]
 *     responses:
 *       200:
 *         description: A list of active leases
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get('/active', (req, res) => LeaseController.getActiveLeases(req, res));

/**
 * @openapi
 * /api/leases/{leaseId}/status:
 *   get:
 *     summary: Get Lease Status (Redis Cached)
 *     description: Checks the status of a lease. Uses Redis for sub-millisecond response.
 *     tags: [Leases]
 *     parameters:
 *       - in: path
 *         name: leaseId
 *         required: true
 *     responses:
 *       200:
 *         description: Lease status information
 */
router.get('/:leaseId/status', (req, res) => LeaseController.getLeaseStatus(req, res));

/**
 * @openapi
 * /api/leases/{leaseId}/purchase-option:
 *   post:
 *     summary: Enable Purchase Option for a lease
 *     description: Configures a portion of the rent to go toward an eventual down payment (equity).
 *     tags: [Leases]
 *     parameters:
 *       - in: path
 *         name: leaseId
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rentShare:
 *                 type: number
 *                 description: Portion of rent (0.0 to 1.0) going toward purchase credit.
 *     responses:
 *       200:
 *         description: Purchase option enabled successfully
 */
router.post('/:leaseId/purchase-option', (req, res) => LeaseController.enablePurchaseOption(req, res));

module.exports = router;
