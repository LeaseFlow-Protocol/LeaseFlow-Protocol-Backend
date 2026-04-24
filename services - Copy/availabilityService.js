const algosdk = require('algosdk');

class AvailabilityService {
  constructor() {
    this.contractId = 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4';
    this.algodClient = null;
    this.SECONDS_PER_BLOCK = 4.5; // Algorand average block time
  }

  async initialize() {
    require('dotenv').config();
    
    const algodToken = process.env.ALGOD_TOKEN || '';
    const algodServer = process.env.ALGOD_SERVER || 'https://testnet-api.algonode.cloud';
    const algodPort = parseInt(process.env.ALGOD_PORT) || 443;
    
    this.algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort);
    console.log('AvailabilityService initialized');
  }

  async getAssetAvailability(assetId) {
    if (!this.algodClient) {
      throw new Error('Service not initialized');
    }

    try {
      const appInfo = await this.algodClient.getApplicationByID(parseInt(this.contractId)).do();
      const globalState = appInfo.params['global-state'] || [];
      
      const leaseData = this.extractLeaseDataForAsset(globalState, assetId);
      
      if (!leaseData) {
        return {
          assetId,
          status: 'available',
          currentLease: null,
          expiryDate: null,
          nextAvailableDate: null
        };
      }

      const expiryDate = this.calculateExpiryDate(leaseData);
      const isExpired = this.isLeaseExpired(leaseData, expiryDate);

      return {
        assetId,
        status: isExpired ? 'available' : 'leased',
        currentLease: {
          tenant: leaseData.tenant || 'unknown',
          startDate: new Date(leaseData.start_timestamp * 1000).toISOString(),
          renterBalance: leaseData.renter_balance || 0
        },
        expiryDate: expiryDate ? expiryDate.toISOString() : null,
        nextAvailableDate: expiryDate && !isExpired ? expiryDate.toISOString() : new Date().toISOString()
      };

    } catch (error) {
      console.error(`Error fetching availability for asset ${assetId}:`, error);
      throw error;
    }
  }

  extractLeaseDataForAsset(globalState, assetId) {
    const leaseKey = `lease_${assetId}`;
    
    for (const state of globalState) {
      const key = Buffer.from(state.key, 'base64').toString('utf8');
      
      if (key === leaseKey) {
        return this.parseLeaseData(state.value);
      }
    }
    
    return null;
  }

  parseLeaseData(value) {
    if (value.type === 1) {
      const intValue = parseInt(value.uint);
      return { renter_balance: intValue };
    }
    
    if (value.type === 2) {
      const byteValue = Buffer.from(value.bytes, 'base64').toString('utf8');
      try {
        return JSON.parse(byteValue);
      } catch {
        return { renter_balance: 0 };
      }
    }
    
    return { renter_balance: 0 };
  }

  calculateExpiryDate(leaseData) {
    if (!leaseData.start_timestamp || !leaseData.duration_blocks) {
      return null;
    }

    const startTimestamp = leaseData.start_timestamp;
    const durationBlocks = leaseData.duration_blocks;
    const durationSeconds = durationBlocks * this.SECONDS_PER_BLOCK;
    const expiryTimestamp = startTimestamp + durationSeconds;

    return new Date(expiryTimestamp * 1000);
  }

  isLeaseExpired(leaseData, expiryDate) {
    if (!expiryDate) {
      return leaseData.renter_balance <= 0;
    }

    const now = new Date();
    const balanceExpired = leaseData.renter_balance <= 0;
    const timeExpired = now > expiryDate;

    return balanceExpired || timeExpired;
  }

  async getMultipleAssetAvailability(assetIds) {
    const availabilityPromises = assetIds.map(id => 
      this.getAssetAvailability(id).catch(error => ({
        assetId: id,
        status: 'error',
        error: error.message
      }))
    );

    return Promise.all(availabilityPromises);
  }

  async getAllAssetsAvailability() {
    if (!this.algodClient) {
      throw new Error('Service not initialized');
    }

    try {
      const appInfo = await this.algodClient.getApplicationByID(parseInt(this.contractId)).do();
      const globalState = appInfo.params['global-state'] || [];
      
      const assetIds = this.extractAllAssetIds(globalState);
      
      if (assetIds.length === 0) {
        return [];
      }

      return await this.getMultipleAssetAvailability(assetIds);

    } catch (error) {
      console.error('Error fetching all assets availability:', error);
      throw error;
    }
  }

  extractAllAssetIds(globalState) {
    const assetIds = new Set();
    
    globalState.forEach(state => {
      const key = Buffer.from(state.key, 'base64').toString('utf8');
      
      if (key.startsWith('lease_')) {
        const assetId = key.replace('lease_', '');
        assetIds.add(assetId);
      }
    });
    
    return Array.from(assetIds);
  }
}

module.exports = AvailabilityService;
