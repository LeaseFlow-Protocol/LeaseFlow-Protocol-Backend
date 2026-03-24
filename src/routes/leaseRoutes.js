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
 *     description: Encrypts the PDF content and stores it on IPFS. Returns the Metadata CID.
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
 *               landlordPubKey:
 *                 type: string
 *     responses:
 *       201:
 *         description: Lease stored successfully
 *       400:
 *         description: Missing required fields
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

module.exports = router;
