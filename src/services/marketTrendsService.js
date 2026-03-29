const { AppDatabase } = require('../db/appDatabase');

/**
 * Market Trends Service - Aggregates anonymized rent data for analytics
 * Provides "Source of Truth" rental market data for LeaseFlow protocol
 */
class MarketTrendsService {
  /**
   * @param {AppDatabase} database - Database instance
   */
  constructor(database) {
    this.db = database;
  }

  /**
   * Get market trends for a specific city/region
   * @param {string} location - City or region name (e.g., "Abuja", "Lagos")
   * @param {object} filters - Optional filters (bedrooms, propertyType, etc.)
   * @returns {object} Market trends analytics
   */
  getMarketTrends(location, filters = {}) {
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    
    // Get all active leases in the location
    const activeLeases = this._getActiveLeasesByLocation(location);
    
    // Filter by bedrooms if specified
    let filteredLeases = activeLeases;
    if (filters.bedrooms) {
      filteredLeases = activeLeases.filter(lease => 
        lease.propertyDetails?.bedrooms === filters.bedrooms
      );
    }
    
    if (filteredLeases.length === 0) {
      return {
        location,
        currency: 'USDC',
        sampleSize: 0,
        message: 'No active leases found for this location',
        averageRent: 0,
        medianRent: 0,
        minRent: 0,
        maxRent: 0,
        pricePerSqft: null,
        monthOverMonthChange: 0,
        yearOverYearChange: 0,
        trendDirection: 'stable',
        confidenceScore: 0,
        generatedAt: now.toISOString()
      };
    }
    
    // Calculate statistics
    const rentAmounts = filteredLeases.map(l => l.rentAmount);
    const averageRent = this._calculateAverage(rentAmounts);
    const medianRent = this._calculateMedian(rentAmounts);
    const minRent = Math.min(...rentAmounts);
    const maxRent = Math.max(...rentAmounts);
    
    // Calculate year-over-year change
    const historicalData = this._getHistoricalRents(location, filters);
    const yearOverYearChange = this._calculateYoYChange(averageRent, historicalData.previousYearAverage);
    const monthOverMonthChange = this._calculateMoMChange(averageRent, historicalData.previousMonthAverage);
    
    // Determine trend direction
    const trendDirection = yearOverYearChange > 2 ? 'increasing' : 
                          yearOverYearChange < -2 ? 'decreasing' : 'stable';
    
    // Calculate confidence score based on sample size
    const confidenceScore = this._calculateConfidenceScore(filteredLeases.length);
    
    return {
      location,
      currency: 'USDC',
      sampleSize: filteredLeases.length,
      totalActiveLeases: activeLeases.length,
      averageRent: Math.round(averageRent),
      medianRent: Math.round(medianRent),
      minRent: Math.round(minRent),
      maxRent: Math.round(maxRent),
      pricePerSqft: this._calculatePricePerSqft(filteredLeases),
      monthOverMonthChange: parseFloat(monthOverMonthChange.toFixed(2)),
      yearOverYearChange: parseFloat(yearOverYearChange.toFixed(2)),
      trendDirection,
      confidenceScore: parseFloat(confidenceScore.toFixed(2)),
      distribution: this._calculateRentDistribution(filteredLeases),
      insights: this._generateInsights({
        averageRent,
        medianRent,
        yearOverYearChange,
        sampleSize: filteredLeases.length,
        trendDirection
      }),
      generatedAt: now.toISOString()
    };
  }

  /**
   * Get comparative market analysis across multiple locations
   * @param {string[]} locations - Array of city/region names
   * @returns {object[]} Array of market trends for each location
   */
  getComparativeAnalysis(locations) {
    return locations.map(location => ({
      location,
      trends: this.getMarketTrends(location)
    }));
  }

  /**
   * Get rental price trends over time for a location
   * @param {string} location - City or region name
   * @param {number} months - Number of months to look back (default: 12)
   * @returns {object} Time series data
   */
  getPriceHistory(location, months = 12) {
    const history = [];
    const now = new Date();
    
    for (let i = months; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStart = date.toISOString().split('T')[0];
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().split('T')[0];
      
      const leasesInMonth = this._getLeasesByDateRange(location, monthStart, monthEnd);
      const averageRent = leasesInMonth.length > 0 
        ? this._calculateAverage(leasesInMonth.map(l => l.rentAmount))
        : null;
      
      history.push({
        period: monthStart,
        averageRent: averageRent ? Math.round(averageRent) : null,
        sampleSize: leasesInMonth.length,
        medianRent: leasesInMonth.length > 0 
          ? Math.round(this._calculateMedian(leasesInMonth.map(l => l.rentAmount)))
          : null
      });
    }
    
    return {
      location,
      months,
      dataPoints: history,
      generatedAt: now.toISOString()
    };
  }

  /**
   * Get property type breakdown for a location
   * @param {string} location - City or region name
   * @returns {object} Property type analytics
   */
  getPropertyTypeBreakdown(location) {
    const activeLeases = this._getActiveLeasesByLocation(location);
    
    const breakdown = {};
    activeLeases.forEach(lease => {
      const type = lease.propertyDetails?.type || 'unknown';
      if (!breakdown[type]) {
        breakdown[type] = {
          count: 0,
          totalRent: 0,
          averageRent: 0,
          percentage: 0
        };
      }
      breakdown[type].count++;
      breakdown[type].totalRent += lease.rentAmount;
    });
    
    const total = activeLeases.length;
    Object.keys(breakdown).forEach(type => {
      breakdown[type].averageRent = Math.round(breakdown[type].totalRent / breakdown[type].count);
      breakdown[type].percentage = parseFloat(((breakdown[type].count / total) * 100).toFixed(2));
      delete breakdown[type].totalRent;
    });
    
    return {
      location,
      totalProperties: total,
      breakdown,
      generatedAt: new Date().toISOString()
    };
  }

  // Private helper methods

  /**
   * Get active leases by location (anonymized)
   */
  _getActiveLeasesByLocation(location) {
    try {
      // Query active leases filtered by city or state
      const stmt = this.db.db.prepare(`
        SELECT 
          id,
          rent_amount AS rentAmount,
          currency,
          start_date AS startDate,
          end_date AS endDate,
          city,
          state,
          country,
          property_type AS propertyType,
          bedrooms,
          bathrooms,
          square_footage AS sqft,
          created_at AS createdAt
        FROM leases
        WHERE status = 'active'
          AND disputed = 0
          AND (city = ? OR state = ? OR country = ?)
        ORDER BY created_at DESC
      `);
      
      const leases = stmt.all(location, location, location);
      
      // Transform to expected format
      return leases.map(lease => ({
        ...lease,
        propertyDetails: {
          bedrooms: lease.bedrooms,
          type: lease.propertyType || 'unknown',
          sqft: lease.sqft
        }
      }));
    } catch (error) {
      console.error('Error fetching active leases:', error.message);
      return [];
    }
  }

  /**
   * Get historical rent data for year-over-year comparison
   */
  _getHistoricalRents(location, filters = {}) {
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    
    // Mock implementation - would query historical data in production
    return {
      previousYearAverage: 0, // Would calculate from historical data
      previousMonthAverage: 0 // Would calculate from recent data
    };
  }

  /**
   * Get leases by date range
   */
  _getLeasesByDateRange(location, startDate, endDate) {
    try {
      const stmt = this.db.db.prepare(`
        SELECT 
          id,
          rent_amount AS rentAmount,
          created_at AS createdAt
        FROM leases
        WHERE status = 'active'
          AND created_at BETWEEN ? AND ?
      `);
      
      return stmt.all(startDate, endDate);
    } catch (error) {
      console.error('Error fetching leases by date range:', error.message);
      return [];
    }
  }

  /**
   * Calculate average
   */
  _calculateAverage(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Calculate median
   */
  _calculateMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 
      ? sorted[mid] 
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Calculate year-over-year change percentage
   */
  _calculateYoYChange(current, previous) {
    if (!previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }

  /**
   * Calculate month-over-month change percentage
   */
  _calculateMoMChange(current, previous) {
    if (!previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }

  /**
   * Calculate confidence score based on sample size
   * Score ranges from 0-100
   */
  _calculateConfidenceScore(sampleSize) {
    if (sampleSize < 10) return Math.min(sampleSize * 5, 50);
    if (sampleSize < 50) return 50 + (sampleSize - 10) * 0.75;
    if (sampleSize < 100) return 80 + (sampleSize - 50) * 0.4;
    return Math.min(95 + (sampleSize - 100) * 0.05, 100);
  }

  /**
   * Calculate price per square foot
   */
  _calculatePricePerSqft(leases) {
    const validLeases = leases.filter(l => l.propertyDetails?.sqft);
    if (validLeases.length === 0) return null;
    
    const total = validLeases.reduce((sum, lease) => {
      return sum + (lease.rentAmount / lease.propertyDetails.sqft);
    }, 0);
    
    return Math.round(total / validLeases.length);
  }

  /**
   * Calculate rent distribution (price brackets)
   */
  _calculateRentDistribution(leases) {
    const brackets = [
      { range: '< 500', min: 0, max: 500, count: 0 },
      { range: '500-1000', min: 500, max: 1000, count: 0 },
      { range: '1000-2000', min: 1000, max: 2000, count: 0 },
      { range: '2000-3000', min: 2000, max: 3000, count: 0 },
      { range: '3000-5000', min: 3000, max: 5000, count: 0 },
      { range: '5000+', min: 5000, max: Infinity, count: 0 }
    ];
    
    leases.forEach(lease => {
      const bracket = brackets.find(b => lease.rentAmount >= b.min && lease.rentAmount < b.max);
      if (bracket) bracket.count++;
    });
    
    const total = leases.length;
    return brackets.map(b => ({
      range: b.range,
      count: b.count,
      percentage: total > 0 ? parseFloat(((b.count / total) * 100).toFixed(2)) : 0
    }));
  }

  /**
   * Generate market insights
   */
  _generateInsights(data) {
    const insights = [];
    
    if (data.sampleSize < 10) {
      insights.push('Limited data available. Consider expanding search criteria for more accurate trends.');
    }
    
    if (data.yearOverYearChange > 5) {
      insights.push(`Strong rental demand detected. Average rents up ${data.yearOverYearChange.toFixed(1)}% year-over-year.`);
    } else if (data.yearOverYearChange < -5) {
      insights.push(`Rental market cooling. Average rents down ${Math.abs(data.yearOverYearChange).toFixed(1)}% year-over-year.`);
    }
    
    if (Math.abs(data.averageRent - data.medianRent) > data.averageRent * 0.2) {
      insights.push('High variance in rental prices suggests diverse property types or neighborhood differences.');
    }
    
    if (data.trendDirection === 'increasing' && data.sampleSize > 50) {
      insights.push('Landlord\'s market: Consider listing properties now to capitalize on high demand.');
    } else if (data.trendDirection === 'decreasing' && data.sampleSize > 50) {
      insights.push('Tenant\'s market: Good opportunity to negotiate favorable lease terms.');
    }
    
    return insights;
  }
}

module.exports = { MarketTrendsService };
