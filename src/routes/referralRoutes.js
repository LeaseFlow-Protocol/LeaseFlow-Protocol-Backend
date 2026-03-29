const express = require('express');
const { ReferralController } = require('../controllers/ReferralController');
const { AppDatabase } = require('../db/appDatabase');

const router = express.Router();

// Initialize controller with database instance
const database = new AppDatabase(process.env.DATABASE_FILENAME || './data/leaseflow-protocol.sqlite');
const controller = new ReferralController(database);

/**
 * @swagger
 * tags:
 *   name: Referrals
 *   description: Referral engine for organic growth with fee waivers
 */

/**
 * @swagger
 * /api/referrals/program-info:
 *   get:
 *     summary: Get referral program information
 *     tags: [Referrals]
 *     responses:
 *       200:
 *         description: Referral program details and rewards structure
 */
router.get('/program-info', (req, res) => controller.getProgramInfo(req, res));

/**
 * @swagger
 * /api/referrals/generate:
 *   post:
 *     summary: Generate a referral code
 *     tags: [Referrals]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *               userType:
 *                 type: string
 *                 enum: [landlord, tenant]
 *                 default: landlord
 *     responses:
 *       201:
 *         description: Referral code generated successfully
 *       400:
 *         description: User has reached referral limit
 */
router.post('/generate', (req, res) => controller.generateReferralCode(req, res));

/**
 * @swagger
 * /api/referrals/validate/{code}:
 *   get:
 *     summary: Validate a referral code
 *     tags: [Referrals]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Referral code to validate
 *     responses:
 *       200:
 *         description: Valid referral code with benefits
 *       404:
 *         description: Invalid or expired code
 */
router.get('/validate/:code', (req, res) => controller.validateReferralCode(req, res));

/**
 * @swagger
 * /api/referrals/stats/{userId}:
 *   get:
 *     summary: Get user's referral statistics
 *     tags: [Referrals]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User identifier
 *     responses:
 *       200:
 *         description: User referral statistics including success rate
 *       500:
 *         description: Server error
 */
router.get('/stats/:userId', (req, res) => controller.getUserStats(req, res));

/**
 * @swagger
 * /api/referrals/property-listed:
 *   post:
 *     summary: Mark property as listed (convert referral)
 *     tags: [Referrals]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - referralCode
 *               - propertyId
 *               - refereeId
 *     responses:
 *       200:
 *         description: Referral converted successfully with rewards
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: Invalid referral code
 */
router.post('/property-listed', (req, res) => controller.markPropertyListed(req, res));

/**
 * @swagger
 * /api/referrals/lease-signed:
 *   post:
 *     summary: Mark lease as signed (upgrade referral)
 *     tags: [Referrals]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - referralCode
 *               - leaseId
 *     responses:
 *       200:
 *         description: Lease signed, referral upgraded to 2-month waiver
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: Invalid referral code
 */
router.post('/lease-signed', (req, res) => controller.markLeaseSigned(req, res));

/**
 * @swagger
 * /api/referrals/apply-waiver:
 *   post:
 *     summary: Apply fee waiver on-chain via Soroban
 *     tags: [Referrals]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *     responses:
 *       200:
 *         description: Fee waiver applied on-chain
 *       500:
 *         description: Failed to apply waiver
 */
router.post('/apply-waiver', async (req, res) => controller.applyFeeWaiver(req, res));

module.exports = router;
