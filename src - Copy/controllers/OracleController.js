const { AssetConditionOracleService } = require('../services/AssetConditionOracleService');

/**
 * Oracle Controller
 * Handles ingest of physical asset condition reports and provides signed payloads.
 */
class OracleController {
  /**
   * @param {AppDatabase} database - Database instance
   */
  constructor(database) {
    this.service = new AssetConditionOracleService(database);
  }

  /**
   * Receive a condition report from a third-party and return a signed payload
   * POST /api/v1/oracles/condition-report
   */
  async submitConditionReport(req, res) {
    try {
      const { leaseId, damageCode, description } = req.body;

      // Basic validation
      if (!leaseId || !damageCode) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: leaseId, damageCode'
        });
      }

      // Process report via service
      const result = await this.service.processConditionReport(req.body);

      if (result.status === 'skipped') {
        return res.status(200).json({
          success: true,
          message: result.message,
          data: { severityTier: result.severityTier }
        });
      }

      return res.status(201).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('[OracleController] Error processing report:', error.message);
      
      const statusCode = error.message.includes('already generated') ? 409 : 400;
      
      return res.status(statusCode).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = { OracleController };
