/**
 * PaymentTrackerJob
 *
 * Wraps RentPaymentTrackerService in a cron-scheduled job so that the backend
 * continuously watches Horizon for new rent payments without requiring
 * webhooks or a Mercury subscription.
 */

const cron = require('node-cron');

class PaymentTrackerJob {
  /**
   * @param {import('../../services/rentPaymentTrackerService').RentPaymentTrackerService} trackerService
   */
  constructor(trackerService) {
    this.trackerService = trackerService;
    this._task = null;
  }

  /**
   * Start the cron job.
   *
   * @param {string} [cronExpression='* * * * *']  Defaults to every minute.
   * @returns {void}
   */
  start(cronExpression = '* * * * *') {
    if (this._task) {
      return; // already running
    }

    this._task = cron.schedule(cronExpression, async () => {
      try {
        const result = await this.trackerService.poll();
        if (result.processed > 0) {
          console.log(
            `[PaymentTracker] Poll done — processed: ${result.processed}, skipped: ${result.skipped}`
          );
        }
        if (result.errors.length > 0) {
          console.error('[PaymentTracker] Errors during poll:', result.errors);
        }
      } catch (err) {
        console.error('[PaymentTracker] Unhandled error during poll:', err.message);
      }
    });

    console.log(
      `[PaymentTracker] Scheduled payment polling (cron: "${cronExpression}")`
    );
  }

  /** Stop the cron job. */
  stop() {
    if (this._task) {
      this._task.stop();
      this._task = null;
    }
  }
}

/**
 * Convenience factory — creates and starts a PaymentTrackerJob.
 *
 * @param {import('../../services/rentPaymentTrackerService').RentPaymentTrackerService} trackerService
 * @param {{cronExpression?: string}} [config]
 * @returns {PaymentTrackerJob}
 */
function startPaymentTrackerJob(trackerService, config = {}) {
  const job = new PaymentTrackerJob(trackerService);
  job.start(config.cronExpression || process.env.PAYMENT_TRACKER_CRON || '* * * * *');
  return job;
}

module.exports = { PaymentTrackerJob, startPaymentTrackerJob };
