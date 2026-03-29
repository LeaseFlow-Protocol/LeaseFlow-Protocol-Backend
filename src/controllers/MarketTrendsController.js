const { MarketTrendsService } = require('../services/marketTrendsService');

/**
 * Market Trends Controller
 * Provides analytics and insights for rental market data
 */
class MarketTrendsController {
  constructor(database) {
    this.service = new MarketTrendsService(database);
  }

  /**
   * Get market trends for a specific location
   * GET /api/market-trends/:location
   */
  getMarketTrends(req, res) {
    try {
      const { location } = req.params;
      const { bedrooms, propertyType } = req.query;
      
      if (!location) {
        return res.status(400).json({
          success: false,
          error: 'Location parameter is required'
        });
      }
      
      const filters = {};
      if (bedrooms) {
        filters.bedrooms = parseInt(bedrooms, 10);
      }
      if (propertyType) {
        filters.propertyType = propertyType;
      }
      
      const trends = this.service.getMarketTrends(location, filters);
      
      res.json({
        success: true,
        data: trends
      });
    } catch (error) {
      console.error('Error fetching market trends:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch market trends',
        message: error.message
      });
    }
  }

  /**
   * Get comparative analysis across multiple locations
   * GET /api/market-trends/compare
   */
  getComparativeAnalysis(req, res) {
    try {
      const { locations } = req.query;
      
      if (!locations) {
        return res.status(400).json({
          success: false,
          error: 'Locations query parameter is required (comma-separated)'
        });
      }
      
      const locationArray = locations.split(',').map(l => l.trim()).filter(l => l);
      
      if (locationArray.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'At least 2 locations are required for comparison'
        });
      }
      
      const analysis = this.service.getComparativeAnalysis(locationArray);
      
      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      console.error('Error fetching comparative analysis:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch comparative analysis',
        message: error.message
      });
    }
  }

  /**
   * Get price history over time
   * GET /api/market-trends/:location/history
   */
  getPriceHistory(req, res) {
    try {
      const { location } = req.params;
      const { months = 12 } = req.query;
      
      if (!location) {
        return res.status(400).json({
          success: false,
          error: 'Location parameter is required'
        });
      }
      
      const history = this.service.getPriceHistory(location, parseInt(months, 10));
      
      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      console.error('Error fetching price history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch price history',
        message: error.message
      });
    }
  }

  /**
   * Get property type breakdown
   * GET /api/market-trends/:location/property-types
   */
  getPropertyTypeBreakdown(req, res) {
    try {
      const { location } = req.params;
      
      if (!location) {
        return res.status(400).json({
          success: false,
          error: 'Location parameter is required'
        });
      }
      
      const breakdown = this.service.getPropertyTypeBreakdown(location);
      
      res.json({
        success: true,
        data: breakdown
      });
    } catch (error) {
      console.error('Error fetching property type breakdown:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch property type breakdown',
        message: error.message
      });
    }
  }

  /**
   * Get all market trends endpoints documentation
   * GET /api/market-trends
   */
  getMarketTrendsInfo(req, res) {
    res.json({
      success: true,
      data: {
        name: 'LeaseFlow Market Trends API',
        description: 'Aggregated anonymized rent data providing source-of-truth rental market analytics',
        version: '1.0.0',
        endpoints: [
          {
            method: 'GET',
            path: '/api/market-trends/:location',
            description: 'Get current market trends for a specific location',
            parameters: {
              location: 'City or region name (e.g., "Abuja", "Lagos")',
              query: {
                bedrooms: 'Filter by number of bedrooms (optional)',
                propertyType: 'Filter by property type (optional)'
              }
            }
          },
          {
            method: 'GET',
            path: '/api/market-trends/:location/history',
            description: 'Get historical price trends over time',
            parameters: {
              location: 'City or region name',
              query: {
                months: 'Number of months to look back (default: 12)'
              }
            }
          },
          {
            method: 'GET',
            path: '/api/market-trends/:location/property-types',
            description: 'Get breakdown of properties by type',
            parameters: {
              location: 'City or region name'
            }
          },
          {
            method: 'GET',
            path: '/api/market-trends/compare',
            description: 'Compare market trends across multiple locations',
            parameters: {
              query: {
                locations: 'Comma-separated list of locations (minimum 2)'
              }
            }
          }
        ],
        features: [
          'Real-time aggregation of anonymized LeaseFlow contract data',
          'Year-over-year and month-over-month change tracking',
          'Confidence scoring based on sample size',
          'Rent distribution analysis',
          'AI-generated market insights',
          'Comparative market analysis'
        ]
      }
    });
  }
}

module.exports = { MarketTrendsController };
