const badgeService = require('../services/badge.service');
const db = require('../db');

async function runBadgeMintJob() {
  const leases = await db('leases')
    .where({ status: 'closed', durationMonths: 12 })
    .andWhereNotExists(db('tenant_badges').whereRaw('tenant_badges.leaseId = leases.id'));

  for (const lease of leases) {
    try {
      await badgeService.mintBadge(lease.userId, lease.id);
      console.log(`Minted badge for lease ${lease.id}`);
    } catch (err) {
      console.error(`Failed to mint badge for lease ${lease.id}: ${err.message}`);
    }
  }
}

module.exports = { runBadgeMintJob };
