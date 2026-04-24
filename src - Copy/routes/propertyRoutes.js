const express = require('express');
const router = express.Router();
const { PropertyController } = require('../controllers/PropertyController');
const { PropertySearchService } = require('../services/PropertySearchService');

const searchService = new PropertySearchService();
const propertyController = new PropertyController(searchService);

/**
 * @openapi
 * /api/properties/search:
 *   get:
 *     summary: Global Property Search (Elasticsearch)
 *     description: Search properties with prices in USDC, Location, and Min Tenant Score
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: minPrice
 *         type: number
 *       - in: query
 *         name: maxPrice
 *         type: number
 *       - in: query
 *         name: location
 *         type: string
 *       - in: query
 *         name: minScore
 *         type: number
 *     responses:
 *       200:
 *         description: Search results retrieved under 200ms
 */
router.get('/search', (req, res) => propertyController.search(req, res));

/**
 * @openapi
 * /api/properties/index:
 *   post:
 *     summary: Index property for search
 *     description: Adds property to Elasticsearch search index
 *     tags: [Search]
 */
router.post('/index', (req, res) => propertyController.indexProperty(req, res));

module.exports = router;
