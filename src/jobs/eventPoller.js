import { SorobanRpc } from 'stellar-sdk';
import { logLeaseEvent } from '../services/loggerService.js';
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

        response.results.forEach(event => {
            // Check if the event topic is 'LeaseStarted'
            // Topics are usually base64 encoded or hex in the RPC response
            const isLeaseStarted = event.topic.some(t => t.includes('LeaseStarted'));

            if (isLeaseStarted) {
                logLeaseEvent('LeaseStarted Event Captured', {
                    contractAddress: event.contractId,
                    txHash: event.txHash,
                    ledger: event.ledger,
                    rawData: event.value
                });
            }
        });

    } catch (error) {
        console.error(" Poller Error:", error.message);
    }
}