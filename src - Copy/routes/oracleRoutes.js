const express = require('express');
const { OracleController } = require('../controllers/OracleController');

/**
 * Oracle Routes
 * API endpoints for physical asset condition reporting and cryptographic signing.
 */
module.exports = (database) => {
  const router = express.Router();
  const controller = new OracleController(database);

  // Simple API Key security middleware
  const requireApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== (process.env.ORACLE_API_KEY || 'leaseflow_oracle_key')) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API Key' });
    }
    next();
  };

  /**
   * @swagger
   * /api/v1/oracles/condition-report:
   *   post:
   *     summary: Ingest asset condition report and return signed payload
   *     tags: [Oracle]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - leaseId
   *               - damageCode
   *             properties:
   *               leaseId:
   *                 type: string
   *               damageCode:
   *                 type: string
   *               description:
   *                 type: string
   *               inspectorId:
   *                 type: string
   *               images:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       201:
   *         description: Signed payload generated successfully
   *       200:
   *         description: Report processed (skipped if minor)
   *       400:
   *         description: Invalid request or missing data
   *       409:
   *         description: Report already generated for this lease event
   */
  router.post('/condition-report', requireApiKey, (req, res) => controller.submitConditionReport(req, res));

  return router;
};
