class TaxController {
  constructor(taxEstimatorService) {
    this.taxEstimatorService = taxEstimatorService;
  }

  /**
   * Generate tax deduction report.
   */
  async generateReport(req, res) {
    try {
      const { landlordId, year } = req.query;
      if (!landlordId || !year) {
        return res.status(400).json({ success: false, error: 'landlordId and year are required' });
      }

      const report = this.taxEstimatorService.generateTaxDeductionReport(landlordId, parseInt(year));
      res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      console.error('[TaxController] Error generating report:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate tax report',
        details: error.message
      });
    }
  }
}

module.exports = { TaxController };
