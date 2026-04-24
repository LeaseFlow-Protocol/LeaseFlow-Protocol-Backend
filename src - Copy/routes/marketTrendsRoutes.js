const express = require('express');
const { MarketTrendsController } = require('../controllers/MarketTrendsController');
const { AppDatabase } = require('../db/appDatabase');

const router = express.Router();

// Initialize controller with database instance
const database = new AppDatabase(process.env.DATABASE_FILENAME || './data/leaseflow-protocol.sqlite');
const controller = new MarketTrendsController(database);

/**
 * @swagger
 * tags:
 *   name: Market Trends
 *   description: Rental market analytics and insights from aggregated LeaseFlow data
 */

/**
 * @swagger
 * /api/market-trends:
 *   get:
 *     summary: Get API information
 *     tags: [Market Trends]
 *     responses:
 *       200:
 *         description: API documentation and available endpoints
 */
router.get('/', (req, res) => controller.getMarketTrendsInfo(req, res));

/**
 * @swagger
 * /api/market-trends/{location}:
 *   get:
 *     summary: Get market trends for a specific location
 *     tags: [Market Trends]
 *     parameters:
 *       - in: path
 *         name: location
 *         required: true
 *         schema:
 *           type: string
 *         description: City or region name (e.g., "Abuja", "Lagos")
 *       - in: query
 *         name: bedrooms
 *         schema:
 *           type: integer
 *         description: Filter by number of bedrooms
 *       - in: query
 *         name: propertyType
 *         schema:
 *           type: string
 *         description: Filter by property type
 *     responses:
 *       200:
 *         description: Market trends analytics including average rent, median, YoY change
 *       400:
 *         description: Missing location parameter
 *       500:
 *         description: Server error
 */
router.get('/:location', (req, res) => controller.getMarketTrends(req, res));

/**
 * @swagger
 * /api/market-trends/{location}/history:
 *   get:
 *     summary: Get historical price trends
 *     tags: [Market Trends]
 *     parameters:
 *       - in: path
 *         name: location
 *         required: true
 *         schema:
 *           type: string
 *         description: City or region name
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *           default: 12
 *         description: Number of months to look back
 *     responses:
 *       200:
 *         description: Historical price data over time
 *       400:
 *         description: Missing location parameter
 *       500:
 *         description: Server error
 */
router.get('/:location/history', (req, res) => controller.getPriceHistory(req, res));

/**
 * @swagger
 * /api/market-trends/{location}/property-types:
 *   get:
 *     summary: Get property type breakdown
 *     tags: [Market Trends]
 *     parameters:
 *       - in: path
 *         name: location
 *         required: true
 *         schema:
 *           type: string
 *         description: City or region name
 *     responses:
 *       200:
 *         description: Breakdown of properties by type with statistics
 *       400:
 *         description: Missing location parameter
 *       500:
 *         description: Server error
 */
router.get('/:location/property-types', (req, res) => controller.getPropertyTypeBreakdown(req, res));

/**
 * @swagger
 * /api/market-trends/compare:
 *   get:
 *     summary: Compare market trends across multiple locations
 *     tags: [Market Trends]
 *     parameters:
 *       - in: query
 *         name: locations
 *         required: true
 *         schema:
 *           type: string
 *         description: Comma-separated list of locations (minimum 2)
 *     responses:
 *       200:
 *         description: Comparative analysis across locations
 *       400:
 *         description: Missing or insufficient locations
 *       500:
 *         description: Server error
 */
router.get('/compare', (req, res) => controller.getComparativeAnalysis(req, res));

module.exports = router;
