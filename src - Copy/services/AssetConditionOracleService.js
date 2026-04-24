const crypto = require('crypto');

/**
 * Asset Condition Oracle Service
 * Processes off-chain damage reports and signs them for on-chain execution.
 */
class AssetConditionOracleService {
  /**
   * @param {AppDatabase} database - Database instance
   */
  constructor(database) {
    this.db = database;
    // Protocol's authorized Oracle Keypair (placeholder - use secure environment variable)
    this.oracleSecretKey = process.env.ORACLE_SECRET_KEY || 'leaseflow_oracle_signing_key_2026';
  }

  /**
   * Process an incoming condition report from a third-party inspector
   * @param {object} reportData - The raw report data
   * @returns {Promise<object>} Standardized, signed payload for the smart contract
   */
  async processConditionReport(reportData) {
    const { leaseId, damageCode, description, inspectorId, images = [] } = reportData;

    // 1. Prevent abuse: Ensure a condition report can only be generated once per lease termination event
    // We check if an active or signed report already exists for this leaseId in the current cycle
    const existingReport = this.db.db.prepare(`
      SELECT id FROM asset_condition_reports WHERE lease_id = ? AND status IN ('signed', 'submitted')
    `).get(leaseId);

    if (existingReport) {
      throw new Error('Condition report already generated for this lease termination event');
    }

    // 2. Map proprietary damage codes to standardized protocol severity tiers
    const mapping = this.mapDamageToSeverity(damageCode);
    const { severityTier, baseSlashAmount } = mapping;

    // 3. Calculate proration/slash amount based on database rules (simplified logic)
    // In a real system, this would query wear-and-tear proration tables
    const slashAmount = this.calculateFinalSlashAmount(leaseId, baseSlashAmount, severityTier);

    // 4. Handle minor wear-and-tear (bypassing slashing payload generation if too minor)
    if (severityTier === 'minor' && slashAmount === 0) {
      return { 
        status: 'skipped', 
        message: 'Report processed as minor wear-and-tear. No deposit slash required.',
        severityTier 
      };
    }

    // 5. Store raw evidence (images/report) - Mocking S3 upload
    const s3Url = `https://leaseflow-evidence.s3.amazonaws.com/reports/${leaseId}-${Date.now()}.json`;

    // 6. Format standardized payload for Soroban
    const standardizedPayload = {
      leaseId,
      severityTier,
      slashAmount,
      evidenceUrl: s3Url,
      inspectorId,
      imageCount: images.length,
      timestamp: Math.floor(Date.now() / 1000)
    };

    // 7. Cryptographically sign the payload using the protocol's Oracle Keypair
    const signature = this.signPayload(standardizedPayload);

    // 8. Persist the report and its signed status for auditability/DAO arbitration
    const reportId = crypto.randomUUID();
    this.db.db.prepare(`
      INSERT INTO asset_condition_reports (
        id, lease_id, report_data, severity_tier, slash_amount, 
        oracle_signature, s3_url, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?)
    `).run(
      reportId,
      leaseId,
      JSON.stringify(reportData),
      severityTier,
      slashAmount,
      signature,
      s3Url,
      new Date().toISOString()
    );

    return {
      reportId,
      payload: standardizedPayload,
      signature,
      status: 'signed'
    };
  }

  /**
   * Internal mapping logic for damage codes
   */
  mapDamageToSeverity(damageCode) {
    const mappings = {
      'SCR-001': { severityTier: 'minor', baseSlashAmount: 0 },
      'DNT-002': { severityTier: 'moderate', baseSlashAmount: 250 },
      'WND-003': { severityTier: 'critical', baseSlashAmount: 1000 },
      'FLM-004': { severityTier: 'critical', baseSlashAmount: 2500 },
      'INT-005': { severityTier: 'moderate', baseSlashAmount: 150 }
    };

    return mappings[damageCode] || { severityTier: 'unknown', baseSlashAmount: 0 };
  }

  /**
   * Calculate final slash amount based on lease specific data
   */
  calculateFinalSlashAmount(leaseId, baseAmount, severity) {
    // Logic to adjust slash based on deposit size or previous history
    // For now, return base amount
    return baseAmount;
  }

  /**
   * Signs the payload using HMAC-SHA256 (representing the Oracle signature)
   */
  signPayload(payload) {
    return crypto.createHmac('sha256', this.oracleSecretKey)
      .update(JSON.stringify(payload))
      .digest('hex');
  }
}

module.exports = { AssetConditionOracleService };
