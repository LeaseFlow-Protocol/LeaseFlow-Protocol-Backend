const db = require('../db');

class MarketplaceService {
  async listDeals(userId) {
    // Fetch tenant score
    const tenant = await db('tenants').where({ id: userId }).first();
    if (!tenant) throw new Error('Tenant not found');

    // Only high-score tenants qualify (e.g. score >= 700)
    const score = tenant.creditScore;
    const deals = await db('partner_deals').select('*');

    return deals.filter(d => score >= d.minScore);
  }

  async getDeal(userId, dealId) {
    const tenant = await db('tenants').where({ id: userId }).first();
    if (!tenant) throw new Error('Tenant not found');

    const deal = await db('partner_deals').where({ id: dealId }).first();
    if (!deal) throw new Error('Deal not found');

    if (tenant.creditScore < deal.minScore) {
      throw new Error('Unauthorized: tenant score too low');
    }

    return deal;
  }
}

module.exports = new MarketplaceService();
