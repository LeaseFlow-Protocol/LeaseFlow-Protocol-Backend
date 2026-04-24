const cron = require("node-cron");

/**
 * Background job that runs the daily late fee assessment.
 */
class LateFeeJob {
  /**
   * @param {import('../services/lateFeeService').LateFeeService} lateFeeService
   */
  constructor(lateFeeService) {
    this.lateFeeService = lateFeeService;
  }

  /**
   * Execute a single late fee assessment pass.
   *
   * @param {{asOfDate?: string}} [input={}]
   * @returns {{assessed: number, skipped: number, errors: Array<{leaseId: string, message: string}>}}
   */
  run(input = {}) {
    console.log("[LateFeeJob] Running daily late fee assessment...");
    const result = this.lateFeeService.assessLateFees(input);
    console.log(
      `[LateFeeJob] Complete — assessed: ${result.assessed}, skipped: ${result.skipped}, errors: ${result.errors.length}`,
    );
    return result;
  }
}

/**
 * Start the node-cron scheduler for daily late fee enforcement.
 * Runs every day at midnight UTC by default.
 *
 * @param {LateFeeJob} job
 * @param {{jobs?: {lateFeeCron?: string}}} config
 * @returns {import('node-cron').ScheduledTask}
 */
function startLateFeeScheduler(job, config = {}) {
  const cronExpression = config.jobs?.lateFeeCron || "0 0 * * *";
  console.log(
    `[LateFeeScheduler] Scheduling late fee job with cron: ${cronExpression}`,
  );

  const task = cron.schedule(
    cronExpression,
    () => {
      try {
        job.run();
      } catch (error) {
        console.error(
          "[LateFeeScheduler] Unhandled error in late fee job:",
          error,
        );
      }
    },
    {
      timezone: "UTC",
    },
  );

  return task;
}

module.exports = {
  LateFeeJob,
  startLateFeeScheduler,
};
