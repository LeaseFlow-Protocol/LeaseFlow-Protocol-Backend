const StellarAssetAdapter = require('./stellarAssetAdapter');
const TokenizedRealtyAdapter = require('./tokenizedRealtyAdapter');
const VehicleRegistryAdapter = require('./vehicleRegistryAdapter');

/**
 * RWA Adapter Registry
 * Manages all RWA adapters and provides a unified interface for accessing them
 */
class RwaAdapterRegistry {
  constructor(config) {
    this.config = config;
    this.adapters = new Map();
    this.initializeAdapters();
  }

  /**
   * Initialize all available adapters
   * @returns {void}
   */
  initializeAdapters() {
    try {
      // Register Stellar Asset adapter
      this.registerAdapter('stellar-asset', new StellarAssetAdapter(this.config));
      
      // Register Tokenized Realty adapter
      this.registerAdapter('tokenized-realty', new TokenizedRealtyAdapter(this.config));
      
      // Register Vehicle Registry adapter
      this.registerAdapter('vehicle-registry', new VehicleRegistryAdapter(this.config));
      
      console.log(`[RwaAdapterRegistry] Initialized ${this.adapters.size} RWA adapters`);
    } catch (error) {
      console.error('[RwaAdapterRegistry] Error initializing adapters:', error);
    }
  }

  /**
   * Register an adapter
   * @param {string} standard - RWA standard name
   * @param {object} adapter - Adapter instance
   * @returns {void}
   */
  registerAdapter(standard, adapter) {
    if (!adapter.getStandard || typeof adapter.getStandard !== 'function') {
      throw new Error('Adapter must implement getStandard() method');
    }
    
    if (!adapter.parseTransferEvents || typeof adapter.parseTransferEvents !== 'function') {
      throw new Error('Adapter must implement parseTransferEvents() method');
    }
    
    if (!adapter.queryAssetOwnership || typeof adapter.queryAssetOwnership !== 'function') {
      throw new Error('Adapter must implement queryAssetOwnership() method');
    }
    
    this.adapters.set(standard, adapter);
    console.log(`[RwaAdapterRegistry] Registered adapter for standard: ${standard}`);
  }

  /**
   * Get adapter by standard
   * @param {string} standard - RWA standard name
   * @returns {object|null} Adapter instance or null if not found
   */
  getAdapter(standard) {
    return this.adapters.get(standard) || null;
  }

  /**
   * Get all available adapters
   * @returns {Map} Map of all adapters
   */
  getAllAdapters() {
    return new Map(this.adapters);
  }

  /**
   * Get all supported standards
   * @returns {Array} Array of supported standard names
   */
  getSupportedStandards() {
    return Array.from(this.adapters.keys());
  }

  /**
   * Check if a standard is supported
   * @param {string} standard - RWA standard name
   * @returns {boolean} True if supported
   */
  isStandardSupported(standard) {
    return this.adapters.has(standard);
  }

  /**
   * Get adapter for contract address
   * @param {string} contractAddress - Contract address
   * @param {object} database - Database instance
   * @returns {Promise<object|null>} Adapter instance or null if not found
   */
  async getAdapterForContract(contractAddress, database) {
    try {
      // Look up contract in database to get its standard
      const contract = database.db.prepare(`
        SELECT rwa_standard FROM rwa_contract_registry
        WHERE contract_address = ? AND is_active = 1
      `).get(contractAddress);
      
      if (!contract) {
        console.warn(`[RwaAdapterRegistry] No active contract found for address: ${contractAddress}`);
        return null;
      }
      
      return this.getAdapter(contract.rwa_standard);
    } catch (error) {
      console.error(`[RwaAdapterRegistry] Error getting adapter for contract ${contractAddress}:`, error);
      return null;
    }
  }

  /**
   * Validate contract address with appropriate adapter
   * @param {string} contractAddress - Contract address
   * @param {string} standard - RWA standard
   * @returns {boolean} True if valid
   */
  validateContractAddress(contractAddress, standard) {
    const adapter = this.getAdapter(standard);
    if (!adapter) {
      return false;
    }
    
    return adapter.validateContractAddress(contractAddress);
  }

  /**
   * Parse transfer events using appropriate adapter
   * @param {object} transaction - Stellar transaction
   * @param {string} contractAddress - Contract address
   * @param {string} standard - RWA standard
   * @returns {Array} Array of parsed events
   */
  parseTransferEvents(transaction, contractAddress, standard) {
    const adapter = this.getAdapter(standard);
    if (!adapter) {
      console.warn(`[RwaAdapterRegistry] No adapter found for standard: ${standard}`);
      return [];
    }
    
    try {
      return adapter.parseTransferEvents(transaction, contractAddress);
    } catch (error) {
      console.error(`[RwaAdapterRegistry] Error parsing events with adapter ${standard}:`, error);
      return [];
    }
  }

  /**
   * Query asset ownership using appropriate adapter
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {string} standard - RWA standard
   * @returns {Promise<object|null>} Asset ownership data or null if error
   */
  async queryAssetOwnership(assetId, contractAddress, standard) {
    const adapter = this.getAdapter(standard);
    if (!adapter) {
      console.warn(`[RwaAdapterRegistry] No adapter found for standard: ${standard}`);
      return null;
    }
    
    try {
      return await adapter.queryAssetOwnership(assetId, contractAddress);
    } catch (error) {
      console.error(`[RwaAdapterRegistry] Error querying ownership with adapter ${standard}:`, error);
      return null;
    }
  }

  /**
   * Check if asset is frozen using appropriate adapter
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {string} standard - RWA standard
   * @returns {Promise<boolean>} True if frozen
   */
  async isAssetFrozen(assetId, contractAddress, standard) {
    const adapter = this.getAdapter(standard);
    if (!adapter) {
      console.warn(`[RwaAdapterRegistry] No adapter found for standard: ${standard}`);
      return false;
    }
    
    try {
      return await adapter.isAssetFrozen(assetId, contractAddress);
    } catch (error) {
      console.error(`[RwaAdapterRegistry] Error checking if asset is frozen with adapter ${standard}:`, error);
      return false;
    }
  }

  /**
   * Check if asset is burned using appropriate adapter
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {string} standard - RWA standard
   * @returns {Promise<boolean>} True if burned
   */
  async isAssetBurned(assetId, contractAddress, standard) {
    const adapter = this.getAdapter(standard);
    if (!adapter) {
      console.warn(`[RwaAdapterRegistry] No adapter found for standard: ${standard}`);
      return false;
    }
    
    try {
      return await adapter.isAssetBurned(assetId, contractAddress);
    } catch (error) {
      console.error(`[RwaAdapterRegistry] Error checking if asset is burned with adapter ${standard}:`, error);
      return false;
    }
  }

  /**
   * Get asset type using appropriate adapter
   * @param {string} contractAddress - Contract address
   * @param {string} standard - RWA standard
   * @returns {Promise<string>} Asset type
   */
  async getAssetType(contractAddress, standard) {
    const adapter = this.getAdapter(standard);
    if (!adapter) {
      console.warn(`[RwaAdapterRegistry] No adapter found for standard: ${standard}`);
      return 'unknown';
    }
    
    try {
      return await adapter.getAssetType(contractAddress);
    } catch (error) {
      console.error(`[RwaAdapterRegistry] Error getting asset type with adapter ${standard}:`, error);
      return 'unknown';
    }
  }

  /**
   * Get registry statistics
   * @returns {object} Registry statistics
   */
  getStats() {
    return {
      totalAdapters: this.adapters.size,
      supportedStandards: this.getSupportedStandards(),
      adapters: Array.from(this.adapters.entries()).map(([standard, adapter]) => ({
        standard,
        type: adapter.constructor.name,
        network: adapter.network || 'unknown'
      }))
    };
  }

  /**
   * Test all adapters
   * @returns {Promise<object>} Test results
   */
  async testAllAdapters() {
    const results = {
      total: this.adapters.size,
      passed: 0,
      failed: 0,
      results: {}
    };
    
    for (const [standard, adapter] of this.adapters) {
      try {
        // Test basic adapter functionality
        const adapterStandard = adapter.getStandard();
        const isValid = adapter.validateContractAddress('GBL...TEST123');
        
        results.results[standard] = {
          passed: true,
          standard: adapterStandard,
          validationTest: isValid
        };
        results.passed++;
      } catch (error) {
        results.results[standard] = {
          passed: false,
          error: error.message
        };
        results.failed++;
      }
    }
    
    return results;
  }

  /**
   * Refresh adapter configurations
   * @param {object} newConfig - New configuration
   * @returns {void}
   */
  refreshAdapters(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.adapters.clear();
    this.initializeAdapters();
  }

  /**
   * Get adapter health status
   * @returns {Promise<object>} Health status for all adapters
   */
  async getAdapterHealth() {
    const health = {};
    
    for (const [standard, adapter] of this.adapters) {
      try {
        // Basic health check - try to validate a test address
        const testAddress = 'GBL...TEST123';
        const isValid = adapter.validateContractAddress(testAddress);
        
        health[standard] = {
          status: isValid ? 'healthy' : 'degraded',
          lastCheck: new Date().toISOString(),
          network: adapter.network || 'unknown'
        };
      } catch (error) {
        health[standard] = {
          status: 'unhealthy',
          lastCheck: new Date().toISOString(),
          error: error.message
        };
      }
    }
    
    return health;
  }
}

module.exports = RwaAdapterRegistry;
