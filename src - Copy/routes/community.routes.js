const express = require('express');
const router = express.Router();
const communityController = require('../controllers/community.controller');
const { authMiddleware } = require('../services/auth.service');

router.post('/community/message', authMiddleware, (req, res) => communityController.postMessage(req, res));
router.get('/community/messages', authMiddleware, (req, res) => communityController.listMessages(req, res));

module.exports = router;
