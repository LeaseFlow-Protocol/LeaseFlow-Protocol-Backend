const communityService = require('../services/community.service');

class CommunityController {
  async postMessage(req, res) {
    try {
      const { buildingId, content } = req.body;
      const userId = req.user.id;
      const message = await communityService.postMessage(buildingId, userId, content);
      res.status(201).json(message);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }

  async listMessages(req, res) {
    try {
      const buildingId = req.user.buildingId;
      const messages = await communityService.listMessages(buildingId);
      res.json(messages);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new CommunityController();
