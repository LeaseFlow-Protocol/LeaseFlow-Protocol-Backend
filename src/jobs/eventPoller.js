import { SorobanRpc } from 'stellar-sdk';
import { logLeaseEvent } from '../services/loggerService.js';
import hierarchyService from '../services/LeaseHierarchyService.js';
import metadataService from '../services/NftMetadataService.js';
import { YieldService } from '../services/yieldService.js';
import { DlqService } from '../services/dlqService.js';
import { loadConfig } from '../config.js';
import dotenv from 'dotenv';

dotenv.config();

const server = new SorobanRpc.Server(process.env.RPC_URL || 'https://soroban-testnet.stellar.org');
const CONTRACT_ID = process.env.LEASE_FLOW_CONTRACT_ADDRESS;
const config = loadConfig();

// Initialize DLQ service
const dlqService = new DlqService(config);

/**
 * Fetches and logs recent contract events with DLQ integration
 */
export async function pollLeaseEvents() {
    try {
        console.log("🔍 Scanning for LeaseFlow events...");
        
        // Get last ingested ledger from database
        const { AppDatabase } = await import('../db/appDatabase.js');
        const database = new AppDatabase(process.env.DB_PATH || './leases.db');
        const lastLedger = database.getLastIngestedLedger();
        
        const response = await server.getEvents({
            startLedger: lastLedger + 1, // Start from next ledger after last ingested
            filters: [{
                type: "contract",
                contractIds: [CONTRACT_ID]
            }]
        });

        if (response.results.length === 0) {
            console.log(`ℹ️ No new events found since ledger ${lastLedger}.`);
            return;
        }

        await hierarchyService.initialize();
        await dlqService.initialize();

        // Process events through DLQ for reliability
        for (const event of response.results) {
            const topics = event.topic.map(t => t.toString());
            let eventType = null;
            let eventData = null;

            // Determine event type and extract data
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
                // Add event to DLQ for processing
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

        // Update last ingested ledger to the highest ledger we've seen
        const maxLedger = Math.max(...response.results.map(e => e.ledger));
        database.updateLastIngestedLedger(maxLedger);
        console.log(`[EventPoller] Updated last ingested ledger to ${maxLedger}`);

    } catch (error) {
        console.error("[EventPoller] Poller Error:", error);
        
        // In case of critical errors, still try to advance ledger to prevent infinite loops
        try {
            const { AppDatabase } = await import('../db/appDatabase.js');
            const database = new AppDatabase(process.env.DB_PATH || './leases.db');
            const currentLedger = database.getLastIngestedLedger();
            database.updateLastIngestedLedger(currentLedger + 1);
            console.log(`[EventPoller] Emergency ledger advancement to ${currentLedger + 1}`);
        } catch (dbError) {
            console.error("[EventPoller] Failed to advance ledger:", dbError);
        }
    }
}

/**
 * Mock helper to parse Soroban event values (would normally use Stellar SDK XDR)
 */
function parseEventValue(val) {
    try {
        return typeof val === 'string' ? JSON.parse(val) : val;
    } catch (e) {
        return {};
    }
}