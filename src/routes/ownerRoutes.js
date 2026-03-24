const express = require('express');
const router = express.Router();
const OwnerController = require('../controllers/OwnerController');

/**
 * @openapi
 * /api/owners/top:
 *   get:
 *     summary: Retrieve top property owners
 *     description: Returns a leaderboard of the most active property owners based on completed rentals.
 *     tags: [Owners]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of owners to return
 *     responses:
 *       200:
 *         description: A list of top owners
 */
router.get('/top', (req, res) => OwnerController.getTopRated(req, res));

module.exports = router;
