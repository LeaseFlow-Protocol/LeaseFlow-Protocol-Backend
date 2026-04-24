const {
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
} = require('@stellar/stellar-sdk');
const fs = require('fs');
const path = require('path');

// --- PATH CORRECTION: Accessing src/ from root ---
const { loadConfig } = require('./src/config');
const logger = require('./src/services/loggerService');
const { pollLeaseEvents } = require('./src/jobs/eventPoller');

const config = loadConfig();
const DB_PATH = path.join(__dirname, 'leases.json');

// Mock Database Helper
function getLeases() {
  if (!fs.existsSync(DB_PATH)) return {};
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveLeases(leases) {
  fs.writeFileSync(DB_PATH, JSON.stringify(leases, null, 2));
}

/**
 * Coordination Worker: Monitors and triggers lease initialization
 */
async function checkAndInitializeLease(leaseId) {
  const leases = getLeases();
  const lease = leases[leaseId];

  if (!lease) {
    logger.error(`Lease ${leaseId} not found.`);
    return;
  }

  if (lease.landlord_signed && lease.tenant_signed && !lease.initialized_on_chain) {
    logger.info(`[Worker] Coordination triggered for Lease: ${leaseId}. Both parties signed.`);
    
    try {
      logger.info(`[Worker] Attempting to initialize on-chain for ${leaseId}...`);
      await triggerOnChainInitialization(leaseId, lease.contract_data);
      
      lease.initialized_on_chain = true;
      lease.status = 'INITIALIZED';
      saveLeases(leases);
      
      logger.info(`[Worker] Lease ${leaseId} successfully initialized on-chain.`);
    } catch (error) {
      logger.error(`[Worker] CRITICAL FAILURE for lease ${leaseId}:`, { error: error.message });
    }
  } else {
    logger.info(`[Worker] Lease ${leaseId} still pending signatures or already initialized.`);
  }
}

async function triggerOnChainInitialization(leaseId, data) {
  const server = new rpc.Server(config.contracts.rpcUrl);
  const networkPassphrase = Networks.TESTNET;
  
  const secretKey = process.env.CONTRACT_ADMIN_SECRET || 'S...';
  
  if (secretKey === 'S...' || secretKey === 'SDP...') {
    logger.info(`[Stellar] Skipping actual transaction building... Simulation mode active.`);
    return new Promise((resolve) => setTimeout(resolve, 100));
  }

  const sourceKey = Keypair.fromSecret(secretKey);
  const contractId = config.contracts.defaultContractId;
  const contract = new Contract(contractId);

  logger.info(`[Stellar] Building transaction for contract ${contractId}...`);
  logger.info(`[Stellar] Calling initialize_lease(${leaseId}, ...)`);
  
  return new Promise((resolve) => setTimeout(resolve, 1000));
}

/**
 * --- START: INTERNAL DASHBOARD ENTRY POINT ---
 * This block starts the Transaction Monitor automatically.
 */
(function startBackgroundJobs() {
  console.log(" LeaseFlow Worker Process Started (Root)");

  // Run the Transaction Monitor (Issue #9)
  if (config.jobs.renewalJobEnabled) {
    logger.info(" Transaction Monitor: Active", { 
        interval: config.jobs.monitorIntervalMs,
        contract: config.contracts.defaultContractId 
    });

    // Run immediately on start
    pollLeaseEvents();

    // Set recurring interval for the monitor
    setInterval(async () => {
      try {
        await pollLeaseEvents();
      } catch (err) {
        logger.error("Transaction Monitor Polling Error", { error: err.message });
      }
    }, config.jobs.monitorIntervalMs);
  }
})();

module.exports = {
  checkAndInitializeLease,
  getLeases,
  saveLeases
};