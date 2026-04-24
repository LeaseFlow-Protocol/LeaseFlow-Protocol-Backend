const { getUSDCToFiatRates } = require('../services/priceFeedService');

/**
 * Fiat-to-Crypto Rent Proration Calculator Engine
 * 
 * Replicates the exact 128-bit fixed-point math utilized in the Soroban smart contract
 * for mid-cycle lease terminations. Provides accurate fiat estimates for frontend display.
 * 
 * Key features:
 * - 128-bit fixed-point arithmetic precision (matching Soroban i128 type)
 * - Exact elapsed seconds calculation
 * - Rent deduction and security deposit refund computation
 * - Redis price cache integration for fiat conversion
 * - Fuzz-testing compatibility with smart contract output
 */
class ProrationCalculatorService {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {object} redisClient - Redis client for price caching
   */
  constructor(database, redisClient = null) {
    this.database = database;
    this.redis = redisClient;
    
    // Stellar precision constants (matching Soroban)
    this.STROOP_PRECISION = 7; // XLM has 7 decimal places
    this.USDC_PRECISION = 7;   // USDC on Stellar also has 7 decimal places
    this.FIXED_POINT_SCALE = BigInt(10) ** BigInt(18); // 128-bit fixed point scale
    
    // Price cache TTL (5 minutes)
    this.PRICE_CACHE_TTL = 300;
  }

  /**
   * Calculate proration preview for a lease termination
   * @param {string} leaseId - Lease identifier
   * @param {number} terminationTimestamp - Target termination timestamp (Unix seconds)
   * @param {string} targetCurrency - Target fiat currency (USD, EUR, etc.)
   * @returns {Promise<object>} Proration calculation result
   */
  async calculateProrationPreview(leaseId, terminationTimestamp, targetCurrency = 'USD') {
    try {
      // Validate inputs
      if (!leaseId || !terminationTimestamp) {
        throw new Error('Lease ID and termination timestamp are required');
      }

      const terminationTime = new Date(terminationTimestamp * 1000);
      if (terminationTime <= new Date()) {
        throw new Error('Termination time must be in the future');
      }

      // Fetch lease configuration
      const lease = this.database.getLeaseById(leaseId);
      if (!lease) {
        throw new Error('Lease not found');
      }

      if (lease.status !== 'active') {
        throw new Error('Lease is not active');
      }

      // Perform 128-bit fixed-point calculations
      const calculation = await this._performProrationCalculation(
        lease, 
        terminationTimestamp, 
        targetCurrency
      );

      return {
        success: true,
        leaseId,
        terminationTimestamp,
        targetCurrency,
        ...calculation,
        calculatedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('[ProrationCalculatorService] Calculation failed:', error);
      return {
        success: false,
        error: error.message,
        calculatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Core proration calculation with 128-bit fixed-point precision
   * @private
   */
  async _performProrationCalculation(lease, terminationTimestamp, targetCurrency) {
    const startTime = new Date(lease.startDate).getTime() / 1000;
    const endTime = new Date(lease.endDate).getTime() / 1000;
    const currentTime = Math.floor(Date.now() / 1000);
    
    // Validate termination time is within lease period
    if (terminationTimestamp < startTime || terminationTimestamp > endTime) {
      throw new Error('Termination timestamp must be within lease period');
    }

    // 1. Calculate elapsed seconds using BigInt precision
    const elapsedSeconds = BigInt(terminationTimestamp) - BigInt(startTime);
    const totalLeaseSeconds = BigInt(endTime) - BigInt(startTime);
    
    // 2. Convert rent amount to fixed-point representation
    // rent_amount is stored as integer in database (in smallest currency unit)
    const rentAmountStroops = BigInt(lease.rentAmount);
    const rentAmountFixed = rentAmountStroops * this.FIXED_POINT_SCALE;
    
    // 3. Calculate proportional rent using 128-bit fixed-point math
    // (elapsed_seconds / total_seconds) * rent_amount
    const elapsedRatio = (elapsedSeconds * this.FIXED_POINT_SCALE) / totalLeaseSeconds;
    const usedRentFixed = (rentAmountFixed * elapsedRatio) / this.FIXED_POINT_SCALE;
    
    // 4. Calculate remaining rent (unused portion)
    const remainingRentFixed = rentAmountFixed - usedRentFixed;
    
    // 5. Calculate security deposit refund (assuming 1 month rent as deposit)
    // This would be configurable based on lease terms
    const securityDepositFixed = rentAmountFixed; // Simplified: 1 month rent
    const depositRefundFixed = securityDepositFixed; // Full refund if no damages
    
    // 6. Total refund amount
    const totalRefundFixed = remainingRentFixed + depositRefundFixed;
    
    // 7. Convert back from fixed-point to stroops
    const remainingRentStroops = remainingRentFixed / this.FIXED_POINT_SCALE;
    const depositRefundStroops = depositRefundFixed / this.FIXED_POINT_SCALE;
    const totalRefundStroops = totalRefundFixed / this.FIXED_POINT_SCALE;
    
    // 8. Get current XLM price and convert to fiat
    const fiatConversion = await this._getFiatConversion(targetCurrency);
    
    // 9. Convert stroops to human-readable amounts
    const remainingRentXLM = Number(remainingRentStroops) / Math.pow(10, this.STROOP_PRECISION);
    const depositRefundXLM = Number(depositRefundStroops) / Math.pow(10, this.STROOP_PRECISION);
    const totalRefundXLM = Number(totalRefundStroops) / Math.pow(10, this.STROOP_PRECISION);
    
    // 10. Convert to fiat
    const remainingRentFiat = remainingRentXLM * fiatConversion.xlmToTargetRate;
    const depositRefundFiat = depositRefundXLM * fiatConversion.xlmToTargetRate;
    const totalRefundFiat = totalRefundXLM * fiatConversion.xlmToTargetRate;
    
    // 11. Format response with precision matching
    return {
      // Raw calculation data (for fuzz testing)
      raw: {
        elapsedSeconds: elapsedSeconds.toString(),
        totalLeaseSeconds: totalLeaseSeconds.toString(),
        elapsedRatio: elapsedRatio.toString(),
        rentAmountStroops: rentAmountStroops.toString(),
        remainingRentStroops: remainingRentStroops.toString(),
        depositRefundStroops: depositRefundStroops.toString(),
        totalRefundStroops: totalRefundStroops.toString()
      },
      
      // Human-readable amounts
      calculation: {
        elapsedDays: Math.floor(Number(elapsedSeconds) / 86400),
        totalLeaseDays: Math.floor(Number(totalLeaseSeconds) / 86400),
        usagePercentage: (Number(elapsedRatio) / Number(this.FIXED_POINT_SCALE)) * 100
      },
      
      // Financial breakdown
        amounts: {
        // Crypto amounts (XLM)
        remainingRent: {
          stroops: remainingRentStroops.toString(),
          xlm: this._roundToPrecision(remainingRentXLM, 7)
        },
        depositRefund: {
          stroops: depositRefundStroops.toString(),
          xlm: this._roundToPrecision(depositRefundXLM, 7)
        },
        totalRefund: {
          stroops: totalRefundStroops.toString(),
          xlm: this._roundToPrecision(totalRefundXLM, 7)
        }
      },
      
      // Fiat conversions
      fiat: {
        targetCurrency,
        exchangeRate: fiatConversion.xlmToTargetRate,
        remainingRent: this._roundToPrecision(remainingRentFiat, 2),
        depositRefund: this._roundToPrecision(depositRefundFiat, 2),
        totalRefund: this._roundToPrecision(totalRefundFiat, 2),
        formatted: `${targetCurrency} ${this._roundToPrecision(totalRefundFiat, 2)}`
      },
      
      // Price data source and timestamp
      priceData: {
        source: fiatConversion.source,
        timestamp: fiatConversion.timestamp
      }
    };
  }

  /**
   * Get fiat conversion rates with Redis caching
   * @private
   */
  async _getFiatConversion(targetCurrency) {
    const cacheKey = `price:xlm:${targetCurrency}`;
    
    try {
      // Try cache first
      if (this.redis) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          const data = JSON.parse(cached);
          console.log(`[ProrationCalculatorService] Price cache hit for XLM/${targetCurrency}`);
          return data;
        }
      }
    } catch (error) {
      console.error('[ProrationCalculatorService] Cache read failed:', error.message);
    }

    try {
      // Fetch fresh rates
      const rates = await getUSDCToFiatRates([targetCurrency.toLowerCase()]);
      
      // Get XLM/USDC rate from Stellar
      const xlmToUsdcRate = await this._getXLMToUSDCRate();
      
      // Calculate XLM to target currency rate
      const usdToTargetRate = rates[targetCurrency.toLowerCase()] || 1;
      const xlmToTargetRate = xlmToUsdcRate * usdToTargetRate;
      
      const conversionData = {
        xlmToTargetRate,
        source: 'coingecko+stellar',
        timestamp: new Date().toISOString()
      };

      // Cache the result
      try {
        if (this.redis) {
          await this.redis.set(
            cacheKey, 
            JSON.stringify(conversionData), 
            'EX', 
            this.PRICE_CACHE_TTL
          );
          console.log(`[ProrationCalculatorService] Price cached for XLM/${targetCurrency}`);
        }
      } catch (error) {
        console.error('[ProrationCalculatorService] Cache write failed:', error.message);
      }

      return conversionData;

    } catch (error) {
      console.error('[ProrationCalculatorService] Price fetch failed:', error);
      
      // Fallback to reasonable default
      return {
        xlmToTargetRate: 0.1, // Conservative fallback
        source: 'fallback',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get XLM to USDC exchange rate from Stellar DEX
   * @private
   */
  async _getXLMToUSDCRate() {
    try {
      const { Horizon, Asset } = require('@stellar/stellar-sdk');
      const server = new Horizon.Server('https://horizon-testnet.stellar.org');
      
      const USDC_ASSET = new Asset(
        'USDC',
        'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
      );

      // Get orderbook for XLM/USDC
      const orderbook = await server.orderbook(Asset.native(), USDC_ASSET).call();
      
      if (orderbook.bids && orderbook.bids.length > 0) {
        // Use best bid price
        const bestBid = orderbook.bids[0];
        return parseFloat(bestBid.price);
      }
      
      // Fallback to 1:1 if no market data
      return 1.0;
      
    } catch (error) {
      console.error('[ProrationCalculatorService] XLM/USDC rate fetch failed:', error);
      return 1.0; // Fallback
    }
  }

  /**
   * Round number to specified precision
   * @private
   */
  _roundToPrecision(value, precision) {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }

  /**
   * Validate calculation against smart contract output (for fuzz testing)
   * @param {object} nodeResult - Node.js calculation result
   * @param {object} contractResult - Smart contract calculation result
   * @returns {boolean} True if results match within 1 stroop tolerance
   */
  validateAgainstContract(nodeResult, contractResult) {
    const tolerance = BigInt(1); // 1 stroop tolerance
    
    const nodeTotalRefund = BigInt(nodeResult.raw.totalRefundStroops);
    const contractTotalRefund = BigInt(contractResult.totalRefundStroops);
    
    const difference = nodeTotalRefund > contractTotalRefund 
      ? nodeTotalRefund - contractTotalRefund 
      : contractTotalRefund - nodeTotalRefund;
    
    return difference <= tolerance;
  }

  /**
   * Generate test cases for fuzz testing
   * @param {number} count - Number of test cases to generate
   * @returns {Array} Array of test cases
   */
  generateFuzzTestCases(count = 100) {
    const cases = [];
    const now = Math.floor(Date.now() / 1000);
    
    for (let i = 0; i < count; i++) {
      // Generate random lease parameters
      const leaseStart = now + Math.floor(Math.random() * 86400 * 30); // Start within 30 days
      const leaseDuration = Math.floor(Math.random() * 86400 * 365 * 2) + 86400 * 30; // 30 days to 2 years
      const leaseEnd = leaseStart + leaseDuration;
      const terminationTime = leaseStart + Math.floor(Math.random() * leaseDuration);
      const rentAmount = Math.floor(Math.random() * 100000000) + 1000000; // 0.1 to 10 XLM in stroops
      
      cases.push({
        leaseId: `test-lease-${i}`,
        startDate: new Date(leaseStart * 1000).toISOString(),
        endDate: new Date(leaseEnd * 1000).toISOString(),
        rentAmount: rentAmount.toString(),
        terminationTimestamp: terminationTime,
        currency: 'XLM'
      });
    }
    
    return cases;
  }
}

module.exports = { ProrationCalculatorService };
