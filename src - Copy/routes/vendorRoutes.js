const express = require('express');
const router = express.Router();
const { VendorController } = require('../controllers/VendorController');
const { VendorService } = require('../services/vendorService');
const { AppDatabase } = require('../db/appDatabase');

// Initialize services with database
const database = new AppDatabase(process.env.DATABASE_FILENAME || './data/leaseflow-protocol.sqlite');
const vendorService = new VendorService(database);
const vendorController = new VendorController(vendorService);

/**
 * @openapi
 * /api/vendors/register:
 *   post:
 *     summary: Register a new vendor
 *     description: Register a handyman/service provider in the system
 *     tags: [Vendors]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               companyName:
 *                 type: string
 *               licenseNumber:
 *                 type: string
 *               specialties:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Vendor registered successfully
 *       400:
 *         description: Missing required fields
 *       409:
 *         description: Vendor already exists
 */
router.post('/register', (req, res) => vendorController.registerVendor(req, res));

/**
 * @openapi
 * /api/vendors/{vendorId}:
 *   get:
 *     summary: Get vendor profile
 *     description: Retrieve vendor details by ID
 *     tags: [Vendors]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vendor profile retrieved
 *       404:
 *         description: Vendor not found
 */
router.get('/:vendorId', (req, res) => vendorController.getVendorProfile(req, res));

/**
 * @openapi
 * /api/vendors/tickets/lease/{leaseId}:
 *   get:
 *     summary: Get maintenance tickets for a lease
 *     description: Retrieve all maintenance tickets for a specific property
 *     tags: [Maintenance]
 *     parameters:
 *       - in: path
 *         name: leaseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Maintenance tickets retrieved
 *       404:
 *         description: Lease not found
 */
router.get('/tickets/lease/:leaseId', (req, res) => vendorController.getMaintenanceTickets(req, res));

/**
 * @openapi
 * /api/vendors/tickets:
 *   post:
 *     summary: Create maintenance ticket
 *     description: Open a new maintenance request
 *     tags: [Maintenance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - leaseId
 *               - title
 *               - description
 *               - category
 *             properties:
 *               leaseId:
 *                 type: string
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high, emergency]
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Ticket created successfully
 *       400:
 *         description: Missing required fields
 */
router.post('/tickets', (req, res) => vendorController.createMaintenanceTicket(req, res));

/**
 * @openapi
 * /api/vendors/tickets/{ticketId}/status:
 *   put:
 *     summary: Update ticket status
 *     description: Update the status of a maintenance ticket
 *     tags: [Maintenance]
 *     parameters:
 *       - in: path
 *         name: ticketId
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
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [open, in_progress, resolved, closed, disputed]
 *     responses:
 *       200:
 *         description: Status updated successfully
 *       400:
 *         description: Missing status
 */
router.put('/tickets/:ticketId/status', (req, res) => vendorController.updateTicketStatus(req, res));

/**
 * @openapi
 * /api/vendors/tickets/{ticketId}/assign:
 *   post:
 *     summary: Assign vendor to ticket
 *     description: Assign a vendor to handle a maintenance ticket
 *     tags: [Maintenance]
 *     parameters:
 *       - in: path
 *         name: ticketId
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
 *               - vendorId
 *             properties:
 *               vendorId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Vendor assigned successfully
 *       400:
 *         description: Missing vendor ID
 */
router.post('/tickets/:ticketId/assign', (req, res) => vendorController.assignVendor(req, res));

/**
 * @openapi
 * /api/vendors/tickets/{ticketId}/photos:
 *   post:
 *     summary: Add repair photos
 *     description: Upload photos of completed repairs
 *     tags: [Maintenance]
 *     parameters:
 *       - in: path
 *         name: ticketId
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
 *     responses:
 *       200:
 *         description: Photos added successfully
 *       400:
 *         description: Missing photos array
 */
router.post('/tickets/:ticketId/photos', (req, res) => vendorController.addRepairPhotos(req, res));

/**
 * @openapi
 * /api/vendors/access/grant:
 *   post:
 *     summary: Grant access to vendor
 *     description: Grant temporary access to property data for a vendor
 *     tags: [Vendor Access]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vendorId
 *               - leaseId
 *               - maintenanceTicketId
 *               - grantedBy
 *             properties:
 *               vendorId:
 *                 type: string
 *               leaseId:
 *                 type: string
 *               maintenanceTicketId:
 *                 type: string
 *               grantedBy:
 *                 type: string
 *               accessType:
 *                 type: string
 *                 enum: [maintenance_log, tenant_contact, property_access]
 *               permissions:
 *                 type: object
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Access granted successfully
 *       400:
 *         description: Missing required fields
 */
router.post('/access/grant', (req, res) => vendorController.grantAccess(req, res));

/**
 * @openapi
 * /api/vendors/access/{vendorId}/grants:
 *   get:
 *     summary: Get active grants for vendor
 *     description: Retrieve all active access grants for a vendor
 *     tags: [Vendor Access]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Active grants retrieved
 *       404:
 *         description: Vendor not found
 */
router.get('/access/:vendorId/grants', (req, res) => vendorController.getVendorGrants(req, res));

/**
 * @openapi
 * /api/vendors/access/{grantId}/revoke:
 *   post:
 *     summary: Revoke vendor access
 *     description: Revoke previously granted access
 *     tags: [Vendor Access]
 *     parameters:
 *       - in: path
 *         name: grantId
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
 *         description: Access revoked successfully
 */
router.post('/access/:grantId/revoke', (req, res) => vendorController.revokeAccess(req, res));

/**
 * @openapi
 * /api/vendors/access/{vendorId}/lease/{leaseId}/data:
 *   get:
 *     summary: Get accessible data for vendor
 *     description: Retrieve data that vendor has permission to access
 *     tags: [Vendor Access]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: leaseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Accessible data retrieved
 *       403:
 *         description: Vendor does not have access
 */
router.get('/access/:vendorId/lease/:leaseId/data', (req, res) => vendorController.getAccessibleData(req, res));

/**
 * @openapi
 * /api/vendors/access/log:
 *   post:
 *     summary: Record vendor access
 *     description: Log vendor's access to resources (audit trail)
 *     tags: [Vendor Access]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accessGrantId
 *               - vendorId
 *               - leaseId
 *               - action
 *             properties:
 *               accessGrantId:
 *                 type: string
 *               vendorId:
 *                 type: string
 *               leaseId:
 *                 type: string
 *               action:
 *                 type: string
 *               resourceAccessed:
 *                 type: string
 *     responses:
 *       200:
 *         description: Access logged successfully
 */
router.post('/access/log', (req, res) => vendorController.recordAccess(req, res));

/**
 * @openapi
 * /api/vendors/tickets/{ticketId}/close:
 *   post:
 *     summary: Close ticket and revoke access
 *     description: Close maintenance ticket and automatically revoke all associated vendor access
 *     tags: [Maintenance]
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               repairPhotos:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Ticket closed and access revoked
 */
router.post('/tickets/:ticketId/close', (req, res) => vendorController.closeTicketAndRevokeAccess(req, res));

/**
 * @openapi
 * /api/vendors/payments/authorize:
 *   post:
 *     summary: Authorize dynamic vendor payment (Direct-Drip)
 *     description: Landlords can authorize a plumber or contractor to be paid from the next rent
 *     tags: [Finance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - amount
 *             properties:
 *               jobId:
 *                 type: string
 *               amount:
 *                 type: number
 *     responses:
 *       201:
 *         description: Payment authorized successfully
 */
router.post('/payments/authorize', (req, res) => vendorController.authorizePayment(req, res));

module.exports = router;
