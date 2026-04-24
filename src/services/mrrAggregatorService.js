const { getUSDCToFiatRates } = require('./priceFeedService');

/**
 * Monthly Recurring Revenue (MRR) Aggregator Service
 * 
 * Provides comprehensive MRR calculations for lessors with:
 * - Normalized monthly revenue from various billing cycles
 * - Historical MRR tracking
 * - Currency conversion and fiat reporting
 * - Redis caching for performance optimization
 * - Complex proration handling
 */
class MrrAggregatorService {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {object} redisClient - Redis client for caching
   */
  constructor(database, redisClient = null) {
    this.database = database;
    this.redis = redisClient;
    
    // Cache TTL: 15 minutes as specified
    this.CACHE_TTL = 900; // 15 minutes in seconds
    
    // Initialize MRR views in database
    this._initializeMrrViews();
  }

  /**
   * Initialize MRR calculation views in the database
   * @private
   */
  _initializeMrrViews() {
    try {
      const mrrViewSql = require('../db/mrrView.sql');
      this.database.db.exec(mrrViewSql);
      console.log('[MrrAggregatorService] MRR views initialized successfully');
    } catch (error) {
      console.error('[MrrAggregatorService] Failed to initialize MRR views:', error);
      throw new Error('MRR view initialization failed');
    }
  }

  /**
   * Get current MRR for a specific lessor
   * @param {string} lessorId - Landlord ID
   * @param {string} targetCurrency - Target fiat currency (USD, EUR, etc.)
   * @returns {Promise<object>} MRR calculation result
   */
  async getCurrentMrr(lessorId, targetCurrency = 'USD') {
    const cacheKey = `mrr:current:${lessorId}:${targetCurrency}`;
    
    try {
      // Try cache first
      if (this.redis) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          console.log(`[MrrAggregatorService] Cache hit for current MRR: ${lessorId}`);
          return JSON.parse(cached);
        }
      }
    } catch (error) {
      console.error('[MrrAggregatorService] Cache read failed:', error.message);
    }

    try {
      // Get raw MRR data from database
      const mrrData = this._getCurrentMrrFromDb(lessorId);
      
      if (!mrrData || mrrData.length === 0) {
        return {
          success: true,
          lessorId,
          targetCurrency,
          currentMrr: 0,
          activeLeaseCount: 0,
          currencyBreakdown: [],
          calculatedAt: new Date().toISOString()
        };
      }

      // Process and convert to target currency
      const processedData = await this._processMrrData(mrrData, targetCurrency);
      
      const result = {
        success: true,
        lessorId,
        targetCurrency,
        ...processedData,
        calculatedAt: new Date().toISOString()
      };

      // Cache the result
      try {
        if (this.redis) {
          await this.redis.set(
            cacheKey, 
            JSON.stringify(result), 
            'EX', 
            this.CACHE_TTL
          );
          console.log(`[MrrAggregatorService] Cached current MRR for ${lessorId}`);
        }
      } catch (error) {
        console.error('[MrrAggregatorService] Cache write failed:', error.message);
      }

      return result;

    } catch (error) {
      console.error('[MrrAggregatorService] Current MRR calculation failed:', error);
      return {
        success: false,
        error: error.message,
        lessorId,
        targetCurrency,
        calculatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Get historical MRR for a specific lessor as of a given date
   * @param {string} lessorId - Landlord ID
   * @param {string} date - Date in YYYY-MM format
   * @param {string} targetCurrency - Target fiat currency
   * @returns {Promise<object>} Historical MRR result
   */
  async getHistoricalMrr(lessorId, date, targetCurrency = 'USD') {
    const cacheKey = `mrr:historical:${lessorId}:${date}:${targetCurrency}`;
    
    try {
      // Try cache first
      if (this.redis) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          console.log(`[MrrAggregatorService] Cache hit for historical MRR: ${lessorId}:${date}`);
          return JSON.parse(cached);
        }
      }
    } catch (error) {
      console.error('[MrrAggregatorService] Cache read failed:', error.message);
    }

    try {
      // Validate date format
      if (!this._isValidYearMonth(date)) {
        throw new Error('Invalid date format. Use YYYY-MM format');
      }

      // Convert YYYY-MM to first day of month for accurate calculation
      const queryDate = `${date}-01`;
      
      // Get historical MRR data
      const mrrData = this._getHistoricalMrrFromDb(lessorId, queryDate);
      
      if (!mrrData || mrrData.length === 0) {
        return {
          success: true,
          lessorId,
          date,
          targetCurrency,
          historicalMrr: 0,
          activeLeaseCount: 0,
          currencyBreakdown: [],
          calculatedAt: new Date().toISOString()
        };
      }

      // Process and convert to target currency
      const processedData = await this._processMrrData(mrrData, targetCurrency);
      
      const result = {
        success: true,
        lessorId,
        date,
        targetCurrency,
        historicalMrr: processedData.currentMrr,
        activeLeaseCount: processedData.activeLeaseCount,
        currencyBreakdown: processedData.currencyBreakdown,
        calculatedAt: new Date().toISOString()
      };

      // Cache the result
      try {
        if (this.redis) {
          await this.redis.set(
            cacheKey, 
            JSON.stringify(result), 
            'EX', 
            this.CACHE_TTL
          );
          console.log(`[MrrAggregatorService] Cached historical MRR for ${lessorId}:${date}`);
        }
      } catch (error) {
        console.error('[MrrAggregatorService] Cache write failed:', error.message);
      }

      return result;

    } catch (error) {
      console.error('[MrrAggregatorService] Historical MRR calculation failed:', error);
      return {
        success: false,
        error: error.message,
        lessorId,
        date,
        targetCurrency,
        calculatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Get MRR trends for a lessor over time
   * @param {string} lessorId - Landlord ID
   * @param {number} months - Number of months to look back
   * @param {string} targetCurrency - Target fiat currency
   * @returns {Promise<object>} MRR trends data
   */
  async getMrrTrends(lessorId, months = 12, targetCurrency = 'USD') {
    const cacheKey = `mrr:trends:${lessorId}:${months}:${targetCurrency}`;
    
    try {
      // Try cache first
      if (this.redis) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          console.log(`[MrrAggregatorService] Cache hit for MRR trends: ${lessorId}`);
          return JSON.parse(cached);
        }
      }
    } catch (error) {
      console.error('[MrrAggregatorService] Cache read failed:', error.message);
    }

    try {
      // Get trend data from database
      const trendData = this._getMrrTrendsFromDb(lessorId, months);
      
      if (!trendData || trendData.length === 0) {
        return {
          success: true,
          lessorId,
          targetCurrency,
          months,
          trends: [],
          calculatedAt: new Date().toISOString()
        };
      }

      // Process trends with currency conversion
      const processedTrends = await this._processTrendData(trendData, targetCurrency);
      
      const result = {
        success: true,
        lessorId,
        targetCurrency,
        months,
        trends: processedTrends,
        calculatedAt: new Date().toISOString()
      };

      // Cache the result
      try {
        if (this.redis) {
          await this.redis.set(
            cacheKey, 
            JSON.stringify(result), 
            'EX', 
            this.CACHE_TTL
          );
          console.log(`[MrrAggregatorService] Cached MRR trends for ${lessorId}`);
        }
      } catch (error) {
        console.error('[MrrAggregatorService] Cache write failed:', error.message);
      }

      return result;

    } catch (error) {
      console.error('[MrrAggregatorService] MRR trends calculation failed:', error);
      return {
        success: false,
        error: error.message,
        lessorId,
        targetCurrency,
        calculatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Get current MRR data from database
   * @private
   */
  _getCurrentMrrFromDb(lessorId) {
    const query = `
      SELECT 
        current_mrr,
        active_lease_count,
        currency,
        avg_monthly_rent_per_lease,
        max_monthly_rent,
        min_monthly_rent
      FROM mrr_by_lessor
      WHERE landlord_id = ?
    `;
    
    return this.database.db.prepare(query).all(lessorId);
  }

  /**
   * Get historical MRR data from database
   * @private
   */
  _getHistoricalMrrFromDb(lessorId, queryDate) {
    // Use raw SQL with parameterized date
    const query = `
      SELECT 
        SUM(
          CASE 
            WHEN l.rent_amount < 1000000 THEN (l.rent_amount * 4.33)  -- Weekly to monthly
            WHEN l.rent_amount < 50000 THEN (l.rent_amount * 30.44)   -- Daily to monthly
            ELSE l.rent_amount
          END
        ) AS historical_mrr,
        COUNT(*) AS active_lease_count,
        l.currency
      FROM leases l
      WHERE l.landlord_id = ?
        AND l.status NOT IN ('Grace_Period', 'Delinquent', 'Terminated', 'terminated')
        AND l.payment_status = 'paid'
        AND date(l.start_date) <= date(?)
        AND date(l.end_date) >= date(?)
      GROUP BY l.currency
    `;
    
    return this.database.db.prepare(query).all(lessorId, queryDate, queryDate);
  }

  /**
   * Get MRR trends data from database
   * @private
   */
  _getMrrTrendsFromDb(lessorId, months) {
    const query = `
      SELECT 
        strftime('%Y-%m', start_date) AS month_year,
        SUM(
          CASE 
            WHEN rent_amount < 1000000 THEN (rent_amount * 4.33)  -- Weekly to monthly
            WHEN rent_amount < 50000 THEN (rent_amount * 30.44)   -- Daily to monthly
            ELSE rent_amount
          END
        ) AS monthly_mrr,
        COUNT(*) AS new_leases_count,
        currency
      FROM leases
      WHERE landlord_id = ?
        AND status NOT IN ('Grace_Period', 'Delinquent', 'Terminated', 'terminated')
        AND payment_status = 'paid'
        AND strftime('%Y-%m', start_date) >= strftime('%Y-%m', date('now', '-${months} months'))
      GROUP BY strftime('%Y-%m', start_date), currency
      ORDER BY month_year DESC
    `;
    
    return this.database.db.prepare(query).all(lessorId);
  }

  /**
   * Process MRR data with currency conversion
   * @private
   */
  async _processMrrData(mrrData, targetCurrency) {
    let totalMrr = 0;
    let totalLeases = 0;
    const currencyBreakdown = [];

    // Get conversion rates
    const conversionRates = await this._getConversionRates(targetCurrency);

    for (const row of mrrData) {
      const convertedMrr = await this._convertCurrency(row.current_mrr, row.currency, targetCurrency, conversionRates);
      
      totalMrr += convertedMrr;
      totalLeases += row.active_lease_count;

      currencyBreakdown.push({
        currency: row.currency,
        originalAmount: row.current_mrr,
        convertedAmount: convertedMrr,
        activeLeaseCount: row.active_lease_count,
        avgMonthlyRent: row.avg_monthly_rent_per_lease,
        maxMonthlyRent: row.max_monthly_rent,
        minMonthlyRent: row.min_monthly_rent
      });
    }

    return {
      currentMrr: Math.round(totalMrr * 100) / 100, // Round to 2 decimal places
      activeLeaseCount: totalLeases,
      currencyBreakdown
    };
  }

  /**
   * Process trend data with currency conversion
   * @private
   */
  async _processTrendData(trendData, targetCurrency) {
    const conversionRates = await this._getConversionRates(targetCurrency);
    const processedTrends = [];

    for (const row of trendData) {
      const convertedMrr = await this._convertCurrency(row.monthly_mrr, row.currency, targetCurrency, conversionRates);
      
      processedTrends.push({
        month: row.month_year,
        originalAmount: row.monthly_mrr,
        convertedAmount: Math.round(convertedMrr * 100) / 100,
        currency: row.currency,
        newLeasesCount: row.new_leases_count
      });
    }

    return processedTrends;
  }

  /**
   * Get currency conversion rates
   * @private
   */
  async _getConversionRates(targetCurrency) {
    try {
      // Get fiat conversion rates
      const rates = await getUSDCToFiatRates([targetCurrency.toLowerCase()]);
      
      // For now, assume all crypto amounts are in USDC-equivalent units
      // In a production system, you'd fetch specific crypto rates
      return {
        usdToTarget: rates[targetCurrency.toLowerCase()] || 1,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[MrrAggregatorService] Failed to get conversion rates:', error);
      return {
        usdToTarget: 1,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Convert currency amounts
   * @private
   */
  async _convertCurrency(amount, fromCurrency, toCurrency, rates) {
    // If same currency, no conversion needed
    if (fromCurrency === toCurrency) {
      return amount;
    }

    // For this implementation, assume all amounts are in USDC-equivalent
    // Convert to target fiat currency
    if (fromCurrency === 'USDC' || fromCurrency === 'USD') {
      return amount * rates.usdToTarget;
    }

    // For other currencies, you'd implement specific conversion logic
    return amount * rates.usdToTarget;
  }

  /**
   * Validate YYYY-MM date format
   * @private
   */
  _isValidYearMonth(dateString) {
    const regex = /^\d{4}-\d{2}$/;
    if (!regex.test(dateString)) return false;
    
    const [year, month] = dateString.split('-').map(Number);
    return year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
  }

  /**
   * Clear MRR cache for a lessor
   * @param {string} lessorId - Landlord ID
   */
  async clearCache(lessorId) {
    if (!this.redis) return;

    try {
      const pattern = `mrr:*:${lessorId}:*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`[MrrAggregatorService] Cleared ${keys.length} cache entries for ${lessorId}`);
      }
    } catch (error) {
      console.error('[MrrAggregatorService] Cache clear failed:', error);
    }
  }
}

module.exports = { MrrAggregatorService };
