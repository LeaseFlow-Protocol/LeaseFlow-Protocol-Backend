const express = require('express');
const { EnhancedKycController } = require('../controllers/enhancedKycController');
const swaggerJsdoc = require('swagger-jsdoc');

const router = express.Router();

// Initialize controller with config from environment
const enhancedKycController = new EnhancedKycController({
  // Identity Router Configuration
  identityRouterEnabled: process.env.IDENTITY_ROUTER_ENABLED === 'true',
  identityRouterProviders: process.env.IDENTITY_ROUTER_PROVIDERS?.split(',') || ['sumsub', 'jumio'],
  identityRouterTimeout: parseInt(process.env.IDENTITY_ROUTER_TIMEOUT) || 5000,
  
  // SumSub Configuration
  sumsubApiToken: process.env.SUMSUB_API_TOKEN,
  sumsubApiSecret: process.env.SUMSUB_API_SECRET,
  sumsubBaseUrl: process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com',
  sumsubLevelName: process.env.SUMSUB_LEVEL_NAME || 'basic-kyc-level',
  
  // Jumio Configuration
  jumioApiToken: process.env.JUMIO_API_TOKEN,
  jumioApiSecret: process.env.JUMIO_API_SECRET,
  jumioBaseUrl: process.env.JUMIO_BASE_URL || 'https://api.jumio.com',
  jumioCustomerId: process.env.JUMIO_CUSTOMER_ID,
  jumioWorkflowDefinitionId: process.env.JUMIO_WORKFLOW_DEFINITION_ID,
  
  // Callback URLs
  identityCallbackBaseUrl: process.env.IDENTITY_CALLBACK_BASE_URL,
  identityFrontendBaseUrl: process.env.IDENTITY_FRONTEND_BASE_URL,
  
  // Original Stellar Anchor Configuration (fallback)
  anchorUrl: process.env.STELLAR_ANCHOR_URL,
  anchorAuthKey: process.env.STELLAR_ANCHOR_AUTH_KEY,
  horizonUrl: process.env.HORIZON_URL || 'https://horizon.stellar.org'
});

/**
 * @swagger
 * components:
 *   schemas:
 *     KycSubmission:
 *       type: object
 *       required:
 *         - actorId
 *         - actorRole
 *         - stellarAccountId
 *         - personalInfo
 *         - addressInfo
 *         - identificationInfo
 *       properties:
 *         actorId:
 *           type: string
 *           description: Actor identifier
 *         actorRole:
 *           type: string
 *           enum: [landlord, tenant]
 *           description: Actor role
 *         stellarAccountId:
 *           type: string
 *           description: Stellar account address
 *         personalInfo:
 *           type: object
 *           properties:
 *             firstName:
 *               type: string
 *             lastName:
 *               type: string
 *             email:
 *               type: string
 *             phone:
 *               type: string
 *         addressInfo:
 *           type: object
 *           properties:
 *             streetAddress:
 *               type: string
 *             city:
 *               type: string
 *             stateProvince:
 *               type: string
 *             country:
 *               type: string
 *             postalCode:
 *               type: string
 *         identificationInfo:
 *           type: object
 *           properties:
 *             idType:
 *               type: string
 *             idNumber:
 *               type: string
 *             idIssueDate:
 *               type: string
 *             idExpiryDate:
 *               type: string
 *             idIssuingCountry:
 *               type: string
 *         additionalInfo:
 *           type: object
 *           properties:
 *             sourceOfFunds:
 *               type: string
 *             occupation:
 *               type: string
 *             annualIncome:
 *               type: string
 *     
 *     VerificationResult:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         status:
 *           type: string
 *           enum: [verified, rejected, in_progress, pending, error]
 *         verificationReference:
 *           type: string
 *         providerName:
 *           type: string
 *         isFallback:
 *           type: boolean
 *         responseTimeMs:
 *           type: number
 *         verifiedAt:
 *           type: string
 *           format: date-time
 *         rejectedAt:
 *           type: string
 *           format: date-time
 *         rejectionReason:
 *           type: string
 *         providerFields:
 *           type: object
 */

/**
 * @swagger
 * /api/kyc/enhanced/submit:
 *   post:
 *     summary: Submit KYC verification with automatic fallback
 *     tags: [Enhanced KYC]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KycSubmission'
 *     responses:
 *       201:
 *         description: KYC verification submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 kycRecord:
 *                   type: object
 *                 verificationSubmission:
 *                   $ref: '#/components/schemas/VerificationResult'
 *                 providerUsed:
 *                   type: string
 *                 isFallback:
 *                   type: boolean
 *       400:
 *         description: Bad request - missing or invalid fields
 *       409:
 *         description: Conflict - KYC verification already exists
 *       500:
 *         description: Internal server error
 */
router.post('/submit', enhancedKycController.submitKycVerification.bind(enhancedKycController));

/**
 * @swagger
 * /api/kyc/enhanced/status/{actorId}/{actorRole}:
 *   get:
 *     summary: Get KYC verification status with fallback support
 *     tags: [Enhanced KYC]
 *     parameters:
 *       - in: path
 *         name: actorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Actor identifier
 *       - in: path
 *         name: actorRole
 *         required: true
 *         schema:
 *           type: string
 *           enum: [landlord, tenant]
 *         description: Actor role
 *     responses:
 *       200:
 *         description: KYC status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 kycRecord:
 *                   type: object
 *                 providerStatus:
 *                   $ref: '#/components/schemas/VerificationResult'
 *                 providerUsed:
 *                   type: string
 *       404:
 *         description: KYC verification not found
 *       500:
 *         description: Internal server error
 */
router.get('/status/:actorId/:actorRole', enhancedKycController.getKycStatus.bind(enhancedKycController));

/**
 * @swagger
 * /api/kyc/enhanced/update/{actorId}/{actorRole}:
 *   put:
 *     summary: Update KYC verification information
 *     tags: [Enhanced KYC]
 *     parameters:
 *       - in: path
 *         name: actorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Actor identifier
 *       - in: path
 *         name: actorRole
 *         required: true
 *         schema:
 *           type: string
 *           enum: [landlord, tenant]
 *         description: Actor role
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               personalInfo:
 *                 type: object
 *               addressInfo:
 *                 type: object
 *               identificationInfo:
 *                 type: object
 *               additionalInfo:
 *                 type: object
 *     responses:
 *       200:
 *         description: KYC verification updated successfully
 *       404:
 *         description: KYC verification not found
 *       500:
 *         description: Internal server error
 */
router.put('/update/:actorId/:actorRole', enhancedKycController.updateKycVerification.bind(enhancedKycController));

/**
 * @swagger
 * /api/kyc/enhanced/requirements:
 *   get:
 *     summary: Get supported ID types and requirements
 *     tags: [Enhanced KYC]
 *     responses:
 *       200:
 *         description: Requirements retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 requirements:
 *                   type: object
 *                   properties:
 *                     supportedIdTypes:
 *                       type: array
 *                       items:
 *                         type: string
 *                     requiredFields:
 *                       type: array
 *                       items:
 *                         type: string
 *                     optionalFields:
 *                       type: array
 *                       items:
 *                         type: string
 *                 providerUsed:
 *                   type: string
 *       500:
 *         description: Internal server error
 */
router.get('/requirements', enhancedKycController.getKycRequirements.bind(enhancedKycController));

/**
 * @swagger
 * /api/kyc/enhanced/health:
 *   get:
 *     summary: Get health status of identity providers
 *     tags: [Enhanced KYC]
 *     responses:
 *       200:
 *         description: Provider health status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 healthStatus:
 *                   type: object
 *                   properties:
 *                     overall:
 *                       type: object
 *                     providers:
 *                       type: object
 *                     metrics:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       503:
 *         description: Identity Router not enabled
 *       500:
 *         description: Internal server error
 */
router.get('/health', enhancedKycController.getIdentityProvidersHealth.bind(enhancedKycController));

/**
 * @swagger
 * /api/kyc/enhanced/metrics:
 *   get:
 *     summary: Get Prometheus metrics for identity providers
 *     tags: [Enhanced KYC]
 *     responses:
 *       200:
 *         description: Prometheus metrics
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *       503:
 *         description: Identity Router not enabled
 *       500:
 *         description: Internal server error
 */
router.get('/metrics', enhancedKycController.getIdentityMetrics.bind(enhancedKycController));

/**
 * @swagger
 * /api/kyc/enhanced/delete/{actorId}/{actorRole}:
 *   delete:
 *     summary: Delete KYC verification data (GDPR compliance)
 *     tags: [Enhanced KYC]
 *     parameters:
 *       - in: path
 *         name: actorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Actor identifier
 *       - in: path
 *         name: actorRole
 *         required: true
 *         schema:
 *           type: string
 *           enum: [landlord, tenant]
 *         description: Actor role
 *     responses:
 *       200:
 *         description: KYC verification data deleted successfully
 *       404:
 *         description: KYC verification not found
 *       500:
 *         description: Internal server error
 */
router.delete('/delete/:actorId/:actorRole', enhancedKycController.deleteKycVerification.bind(enhancedKycController));

module.exports = router;
