const db = require('../db'); // assuming a db helper

class CommunityService {
  async postMessage(buildingId, userId, content) {
    // Verify tenant belongs to building
    const tenant = await db('tenants').where({ buildingId, userId, active: true }).first();
    if (!tenant) throw new Error('Unauthorized: not an active tenant');

    const [message] = await db('community_messages')
      .insert({ buildingId, userId, content, createdAt: new Date() })
      .returning('*');

    return message;
  }

  async listMessages(buildingId) {
    return db('community_messages')
      .where({ buildingId })
      .orderBy('createdAt', 'desc');
  }
}

module.exports = new CommunityService();
