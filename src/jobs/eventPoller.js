const dotenv = require('dotenv');
const { logLeaseEvent } = require('../services/loggerService');
const hierarchyService = require('../services/LeaseHierarchyService');
const metadataService = require('../services/NftMetadataService');
const { YieldService } = require('../services/yieldService');
const { DlqService } = require('../services/dlqService');
const { loadConfig } = require('../config');

dotenv.config();

let SorobanRpc;
try {
  SorobanRpc = require('@stellar/stellar-sdk').SorobanRpc;
} catch (e) {
  try {
    SorobanRpc = require('stellar-sdk').SorobanRpc;
  } catch (e2) {
    SorobanRpc = null;
  }
}

const server = SorobanRpc ? new SorobanRpc.Server(process.env.RPC_URL || 'https://soroban-testnet.stellar.org') : null;
const CONTRACT_ID = process.env.LEASE_FLOW_CONTRACT_ADDRESS;
const config = loadConfig();

const dlqService = new DlqService(config);

async function pollLeaseEvents() {
    try {
        console.log("Scanning for LeaseFlow events...");
        
        const { AppDatabase } = require('../db/appDatabase');
        const database = new AppDatabase(process.env.DB_PATH || './leases.db');
        const lastLedger = database.getLastIngestedLedger();
        
        const response = await server.getEvents({
            startLedger: lastLedger + 1,
            filters: [{
                type: "contract",
                contractIds: [CONTRACT_ID]
            }]
        });

        if (response.results.length === 0) {
            console.log(`No new events found since ledger ${lastLedger}.`);
            return;
        }

        await hierarchyService.initialize();
        await dlqService.initialize();

        for (const event of response.results) {
            const topics = event.topic.map(t => t.toString());
            let eventType = null;
            let eventData = null;

            if (topics.some(t => t.includes('LeaseStarted'))) {
                eventType = 'LeaseStarted';
                eventData = parseEventValue(event.value);
            } else if (topics.some(t => t.includes('SubleaseCreated'))) {
                eventType = 'SubleaseCreated';
                eventData = parseEventValue(event.value);
            } else if (topics.some(t => t.includes('DerivedHierarchyBurned'))) {
                eventType = 'DerivedHierarchyBurned';
                eventData = parseEventValue(event.value);
            } else if (topics.some(t => t.includes('EscrowYieldHarvested'))) {
                eventType = 'EscrowYieldHarvested';
                eventData = parseEventValue(event.value);
            }

            if (eventType && eventData) {
                await dlqService.addEvent({
                    eventPayload: {
                        ...eventData,
                        txHash: event.txHash,
                        contractId: event.contractId,
                        timestamp: event.timestamp
                    },
                    ledgerNumber: event.ledger,
                    eventType: eventType
                });

                console.log(`[EventPoller] Queued ${eventType} event from ledger ${event.ledger} for processing`);
            }
        }

        const maxLedger = Math.max(...response.results.map(e => e.ledger));
        database.updateLastIngestedLedger(maxLedger);
        console.log(`[EventPoller] Updated last ingested ledger to ${maxLedger}`);

    } catch (error) {
        console.error("[EventPoller] Poller Error:", error);
        
        try {
            const { AppDatabase } = require('../db/appDatabase');
            const database = new AppDatabase(process.env.DB_PATH || './leases.db');
            const currentLedger = database.getLastIngestedLedger();
            database.updateLastIngestedLedger(currentLedger + 1);
            console.log(`[EventPoller] Emergency ledger advancement to ${currentLedger + 1}`);
        } catch (dbError) {
            console.error("[EventPoller] Failed to advance ledger:", dbError);
        }
    }
}

function parseEventValue(val) {
    try {
        return typeof val === 'string' ? JSON.parse(val) : val;
    } catch (e) {
        return {};
    }
}

module.exports = { pollLeaseEvents };
