/**
 * Controller for late fee inspection and management endpoints.
 */
class LateFeeController {
  /**
   * @param {import('../services/lateFeeService').LateFeeService} lateFeeService
   */
  constructor(lateFeeService) {
    this.lateFeeService = lateFeeService;
  }

  /**
   * GET /api/late-fees/:leaseId
   * Retrieve accrued late fees for a lease.
   */
  getLeaseLateFees(req, res) {
    try {
      const { leaseId } = req.params;
      const data = this.lateFeeService.getLeaseLateFees(leaseId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("[LateFeeController] Error fetching late fees:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * POST /api/late-fees/assess
   * Manually trigger a late fee assessment pass (admin use).
   */
  triggerAssessment(req, res) {
    try {
      const { asOfDate } = req.body || {};
      const result = this.lateFeeService.assessLateFees({ asOfDate });
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error("[LateFeeController] Error assessing late fees:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = { LateFeeController };
