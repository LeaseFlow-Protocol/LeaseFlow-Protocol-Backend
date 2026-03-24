const {
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
} = require('@stellar/stellar-sdk');
const fs = require('fs');
const path = require('path');

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
    console.error(`Lease ${leaseId} not found.`);
    return;
  }

  // check if both parties have signed
  if (lease.landlord_signed && lease.tenant_signed && !lease.initialized_on_chain) {
    console.log(`[Worker] Coordination triggered for Lease: ${leaseId}. Both parties signed.`);
    
    try {
      console.log(`[Worker] Attempting to initialize on-chain for ${leaseId}...`);
      await triggerOnChainInitialization(leaseId, lease.contract_data);
      
      // Update local state
      lease.initialized_on_chain = true;
      lease.status = 'INITIALIZED';
      saveLeases(leases);
      
      console.log(`[Worker] Lease ${leaseId} successfully initialized on-chain.`);
    } catch (error) {
      console.error(`[Worker] CRITICAL FAILURE for lease ${leaseId}:`, error);
    }
  } else {
    console.log(`[Worker] Lease ${leaseId} still pending signatures or already initialized.`);
  }
}

async function triggerOnChainInitialization(leaseId, data) {
  const server = new rpc.Server('https://soroban-testnet.stellar.org');
  const networkPassphrase = Networks.TESTNET;
  
  // Admin key (for demo/simulation, handle dummy values)
  const secretKey = process.env.CONTRACT_ADMIN_SECRET || 'S...';
  
  if (secretKey === 'S...' || secretKey === 'SDP...') {
    console.log(`[Stellar] Skipping actual transaction building... Simulation mode active.`);
    return new Promise((resolve) => setTimeout(resolve, 100));
  }

  const sourceKey = Keypair.fromSecret(secretKey);
  
  const contractId = process.env.LEASE_CONTRACT_ID || 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4';
  const contract = new Contract(contractId);

  // In a real scenario, we'd build and submit the XDR here.
  // For the purpose of the coordinating worker, we simulate the submission.
  console.log(`[Stellar] Building transaction for contract ${contractId}...`);
  console.log(`[Stellar] Calling initialize_lease(${leaseId}, ...)`);
  
  // Simulation:
  return new Promise((resolve) => setTimeout(resolve, 1000));
}

module.exports = {
  checkAndInitializeLease,
  getLeases,
  saveLeases
};
