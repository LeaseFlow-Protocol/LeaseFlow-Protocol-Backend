const { Server, Networks } = require('@stellar/stellar-sdk');
const EventEmitter = require('events');

/**
 * Stellar Event Listener for RWA transfers
 * Listens to Stellar network for RWA contract events and processes them
 */
class StellarEventListener extends EventEmitter {
  constructor(config, database, adapterRegistry) {
    super();
    this.config = config;
    this.database = database;
    this.adapterRegistry = adapterRegistry;
    this.network = config.network || 'testnet';
    this.server = new Server(
      this.network === 'public' 
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org'
    );
    this.networkPassphrase = this.network === 'public' 
      ? Networks.PUBLIC
      : Networks.TESTNET;
    
    this.isRunning = false;
    this.streams = new Map(); // contractAddress -> stream
    this.cursors = new Map(); // contractAddress -> last cursor
    this.retryAttempts = new Map(); // contractAddress -> retry count
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 5000;
  }

  /**
   * Start listening for events from all active RWA contracts
   * @returns {Promise<void>}
   */
  async start() {
    try {
      console.log('[StellarEventListener] Starting RWA event listener...');
      
      // Get all active RWA contracts from database
      const contracts = this.getActiveRwaContracts();
      
      if (contracts.length === 0) {
        console.log('[StellarEventListener] No active RWA contracts found to monitor');
        return;
      }
      
      // Start streaming for each contract
      for (const contract of contracts) {
        await this.startContractStreaming(contract);
      }
      
      this.isRunning = true;
      console.log(`[StellarEventListener] Started monitoring ${contracts.length} RWA contracts`);
      
      this.emit('started', { contractsCount: contracts.length });
    } catch (error) {
      console.error('[StellarEventListener] Error starting event listener:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop listening for events
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      console.log('[StellarEventListener] Stopping RWA event listener...');
      
      // Close all active streams
      for (const [contractAddress, stream] of this.streams) {
        try {
          if (stream && typeof stream.close === 'function') {
            stream.close();
          }
        } catch (error) {
          console.error(`[StellarEventListener] Error closing stream for ${contractAddress}:`, error);
        }
      }
      
      this.streams.clear();
      this.isRunning = false;
      
      console.log('[StellarEventListener] RWA event listener stopped');
      this.emit('stopped');
    } catch (error) {
      console.error('[StellarEventListener] Error stopping event listener:', error);
      this.emit('error', error);
    }
  }

  /**
   * Start streaming events for a specific contract
   * @param {object} contract - Contract object from database
   * @returns {Promise<void>}
   */
  async startContractStreaming(contract) {
    try {
      const contractAddress = contract.contract_address;
      const standard = contract.rwa_standard;
      
      console.log(`[StellarEventListener] Starting stream for contract ${contractAddress} (${standard})`);
      
      // Get appropriate adapter for this contract
      const adapter = this.adapterRegistry.getAdapter(standard);
      if (!adapter) {
        console.error(`[StellarEventListener] No adapter found for standard: ${standard}`);
        return;
      }
      
      // Get last cursor for this contract
      let cursor = contract.last_event_cursor;
      if (!cursor) {
        cursor = await this.getLatestCursor(contractAddress);
      }
      
      // Start streaming
      const stream = this.server.transactions()
        .forAccount(contractAddress)
        .cursor(cursor)
        .stream({
          onmessage: async (transaction) => {
            await this.handleTransaction(transaction, contract, adapter);
            // Update cursor
            this.cursors.set(contractAddress, transaction.paging_token);
            this.updateContractCursor(contractAddress, transaction.paging_token);
          },
          onerror: (error) => {
            console.error(`[StellarEventListener] Stream error for ${contractAddress}:`, error);
            this.handleStreamError(contract, error);
          },
          onclose: () => {
            console.log(`[StellarEventListener] Stream closed for ${contractAddress}`);
            this.streams.delete(contractAddress);
            // Attempt to restart after delay
            setTimeout(() => {
              if (this.isRunning) {
                this.startContractStreaming(contract);
              }
            }, this.retryDelay);
          }
        });
      
      this.streams.set(contractAddress, stream);
      console.log(`[StellarEventListener] Stream started for contract ${contractAddress}`);
      
    } catch (error) {
      console.error(`[StellarEventListener] Error starting stream for contract ${contract.contract_address}:`, error);
      this.handleStreamError(contract, error);
    }
  }

  /**
   * Handle incoming transaction
   * @param {object} transaction - Stellar transaction
   * @param {object} contract - Contract object
   * @param {object} adapter - RWA adapter
   * @returns {Promise<void>}
   */
  async handleTransaction(transaction, contract, adapter) {
    try {
      console.log(`[StellarEventListener] Processing transaction ${transaction.hash} for contract ${contract.contract_address}`);
      
      // Parse events using the appropriate adapter
      const events = adapter.parseTransferEvents(transaction, contract.contract_address);
      
      if (events.length === 0) {
        console.log(`[StellarEventListener] No RWA events found in transaction ${transaction.hash}`);
        return;
      }
      
      // Process each event
      for (const event of events) {
        await this.processEvent(event, contract);
      }
      
      console.log(`[StellarEventListener] Processed ${events.length} events from transaction ${transaction.hash}`);
      this.emit('eventsProcessed', { transactionHash: transaction.hash, eventsCount: events.length });
      
    } catch (error) {
      console.error(`[StellarEventListener] Error handling transaction ${transaction.hash}:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Process a single RWA event
   * @param {object} event - Parsed event data
   * @param {object} contract - Contract object
   * @returns {Promise<void>}
   */
  async processEvent(event, contract) {
    try {
      console.log(`[StellarEventListener] Processing event ${event.id} for asset ${event.assetId}`);
      
      // Store the transfer event in database
      await this.storeTransferEvent(event);
      
      // Update the asset ownership cache
      await this.updateAssetOwnershipCache(event, contract);
      
      // Emit event for other services
      this.emit('rwaEvent', event);
      
      // Special handling for frozen/burned assets
      if (event.eventType === 'freeze') {
        await this.handleAssetFreeze(event);
      } else if (event.eventType === 'burn') {
        await this.handleAssetBurn(event);
      }
      
      console.log(`[StellarEventListener] Successfully processed event ${event.id}`);
      
    } catch (error) {
      console.error(`[StellarEventListener] Error processing event ${event.id}:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Store transfer event in database
   * @param {object} event - Event data
   * @returns {Promise<void>}
   */
  async storeTransferEvent(event) {
    try {
      const now = new Date().toISOString();
      
      this.database.db.prepare(`
        INSERT OR REPLACE INTO asset_transfer_events (
          id, event_id, asset_id, from_owner_pubkey, to_owner_pubkey,
          rwa_contract_address, transaction_hash, ledger_sequence, operation_index,
          event_type, event_data, processed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.id, // Use event.id as event_id for uniqueness
        event.assetId,
        event.fromOwnerPubkey,
        event.toOwnerPubkey,
        event.contractAddress,
        event.transactionHash,
        event.ledgerSequence,
        event.operationIndex,
        event.eventType,
        JSON.stringify(event.eventData),
        now,
        now
      );
      
    } catch (error) {
      console.error('[StellarEventListener] Error storing transfer event:', error);
      throw error;
    }
  }

  /**
   * Update asset ownership cache
   * @param {object} event - Event data
   * @param {object} contract - Contract object
   * @returns {Promise<void>}
   */
  async updateAssetOwnershipCache(event, contract) {
    try {
      const now = new Date().toISOString();
      
      // For transfer events, update the owner
      if (event.eventType === 'transfer') {
        this.database.db.prepare(`
          INSERT OR REPLACE INTO asset_ownership_cache (
            id, asset_id, owner_pubkey, rwa_contract_address, rwa_standard,
            asset_type, is_frozen, is_burned, transfer_count, last_transfer_hash,
            last_transfer_at, cache_updated_at, blockchain_verified_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `asset_${event.assetId}_${contract.contract_address}`,
          event.assetId,
          event.toOwnerPubkey,
          contract.contract_address,
          contract.rwa_standard,
          contract.asset_type,
          0, // is_frozen - will be updated separately if needed
          0, // is_burned - will be updated separately if needed
          this.getTransferCount(event.assetId, contract.contract_address) + 1,
          event.transactionHash,
          event.timestamp,
          now,
          now,
          now,
          now
        );
      }
      
      // For freeze/burn events, update the asset status
      if (event.eventType === 'freeze') {
        this.database.db.prepare(`
          UPDATE asset_ownership_cache 
          SET is_frozen = 1, cache_updated_at = ?, updated_at = ?
          WHERE asset_id = ? AND rwa_contract_address = ?
        `).run(now, now, event.assetId, contract.contract_address);
      }
      
      if (event.eventType === 'burn') {
        this.database.db.prepare(`
          UPDATE asset_ownership_cache 
          SET is_burned = 1, cache_updated_at = ?, updated_at = ?
          WHERE asset_id = ? AND rwa_contract_address = ?
        `).run(now, now, event.assetId, contract.contract_address);
      }
      
    } catch (error) {
      console.error('[StellarEventListener] Error updating asset ownership cache:', error);
      throw error;
    }
  }

  /**
   * Handle asset freeze event
   * @param {object} event - Freeze event data
   * @returns {Promise<void>}
   */
  async handleAssetFreeze(event) {
    try {
      console.log(`[StellarEventListener] Asset ${event.assetId} frozen by issuer`);
      
      // Emit special event for frozen assets
      this.emit('assetFrozen', {
        assetId: event.assetId,
        contractAddress: event.contractAddress,
        timestamp: event.timestamp
      });
      
    } catch (error) {
      console.error('[StellarEventListener] Error handling asset freeze:', error);
    }
  }

  /**
   * Handle asset burn event
   * @param {object} event - Burn event data
   * @returns {Promise<void>}
   */
  async handleAssetBurn(event) {
    try {
      console.log(`[StellarEventListener] Asset ${event.assetId} burned by issuer`);
      
      // Emit special event for burned assets
      this.emit('assetBurned', {
        assetId: event.assetId,
        contractAddress: event.contractAddress,
        timestamp: event.timestamp
      });
      
    } catch (error) {
      console.error('[StellarEventListener] Error handling asset burn:', error);
    }
  }

  /**
   * Handle stream errors with retry logic
   * @param {object} contract - Contract object
   * @param {Error} error - Stream error
   * @returns {void>}
   */
  handleStreamError(contract, error) {
    const contractAddress = contract.contract_address;
    const retryCount = this.retryAttempts.get(contractAddress) || 0;
    
    if (retryCount < this.maxRetries) {
      console.log(`[StellarEventListener] Retrying stream for ${contractAddress} (attempt ${retryCount + 1}/${this.maxRetries})`);
      
      this.retryAttempts.set(contractAddress, retryCount + 1);
      
      setTimeout(() => {
        if (this.isRunning) {
          this.startContractStreaming(contract);
        }
      }, this.retryDelay * Math.pow(2, retryCount)); // Exponential backoff
      
    } else {
      console.error(`[StellarEventListener] Max retries exceeded for contract ${contractAddress}`);
      this.emit('streamError', { contract, error, maxRetriesExceeded: true });
    }
  }

  /**
   * Get active RWA contracts from database
   * @returns {Array} Array of contract objects
   */
  getActiveRwaContracts() {
    try {
      const contracts = this.database.db.prepare(`
        SELECT id, contract_address, contract_name, rwa_standard, asset_type,
               network, is_active, monitoring_enabled, last_event_cursor,
               last_sync_at, sync_interval_minutes, created_at, updated_at
        FROM rwa_contract_registry
        WHERE is_active = 1 AND monitoring_enabled = 1
      `).all();
      
      return contracts;
    } catch (error) {
      console.error('[StellarEventListener] Error getting active contracts:', error);
      return [];
    }
  }

  /**
   * Get latest cursor for a contract
   * @param {string} contractAddress - Contract address
   * @returns {Promise<string>} Latest cursor
   */
  async getLatestCursor(contractAddress) {
    try {
      const latestTransaction = await this.server
        .transactions()
        .forAccount(contractAddress)
        .order('desc')
        .limit(1)
        .call();
      
      return latestTransaction.records[0]?.paging_token || 'now';
    } catch (error) {
      console.error(`[StellarEventListener] Error getting latest cursor for ${contractAddress}:`, error);
      return 'now';
    }
  }

  /**
   * Update contract cursor in database
   * @param {string} contractAddress - Contract address
   * @param {string} cursor - New cursor
   * @returns {void}
   */
  updateContractCursor(contractAddress, cursor) {
    try {
      this.database.db.prepare(`
        UPDATE rwa_contract_registry 
        SET last_event_cursor = ?, last_sync_at = ?
        WHERE contract_address = ?
      `).run(cursor, new Date().toISOString(), contractAddress);
    } catch (error) {
      console.error('[StellarEventListener] Error updating contract cursor:', error);
    }
  }

  /**
   * Get transfer count for an asset
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @returns {number} Transfer count
   */
  getTransferCount(assetId, contractAddress) {
    try {
      const result = this.database.db.prepare(`
        SELECT COUNT(*) as count FROM asset_transfer_events
        WHERE asset_id = ? AND rwa_contract_address = ?
      `).get(assetId, contractAddress);
      
      return result?.count || 0;
    } catch (error) {
      console.error('[StellarEventListener] Error getting transfer count:', error);
      return 0;
    }
  }

  /**
   * Get listener status
   * @returns {object} Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeStreams: this.streams.size,
      contracts: this.getActiveRwaContracts().length,
      retryAttempts: Object.fromEntries(this.retryAttempts),
      lastCursors: Object.fromEntries(this.cursors)
    };
  }

  /**
   * Add a new contract to monitor
   * @param {object} contract - Contract object
   * @returns {Promise<void>}
   */
  async addContract(contract) {
    try {
      console.log(`[StellarEventListener] Adding contract ${contract.contract_address} to monitoring`);
      
      // Insert contract into database
      const now = new Date().toISOString();
      this.database.db.prepare(`
        INSERT OR REPLACE INTO rwa_contract_registry (
          id, contract_address, contract_name, rwa_standard, asset_type,
          network, is_active, monitoring_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        contract.id || `contract_${contract.contract_address}`,
        contract.contract_address,
        contract.contract_name,
        contract.rwa_standard,
        contract.asset_type,
        contract.network || this.network,
        contract.is_active !== false ? 1 : 0,
        contract.monitoring_enabled !== false ? 1 : 0,
        now,
        now
      );
      
      // Start streaming if listener is running
      if (this.isRunning) {
        await this.startContractStreaming(contract);
      }
      
      console.log(`[StellarEventListener] Successfully added contract ${contract.contract_address}`);
      
    } catch (error) {
      console.error(`[StellarEventListener] Error adding contract ${contract.contract_address}:`, error);
      throw error;
    }
  }

  /**
   * Remove a contract from monitoring
   * @param {string} contractAddress - Contract address
   * @returns {Promise<void>}
   */
  async removeContract(contractAddress) {
    try {
      console.log(`[StellarEventListener] Removing contract ${contractAddress} from monitoring`);
      
      // Stop streaming for this contract
      const stream = this.streams.get(contractAddress);
      if (stream) {
        stream.close();
        this.streams.delete(contractAddress);
      }
      
      // Update database
      this.database.db.prepare(`
        UPDATE rwa_contract_registry 
        SET monitoring_enabled = 0, updated_at = ?
        WHERE contract_address = ?
      `).run(new Date().toISOString(), contractAddress);
      
      // Clean up tracking data
      this.cursors.delete(contractAddress);
      this.retryAttempts.delete(contractAddress);
      
      console.log(`[StellarEventListener] Successfully removed contract ${contractAddress}`);
      
    } catch (error) {
      console.error(`[StellarEventListener] Error removing contract ${contractAddress}:`, error);
      throw error;
    }
  }
}

module.exports = StellarEventListener;
