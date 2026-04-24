# MRR (Monthly Recurring Revenue) Aggregator Documentation

## Overview

The MRR Aggregator is a comprehensive financial analytics system designed specifically for commercial leasing companies using the LeaseFlow Protocol. It provides accurate, normalized monthly revenue calculations that handle complex billing cycles, historical tracking, and multi-currency support.

## Features

### ✅ Core Functionality
- **Real-time MRR Calculation**: Instant access to current monthly recurring revenue
- **Historical MRR Tracking**: Query MRR as it stood on any specific past date
- **Multi-Currency Support**: Automatic conversion to major fiat currencies (USD, EUR, GBP, JPY, CAD, AUD)
- **Billing Cycle Normalization**: Converts weekly, daily, and custom billing cycles to standardized monthly amounts
- **Intelligent Lease Filtering**: Automatically excludes leases in Grace_Period, Delinquent, or Terminated states

### ✅ Performance & Reliability
- **Redis Caching**: 15-minute TTL cache to protect the database from heavy analytical queries
- **Bulk Processing**: Handle up to 50 lessors per request for portfolio analysis
- **Mathematical Precision**: Maintains exact precision for complex financial calculations
- **Error Handling**: Graceful degradation and comprehensive error reporting

### ✅ Analytics & Insights
- **MRR Trends**: Monthly trend analysis with configurable lookback periods
- **Currency Breakdowns**: Detailed breakdowns by currency with conversion rates
- **Statistical Metrics**: Min/max/average rent calculations across portfolios
- **Portfolio Analytics**: Comprehensive insights for large lease portfolios

## API Endpoints

### 1. Get Current MRR
```http
GET /api/v1/lessors/:id/metrics/mrr?currency=USD
```

**Parameters:**
- `id` (path): Lessor ID (required)
- `currency` (query): Target fiat currency - USD, EUR, GBP, JPY, CAD, AUD (default: USD)

**Response:**
```json
{
  "success": true,
  "lessorId": "lessor-123",
  "targetCurrency": "USD",
  "currentMrr": 15000.00,
  "activeLeaseCount": 5,
  "currencyBreakdown": [
    {
      "currency": "USDC",
      "originalAmount": 150000000,
      "convertedAmount": 15000.00,
      "activeLeaseCount": 5,
      "avgMonthlyRent": 30000000,
      "maxMonthlyRent": 50000000,
      "minMonthlyRent": 20000000
    }
  ],
  "calculatedAt": "2024-04-24T11:55:00.000Z"
}
```

### 2. Get Historical MRR
```http
GET /api/v1/lessors/:id/metrics/mrr?date=YYYY-MM&currency=USD
```

**Parameters:**
- `id` (path): Lessor ID (required)
- `date` (query): Historical date in YYYY-MM format (required)
- `currency` (query): Target fiat currency (default: USD)

**Response:**
```json
{
  "success": true,
  "lessorId": "lessor-123",
  "date": "2024-03",
  "targetCurrency": "USD",
  "historicalMrr": 14500.00,
  "activeLeaseCount": 4,
  "currencyBreakdown": [...],
  "calculatedAt": "2024-04-24T11:55:00.000Z"
}
```

### 3. Get MRR Trends
```http
GET /api/v1/lessors/:id/metrics/mrr/trends?months=12&currency=USD
```

**Parameters:**
- `id` (path): Lessor ID (required)
- `months` (query): Number of months to look back (1-60, default: 12)
- `currency` (query): Target fiat currency (default: USD)

**Response:**
```json
{
  "success": true,
  "lessorId": "lessor-123",
  "targetCurrency": "USD",
  "months": 12,
  "trends": [
    {
      "month": "2024-03",
      "originalAmount": 145000000,
      "convertedAmount": 14500.00,
      "currency": "USDC",
      "newLeasesCount": 1
    }
  ],
  "calculatedAt": "2024-04-24T11:55:00.000Z"
}
```

### 4. Bulk MRR Processing
```http
POST /api/v1/lessors/metrics/mrr/bulk
```

**Request Body:**
```json
{
  "lessorIds": ["lessor-123", "lessor-456", "lessor-789"],
  "currency": "USD"
}
```

**Response:**
```json
{
  "success": true,
  "currency": "USD",
  "totalLessors": 3,
  "successfulCalculations": 3,
  "results": [
    {
      "lessorId": "lessor-123",
      "success": true,
      "currentMrr": 15000.00,
      "activeLeaseCount": 5,
      "currencyBreakdown": [...],
      "calculatedAt": "2024-04-24T11:55:00.000Z"
    }
  ],
  "calculatedAt": "2024-04-24T11:55:00.000Z"
}
```

### 5. Cache Management
```http
DELETE /api/v1/lessors/:id/metrics/mrr/cache
```

**Response:**
```json
{
  "success": true,
  "message": "MRR cache cleared successfully",
  "lessorId": "lessor-123",
  "clearedAt": "2024-04-24T11:55:00.000Z"
}
```

## Billing Cycle Normalization

The MRR Aggregator automatically detects and normalizes different billing cycles:

### Weekly Rent Detection
- **Threshold**: Rent amounts < 1,000,000 units (indicating weekly rates)
- **Conversion**: Weekly × 4.33 = Monthly
- **Example**: 250,000/week × 4.33 = 1,082,500/month

### Daily Rent Detection
- **Threshold**: Rent amounts < 50,000 units (indicating daily rates)
- **Conversion**: Daily × 30.44 = Monthly
- **Example**: 35,000/day × 30.44 = 1,065,400/month

### Monthly Rent
- **Threshold**: Rent amounts ≥ 1,000,000 units
- **Conversion**: No conversion needed (already monthly)
- **Example**: 1,500,000/month = 1,500,000/month

## Lease Status Filtering

The system automatically excludes leases with the following statuses:

### Excluded Statuses
- `Grace_Period`: Leases in grace period
- `Delinquent`: Delinquent leases
- `Terminated`: Terminated leases
- `terminated`: Terminated leases (lowercase variant)

### Required Statuses
- `status`: Must be active (not in excluded list)
- `payment_status`: Must be 'paid'

## Currency Conversion

### Supported Currencies
- **USD**: US Dollar (default)
- **EUR**: Euro
- **GBP**: British Pound
- **JPY**: Japanese Yen
- **CAD**: Canadian Dollar
- **AUD**: Australian Dollar

### Conversion Logic
1. All amounts are assumed to be in USDC-equivalent units
2. Conversion rates are fetched from price feed service
3. Rates are cached for 5 minutes to ensure consistency
4. Fallback rates are used if price feed is unavailable

## Caching Strategy

### Redis Cache Keys
- **Current MRR**: `mrr:current:{lessorId}:{currency}`
- **Historical MRR**: `mrr:historical:{lessorId}:{date}:{currency}`
- **MRR Trends**: `mrr:trends:{lessorId}:{months}:{currency}`

### Cache TTL
- **All Cache Entries**: 15 minutes (900 seconds)
- **Price Cache**: 5 minutes (300 seconds)

### Cache Invalidation
- Manual cache clearing available via DELETE endpoint
- Automatic expiration based on TTL
- Cache is cleared when leases are updated (implementation dependent)

## Mathematical Precision

### Precision Handling
- **Integer Arithmetic**: All calculations use integer arithmetic to maintain precision
- **Fixed-Point Scale**: Uses 7 decimal places (matching Stellar USDC precision)
- **Rounding**: Final results are rounded to 2 decimal places for display
- **Edge Cases**: Handles zero, minimum, and maximum amounts gracefully

### Verification
- Comprehensive test suite with mathematical verification
- Fuzz testing for edge cases
- Precision testing with floating-point boundaries
- Large dataset performance testing

## Usage Examples

### Basic Usage
```javascript
// Get current MRR for a lessor
const response = await fetch('/api/v1/lessors/lessor-123/metrics/mrr?currency=USD');
const mrrData = await response.json();
console.log(`Current MRR: $${mrrData.currentMrr} USD`);
```

### Historical Analysis
```javascript
// Get MRR for January 2024
const response = await fetch('/api/v1/lessors/lessor-123/metrics/mrr?date=2024-01&currency=USD');
const historicalMrr = await response.json();
console.log(`January 2024 MRR: $${historicalMrr.historicalMrr} USD`);
```

### Trend Analysis
```javascript
// Get 6-month MRR trends
const response = await fetch('/api/v1/lessors/lessor-123/metrics/mrr/trends?months=6&currency=USD');
const trends = await response.json();
trends.trends.forEach(trend => {
  console.log(`${trend.month}: $${trend.convertedAmount} USD (${trend.newLeasesCount} new leases)`);
});
```

### Bulk Processing
```javascript
// Get MRR for multiple lessors
const response = await fetch('/api/v1/lessors/metrics/mrr/bulk', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    lessorIds: ['lessor-1', 'lessor-2', 'lessor-3'],
    currency: 'USD'
  })
});
const bulkResults = await response.json();
bulkResults.results.forEach(result => {
  console.log(`${result.lessorId}: $${result.currentMrr} USD`);
});
```

## Performance Considerations

### Database Optimization
- **Indexes**: Optimized indexes on landlord_id, status, payment_status, and date fields
- **Views**: Pre-computed SQL views for efficient querying
- **Connection Pooling**: Database connection pooling for concurrent requests

### Caching Benefits
- **Reduced Load**: 15-minute cache significantly reduces database load
- **Faster Response**: Cached responses return in milliseconds
- **Scalability**: Supports high concurrent request volumes

### Bulk Processing
- **Concurrency Limit**: Processes up to 5 lessors concurrently
- **Rate Limiting**: Built-in rate limiting to prevent abuse
- **Timeout Protection**: Requests timeout after reasonable periods

## Error Handling

### Common Error Responses
```json
{
  "success": false,
  "error": "Lessor ID is required"
}
```

### Error Types
- **400 Bad Request**: Invalid parameters (missing ID, invalid currency, bad date format)
- **500 Internal Server Error**: Database errors, calculation failures
- **404 Not Found**: Not applicable (returns zero MRR for non-existent lessors)

### Graceful Degradation
- **Database Errors**: Returns error response with details
- **Price Feed Failures**: Uses fallback conversion rates
- **Cache Failures**: Continues without caching, logs errors

## Testing

### Test Coverage
- **Unit Tests**: Core service logic and mathematical calculations
- **Integration Tests**: API endpoints and database interactions
- **Mathematical Verification**: Precision and edge case testing
- **Performance Tests**: Large dataset and concurrent request testing

### Running Tests
```bash
# Run all MRR tests
npm test -- --testPathPattern=mrr

# Run specific test suites
npm test -- mrrAggregator.test.js
npm test -- mrrApi.test.js
npm test -- mrrMathematicalVerification.test.js
```

## Monitoring & Debugging

### Logging
- **Info Level**: Successful calculations, cache hits/misses
- **Error Level**: Failed calculations, database errors
- **Debug Level**: Detailed calculation steps, cache operations

### Metrics to Monitor
- **Response Times**: API endpoint response times
- **Cache Hit Rates**: Percentage of requests served from cache
- **Error Rates**: Failed calculation percentages
- **Database Load**: Query performance and connection usage

## Security Considerations

### Access Control
- **Authentication**: Integrate with existing authentication system
- **Authorization**: Ensure lessors can only access their own MRR data
- **Rate Limiting**: Prevent abuse with rate limiting

### Data Privacy
- **PII Protection**: No personal information in MRR calculations
- **Data Aggregation**: Only aggregated financial data is exposed
- **Audit Trail**: All MRR queries are logged for audit purposes

## Future Enhancements

### Planned Features
- **Real-time Updates**: WebSocket integration for live MRR updates
- **Advanced Analytics**: Revenue growth rates, churn analysis
- **Forecasting**: Predictive MRR based on lease pipelines
- **Multi-tenant Support**: Organization-level MRR aggregation

### Performance Improvements
- **Materialized Views**: Database-level materialized views for faster queries
- **Distributed Caching**: Redis Cluster for large-scale deployments
- **Background Processing**: Async MRR calculation for large portfolios

## Troubleshooting

### Common Issues

#### MRR Shows Zero
- Check lease statuses (exclude Grace_Period, Delinquent, Terminated)
- Verify payment_status is 'paid'
- Ensure start_date ≤ current_date ≤ end_date

#### Slow Response Times
- Check Redis cache configuration
- Verify database indexes are created
- Monitor database connection pool

#### Incorrect Currency Conversion
- Verify price feed service is running
- Check currency code validity
- Review conversion rate cache

### Debug Mode
Set environment variable for enhanced debugging:
```bash
DEBUG=mrr:* npm start
```

## Support

For issues related to the MRR Aggregator:
1. Check the logs for error messages
2. Verify database connectivity and schema
3. Test with simple cases first
4. Review this documentation for common solutions

For technical support or feature requests, please create an issue in the repository with detailed information about the problem or enhancement needed.
