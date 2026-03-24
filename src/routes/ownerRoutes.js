const express = require('express');
const router = express.Router();
const OwnerController = require('../controllers/OwnerController');

/**
 * Route: GET /api/owners/top
 * Description: Retrieves a leaderboard of top property owners by completed rentals.
 */
router.get('/top', (req, res) => OwnerController.getTopRated(req, res));

module.exports = router;
