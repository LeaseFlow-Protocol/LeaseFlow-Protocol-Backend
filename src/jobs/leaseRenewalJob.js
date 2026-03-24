/**
 * Background job for lease renewal proposal generation.
 */
class LeaseRenewalJob {
  /**
   * @param {import('../services/leaseRenewalService').LeaseRenewalService} leaseRenewalService Renewal service.
   */
  constructor(leaseRenewalService) {
    this.leaseRenewalService = leaseRenewalService;
  }

  /**
   * Run a single renewal scan pass.
   *
   * @param {{asOfDate?: string}} [input={}] Optional run input.
   * @returns {{generated: number, skipped: number, errors: Array<{leaseId: string, message: string}>}}
   */
  run(input = {}) {
    return this.leaseRenewalService.scanAndGenerate(input);
  }
}

/**
 * Start an interval-based scheduler for the lease renewal job.
 *
 * @param {LeaseRenewalJob} job Lease renewal job.
 * @param {{jobs: {intervalMs: number}}} config Runtime config.
 * @returns {NodeJS.Timeout}
 */
function startLeaseRenewalScheduler(job, config) {
  return setInterval(() => {
    job.run();
  }, config.jobs.intervalMs);
}

module.exports = {
  LeaseRenewalJob,
  startLeaseRenewalScheduler,
};
