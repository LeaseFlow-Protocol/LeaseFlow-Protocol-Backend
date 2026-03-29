const stellar = require('stellar-sdk');
const db = require('../db');

class BadgeService {
  constructor() {
    this.server = new stellar.Server('https://horizon.stellar.org');
    this.issuerSecret = process.env.BADGE_ISSUER_SECRET;
    this.issuerKeypair = stellar.Keypair.fromSecret(this.issuerSecret);
  }

  async mintBadge(userId, leaseId) {
    // Verify lease completion
    const lease = await db('leases').where({ id: leaseId, userId }).first();
    if (!lease || lease.status !== 'closed' || lease.durationMonths < 12) {
      throw new Error('Lease not eligible for badge');
    }

    const tenant = await db('tenants').where({ id: userId }).first();
    if (!tenant) throw new Error('Tenant not found');

    // Build NFT asset
    const assetCode = `LEASEBADGE-${leaseId}`;
    const asset = new stellar.Asset(assetCode, this.issuerKeypair.publicKey());

    // Create trustline and payment (simplified)
    const account = await this.server.loadAccount(tenant.stellarAddress);
    const tx = new stellar.TransactionBuilder(account, {
      fee: await this.server.fetchBaseFee(),
      networkPassphrase: stellar.Networks.PUBLIC,
    })
      .addOperation(stellar.Operation.changeTrust({ asset }))
      .addOperation(stellar.Operation.payment({
        destination: tenant.stellarAddress,
        asset,
        amount: '1',
      }))
      .setTimeout(30)
      .build();

    tx.sign(this.issuerKeypair);
    await this.server.submitTransaction(tx);

    // Archive badge record
    const [badge] = await db('tenant_badges')
      .insert({
        userId,
        leaseId,
        assetCode,
        mintedAt: new Date(),
      })
      .returning('*');

    return badge;
  }

  async listBadges(userId) {
    return db('tenant_badges').where({ userId });
  }
}

module.exports = new BadgeService();
