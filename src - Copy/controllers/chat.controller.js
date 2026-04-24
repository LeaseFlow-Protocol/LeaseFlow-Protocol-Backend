const chatService = require('../services/chat.service');

class ChatController {
  async sendMessage(req, res) {
    try {
      const { receiverId, content } = req.body;
      const senderId = req.user.id;
      const message = await chatService.sendMessage(senderId, receiverId, content);
      res.status(201).json(message);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async listMessages(req, res) {
    try {
      const otherPartyId = req.params.id;
      const userId = req.user.id;
      const messages = await chatService.listMessages(userId, otherPartyId);
      res.json(messages);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new ChatController();
