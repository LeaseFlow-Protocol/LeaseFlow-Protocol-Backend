import { SorobanRpc } from 'stellar-sdk';
import { logLeaseEvent } from '../services/loggerService.js';
import hierarchyService from '../services/LeaseHierarchyService.js';
import metadataService from '../services/NftMetadataService.js';
import dotenv from 'dotenv';

dotenv.config();

const server = new SorobanRpc.Server(process.env.RPC_URL || 'https://soroban-testnet.stellar.org');
const CONTRACT_ID = process.env.LEASE_FLOW_CONTRACT_ADDRESS;

/**
 * Fetches and logs recent contract events
 */
export async function pollLeaseEvents() {
    try {
        console.log("🔍 Scanning for LeaseFlow events...");
        
        const response = await server.getEvents({
            startLedger: 0, // In a real app, store the last ledger seen in your DB
            filters: [{
                type: "contract",
                contractIds: [CONTRACT_ID]
            }]
        });

        if (response.results.length === 0) {
            console.log("ℹ️ No new events found.");
            return;
        }

        await hierarchyService.initialize();

        response.results.forEach(async (event) => {
            const topics = event.topic.map(t => t.toString());
            
            // Existing LeaseStarted logic
            if (topics.some(t => t.includes('LeaseStarted'))) {
                logLeaseEvent('LeaseStarted Event Captured', {
                    contractAddress: event.contractId,
                    txHash: event.txHash,
                    ledger: event.ledger,
                    rawData: event.value
                });
                
                const eventData = parseEventValue(event.value);
                if (eventData.lease_id) {
                    await metadataService.invalidateCache(CONTRACT_ID, eventData.lease_id);
                }
            }

            // New SubleaseCreated logic
            if (topics.some(t => t.includes('SubleaseCreated'))) {
                const eventData = parseEventValue(event.value); // Helper to parse XDR/JSON
                await hierarchyService.handleSubleaseCreated({
                    leaseId: eventData.lease_id,
                    parentLeaseId: eventData.parent_id,
                    tenantId: eventData.tenant,
                    landlordId: eventData.landlord,
                    rentAmount: eventData.rent,
                    currency: eventData.currency,
                    startDate: eventData.start,
                    endDate: eventData.end
                });
                await metadataService.invalidateCache(CONTRACT_ID, eventData.lease_id);
            }

            // New DerivedHierarchyBurned logic
            if (topics.some(t => t.includes('DerivedHierarchyBurned'))) {
                const eventData = parseEventValue(event.value);
                await hierarchyService.handleDerivedHierarchyBurned(eventData.root_lease_id);
                // Invalidate all? For now just root
                await metadataService.invalidateCache(CONTRACT_ID, eventData.root_lease_id);
            }
        });

    } catch (error) {
        console.error(" Poller Error:", error.message);
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