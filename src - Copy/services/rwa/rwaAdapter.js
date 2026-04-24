/**
 * Base RWA Adapter Interface
 * Defines the contract that all RWA adapters must implement
 */
class RwaAdapter {
  constructor(config) {
    this.config = config;
    this.network = config.network || 'testnet';
  }

  /**
   * Get the standard name this adapter handles
   * @returns {string} Standard name (e.g., 'stellar-asset', 'tokenized-realty')
   */
  getStandard() {
    throw new Error('getStandard() must be implemented by subclass');
  }

  /**
   * Parse transfer events from Stellar transaction
   * @param {object} transaction - Stellar transaction object
   * @param {string} contractAddress - RWA contract address
   * @returns {Array} Array of parsed transfer events
   */
  parseTransferEvents(transaction, contractAddress) {
    throw new Error('parseTransferEvents() must be implemented by subclass');
  }

  /**
   * Query current asset ownership from blockchain
   * @param {string} assetId - Asset identifier
   * @param {string} contractAddress - RWA contract address
   * @returns {Promise<object>} Asset ownership data
   */
  async queryAssetOwnership(assetId, contractAddress) {
    throw new Error('queryAssetOwnership() must be implemented by subclass');
  }

  /**
   * Check if asset is frozen
   * @param {string} assetId - Asset identifier
   * @param {string} contractAddress - RWA contract address
   * @returns {Promise<boolean>} True if asset is frozen
   */
  async isAssetFrozen(assetId, contractAddress) {
    throw new Error('isAssetFrozen() must be implemented by subclass');
  }

  /**
   * Check if asset is burned
   * @param {string} assetId - Asset identifier
   * @param {string} contractAddress - RWA contract address
   * @returns {Promise<boolean>} True if asset is burned
   */
  async isAssetBurned(assetId, contractAddress) {
    throw new Error('isAssetBurned() must be implemented by subclass');
  }

  /**
   * Validate contract address format
   * @param {string} contractAddress - Contract address to validate
   * @returns {boolean} True if valid
   */
  validateContractAddress(contractAddress) {
    throw new Error('validateContractAddress() must be implemented by subclass');
  }

  /**
   * Get asset type from contract
   * @param {string} contractAddress - Contract address
   * @returns {string} Asset type ('real_estate', 'vehicle', etc.)
   */
  async getAssetType(contractAddress) {
    throw new Error('getAssetType() must be implemented by subclass');
  }
}

module.exports = RwaAdapter;
