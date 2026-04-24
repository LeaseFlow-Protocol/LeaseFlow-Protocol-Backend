const express = require("express");
const router = express.Router();

/**
 * Late fee routes factory. Requires the LateFeeController to be passed in so
 * the same service instances wired in index.js are reused.
 *
 * @param {import('../controllers/LateFeeController').LateFeeController} controller
 * @returns {import('express').Router}
 */
function createLateFeeRoutes(controller) {
  /**
   * @openapi
   * /api/late-fees/{leaseId}:
   *   get:
   *     summary: Get late fees for a lease
   *     description: Returns all assessed late fee entries and total pending debt for the specified lease.
   *     tags: [Late Fees]
   *     parameters:
   *       - in: path
   *         name: leaseId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Late fee summary
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     leaseId:
   *                       type: string
   *                     totalPendingDebt:
   *                       type: number
   *                     entries:
   *                       type: array
   *                       items:
   *                         type: object
   */
  router.get("/:leaseId", (req, res) => controller.getLeaseLateFees(req, res));

  /**
   * @openapi
   * /api/late-fees/assess:
   *   post:
   *     summary: Trigger late fee assessment
   *     description: Manually triggers a late fee assessment pass across all active leases with overdue payments.
   *     tags: [Late Fees]
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               asOfDate:
   *                 type: string
   *                 description: Date to assess as of (YYYY-MM-DD). Defaults to today.
   *     responses:
   *       200:
   *         description: Assessment results
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     assessed:
   *                       type: number
   *                     skipped:
   *                       type: number
   *                     errors:
   *                       type: array
   */
  router.post("/assess", (req, res) => controller.triggerAssessment(req, res));

  return router;
}

module.exports = { createLateFeeRoutes };
