const cron = require('node-cron');
const { AbandonedAssetTracker } = require('../services/abandonedAssetTracker');

let trackingJob = null;
let trackerInstance = null;

/**
 * Initialize and start the abandoned asset tracking job
 * @param {AppDatabase} database - Database instance
 * @param {NotificationService} notificationService - Notification service instance
 */
function startAbandonedAssetTrackingJob(database, notificationService) {
  if (trackingJob) {
    console.log('Abandoned asset tracking job is already running');
    return;
  }

  // Initialize tracker instance
  trackerInstance = new AbandonedAssetTracker(database, notificationService);

  // Run every hour to check for abandoned assets and send alerts
  trackingJob = cron.schedule('0 * * * *', async () => {
    console.log('Running abandoned asset tracking job...');
    try {
      const results = await trackerInstance.runTrackingProcess();
      console.log('Abandoned asset tracking completed:', results);
    } catch (error) {
      console.error('Error in abandoned asset tracking job:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  console.log('Abandoned asset tracking job started (runs every hour)');
}

/**
 * Stop the abandoned asset tracking job
 */
function stopAbandonedAssetTrackingJob() {
  if (trackingJob) {
    trackingJob.stop();
    trackingJob = null;
    trackerInstance = null;
    console.log('Abandoned asset tracking job stopped');
  }
}

/**
 * Get the current tracker instance
 * @returns {AbandonedAssetTracker|null} Current tracker instance
 */
function getAbandonedAssetTracker() {
  return trackerInstance;
}

/**
 * Run the tracking process manually (for testing or immediate execution)
 * @param {AppDatabase} database - Database instance
 * @param {NotificationService} notificationService - Notification service instance
 * @returns {Promise<Object>} Tracking results
 */
async function runAbandonedAssetTrackingManually(database, notificationService) {
  const tracker = new AbandonedAssetTracker(database, notificationService);
  return await tracker.runTrackingProcess();
}

module.exports = {
  startAbandonedAssetTrackingJob,
  stopAbandonedAssetTrackingJob,
  getAbandonedAssetTracker,
  runAbandonedAssetTrackingManually,
  AbandonedAssetTracker
};
