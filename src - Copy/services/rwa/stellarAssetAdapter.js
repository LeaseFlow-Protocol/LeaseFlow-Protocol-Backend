const RwaAdapter = require('./rwaAdapter');
const { Server, Networks } = require('@stellar/stellar-sdk');

/**
 * Stellar Asset Adapter
 * Handles RWA tokens created using Stellar's built-in asset functionality
 */
class StellarAssetAdapter extends RwaAdapter {
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
    return 'stellar-asset';
  }

  /**
   * Parse transfer events from Stellar transaction
   * @param {object} transaction - Stellar transaction object
   * @param {string} contractAddress - Asset issuer address
   * @returns {Array} Array of parsed transfer events
   */
  parseTransferEvents(transaction, contractAddress) {
    const events = [];
    
    try {
      // Look for payment operations involving the target asset
      transaction.operations?.forEach((operation, index) => {
        if (operation.type === 'payment' && operation.asset) {
          // Check if this payment involves our target asset
          const assetCode = this.getAssetCode(operation.asset, contractAddress);
          if (assetCode) {
            const event = {
              id: `${transaction.hash}_${index}`,
              assetId: assetCode,
              fromOwnerPubkey: operation.source || transaction.source_account,
              toOwnerPubkey: operation.destination,
              contractAddress: contractAddress,
              transactionHash: transaction.hash,
              ledgerSequence: transaction.ledger_attr,
              operationIndex: index,
              eventType: 'transfer',
              eventData: {
                amount: operation.amount,
                assetType: operation.asset_type,
                assetCode: operation.asset_code,
                assetIssuer: operation.asset_issuer
              },
              timestamp: new Date(transaction.created_at).toISOString()
            };
            events.push(event);
          }
        }
      });
    } catch (error) {
      console.error('[StellarAssetAdapter] Error parsing transaction events:', error);
    }
    
    return events;
  }

  /**
   * Query current asset ownership from blockchain
   * @param {string} assetId - Asset code
   * @param {string} contractAddress - Asset issuer address
   * @returns {Promise<object>} Asset ownership data
   */
  async queryAssetOwnership(assetId, contractAddress) {
    try {
      // For Stellar assets, we need to find accounts holding the asset
      const asset = {
        asset_code: assetId,
        asset_issuer: contractAddress,
        asset_type: 'credit_alphanum4' // or 'credit_alphanum12' based on code length
      };

      // Get all accounts holding this asset
      const accounts = await this.server
        .accounts()
        .forAsset(asset)
        .limit(200)
        .call();

      // Get asset details
      const assetDetails = await this.server.assets()
        .forIssuer(contractAddress)
        .forCode(assetId)
        .call();

      const ownership = {
        assetId,
        contractAddress,
        rwaStandard: this.getStandard(),
        assetType: this.inferAssetType(assetDetails.records[0]),
        totalHolders: accounts.records.length,
        holders: accounts.records.map(account => ({
          publicKey: account.account_id,
          balance: account.balances.find(b => 
            b.asset_code === assetId && b.asset_issuer === contractAddress
          )?.balance || '0'
        })),
        isFrozen: assetDetails.records[0]?.flags?.auth_required || false,
        isBurned: false, // Stellar assets can't be burned in the traditional sense
        lastUpdated: new Date().toISOString(),
        blockchainVerified: true
      };

      return ownership;
    } catch (error) {
      console.error('[StellarAssetAdapter] Error querying asset ownership:', error);
      throw new Error(`Failed to query asset ownership: ${error.message}`);
    }
  }

  /**
   * Check if asset is frozen
   * @param {string} assetId - Asset code
   * @param {string} contractAddress - Asset issuer address
   * @returns {Promise<boolean>} True if asset is frozen
   */
  async isAssetFrozen(assetId, contractAddress) {
    try {
      const assetDetails = await this.server.assets()
        .forIssuer(contractAddress)
        .forCode(assetId)
        .call();

      const asset = assetDetails.records[0];
      return asset?.flags?.auth_required || asset?.flags?.auth_revocable || false;
    } catch (error) {
      console.error('[StellarAssetAdapter] Error checking if asset is frozen:', error);
      return false;
    }
  }

  /**
   * Check if asset is burned
   * @param {string} assetId - Asset code
   * @param {string} contractAddress - Asset issuer address
   * @returns {Promise<boolean>} True if asset is burned
   */
  async isAssetBurned(assetId, contractAddress) {
    // Stellar assets cannot be burned in the traditional sense
    // They can be clawed back by the issuer, but that's different
    return false;
  }

  /**
   * Validate contract address format
   * @param {string} contractAddress - Stellar account address
   * @returns {boolean} True if valid
   */
  validateContractAddress(contractAddress) {
    try {
      // Basic Stellar address validation (starts with G and is 56 chars)
      return /^[G][A-Z0-9]{55}$/.test(contractAddress);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get asset type from contract
   * @param {string} contractAddress - Asset issuer address
   * @returns {string} Asset type
   */
  async getAssetType(contractAddress) {
    try {
      // Try to infer asset type from issuer's metadata or known patterns
      const account = await this.server.loadAccount(contractAddress);
      
      // Look for clues in account data or memo
      if (account.data_attr) {
        const data = JSON.parse(JSON.stringify(account.data_attr));
        if (data.asset_type) {
          return data.asset_type;
        }
      }

      // Default fallback based on common patterns
      return 'real_estate'; // Default assumption
    } catch (error) {
      console.error('[StellarAssetAdapter] Error getting asset type:', error);
      return 'real_estate'; // Default fallback
    }
  }

  /**
   * Get asset code from operation
   * @param {object} asset - Asset object from operation
   * @param {string} contractAddress - Target contract address
   * @returns {string|null} Asset code if matches target contract
   */
  getAssetCode(asset, contractAddress) {
    if (asset.asset_issuer === contractAddress) {
      return asset.asset_code;
    }
    return null;
  }

  /**
   * Infer asset type from asset details
   * @param {object} assetDetails - Asset details from Horizon
   * @returns {string} Asset type
   */
  inferAssetType(assetDetails) {
    if (!assetDetails) return 'real_estate';

    // Look for clues in asset domain or other metadata
    if (assetDetails.domain) {
      const domain = assetDetails.domain.toLowerCase();
      if (domain.includes('realty') || domain.includes('property') || domain.includes('estate')) {
        return 'real_estate';
      }
      if (domain.includes('vehicle') || domain.includes('auto') || domain.includes('car')) {
        return 'vehicle';
      }
      if (domain.includes('commodity') || domain.includes('gold') || domain.includes('silver')) {
        return 'commodity';
      }
    }

    // Check asset code for patterns
    const code = (assetDetails.asset_code || '').toLowerCase();
    if (code.includes('real') || code.includes('prop') || code.includes('estate')) {
      return 'real_estate';
    }
    if (code.includes('vehicle') || code.includes('auto') || code.includes('car')) {
      return 'vehicle';
    }

    return 'real_estate'; // Default fallback
  }

  /**
   * Get recent transactions for an asset
   * @param {string} contractAddress - Asset issuer address
   * @param {string} cursor - Pagination cursor
   * @returns {Promise<object>} Transaction data
   */
  async getRecentTransactions(contractAddress, cursor = null) {
    try {
      let transactionsBuilder = this.server
        .transactions()
        .forAccount(contractAddress)
        .order('desc')
        .limit(200);

      if (cursor) {
        transactionsBuilder = transactionsBuilder.cursor(cursor);
      }

      const transactions = await transactionsBuilder.call();
      return {
        transactions: transactions.records,
        nextCursor: transactions.next_cursor
      };
    } catch (error) {
      console.error('[StellarAssetAdapter] Error getting recent transactions:', error);
      throw new Error(`Failed to get transactions: ${error.message}`);
    }
  }

  /**
   * Stream real-time transactions for an asset
   * @param {string} contractAddress - Asset issuer address
   * @param {function} callback - Callback for new transactions
   * @returns {object} Stream handle
   */
  streamTransactions(contractAddress, callback) {
    try {
      const es = this.server.transactions()
        .forAccount(contractAddress)
        .stream({
          onmessage: (transaction) => {
            const events = this.parseTransferEvents(transaction, contractAddress);
            if (events.length > 0) {
              callback(events);
            }
          },
          onerror: (error) => {
            console.error('[StellarAssetAdapter] Stream error:', error);
          }
        });

      return es;
    } catch (error) {
      console.error('[StellarAssetAdapter] Error setting up stream:', error);
      throw new Error(`Failed to setup stream: ${error.message}`);
    }
  }
}

module.exports = StellarAssetAdapter;
