const express = require('express');
const router = express.Router();
const { TaxController } = require('../controllers/TaxController');
const { TaxEstimatorService } = require('../services/TaxEstimatorService');
const { AppDatabase } = require('../db/appDatabase');

// Initialize dependencies
const database = new AppDatabase(process.env.DATABASE_FILENAME || './data/leaseflow-protocol.sqlite');
const taxService = new TaxEstimatorService(database);
const taxController = new TaxController(taxService);

/**
 * @openapi
 * /api/tax/report:
 *   get:
 *     summary: Generate Tax Deduction Report
 *     description: Highlights total maintenance expenses and protocol fees for a given year
 *     tags: [Finance]
 *     parameters:
 *       - in: query
 *         name: landlordId
 *         required: true
 *       - in: query
 *         name: year
 *         required: true
 *     responses:
 *       200:
 *         description: Report generated successfully
 */
router.get('/report', (req, res) => taxController.generateReport(req, res));

module.exports = router;
