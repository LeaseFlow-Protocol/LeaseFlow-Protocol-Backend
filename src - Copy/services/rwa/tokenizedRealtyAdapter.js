const RwaAdapter = require('./rwaAdapter');
const { Server, Networks } = require('@stellar/stellar-sdk');

/**
 * Tokenized Realty Adapter
 * Handles RWA tokens from specialized tokenized real estate platforms
 */
class TokenizedRealtyAdapter extends RwaAdapter {
  constructor(config) {
    super(config);
    this.server = new Server(
      config.network === 'public' 
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org'
    );
    this.networkPassphrase = config.network === 'public' 
      ? Networks.PUBLIC
      : Networks.TESTNET;
  }

  getStandard() {
    return 'tokenized-realty';
  }

  /**
   * Parse transfer events from Stellar transaction
   * @param {object} transaction - Stellar transaction object
   * @param {string} contractAddress - Tokenized realty contract address
   * @returns {Array} Array of parsed transfer events
   */
  parseTransferEvents(transaction, contractAddress) {
    const events = [];
    
    try {
      // Tokenized realty platforms often use custom data in transactions
      // Look for specific patterns in memo or operations
      
      transaction.operations?.forEach((operation, index) => {
        if (this.isRealtyOperation(operation, contractAddress)) {
          const event = {
            id: `${transaction.hash}_${index}`,
            assetId: this.extractAssetId(operation, transaction),
            fromOwnerPubkey: operation.source || transaction.source_account,
            toOwnerPubkey: this.extractRecipient(operation),
            contractAddress: contractAddress,
            transactionHash: transaction.hash,
            ledgerSequence: transaction.ledger_attr,
            operationIndex: index,
            eventType: this.determineEventType(operation),
            eventData: {
              operationType: operation.type,
              amount: operation.amount,
              propertyId: this.extractPropertyId(operation, transaction),
              jurisdiction: this.extractJurisdiction(operation, transaction),
              legalMetadata: this.extractLegalMetadata(operation, transaction)
            },
            timestamp: new Date(transaction.created_at).toISOString()
          };
          events.push(event);
        }
      });
    } catch (error) {
      console.error('[TokenizedRealtyAdapter] Error parsing transaction events:', error);
    }
    
    return events;
  }

  /**
   * Query current asset ownership from blockchain
   * @param {string} assetId - Property token ID
   * @param {string} contractAddress - Tokenized realty contract address
   * @returns {Promise<object>} Asset ownership data
   */
  async queryAssetOwnership(assetId, contractAddress) {
    try {
      // Query the contract directly for ownership information
      const contractData = await this.queryContractData(contractAddress, assetId);
      
      // Get transaction history for this asset
      const transactions = await this.getAssetTransactions(assetId, contractAddress);
      
      const ownership = {
        assetId,
        contractAddress,
        rwaStandard: this.getStandard(),
        assetType: 'real_estate',
        currentOwner: contractData.currentOwner,
        previousOwners: contractData.ownershipHistory || [],
        isFrozen: contractData.isFrozen || false,
        isBurned: contractData.isBurned || false,
        transferCount: transactions.length,
        lastTransferHash: transactions[0]?.hash || null,
        lastTransferAt: transactions[0]?.created_at || null,
        propertyDetails: {
          propertyId: assetId,
          address: contractData.propertyAddress,
          jurisdiction: contractData.jurisdiction,
          squareFootage: contractData.squareFootage,
          bedrooms: contractData.bedrooms,
          bathrooms: contractData.bathrooms,
          legalDescription: contractData.legalDescription,
          parcelNumber: contractData.parcelNumber,
          titleNumber: contractData.titleNumber
        },
        blockchainVerified: true,
        lastUpdated: new Date().toISOString()
      };

      return ownership;
    } catch (error) {
      console.error('[TokenizedRealtyAdapter] Error querying asset ownership:', error);
      throw new Error(`Failed to query asset ownership: ${error.message}`);
    }
  }

  /**
   * Check if asset is frozen
   * @param {string} assetId - Property token ID
   * @param {string} contractAddress - Tokenized realty contract address
   * @returns {Promise<boolean>} True if asset is frozen
   */
  async isAssetFrozen(assetId, contractAddress) {
    try {
      const contractData = await this.queryContractData(contractAddress, assetId);
      return contractData.isFrozen || false;
    } catch (error) {
      console.error('[TokenizedRealtyAdapter] Error checking if asset is frozen:', error);
      return false;
    }
  }

  /**
   * Check if asset is burned
   * @param {string} assetId - Property token ID
   * @param {string} contractAddress - Tokenized realty contract address
   * @returns {Promise<boolean>} True if asset is burned
   */
  async isAssetBurned(assetId, contractAddress) {
    try {
      const contractData = await this.queryContractData(contractAddress, assetId);
      return contractData.isBurned || false;
    } catch (error) {
      console.error('[TokenizedRealtyAdapter] Error checking if asset is burned:', error);
      return false;
    }
  }

  /**
   * Validate contract address format
   * @param {string} contractAddress - Contract address
   * @returns {boolean} True if valid
   */
  validateContractAddress(contractAddress) {
    try {
      // Tokenized realty contracts are Stellar smart contracts
      // They use standard Stellar address format
      return /^[G][A-Z0-9]{55}$/.test(contractAddress);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get asset type from contract
   * @param {string} contractAddress - Contract address
   * @returns {string} Asset type
   */
  async getAssetType(contractAddress) {
    try {
      // Tokenized realty contracts always handle real estate
      return 'real_estate';
    } catch (error) {
      console.error('[TokenizedRealtyAdapter] Error getting asset type:', error);
      return 'real_estate';
    }
  }

  /**
   * Query contract data for specific asset
   * @param {string} contractAddress - Contract address
   * @param {string} assetId - Asset ID
   * @returns {Promise<object>} Contract data
   */
  async queryContractData(contractAddress, assetId) {
    try {
      // In a real implementation, this would query the smart contract
      // For now, we'll simulate with account data lookups
      
      const account = await this.server.loadAccount(contractAddress);
      
      // Look for asset data in account data entries
      const dataEntries = account.data_attr || {};
      const assetDataKey = `asset_${assetId}`;
      
      if (dataEntries[assetDataKey]) {
        return JSON.parse(dataEntries[assetDataKey]);
      }
      
      // Fallback: return default structure
      return {
        currentOwner: null,
        isFrozen: false,
        isBurned: false,
        ownershipHistory: [],
        propertyAddress: 'Unknown',
        jurisdiction: 'Unknown'
      };
    } catch (error) {
      console.error('[TokenizedRealtyAdapter] Error querying contract data:', error);
      throw new Error(`Failed to query contract data: ${error.message}`);
    }
  }

  /**
   * Get transaction history for an asset
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @returns {Promise<Array>} Transaction history
   */
  async getAssetTransactions(assetId, contractAddress) {
    try {
      const transactions = await this.server
        .transactions()
        .forAccount(contractAddress)
        .order('desc')
        .limit(100)
        .call();

      // Filter transactions related to this asset
      return transactions.records.filter(tx => 
        this.isTransactionForAsset(tx, assetId)
      );
    } catch (error) {
      console.error('[TokenizedRealtyAdapter] Error getting asset transactions:', error);
      return [];
    }
  }

  /**
   * Check if operation is related to realty
   * @param {object} operation - Stellar operation
   * @param {string} contractAddress - Contract address
   * @returns {boolean} True if realty operation
   */
  isRealtyOperation(operation, contractAddress) {
    // Check if operation involves the target contract
    if (operation.source === contractAddress) {
      return true;
    }
    
    // Check for realty-specific patterns in operation data
    if (operation.type === 'payment' && operation.destination === contractAddress) {
      return true;
    }
    
    // Look for realty-specific memos
    if (operation.memo && operation.memo.type === 'text') {
      const memo = operation.memo.value.toLowerCase();
      return memo.includes('realty') || memo.includes('property') || memo.includes('estate');
    }
    
    return false;
  }

  /**
   * Extract asset ID from operation
   * @param {object} operation - Stellar operation
   * @param {object} transaction - Full transaction
   * @returns {string} Asset ID
   */
  extractAssetId(operation, transaction) {
    // Try to extract from memo first
    if (transaction.memo && transaction.memo.type === 'text') {
      const memo = transaction.memo.value;
      // Look for patterns like "PROP_001" or "REALTY_123"
      const match = memo.match(/(PROP|REALTY|PROPERTY)_\w+/i);
      if (match) {
        return match[0];
      }
    }
    
    // Fallback: generate from operation details
    return `REALTY_${operation.id || Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Extract recipient from operation
   * @param {object} operation - Stellar operation
   * @returns {string} Recipient public key
   */
  extractRecipient(operation) {
    if (operation.type === 'payment') {
      return operation.destination;
    }
    
    // For other operation types, return source
    return operation.source;
  }

  /**
   * Determine event type from operation
   * @param {object} operation - Stellar operation
   * @returns {string} Event type
   */
  determineEventType(operation) {
    switch (operation.type) {
      case 'payment':
        return 'transfer';
      case 'manage_data':
        if (operation.name.includes('freeze')) return 'freeze';
        if (operation.name.includes('unfreeze')) return 'unfreeze';
        if (operation.name.includes('burn')) return 'burn';
        return 'metadata_update';
      default:
        return 'unknown';
    }
  }

  /**
   * Extract property ID from operation
   * @param {object} operation - Stellar operation
   * @param {object} transaction - Full transaction
   * @returns {string} Property ID
   */
  extractPropertyId(operation, transaction) {
    return this.extractAssetId(operation, transaction);
  }

  /**
   * Extract jurisdiction from operation
   * @param {object} operation - Stellar operation
   * @param {object} transaction - Full transaction
   * @returns {string} Jurisdiction
   */
  extractJurisdiction(operation, transaction) {
    if (transaction.memo && transaction.memo.type === 'text') {
      const memo = transaction.memo.value;
      // Look for jurisdiction codes like "NY", "CA", "FL"
      const match = memo.match(/\b(NY|CA|FL|TX|IL|WA|AZ|CO)\b/i);
      if (match) {
        return match[0].toUpperCase();
      }
    }
    
    return 'US'; // Default fallback
  }

  /**
   * Extract legal metadata from operation
   * @param {object} operation - Stellar operation
   * @param {object} transaction - Full transaction
   * @returns {object} Legal metadata
   */
  extractLegalMetadata(operation, transaction) {
    const metadata = {
      legalReference: null,
      complianceFlags: [],
      regulatoryJurisdiction: null
    };
    
    if (transaction.memo && transaction.memo.type === 'text') {
      const memo = transaction.memo.value;
      
      // Look for legal references
      const legalMatch = memo.match(/LEGAL[_:\s]+(\w+)/i);
      if (legalMatch) {
        metadata.legalReference = legalMatch[1];
      }
      
      // Look for compliance flags
      if (memo.toLowerCase().includes('kyc')) {
        metadata.complianceFlags.push('KYC_VERIFIED');
      }
      if (memo.toLowerCase().includes('aml')) {
        metadata.complianceFlags.push('AML_CHECKED');
      }
    }
    
    return metadata;
  }

  /**
   * Check if transaction is for specific asset
   * @param {object} transaction - Stellar transaction
   * @param {string} assetId - Asset ID
   * @returns {boolean} True if transaction is for asset
   */
  isTransactionForAsset(transaction, assetId) {
    // Check memo for asset reference
    if (transaction.memo && transaction.memo.type === 'text') {
      return transaction.memo.value.includes(assetId);
    }
    
    // Check operations for asset reference
    return transaction.operations?.some(op => 
      this.extractAssetId(op, transaction) === assetId
    );
  }
}

module.exports = TokenizedRealtyAdapter;
