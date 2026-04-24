# MRR Aggregator Deployment Guide

## Quick Start

### 1. Prerequisites
- Node.js 16+ and npm installed
- Redis server running (optional but recommended)
- PostgreSQL/SQLite database with existing lease data

### 2. Installation
```bash
# Install dependencies
npm install

# Start the application
npm start
```

### 3. Verify Installation
```bash
# Run validation script
node src/tests/validation.js

# Run tests
npm test -- --testPathPattern=mrr
```

### 4. Test API Endpoints
```bash
# Test current MRR
curl "http://localhost:3000/api/v1/lessors/test-lessor/metrics/mrr?currency=USD"

# Test historical MRR
curl "http://localhost:3000/api/v1/lessors/test-lessor/metrics/mrr?date=2024-01&currency=USD"

# Test trends
curl "http://localhost:3000/api/v1/lessors/test-lessor/metrics/mrr/trends?months=6&currency=USD"
```

## Configuration

### Environment Variables
```bash
# Redis Configuration (optional)
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_redis_password

# Database Configuration
DATABASE_URL=./database.sqlite

# Cache Configuration
MRR_CACHE_TTL=900  # 15 minutes in seconds
```

### Database Setup
The MRR views are automatically created when the application starts. No manual database migration is required.

## API Usage Examples

### JavaScript/Node.js
```javascript
// Get current MRR
const response = await fetch('/api/v1/lessors/lessor-123/metrics/mrr?currency=USD');
const mrrData = await response.json();
console.log(`Current MRR: $${mrrData.currentMrr} USD`);

// Get historical MRR
const historicalResponse = await fetch('/api/v1/lessors/lessor-123/metrics/mrr?date=2024-01&currency=USD');
const historicalData = await historicalResponse.json();
console.log(`January MRR: $${historicalData.historicalMrr} USD`);

// Get trends
const trendsResponse = await fetch('/api/v1/lessors/lessor-123/metrics/mrr/trends?months=12&currency=USD');
const trendsData = await trendsResponse.json();
trendsData.trends.forEach(trend => {
  console.log(`${trend.month}: $${trend.convertedAmount} USD`);
});
```

### Python
```python
import requests

# Get current MRR
response = requests.get('http://localhost:3000/api/v1/lessors/lessor-123/metrics/mrr?currency=USD')
mrr_data = response.json()
print(f"Current MRR: ${mrr_data['currentMrr']} USD")

# Get historical MRR
historical_response = requests.get('http://localhost:3000/api/v1/lessors/lessor-123/metrics/mrr?date=2024-01&currency=USD')
historical_data = historical_response.json()
print(f"January MRR: ${historical_data['historicalMrr']} USD")
```

### cURL
```bash
# Current MRR
curl -X GET "http://localhost:3000/api/v1/lessors/lessor-123/metrics/mrr?currency=USD"

# Historical MRR
curl -X GET "http://localhost:3000/api/v1/lessors/lessor-123/metrics/mrr?date=2024-01&currency=USD"

# MRR Trends
curl -X GET "http://localhost:3000/api/v1/lessors/lessor-123/metrics/mrr/trends?months=12&currency=USD"

# Bulk MRR
curl -X POST "http://localhost:3000/api/v1/lessors/metrics/mrr/bulk" \
  -H "Content-Type: application/json" \
  -d '{"lessorIds": ["lessor-1", "lessor-2"], "currency": "USD"}'

# Clear cache
curl -X DELETE "http://localhost:3000/api/v1/lessors/lessor-123/metrics/mrr/cache"
```

## Monitoring

### Health Checks
```bash
# Application health
curl http://localhost:3000/health

# MRR-specific health (add custom endpoint if needed)
curl http://localhost:3000/api/v1/health/mrr
```

### Key Metrics to Monitor
- **Response Times**: API endpoint response times should be < 200ms for cached requests
- **Cache Hit Rate**: Should be > 80% for optimal performance
- **Error Rate**: Should be < 1% for production
- **Database Load**: Monitor query performance on lease tables

## Troubleshooting

### Common Issues

#### MRR Returns Zero
1. Check lease statuses (exclude Grace_Period, Delinquent, Terminated)
2. Verify payment_status is 'paid'
3. Ensure start_date ≤ current_date ≤ end_date
4. Check if landlord_id exists in database

#### Slow Response Times
1. Verify Redis is running and accessible
2. Check database indexes on lease tables
3. Monitor database connection pool
4. Consider reducing cache TTL for more frequent updates

#### Currency Conversion Issues
1. Verify price feed service is accessible
2. Check currency codes are valid (USD, EUR, GBP, JPY, CAD, AUD)
3. Review Redis cache for stale conversion rates

#### Database Errors
1. Check database connection string
2. Verify database schema is up to date
3. Ensure MRR views are created successfully

### Debug Mode
```bash
# Enable debug logging
DEBUG=mrr:* npm start

# Check logs for MRR operations
tail -f logs/application.log | grep MRR
```

## Performance Optimization

### Database Optimization
```sql
-- Add indexes for better performance (if not already present)
CREATE INDEX IF NOT EXISTS idx_leases_landlord_status ON leases(landlord_id, status, payment_status);
CREATE INDEX IF NOT EXISTS idx_leases_dates ON leases(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leases_currency ON leases(currency);
```

### Redis Configuration
```bash
# Redis configuration for optimal performance
redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
```

### Caching Strategy
- **Current MRR**: 15 minutes cache
- **Historical MRR**: 15 minutes cache
- **Trends**: 15 minutes cache
- **Currency Rates**: 5 minutes cache

## Security Considerations

### Authentication
The MRR endpoints should be protected with your existing authentication system:

```javascript
// Example middleware integration
app.use('/api/v1/lessors/:id/metrics/mrr', requireAuth, ensureLessorAccess);
```

### Rate Limiting
```javascript
// Add rate limiting to prevent abuse
const rateLimit = require('express-rate-limit');

const mrrRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/v1/lessors/:id/metrics/mrr', mrrRateLimit);
```

### Data Privacy
- Only aggregated financial data is exposed
- No personal information in MRR calculations
- All queries are logged for audit purposes

## Scaling Considerations

### Horizontal Scaling
- Use Redis Cluster for distributed caching
- Implement database read replicas for better performance
- Consider load balancing for API endpoints

### Database Scaling
- Partition lease tables by date for large datasets
- Use materialized views for complex aggregations
- Implement database connection pooling

### Cache Scaling
- Redis Cluster for high availability
- Cache warming strategies for popular queries
- Implement cache invalidation on lease updates

## Maintenance

### Regular Tasks
1. **Monitor cache hit rates** and adjust TTL as needed
2. **Review database performance** and optimize indexes
3. **Update currency conversion rates** regularly
4. **Clear stale cache** entries periodically

### Backup and Recovery
```bash
# Backup database
sqlite3 database.sqlite .backup backup-$(date +%Y%m%d).sqlite

# Backup Redis cache (if needed)
redis-cli --rdb backup-redis-$(date +%Y%m%d).rdb
```

## Support

For issues related to the MRR Aggregator:

1. Check the application logs for error messages
2. Verify database connectivity and schema
3. Test with simple cases first
4. Review the documentation in `docs/MRR_AGGREGATOR_DOCUMENTATION.md`
5. Run the validation script: `node src/tests/validation.js`

## Version History

### v1.0.0 (Current)
- ✅ Basic MRR calculation with normalization
- ✅ Historical MRR tracking
- ✅ Multi-currency support
- ✅ Redis caching with 15-minute TTL
- ✅ Comprehensive test suite
- ✅ API documentation

### Future Enhancements
- Real-time MRR updates via WebSocket
- Advanced analytics and forecasting
- Multi-tenant support
- Performance optimizations for large datasets

---

## Quick Validation Checklist

Before going to production, ensure:

- [ ] Application starts without errors
- [ ] Database tables and views are created
- [ ] Redis connection is working (if used)
- [ ] API endpoints return correct responses
- [ ] Caching is functioning properly
- [ ] Tests pass successfully
- [ ] Documentation is reviewed
- [ ] Monitoring is set up
- [ ] Security measures are in place
- [ ] Performance benchmarks are met

Once all items are checked, the MRR Aggregator is ready for production deployment!
