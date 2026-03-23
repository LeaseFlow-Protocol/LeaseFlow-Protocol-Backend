const cron = require('node-cron');
const LeaseMonitoringService = require('./leaseMonitoringService');

class NotificationScheduler {
  constructor() {
    this.leaseMonitoringService = new LeaseMonitoringService();
    this.isRunning = false;
    this.tasks = new Map();
  }

  async initialize() {
    await this.leaseMonitoringService.initialize();
    console.log('NotificationScheduler initialized');
  }

  start() {
    if (this.isRunning) {
      console.log('Notification scheduler is already running');
      return;
    }

    console.log('Starting notification scheduler...');
    
    // Schedule lease monitoring to run every 15 minutes
    const monitoringTask = cron.schedule('*/15 * * * *', async () => {
      try {
        console.log('Running scheduled lease monitoring check...');
        const result = await this.leaseMonitoringService.checkLeasesEndingSoon();
        
        console.log(`Monitoring check completed:`, {
          totalLeases: result.totalLeases,
          endingSoon: result.endingSoon,
          notificationsSent: result.notifications.filter(n => n.success).length,
          failedNotifications: result.notifications.filter(n => !n.success).length
        });

      } catch (error) {
        console.error('Error in scheduled lease monitoring:', error);
      }
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    this.tasks.set('leaseMonitoring', monitoringTask);
    monitoringTask.start();
    this.isRunning = true;

    console.log('Notification scheduler started successfully');
    console.log('Lease monitoring will run every 15 minutes');
  }

  stop() {
    if (!this.isRunning) {
      console.log('Notification scheduler is not running');
      return;
    }

    console.log('Stopping notification scheduler...');
    
    this.tasks.forEach((task, name) => {
      task.stop();
      console.log(`Stopped task: ${name}`);
    });
    
    this.tasks.clear();
    this.isRunning = false;
    
    console.log('Notification scheduler stopped');
  }

  async runManualCheck() {
    console.log('Running manual lease monitoring check...');
    
    try {
      const result = await this.leaseMonitoringService.checkLeasesEndingSoon();
      console.log('Manual check completed:', result);
      return result;
    } catch (error) {
      console.error('Error in manual lease monitoring check:', error);
      throw error;
    }
  }

  async getLeaseStatus(assetId) {
    return await this.leaseMonitoringService.getLeaseStatus(assetId);
  }

  getSchedulerStatus() {
    return {
      isRunning: this.isRunning,
      activeTasks: Array.from(this.tasks.keys()),
      configuration: this.leaseMonitoringService.getConfiguration()
    };
  }

  updateSchedule(cronExpression) {
    if (!cron.validate(cronExpression)) {
      throw new Error('Invalid cron expression');
    }

    if (!this.isRunning) {
      throw new Error('Scheduler is not running');
    }

    const monitoringTask = this.tasks.get('leaseMonitoring');
    if (monitoringTask) {
      monitoringTask.stop();
      this.tasks.delete('leaseMonitoring');
    }

    const newTask = cron.schedule(cronExpression, async () => {
      try {
        console.log('Running scheduled lease monitoring check...');
        const result = await this.leaseMonitoringService.checkLeasesEndingSoon();
        
        console.log(`Monitoring check completed:`, {
          totalLeases: result.totalLeases,
          endingSoon: result.endingSoon,
          notificationsSent: result.notifications.filter(n => n.success).length,
          failedNotifications: result.notifications.filter(n => !n.success).length
        });

      } catch (error) {
        console.error('Error in scheduled lease monitoring:', error);
      }
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    this.tasks.set('leaseMonitoring', newTask);
    newTask.start();
    
    console.log(`Updated lease monitoring schedule to: ${cronExpression}`);
  }

  clearNotificationCache() {
    this.leaseMonitoringService.clearProcessedNotifications();
  }

  async testNotificationService() {
    return this.leaseMonitoringService.notificationService.getConfigurationStatus();
  }
}

module.exports = NotificationScheduler;
