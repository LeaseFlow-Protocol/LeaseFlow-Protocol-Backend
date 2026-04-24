const express = require('express');
const router = express.Router();
const KycController = require('../controllers/kycController');

/**
 * @openapi
 * components:
 *   schemas:
 *     PersonalInfo:
 *       type: object
 *       required:
 *         - firstName
 *         - lastName
 *         - email
 *         - phone
 *       properties:
 *         firstName:
 *           type: string
 *           description: First name
 *         lastName:
 *           type: string
 *           description: Last name
 *         email:
 *           type: string
 *           format: email
 *           description: Email address
 *         phone:
 *           type: string
 *           description: Phone number
 *     
 *     AddressInfo:
 *       type: object
 *       required:
 *         - streetAddress
 *         - city
 *         - stateProvince
 *         - country
 *         - postalCode
 *       properties:
 *         streetAddress:
 *           type: string
 *           description: Street address
 *         city:
 *           type: string
 *           description: City
 *         stateProvince:
 *           type: string
 *           description: State or province
 *         country:
 *           type: string
 *           description: Country code (ISO 3166-1)
 *         postalCode:
 *           type: string
 *           description: Postal code
 *     
 *     IdentificationInfo:
 *       type: object
 *       required:
 *         - idType
 *         - idNumber
 *         - idIssueDate
 *         - idExpiryDate
 *         - idIssuingCountry
 *       properties:
 *         idType:
 *           type: string
 *           enum: [passport, driver_license, national_id, residence_permit]
 *           description: Type of identification document
 *         idNumber:
 *           type: string
 *           description: Identification number
 *         idIssueDate:
 *           type: string
 *           format: date
 *           description: ID issue date
 *         idExpiryDate:
 *           type: string
 *           format: date
 *           description: ID expiry date
 *         idIssuingCountry:
 *           type: string
 *           description: ID issuing country
 *     
 *     AdditionalInfo:
 *       type: object
 *       properties:
 *         sourceOfFunds:
 *           type: string
 *           description: Source of funds
 *         occupation:
 *           type: string
 *           description: Occupation
 *         annualIncome:
 *           type: string
 *           description: Annual income range
 *     
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
 *           $ref: '#/components/schemas/PersonalInfo'
 *         addressInfo:
 *           $ref: '#/components/schemas/AddressInfo'
 *         identificationInfo:
 *           $ref: '#/components/schemas/IdentificationInfo'
 *         additionalInfo:
 *           $ref: '#/components/schemas/AdditionalInfo'
 */

/**
 * @openapi
 * /api/kyc/submit:
 *   post:
 *     summary: Submit KYC verification for an actor
 *     description: Submits KYC information to a Stellar Anchor for verification according to SEP-12 standards.
 *     tags: [KYC]
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
 *                 anchorSubmission:
 *                   type: object
 *       400:
 *         description: Invalid request data
 *       409:
 *         description: KYC verification already exists
 *       500:
 *         description: Server error
 */
router.post('/submit', (req, res) => KycController.submitKycVerification(req, res));

/**
 * @openapi
 * /api/kyc/status/{actorId}/{actorRole}:
 *   get:
 *     summary: Get KYC verification status for an actor
 *     description: Retrieves the current KYC verification status for a specific actor.
 *     tags: [KYC]
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
 *                 anchorStatus:
 *                   type: object
 *       404:
 *         description: KYC verification not found
 *       500:
 *         description: Server error
 */
router.get('/status/:actorId/:actorRole', (req, res) => KycController.getKycStatus(req, res));

/**
 * @openapi
 * /api/kyc/update/{actorId}/{actorRole}:
 *   put:
 *     summary: Update KYC verification information
 *     description: Updates existing KYC verification information for an actor.
 *     tags: [KYC]
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
 *                 $ref: '#/components/schemas/PersonalInfo'
 *               addressInfo:
 *                 $ref: '#/components/schemas/AddressInfo'
 *               identificationInfo:
 *                 $ref: '#/components/schemas/IdentificationInfo'
 *               additionalInfo:
 *                 $ref: '#/components/schemas/AdditionalInfo'
 *     responses:
 *       200:
 *         description: KYC verification updated successfully
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: KYC verification not found
 *       500:
 *         description: Server error
 */
router.put('/update/:actorId/:actorRole', (req, res) => KycController.updateKycVerification(req, res));

/**
 * @openapi
 * /api/kyc/compliance:
 *   post:
 *     summary: Check KYC compliance for a lease
 *     description: Checks if both landlord and tenant are KYC verified for lease compliance.
 *     tags: [KYC]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - landlordId
 *               - tenantId
 *             properties:
 *               landlordId:
 *                 type: string
 *                 description: Landlord identifier
 *               tenantId:
 *                 type: string
 *                 description: Tenant identifier
 *     responses:
 *       200:
 *         description: KYC compliance check completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 compliance:
 *                   type: object
 *                   properties:
 *                     landlord:
 *                       type: object
 *                     tenant:
 *                       type: object
 *                     leaseCanProceed:
 *                       type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid request data
 *       500:
 *         description: Server error
 */
router.post('/compliance', (req, res) => KycController.checkLeaseKycCompliance(req, res));

/**
 * @openapi
 * /api/kyc/requirements:
 *   get:
 *     summary: Get KYC requirements from anchor
 *     description: Retrieves supported ID types and requirements from the Stellar Anchor.
 *     tags: [KYC]
 *     responses:
 *       200:
 *         description: KYC requirements retrieved successfully
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
 *       500:
 *         description: Server error
 */
router.get('/requirements', (req, res) => KycController.getKycRequirements(req, res));

/**
 * @openapi
 * /api/kyc/delete/{actorId}/{actorRole}:
 *   delete:
 *     summary: Delete KYC verification data
 *     description: Deletes KYC verification data for GDPR compliance.
 *     tags: [KYC]
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
 *         description: Server error
 */
router.delete('/delete/:actorId/:actorRole', (req, res) => KycController.deleteKycVerification(req, res));

module.exports = router;
