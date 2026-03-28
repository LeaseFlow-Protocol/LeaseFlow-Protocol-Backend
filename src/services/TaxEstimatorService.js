/**
 * Service to generate Tax Deduction Reports for landlords.
 * Tracks Maintenance Expenses and Protocol Fees.
 */
class TaxEstimatorService {
  /**
   * @param {AppDatabase} database - Database instance
   */
  constructor(database) {
    this.db = database;
  }

  /**
   * Generate a tax deduction report for a specific landlord and year.
   * 
   * @param {string} landlordId - Landlord identifier
   * @param {number} year - Fiscal year
   * @returns {object} Tax deduction report
   */
  generateTaxDeductionReport(landlordId, year) {
    console.log(`Generating Tax Deduction Report for Landlord ${landlordId} for year ${year}`);

    // 1. Fetch maintenance expenses
    const maintenanceExpenses = this.db.listMaintenanceExpenses(landlordId, year);
    const totalMaintenance = maintenanceExpenses.reduce((sum, job) => sum + job.amount, 0);

    // 2. Fetch protocol fees (LeaseFlow Protocol Fees are tax-deductible business expenses)
    const protocolFeesList = this.db.listProtocolFees(landlordId, year);
    const totalProtocolFees = protocolFeesList.reduce((sum, rp) => sum + Number(rp.protocol_fee || 0), 0);

    // 3. Compile report
    const report = {
      landlordId,
      fiscalYear: year,
      generatedAt: new Date().toISOString(),
      summary: {
        totalDeductions: totalMaintenance + totalProtocolFees,
        maintenanceExpenseTotal: totalMaintenance,
        protocolFeeTotal: totalProtocolFees,
      },
      details: {
        maintenanceJobs: maintenanceExpenses.map(job => ({
          description: job.description,
          amount: job.amount,
          date: job.completed_at
        })),
        protocolFees: protocolFeesList.map(fee => ({
          leaseId: fee.lease_id,
          amount: Number(fee.protocol_fee),
          date: fee.date_paid
        }))
      },
      disclaimer: "This report is for informational purposes only. Please consult with a tax professional."
    };

    return report;
  }
}

module.exports = { TaxEstimatorService };
