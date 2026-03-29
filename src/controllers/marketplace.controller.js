const marketplaceService = require('../services/marketplace.service');

class MarketplaceController {
  async listDeals(req, res) {
    try {
      const userId = req.user.id;
      const deals = await marketplaceService.listDeals(userId);
      res.json(deals);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }

  async getDeal(req, res) {
    try {
      const userId = req.user.id;
      const dealId = req.params.id;
      const deal = await marketplaceService.getDeal(userId, dealId);
      res.json(deal);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }
}

module.exports = new MarketplaceController();
