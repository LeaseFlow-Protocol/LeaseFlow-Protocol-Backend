/**
 * YieldGeneratorService
 * 
 * Moves security deposits from a "Static Escrow" to a "Lending Pool" on Stellar.
 * The interest earned is split between the tenant and the platform.
 */

class YieldGeneratorService {
  constructor(stellarService, database) {
    this.stellarService = stellarService;
    this.database = database;
    this.lendingPoolAddress = process.env.STELLAR_LENDING_POOL_ADDRESS;
  }

  /**
   * Moves the security deposit to the lending pool.
   * Requires explicit tenant consent.
   */
  async depositToYieldPool(leaseId, amount, tenantConsent) {
    if (!tenantConsent) {
      throw new Error("Tenant consent required for yield generation");
    }
    
    // Move from static escrow to lending pool
    const txHash = await this.stellarService.transferToPool(this.lendingPoolAddress, amount);
    
    // Record yield deposit in database
    await this.database.recordYieldDeposit(leaseId, amount, txHash);
    
    return { success: true, txHash };
  }

  /**
   * Calculates the yield generated and splits it between tenant and platform.
   */
  async calculateAndSplitYield(leaseId) {
    // Calculate total yield generated from the pool for this lease
    const yieldAmount = await this.stellarService.getYieldBalance(leaseId);
    
    // Split: 80% to tenant, 20% to platform
    const tenantShare = yieldAmount * 0.8;
    const platformShare = yieldAmount * 0.2;
    
    return {
      totalYield: yieldAmount,
      tenantShare,
      platformShare
    };
  }
}

module.exports = { YieldGeneratorService };