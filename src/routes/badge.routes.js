const express = require('express');
const router = express.Router();
const badgeController = require('../controllers/badge.controller');
const { authMiddleware } = require('../services/auth.service');

router.post('/badges/mint', authMiddleware, (req, res) => badgeController.mintBadge(req, res));
router.get('/badges', authMiddleware, (req, res) => badgeController.listBadges(req, res));

module.exports = router;
