const express = require('express');
const router = express.Router();

/**
 * @openapi
 * /api/v1/leases/{id}/contract:
 *   get:
 *     summary: Get lease contract PDF
 *     description: Streams the lease agreement PDF directly from IPFS. If PDF doesn't exist, triggers generation and returns 202 status.
 *     tags: [Lease Contracts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lease ID
 *     responses:
 *       200:
 *         description: PDF file streamed successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       202:
 *         description: PDF generation in progress
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 jobId:
 *                   type: string
 *                 leaseId:
 *                   type: string
 *                 statusUrl:
 *                   type: string
 *       404:
 *         description: Lease not found or access denied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */
router.get('/:id/contract', (req, res) => {
  const controller = req.app.locals.leaseContractController;
  return controller.getLeaseContract(req, res);
});

/**
 * @openapi
 * /api/v1/leases/{id}/contract/status:
 *   get:
 *     summary: Get PDF generation status
 *     description: Returns the current status of PDF generation for a lease. Can check by lease ID or specific job ID.
 *     tags: [Lease Contracts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lease ID
 *       - in: query
 *         name: jobId
 *         required: false
 *         schema:
 *           type: string
 *         description: Specific job ID to check (optional)
 *     responses:
 *       200:
 *         description: Status retrieved successfully
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
 *                     status:
 *                       type: string
 *                       enum: [not_generated, queued, generating, completed, failed, regeneration_needed]
 *                     message:
 *                       type: string
 *                     jobId:
 *                       type: string
 *                     ipfsCid:
 *                       type: string
 *                     gatewayUrl:
 *                       type: string
 *                     contractUrl:
 *                       type: string
 *                     jobStatus:
 *                       type: object
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */
router.get('/:id/contract/status', (req, res) => {
  const controller = req.app.locals.leaseContractController;
  return controller.getContractGenerationStatus(req, res);
});

/**
 * @openapi
 * /api/v1/leases/{id}/contract/generate:
 *   post:
 *     summary: Trigger PDF generation
 *     description: Manually triggers the generation of a lease contract PDF. Useful for regenerating or updating contracts.
 *     tags: [Lease Contracts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lease ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high]
 *                 default: normal
 *                 description: Job priority in queue
 *               force:
 *                 type: boolean
 *                 default: false
 *                 description: Force regeneration even if PDF already exists
 *     responses:
 *       202:
 *         description: PDF generation started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 jobId:
 *                   type: string
 *                 leaseId:
 *                   type: string
 *                 statusUrl:
 *                   type: string
 *       404:
 *         description: Lease not found or access denied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */
router.post('/:id/contract/generate', (req, res) => {
  const controller = req.app.locals.leaseContractController;
  return controller.triggerContractGeneration(req, res);
});

/**
 * @openapi
 * /api/v1/leases/contracts/queue/stats:
 *   get:
 *     summary: Get PDF generation queue statistics
 *     description: Returns statistics about the PDF generation queue including waiting, active, completed, and failed jobs.
 *     tags: [Lease Contracts]
 *     responses:
 *       200:
 *         description: Queue statistics retrieved successfully
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
 *                     queue:
 *                       type: string
 *                     waiting:
 *                       type: integer
 *                     active:
 *                       type: integer
 *                     completed:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */
router.get('/contracts/queue/stats', (req, res) => {
  const controller = req.app.locals.leaseContractController;
  return controller.getQueueStats(req, res);
});

/**
 * @openapi
 * /api/v1/leases/contracts/cleanup:
 *   post:
 *     summary: Cleanup old PDF records
 *     description: Maintenance endpoint to clean up old PDF generation records. Removes failed and completed records older than specified days.
 *     tags: [Lease Contracts]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               daysOld:
 *                 type: integer
 *                 default: 30
 *                 description: Delete records older than this many days
 *     responses:
 *       200:
 *         description: Cleanup completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     deletedFailedRecords:
 *                       type: integer
 *                     deletedCompletedRecords:
 *                       type: integer
 *                     cutoffDate:
 *                       type: string
 *                       format: date-time
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */
router.post('/contracts/cleanup', (req, res) => {
  const controller = req.app.locals.leaseContractController;
  return controller.cleanupOldRecords(req, res);
});

module.exports = router;
