const RwaAdapter = require('./rwaAdapter');
const { Server, Networks } = require('@stellar/stellar-sdk');

/**
 * Vehicle Registry Adapter
 * Handles RWA tokens from vehicle tokenization platforms
 */
class VehicleRegistryAdapter extends RwaAdapter {
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
    return 'vehicle-registry';
  }

  /**
   * Parse transfer events from Stellar transaction
   * @param {object} transaction - Stellar transaction object
   * @param {string} contractAddress - Vehicle registry contract address
   * @returns {Array} Array of parsed transfer events
   */
  parseTransferEvents(transaction, contractAddress) {
    const events = [];
    
    try {
      transaction.operations?.forEach((operation, index) => {
        if (this.isVehicleOperation(operation, contractAddress)) {
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
              vin: this.extractVIN(operation, transaction),
              make: this.extractMake(operation, transaction),
              model: this.extractModel(operation, transaction),
              year: this.extractYear(operation, transaction),
              registrationNumber: this.extractRegistrationNumber(operation, transaction),
              jurisdiction: this.extractJurisdiction(operation, transaction),
              legalMetadata: this.extractLegalMetadata(operation, transaction)
            },
            timestamp: new Date(transaction.created_at).toISOString()
          };
          events.push(event);
        }
      });
    } catch (error) {
      console.error('[VehicleRegistryAdapter] Error parsing transaction events:', error);
    }
    
    return events;
  }

  /**
   * Query current asset ownership from blockchain
   * @param {string} assetId - Vehicle token ID
   * @param {string} contractAddress - Vehicle registry contract address
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
        assetType: 'vehicle',
        currentOwner: contractData.currentOwner,
        previousOwners: contractData.ownershipHistory || [],
        isFrozen: contractData.isFrozen || false,
        isBurned: contractData.isBurned || false,
        transferCount: transactions.length,
        lastTransferHash: transactions[0]?.hash || null,
        lastTransferAt: transactions[0]?.created_at || null,
        vehicleDetails: {
          vin: contractData.vin,
          make: contractData.make,
          model: contractData.model,
          year: contractData.year,
          registrationNumber: contractData.registrationNumber,
          jurisdiction: contractData.jurisdiction,
          titleNumber: contractData.titleNumber,
          odometerReading: contractData.odometerReading,
          lastInspectionDate: contractData.lastInspectionDate,
          insuranceStatus: contractData.insuranceStatus
        },
        blockchainVerified: true,
        lastUpdated: new Date().toISOString()
      };

      return ownership;
    } catch (error) {
      console.error('[VehicleRegistryAdapter] Error querying asset ownership:', error);
      throw new Error(`Failed to query asset ownership: ${error.message}`);
    }
  }

  /**
   * Check if asset is frozen
   * @param {string} assetId - Vehicle token ID
   * @param {string} contractAddress - Vehicle registry contract address
   * @returns {Promise<boolean>} True if asset is frozen
   */
  async isAssetFrozen(assetId, contractAddress) {
    try {
      const contractData = await this.queryContractData(contractAddress, assetId);
      return contractData.isFrozen || false;
    } catch (error) {
      console.error('[VehicleRegistryAdapter] Error checking if asset is frozen:', error);
      return false;
    }
  }

  /**
   * Check if asset is burned
   * @param {string} assetId - Vehicle token ID
   * @param {string} contractAddress - Vehicle registry contract address
   * @returns {Promise<boolean>} True if asset is burned
   */
  async isAssetBurned(assetId, contractAddress) {
    try {
      const contractData = await this.queryContractData(contractAddress, assetId);
      return contractData.isBurned || false;
    } catch (error) {
      console.error('[VehicleRegistryAdapter] Error checking if asset is burned:', error);
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
      // Vehicle registry contracts are Stellar smart contracts
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
      // Vehicle registry contracts always handle vehicles
      return 'vehicle';
    } catch (error) {
      console.error('[VehicleRegistryAdapter] Error getting asset type:', error);
      return 'vehicle';
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
      const account = await this.server.loadAccount(contractAddress);
      
      // Look for asset data in account data entries
      const dataEntries = account.data_attr || {};
      const assetDataKey = `vehicle_${assetId}`;
      
      if (dataEntries[assetDataKey]) {
        return JSON.parse(dataEntries[assetDataKey]);
      }
      
      // Fallback: return default structure
      return {
        currentOwner: null,
        isFrozen: false,
        isBurned: false,
        ownershipHistory: [],
        vin: 'Unknown',
        make: 'Unknown',
        model: 'Unknown',
        year: 'Unknown',
        registrationNumber: 'Unknown',
        jurisdiction: 'US'
      };
    } catch (error) {
      console.error('[VehicleRegistryAdapter] Error querying contract data:', error);
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
      console.error('[VehicleRegistryAdapter] Error getting asset transactions:', error);
      return [];
    }
  }

  /**
   * Check if operation is related to vehicle
   * @param {object} operation - Stellar operation
   * @param {string} contractAddress - Contract address
   * @returns {boolean} True if vehicle operation
   */
  isVehicleOperation(operation, contractAddress) {
    // Check if operation involves the target contract
    if (operation.source === contractAddress) {
      return true;
    }
    
    // Check for vehicle-specific patterns in operation data
    if (operation.type === 'payment' && operation.destination === contractAddress) {
      return true;
    }
    
    // Look for vehicle-specific memos
    if (operation.memo && operation.memo.type === 'text') {
      const memo = operation.memo.value.toLowerCase();
      return memo.includes('vehicle') || memo.includes('vin') || memo.includes('auto') || memo.includes('car');
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
      // Look for patterns like "VIN_1234567890" or "VEHICLE_ABC123"
      const match = memo.match(/(VIN|VEHICLE|AUTO|CAR)_\w+/i);
      if (match) {
        return match[0];
      }
    }
    
    // Fallback: generate from operation details
    return `VEHICLE_${operation.id || Math.random().toString(36).substr(2, 9)}`;
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
   * Extract VIN from operation
   * @param {object} operation - Stellar operation
   * @param {object} transaction - Full transaction
   * @returns {string} VIN
   */
  extractVIN(operation, transaction) {
    if (transaction.memo && transaction.memo.type === 'text') {
      const memo = transaction.memo.value;
      // Look for 17-character VIN patterns
      const vinMatch = memo.match(/[A-HJ-NPR-Z0-9]{17}/i);
      if (vinMatch) {
        return vinMatch[0].toUpperCase();
      }
    }
    
    return 'UNKNOWN_VIN';
  }

  /**
   * Extract make from operation
   * @param {object} operation - Stellar operation
   * @param {object} transaction - Full transaction
   * @returns {string} Vehicle make
   */
  extractMake(operation, transaction) {
    if (transaction.memo && transaction.memo.type === 'text') {
      const memo = transaction.memo.value;
      // Look for common car makes
      const makes = ['TOYOTA', 'HONDA', 'FORD', 'CHEVROLET', 'BMW', 'MERCEDES', 'TESLA', 'VOLKSWAGEN'];
      for (const make of makes) {
        if (memo.toUpperCase().includes(make)) {
          return make;
        }
      }
    }
    
    return 'Unknown';
  }

  /**
   * Extract model from operation
   * @param {object} operation - Stellar operation
   * @param {object} transaction - Full transaction
   * @returns {string} Vehicle model
   */
  extractModel(operation, transaction) {
    if (transaction.memo && transaction.memo.type === 'text') {
      const memo = transaction.memo.value;
      // Look for model patterns after make
      const make = this.extractMake(operation, transaction);
      if (make !== 'Unknown') {
        const modelMatch = memo.match(new RegExp(`${make}\\s+(\\w+)`, 'i'));
        if (modelMatch) {
          return modelMatch[1];
        }
      }
    }
    
    return 'Unknown';
  }

  /**
   * Extract year from operation
   * @param {object} operation - Stellar operation
   * @param {object} transaction - Full transaction
   * @returns {string} Vehicle year
   */
  extractYear(operation, transaction) {
    if (transaction.memo && transaction.memo.type === 'text') {
      const memo = transaction.memo.value;
      // Look for 4-digit year patterns (reasonable vehicle years)
      const yearMatch = memo.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        const year = parseInt(yearMatch[0]);
        if (year >= 1900 && year <= new Date().getFullYear() + 1) {
          return yearMatch[0];
        }
      }
    }
    
    return 'Unknown';
  }

  /**
   * Extract registration number from operation
   * @param {object} operation - Stellar operation
   * @param {object} transaction - Full transaction
   * @returns {string} Registration number
   */
  extractRegistrationNumber(operation, transaction) {
    if (transaction.memo && transaction.memo.type === 'text') {
      const memo = transaction.memo.value;
      // Look for registration patterns
      const regMatch = memo.match(/REG[_:\s]+(\w+)/i);
      if (regMatch) {
        return regMatch[1];
      }
    }
    
    return 'Unknown';
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
      // Look for US state codes
      const stateMatch = memo.match(/\b(AK|AL|AR|AZ|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/);
      if (stateMatch) {
        return stateMatch[0];
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
      regulatoryJurisdiction: null,
      titleStatus: null,
      lienHolder: null
    };
    
    if (transaction.memo && transaction.memo.type === 'text') {
      const memo = transaction.memo.value;
      
      // Look for legal references
      const legalMatch = memo.match(/TITLE[_:\s]+(\w+)/i);
      if (legalMatch) {
        metadata.legalReference = legalMatch[1];
      }
      
      // Look for title status
      const titleMatch = memo.match(/STATUS[_:\s]+(\w+)/i);
      if (titleMatch) {
        metadata.titleStatus = titleMatch[1];
      }
      
      // Look for lien holder
      const lienMatch = memo.match(/LIEN[_:\s]+(\w+)/i);
      if (lienMatch) {
        metadata.lienHolder = lienMatch[1];
      }
      
      // Look for compliance flags
      if (memo.toLowerCase().includes('kyc')) {
        metadata.complianceFlags.push('KYC_VERIFIED');
      }
      if (memo.toLowerCase().includes('dmv')) {
        metadata.complianceFlags.push('DMV_VERIFIED');
      }
      if (memo.toLowerCase().includes('insurance')) {
        metadata.complianceFlags.push('INSURANCE_VERIFIED');
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

module.exports = VehicleRegistryAdapter;
