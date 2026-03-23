const algosdk = require('algosdk');
const NotificationService = require('./notificationService');

class LeaseMonitoringService {
  constructor() {
    this.contractId = 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4';
    this.algodClient = null;
    this.notificationService = new NotificationService();
    this.SECONDS_PER_BLOCK = 4.5; // Algorand average block time
    this.NOTIFICATION_THRESHOLD_HOURS = 1; // Notify 1 hour before expiry
    this.CHECK_INTERVAL_MINUTES = 15; // Check every 15 minutes
    this.processedNotifications = new Set(); // Track sent notifications to avoid duplicates
  }

  async initialize() {
    require('dotenv').config();
    
    const algodToken = process.env.ALGOD_TOKEN || '';
    const algodServer = process.env.ALGOD_SERVER || 'https://testnet-api.algonode.cloud';
    const algodPort = parseInt(process.env.ALGOD_PORT) || 443;
    
    this.algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort);
    await this.notificationService.initialize();
    
    console.log('LeaseMonitoringService initialized');
  }

  async checkLeasesEndingSoon() {
    if (!this.algodClient) {
      throw new Error('Service not initialized');
    }

    try {
      const appInfo = await this.algodClient.getApplicationByID(parseInt(this.contractId)).do();
      const globalState = appInfo.params['global-state'] || [];
      
      const leases = this.extractAllLeases(globalState);
      const endingSoon = leases.filter(lease => this.isLeaseEndingSoon(lease));
      
      console.log(`Found ${endingSoon.length} leases ending soon out of ${leases.length} total leases`);
      
      const notifications = [];
      for (const lease of endingSoon) {
        try {
          const result = await this.sendNotification(lease);
          notifications.push(result);
        } catch (error) {
          console.error(`Failed to send notification for lease ${lease.assetId}:`, error);
          notifications.push({ 
            assetId: lease.assetId, 
            success: false, 
            error: error.message 
          });
        }
      }
      
      return {
        totalLeases: leases.length,
        endingSoon: endingSoon.length,
        notifications: notifications
      };

    } catch (error) {
      console.error('Error checking leases ending soon:', error);
      throw error;
    }
  }

  extractAllLeases(globalState) {
    const leases = [];
    
    globalState.forEach(state => {
      const key = Buffer.from(state.key, 'base64').toString('utf8');
      
      if (key.startsWith('lease_')) {
        const assetId = key.replace('lease_', '');
        const leaseData = this.parseLeaseData(state.value);
        
        if (leaseData) {
          leases.push({
            assetId,
            ...leaseData,
            assetName: leaseData.assetName || `Asset ${assetId}`,
            renterEmail: leaseData.renterEmail,
            renterPhone: leaseData.renterPhone,
            renterAddress: leaseData.renterAddress || leaseData.tenant || 'Unknown'
          });
        }
      }
    });
    
    return leases;
  }

  parseLeaseData(value) {
    if (value.type === 1) {
      return { renter_balance: parseInt(value.uint) };
    }
    
    if (value.type === 2) {
      try {
        const byteValue = Buffer.from(value.bytes, 'base64').toString('utf8');
        return JSON.parse(byteValue);
      } catch (error) {
        console.error('Error parsing lease data:', error);
        return { renter_balance: 0 };
      }
    }
    
    return { renter_balance: 0 };
  }

  isLeaseEndingSoon(lease) {
    // Skip if already notified
    const notificationKey = `${lease.assetId}_${lease.start_timestamp}_${lease.duration_blocks}`;
    if (this.processedNotifications.has(notificationKey)) {
      return false;
    }

    // Check if lease has balance
    if (!lease.renter_balance || lease.renter_balance <= 0) {
      return false;
    }

    // Calculate expiry time
    if (!lease.start_timestamp || !lease.duration_blocks) {
      return false;
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const startTimestamp = lease.start_timestamp;
    const durationBlocks = lease.duration_blocks;
    const durationSeconds = durationBlocks * this.SECONDS_PER_BLOCK;
    const expiryTimestamp = startTimestamp + durationSeconds;
    
    const timeUntilExpiry = expiryTimestamp - currentTimestamp;
    const thresholdSeconds = this.NOTIFICATION_THRESHOLD_HOURS * 3600;
    
    // Check if lease is within notification threshold
    if (timeUntilExpiry > 0 && timeUntilExpiry <= thresholdSeconds) {
      this.processedNotifications.add(notificationKey);
      return true;
    }
    
    return false;
  }

  calculateTimeRemaining(lease) {
    if (!lease.start_timestamp || !lease.duration_blocks) {
      return null;
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const startTimestamp = lease.start_timestamp;
    const durationBlocks = lease.duration_blocks;
    const durationSeconds = durationBlocks * this.SECONDS_PER_BLOCK;
    const expiryTimestamp = startTimestamp + durationSeconds;
    
    const timeRemaining = expiryTimestamp - currentTimestamp;
    
    if (timeRemaining <= 0) {
      return { hours: 0, minutes: 0, expired: true };
    }
    
    const hours = Math.floor(timeRemaining / 3600);
    const minutes = Math.floor((timeRemaining % 3600) / 60);
    
    return { hours, minutes, expired: false };
  }

  async sendNotification(lease) {
    const timeRemaining = this.calculateTimeRemaining(lease);
    
    if (!timeRemaining) {
      throw new Error('Cannot calculate time remaining for lease');
    }

    const notificationData = {
      renterEmail: lease.renterEmail,
      renterPhone: lease.renterPhone,
      assetName: lease.assetName,
      assetId: lease.assetId,
      hoursRemaining: timeRemaining.hours,
      renterAddress: lease.renterAddress
    };

    const results = await this.notificationService.sendLeaseEndingSoonNotification(notificationData);
    
    return {
      assetId: lease.assetId,
      assetName: lease.assetName,
      timeRemaining,
      notifications: results,
      success: results.some(r => r.success)
    };
  }

  async getLeaseStatus(assetId) {
    if (!this.algodClient) {
      throw new Error('Service not initialized');
    }

    try {
      const appInfo = await this.algodClient.getApplicationByID(parseInt(this.contractId)).do();
      const globalState = appInfo.params['global-state'] || [];
      
      const leaseKey = `lease_${assetId}`;
      for (const state of globalState) {
        const key = Buffer.from(state.key, 'base64').toString('utf8');
        
        if (key === leaseKey) {
          const leaseData = this.parseLeaseData(state.value);
          const timeRemaining = this.calculateTimeRemaining(leaseData);
          const endingSoon = this.isLeaseEndingSoon({ assetId, ...leaseData });
          
          return {
            assetId,
            ...leaseData,
            timeRemaining,
            endingSoon,
            notificationSent: this.processedNotifications.has(`${assetId}_${leaseData.start_timestamp}_${leaseData.duration_blocks}`)
          };
        }
      }
      
      return { assetId, status: 'not_found' };

    } catch (error) {
      console.error(`Error getting lease status for asset ${assetId}:`, error);
      throw error;
    }
  }

  clearProcessedNotifications() {
    this.processedNotifications.clear();
    console.log('Processed notifications cache cleared');
  }

  getConfiguration() {
    return {
      contractId: this.contractId,
      notificationThresholdHours: this.NOTIFICATION_THRESHOLD_HOURS,
      checkIntervalMinutes: this.CHECK_INTERVAL_MINUTES,
      secondsPerBlock: this.SECONDS_PER_BLOCK,
      processedNotificationsCount: this.processedNotifications.size,
      notificationService: this.notificationService.getConfigurationStatus()
    };
  }
}

module.exports = LeaseMonitoringService;
