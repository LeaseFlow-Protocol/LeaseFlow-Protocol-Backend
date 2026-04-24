const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { authMiddleware } = require('../services/auth.service');

router.post('/chat/message', authMiddleware, (req, res) => chatController.sendMessage(req, res));
router.get('/chat/messages/:id', authMiddleware, (req, res) => chatController.listMessages(req, res));

module.exports = router;
