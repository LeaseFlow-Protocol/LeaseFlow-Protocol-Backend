const badgeService = require('../services/badge.service');

class BadgeController {
  async mintBadge(req, res) {
    try {
      const { leaseId } = req.body;
      const userId = req.user.id;
      const badge = await badgeService.mintBadge(userId, leaseId);
      res.status(201).json(badge);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async listBadges(req, res) {
    try {
      const userId = req.user.id;
      const badges = await badgeService.listBadges(userId);
      res.json(badges);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new BadgeController();
