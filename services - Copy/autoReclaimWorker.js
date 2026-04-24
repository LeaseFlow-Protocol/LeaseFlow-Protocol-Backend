const cron = require('node-cron');
const algosdk = require('algosdk');

class AutoReclaimWorker {
  constructor() {
    this.contractId = 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4';
    this.algodClient = null;
    this.isRunning = false;
  }

  async initialize() {
    require('dotenv').config();

    const algodToken = process.env.ALGOD_TOKEN || '';
    const algodServer = process.env.ALGOD_SERVER || 'https://testnet-api.algonode.cloud';
    const algodPort = parseInt(process.env.ALGOD_PORT) || 443;

    this.algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort);
    console.log('AutoReclaimWorker initialized');
  }

  async checkExpiredLeases() {
    if (!this.algodClient) {
      throw new Error('Worker not initialized');
    }

    try {
      const appInfo = await this.algodClient.getApplicationByID(parseInt(this.contractId)).do();

      const globalState = appInfo.params['global-state'] || [];
      const leases = this.extractLeasesFromGlobalState(globalState);

      const expiredLeases = leases.filter(lease =>
        lease.renter_balance && lease.renter_balance <= 0
      );

      console.log(`Found ${expiredLeases.length} expired leases out of ${leases.length} total leases`);

      return expiredLeases;
    } catch (error) {
      console.error('Error checking expired leases:', error);
      throw error;
    }
  }

  extractLeasesFromGlobalState(globalState) {
    const leases = [];

    globalState.forEach(state => {
      const key = Buffer.from(state.key, 'base64').toString('utf8');

      if (key.startsWith('lease_')) {
        const leaseData = this.parseLeaseData(state.value);
        leases.push({
          id: key.replace('lease_', ''),
          ...leaseData
        });
      }
    });

    return leases.filter(lease => lease.renter_balance !== undefined);
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

  async executeReclaim(leaseId) {
    try {
      const senderAccount = this.getOwnerAccount();

      const suggestedParams = await this.algodClient.getTransactionParams().do();

      const appCallTxn = algosdk.makeApplicationCallTxnFromObject({
        from: senderAccount.addr,
        appIndex: parseInt(this.contractId),
        appArgs: [new Uint8Array(Buffer.from('reclaim'))],
        foreignAssets: [],
        accounts: [],
        appForeignApps: [],
        suggestedParams,
        onComplete: algosdk.OnApplicationComplete.NoOpOC
      });

      const signedTxn = appCallTxn.signTxn(senderAccount.sk);
      const txId = appCallTxn.txID().toString();

      await this.algodClient.sendRawTransaction(signedTxn).do();

      const confirmedTxn = await algosdk.waitForConfirmation(this.algodClient, txId, 4);

      console.log(`Successfully reclaimed lease ${leaseId}. Transaction ID: ${txId}`);
      return confirmedTxn;

    } catch (error) {
      console.error(`Failed to reclaim lease ${leaseId}:`, error);
      throw error;
    }
  }

  getOwnerAccount() {
    const ownerMnemonic = process.env.OWNER_MNEMONIC;
    if (!ownerMnemonic) {
      throw new Error('OWNER_MNEMONIC environment variable not set');
    }

    return algosdk.mnemonicToSecretKey(ownerMnemonic);
  }

  async runReclaimCycle() {
    if (this.isRunning) {
      console.log('Reclaim cycle already running, skipping...');
      return;
    }

    this.isRunning = true;

    try {
      console.log('Starting auto-reclaim cycle...');

      const expiredLeases = await this.checkExpiredLeases();

      for (const lease of expiredLeases) {
        console.log(`Reclaiming lease ${lease.id} with balance ${lease.renter_balance}`);
        await this.executeReclaim(lease.id);
      }

      console.log('Auto-reclaim cycle completed');

    } catch (error) {
      console.error('Error in reclaim cycle:', error);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    console.log('Starting Auto-Reclaim Worker (every 10 minutes)...');

    cron.schedule('*/10 * * * *', async () => {
      await this.runReclaimCycle();
    });

    setTimeout(() => this.runReclaimCycle(), 5000);
  }
}

module.exports = AutoReclaimWorker;
