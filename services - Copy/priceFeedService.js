const axios = require('axios');
const { Horizon, Asset } = require('@stellar/stellar-sdk');

const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3';
const STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(STELLAR_HORIZON_URL);

// USDC on Stellar Testnet (Circle issuer)
const USDC_ASSET = new Asset(
  'USDC',
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
);

/**
 * Fetch USDC to Fiat exchange rates.
 * @param {string[]} currencies - Array of fiat currency codes (e.g., ['ngn', 'eur']).
 * @returns {Promise<Object>} - Exchange rates.
 */
async function getUSDCToFiatRates(currencies = ['ngn', 'eur', 'usd']) {
  try {
    // USDC's ID on CoinGecko is 'usd-coin'
    const response = await axios.get(`${COINGECKO_API_URL}/simple/price`, {
      params: {
        ids: 'usd-coin',
        vs_currencies: currencies.join(','),
      },
    });
    return response.data['usd-coin'];
  } catch (error) {
    console.error('Error fetching fiat rates from CoinGecko:', error.message);
    // Fallback or rethrow
    throw new Error('Failed to fetch fiat exchange rates.');
  }
}

/**
 * Calculate the best path for XLM to USDC payment.
 * @param {string} destinationAmount - Amount of USDC required by the landlord.
 * @returns {Promise<Object>} - Path payment details.
 */
async function getXLMToUSDCPath(destinationAmount) {
  try {
    const paths = await server.strictReceivePaths(
      [Asset.native()], // Source asset (XLM)
      USDC_ASSET,       // Destination asset (USDC)
      destinationAmount // Destination amount
    ).call();

    if (paths.records && paths.records.length > 0) {
      // Sort by source amount ascending to find the most cost-effective path
      const sortedPaths = paths.records.sort((a, b) => parseFloat(a.source_amount) - parseFloat(b.source_amount));
      const bestPath = sortedPaths[0];

      return {
        sourceAsset: 'XLM',
        sourceAmount: bestPath.source_amount,
        destinationAsset: 'USDC',
        destinationAmount: destinationAmount,
        path: bestPath.path,
        price: bestPath.source_amount / destinationAmount,
      };
    } else {
      throw new Error('No path found for XLM to USDC.');
    }
  } catch (error) {
    console.error('Error finding Stellar path:', error.message);
    throw new Error('Failed to calculate path payment.');
  }
}

module.exports = {
  getUSDCToFiatRates,
  getXLMToUSDCPath,
};
