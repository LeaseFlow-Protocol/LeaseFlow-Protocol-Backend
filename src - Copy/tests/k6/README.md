# K6 Load Testing Suite - LeaseFlow Protocol

## Overview

This suite provides comprehensive load testing for the LeaseFlow backend, specifically designed to simulate "Rent Day" scenarios where 90% of users log in simultaneously. The tests ensure the backend can handle **10,000 concurrent requests** without database deadlocks or crashes.

## Prerequisites

### Install K6

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo apt-get install k6

# Windows
choco install k6

# Or via npm (already installed as dev dependency)
npm install --save-dev k6
```

### Verify Installation

```bash
k6 version
```

## Test Scenarios

### 1. Rent Day Stress Test (`rent-day-stress-test.js`)

**Purpose:** Simulates the extreme load on the 1st of the month when most tenants pay rent simultaneously.

**Features:**
- Gradual ramp-up from 0 to 10,000 concurrent users
- Sustained peak load at 10,000 VUs
- Spike test for sudden traffic surges
- 90% tenants paying rent, 10% landlords generating invoices
- Custom metrics for payment success rates and database deadlocks

**Run the test:**

```bash
# Basic run (short duration for quick testing)
k6 run --vus 100 --duration 30s src/tests/k6/rent-day-stress-test.js

# Full production stress test (10,000 concurrent users)
k6 run --vus 10000 --duration 30m src/tests/k6/rent-day-stress-test.js

# With gradual ramp-up
k6 run --stages=duration:5m,vus:1000 \
       --stages=duration:10m,vus:5000 \
       --stages=duration:15m,vus:10000 \
       src/tests/k6/rent-day-stress-test.js
```

### 2. Invoice Generation Test (`invoice-generation-test.js`)

**Purpose:** Tests invoice generation endpoint under constant heavy load.

**Features:**
- Constant arrival rate of 100 requests/second
- Sustained load for 10 minutes
- Maximum 2,000 concurrent virtual users

**Run the test:**

```bash
k6 run src/tests/k6/invoice-generation-test.js
```

## Configuration

### Environment Variables

Create a `.env.k6` file or export environment variables:

```bash
export BASE_URL=http://localhost:3000
export TENANT_AUTH_TOKEN=your_test_tenant_token
export LANDLORD_AUTH_TOKEN=your_test_landlord_token
```

Or use inline:

```bash
BASE_URL=http://localhost:3000 \
TENANT_AUTH_TOKEN=test_token \
LANDLORD_AUTH_TOKEN=test_token \
k6 run src/tests/k6/rent-day-stress-test.js
```

### K6 Cloud Execution (Optional)

For massive scale testing (100,000+ VUs), use [k6 Cloud](https://k6.io/cloud):

```bash
# Login to k6 Cloud
k6 login cloud

# Run test on k6 Cloud infrastructure
k6 cloud src/tests/k6/rent-day-stress-test.js
```

## Performance Thresholds

The tests enforce strict performance thresholds. A test **FAILS** if any threshold is not met:

| Metric | Threshold | Description |
|--------|-----------|-------------|
| `http_req_duration` | p95 < 3000ms | 95% of requests must complete within 3 seconds |
| `http_req_failed` | rate < 1% | Less than 1% request failures |
| `rent_payment_success` | rate > 99% | 99% of rent payments must succeed |
| `invoice_generation_success` | rate > 99% | 99% of invoice generations must succeed |
| `payment_response_time` | p95 < 2000ms | Payment processing under 2 seconds (p95) |
| `invoice_response_time` | p95 < 1500ms | Invoice generation under 1.5 seconds (p95) |
| `database_deadlocks` | count = 0 | **ZERO** database deadlocks tolerated |

## Output & Reporting

### Console Output

K6 provides real-time metrics during test execution:

```
█ rent-day-stress-test

    ✓ rent payment successful
    ✓ invoice generation successful
    ✗ no database errors

    checks.........................: 98.50% ✓ 985000 / 1000000
    data_received..................: 2.5 GB 
    data_sent......................: 1.2 GB 
    http_req_duration..............: avg=1.2s min=50ms med=1.1s max=15s p(90)=1.8s p(95)=2.1s p(99)=4.5s
    http_reqs......................: 50000/s
    
    rent_payment_success...........: 99.2%  ✓ 496000 / 500000
    invoice_generation_success.....: 99.5%  ✓ 49750 / 50000
    database_deadlocks.............: 0      0/s
```

### JSON Output

Generate detailed JSON reports for analysis:

```bash
k6 run --out json=results.json src/tests/k6/rent-day-stress-test.js
```

### HTML Report

Generate visual HTML reports:

```bash
k6 run --out json=results.json src/tests/k6/rent-day-stress-test.js
k6-to-html results.json --output report.html
```

### CI/CD Integration

Integrate with GitHub Actions, Jenkins, or GitLab CI:

```yaml
# .github/workflows/load-test.yml
name: Load Testing
on: [push]
jobs:
  k6:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install k6
        run: |
          brew install k6
      - name: Run Rent Day Stress Test
        run: |
          k6 run --vus 1000 --duration 5m src/tests/k6/rent-day-stress-test.js
        env:
          BASE_URL: ${{ secrets.TEST_BASE_URL }}
          TENANT_AUTH_TOKEN: ${{ secrets.TEST_TENANT_TOKEN }}
          LANDLORD_AUTH_TOKEN: ${{ secrets.TEST_LANDLORD_TOKEN }}
```

## Interpreting Results

### ✅ PASS - System is Production Ready

All thresholds met:
- `rent_payment_success` > 99%
- `database_deadlocks` = 0
- Response times within limits

### ❌ FAIL - Optimization Required

If tests fail, investigate:

1. **Database Deadlocks Detected**
   - Check transaction isolation levels
   - Optimize query indexes
   - Review connection pool settings
   - Implement row-level locking

2. **High Response Times**
   - Add caching layer (Redis)
   - Optimize slow queries
   - Scale horizontally (load balancers)
   - Implement queue-based processing

3. **Low Success Rate**
   - Increase server capacity
   - Add rate limiting
   - Implement circuit breakers
   - Review error handling

## Best Practices

### Before Running Tests

1. **Use a staging environment** that mirrors production
2. **Seed the database** with realistic test data (10,000+ leases)
3. **Monitor server resources** (CPU, memory, disk I/O)
4. **Enable database query logging** to identify bottlenecks

### During Tests

1. **Monitor application logs** in real-time
2. **Watch database connections** and lock contention
3. **Track memory usage** and garbage collection
4. **Observe network throughput**

### After Tests

1. **Analyze slow query logs**
2. **Review error patterns**
3. **Generate performance reports**
4. **Document bottlenecks and fixes**
5. **Re-run tests after optimizations**

## Troubleshooting

### Issue: "Too many open files"

**Solution:** Increase file descriptor limit

```bash
ulimit -n 65536
```

### Issue: "Connection refused" at high VUs

**Solution:** Increase OS connection limits

```bash
# Linux
sysctl -w net.core.somaxconn=65536
sysctl -w net.ipv4.ip_local_port_range="1024 65535"
```

### Issue: Database connection pool exhausted

**Solution:** Increase pool size in database configuration

```javascript
// In your database service
maxConnections: 100 // Increase from default
```

## Advanced Usage

### Distributed Testing

Run tests across multiple machines for even higher load:

```bash
# On master node
k6 run --out cloud src/tests/k6/rent-day-stress-test.js

# On worker nodes (SSH)
for i in {1..5}; do
  ssh worker-$i "k6 run --vus 2000 src/tests/k6/rent-day-stress-test.js" &
done
```

### Custom Scenarios

Modify test scenarios in `options`:

```javascript
export const options = {
  scenarios: {
    custom_scenario: {
      executor: 'custom',
      exec: 'customLoadPattern',
      // Your custom logic here
    },
  },
};
```

## Resources

- [K6 Documentation](https://k6.io/docs/)
- [K6 JavaScript API](https://k6.io/docs/javascript-api/)
- [Performance Testing Best Practices](https://k6.io/blog/performance-testing-best-practices/)
- [Database Deadlock Prevention](https://www.postgresql.org/docs/current/explicit-locking.html)

## Support

For issues or questions, please open an issue on the LeaseFlow repository or contact the DevOps team.

---

**Labels:** devops, performance, reliability
