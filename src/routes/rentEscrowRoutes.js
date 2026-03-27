const express = require('express');
const router = express.Router();
const { RentEscrowController } = require('../controllers/RentEscrowController');
const { RentEscrowService } = require('../services/rentEscrowService');
const { AppDatabase } = require('../db/appDatabase');

// Initialize services with database
const database = new AppDatabase(process.env.DATABASE_FILENAME || './data/leaseflow-protocol.sqlite');
const rentEscrowService = new RentEscrowService(database, {
  autoReleaseDays: parseInt(process.env.ESCROW_AUTO_RELEASE_DAYS) || 7
});
const rentEscrowController = new RentEscrowController(rentEscrowService);

/**
 * @openapi
 * /api/escrow/create:
 *   post:
 *     summary: Create rent escrow
 *     description: Withhold disputed rent amount in escrow during maintenance dispute
 *     tags: [Rent Escrow]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - leaseId
 *               - maintenanceTicketId
 *               - tenantId
 *               - landlordId
 *               - disputedAmount
 *             properties:
 *               leaseId:
 *                 type: string
 *               maintenanceTicketId:
 *                 type: string
 *               tenantId:
 *                 type: string
 *               landlordId:
 *                 type: string
 *               disputedAmount:
 *                 type: number
 *               currency:
 *                 type: string
 *                 default: XLM
 *               reason:
 *                 type: string
 *               evidence:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Escrow created successfully
 *       400:
 *         description: Missing required fields or invalid ticket status
 */
router.post('/create', (req, res) => rentEscrowController.createEscrow(req, res));

/**
 * @openapi
 * /api/escrow/{escrowId}:
 *   get:
 *     summary: Get escrow details
 *     description: Retrieve escrow information by ID
 *     tags: [Rent Escrow]
 *     parameters:
 *       - in: path
 *         name: escrowId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Escrow details retrieved
 *       404:
 *         description: Escrow not found
 */
router.get('/:escrowId', (req, res) => rentEscrowController.getEscrow(req, res));

/**
 * @openapi
 * /api/escrow/lease/{leaseId}:
 *   get:
 *     summary: Get escrows by lease
 *     description: Retrieve all escrows for a specific lease
 *     tags: [Rent Escrow]
 *     parameters:
 *       - in: path
 *         name: leaseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Escrows retrieved
 *       404:
 *         description: Lease not found
 */
router.get('/lease/:leaseId', (req, res) => rentEscrowController.getLeaseEscrows(req, res));

/**
 * @openapi
 * /api/escrow/verification/{verificationId}/photos:
 *   post:
 *     summary: Upload repair photos
 *     description: Landlord uploads photos of completed repairs
 *     tags: [Repair Verification]
 *     parameters:
 *       - in: path
 *         name: verificationId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - photos
 *             properties:
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *               repairDescription:
 *                 type: string
 *     responses:
 *       200:
 *         description: Photos uploaded successfully
 *       400:
 *         description: Missing photos array
 */
router.post('/verification/:verificationId/photos', (req, res) => rentEscrowController.uploadRepairPhotos(req, res));

/**
 * @openapi
 * /api/escrow/verification/{verificationId}/confirm:
 *   post:
 *     summary: Tenant confirms repairs
 *     description: Tenant confirms repairs are completed - triggers escrow release
 *     tags: [Repair Verification]
 *     parameters:
 *       - in: path
 *         name: verificationId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               feedback:
 *                 type: string
 *     responses:
 *       200:
 *         description: Repairs confirmed
 *       400:
 *         description: Verification not found
 */
router.post('/verification/:verificationId/confirm', (req, res) => rentEscrowController.confirmRepairs(req, res));

/**
 * @openapi
 * /api/escrow/verification/{verificationId}/reject:
 *   post:
 *     summary: Tenant rejects repairs
 *     description: Tenant rejects repair completion - escrow remains active
 *     tags: [Repair Verification]
 *     parameters:
 *       - in: path
 *         name: verificationId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - feedback
 *             properties:
 *               feedback:
 *                 type: string
 *     responses:
 *       200:
 *         description: Repairs rejected
 *       400:
 *         description: Missing feedback
 */
router.post('/verification/:verificationId/reject', (req, res) => rentEscrowController.rejectRepairs(req, res));

/**
 * @openapi
 * /api/escrow/{escrowId}/release:
 *   post:
 *     summary: Release escrow to landlord
 *     description: Release full escrow amount to landlord
 *     tags: [Escrow Release]
 *     parameters:
 *       - in: path
 *         name: escrowId
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
 *         description: Escrow released
 *       400:
 *         description: Escrow not active or not found
 */
router.post('/:escrowId/release', (req, res) => rentEscrowController.releaseToLandlord(req, res));

/**
 * @openapi
 * /api/escrow/{escrowId}/return:
 *   post:
 *     summary: Return escrow to tenant
 *     description: Return full escrow amount to tenant
 *     tags: [Escrow Release]
 *     parameters:
 *       - in: path
 *         name: escrowId
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
 *         description: Escrow returned
 *       400:
 *         description: Escrow not active or not found
 */
router.post('/:escrowId/return', (req, res) => rentEscrowController.returnToTenant(req, res));

/**
 * @openapi
 * /api/escrow/{escrowId}/split:
 *   post:
 *     summary: Split escrow between parties
 *     description: Split escrow amount based on percentage
 *     tags: [Escrow Release]
 *     parameters:
 *       - in: path
 *         name: escrowId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - landlordPercentage
 *             properties:
 *               landlordPercentage:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Escrow split successfully
 *       400:
 *         description: Invalid percentage or escrow not found
 */
router.post('/:escrowId/split', (req, res) => rentEscrowController.splitEscrow(req, res));

/**
 * @openapi
 * /api/escrow/{escrowId}/cancel:
 *   post:
 *     summary: Cancel escrow
 *     description: Cancel escrow without automatic release
 *     tags: [Escrow Release]
 *     parameters:
 *       - in: path
 *         name: escrowId
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
 *         description: Escrow cancelled
 */
router.post('/:escrowId/cancel', (req, res) => rentEscrowController.cancelEscrow(req, res));

/**
 * @openapi
 * /api/escrow/{escrowId}/transactions:
 *   get:
 *     summary: Get transaction history
 *     description: Retrieve all transactions for an escrow
 *     tags: [Rent Escrow]
 *     parameters:
 *       - in: path
 *         name: escrowId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transactions retrieved
 */
router.get('/:escrowId/transactions', (req, res) => rentEscrowController.getTransactions(req, res));

/**
 * @openapi
 * /api/escrow/maintenance/auto-release:
 *   post:
 *     summary: Trigger auto-release
 *     description: Manually trigger auto-release of expired verifications
 *     tags: [Maintenance]
 *     responses:
 *       200:
 *         description: Auto-release triggered
 */
router.post('/maintenance/auto-release', (req, res) => rentEscrowController.triggerAutoRelease(req, res));

module.exports = router;
