const express = require('express');
const router = express.Router();
const marketplaceController = require('../controllers/marketplace.controller');
const { authMiddleware } = require('../services/auth.service');

router.get('/marketplace/deals', authMiddleware, (req, res) => marketplaceController.listDeals(req, res));
router.get('/marketplace/deals/:id', authMiddleware, (req, res) => marketplaceController.getDeal(req, res));

module.exports = router;
