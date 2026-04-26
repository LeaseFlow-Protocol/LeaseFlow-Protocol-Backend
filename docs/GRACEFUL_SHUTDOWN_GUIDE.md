# Graceful Shutdown Implementation Guide

## Overview

This document describes the graceful shutdown implementation for the LeaseFlow Protocol backend, ensuring zero data loss during Kubernetes pod terminations, deployments, and autoscaling scale-down events.

## Problem Statement

When Kubernetes sends a SIGTERM signal to a Node.js pod during:
- Rolling deployments
- Autoscaling scale-down events
- Pod eviction due to resource constraints
- Manual pod termination

The application would abruptly kill:
- Active database transactions
- In-progress webhook dispatches
- Background job processing

This could result in:
- Data corruption
- Incomplete transactions
- Lost webhook deliveries
- Abandoned background jobs

## Solution

The GracefulShutdownService intercepts SIGTERM signals and orchestrates a clean shutdown sequence:

### Shutdown Sequence

1. **Stop accepting new connections** (immediate)
   - Set `isShuttingDown` flag
   - Middleware returns 503 for all new HTTP requests
   - Health endpoint returns 503 to signal load balancers

2. **Pause BullMQ queues** (immediate)
   - Pause all BullMQ workers to prevent new job processing
   - Allow currently processing jobs to complete

3. **Wait for active connections** (up to 25 seconds)
   - Track active HTTP connections
   - Wait for in-flight requests to complete
   - Force close remaining connections after timeout

4. **Stop background jobs** (up to 2 seconds)
   - Stop cron jobs and schedulers
   - Stop background workers

5. **Close BullMQ queues** (up to 2 seconds)
   - Close BullMQ workers
   - Close BullMQ queues

6. **Close database connections** (up to 1 second)
   - Close SQLite database connection
   - Ensure all transactions are committed

7. **Close Redis connections** (up to 1 second)
   - Unsubscribe from all Pub/Sub channels
   - Close subscriber connection
   - Close main client connection

8. **Stop GraphQL server** (up to 1 second)
   - Stop Apollo GraphQL server
   - Close WebSocket connections

9. **Close HTTP server** (up to 1 second)
   - Stop accepting new connections
   - Close HTTP server

**Total timeout: 30 seconds**

## Implementation Details

### GracefulShutdownService

Located in `src/services/gracefulShutdownService.js`

#### Key Features

- **SIGTERM/SIGINT interception**: Listens for termination signals
- **503 middleware**: Returns 503 for all requests during shutdown
- **Connection tracking**: Tracks active HTTP connections
- **BullMQ integration**: Pauses and closes BullMQ queues/workers
- **Database closing**: Gracefully closes database connections
- **Redis cleanup**: Unsubscribes from Pub/Sub and closes connections
- **Timeout enforcement**: Prevents hung processes from blocking shutdown

#### Configuration

```javascript
const gracefulShutdownService = new GracefulShutdownService();

// Timeouts (configurable)
gracefulShutdownService.shutdownTimeout = 30000; // 30 seconds total
gracefulShutdownService.healthCheckGracePeriod = 5000; // 5 seconds
gracefulShutdownService.requestDrainTimeout = 25000; // 25 seconds for request drain
```

#### Registration

```javascript
// In index.js
const gracefulShutdownService = new GracefulShutdownService();
gracefulShutdownService.initialize(app, server, {
  database,
  redisService,
  apolloServer: app.locals.apolloServer,
  config
});

// Register background jobs
gracefulShutdownService.registerBackgroundJob('leaseRenewal', renewalJob);
gracefulShutdownService.registerBackgroundJob('lateFee', lateFeeJob);

// Register BullMQ queues (if using BullMQ)
gracefulShutdownService.registerBullMQQueue('webhooks', webhookQueue, webhookWorker);
```

### Database Connection Closing

Located in `src/db/appDatabase.js`

#### Implementation

```javascript
class AppDatabase {
  async close() {
    if (this.db) {
      try {
        this.db.close();
        console.log('[AppDatabase] Database connection closed');
      } catch (error) {
        console.error('[AppDatabase] Error closing database:', error.message);
      }
    }
  }
}
```

This ensures:
- All pending transactions are committed
- Database connection is properly closed
- No data corruption occurs

### Redis Pub/Sub Cleanup

Located in `src/services/redisService.js`

#### Implementation

```javascript
class RedisService {
  async disconnect() {
    // Unsubscribe from all Pub/Sub channels
    await this.unsubscribeAll();

    // Close subscriber connection
    if (this.subscriber) {
      await this.subscriber.quit();
    }

    // Close main client connection
    if (this.client) {
      await this.client.quit();
    }
  }

  async subscribe(channel, callback) {
    // Creates dedicated subscriber connection
    // Registers callback for messages
    // Tracks subscriptions for cleanup
  }

  async unsubscribeAll() {
    // Unsubscribes from all tracked channels
    // Clears subscription map
  }
}
```

This ensures:
- All Pub/Sub subscriptions are cleaned up
- No orphaned subscribers remain
- Redis connections close gracefully

### BullMQ Queue Management

#### Implementation

```javascript
// Register BullMQ queues
gracefulShutdownService.registerBullMQQueue('queueName', queue, worker);

// During shutdown:
// 1. Pause queues to prevent new jobs
await gracefulShutdownService.pauseBullMQQueues();

// 2. Close workers and queues
await gracefulShutdownService.closeBullMQQueues();
```

This ensures:
- No new jobs are processed during shutdown
- Currently processing jobs complete
- Queues close cleanly

## Kubernetes Configuration

### Pod Termination Grace Period

Configure the `terminationGracePeriodSeconds` in your Kubernetes deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: leaseflow-backend
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 35  # 30s shutdown + 5s buffer
```

### Pre-Stop Hook

Add a pre-stop hook to signal the application:

```yaml
spec:
  containers:
  - name: leaseflow-backend
    lifecycle:
      preStop:
        exec:
          command: ["/bin/sh", "-c", "sleep 5"]
```

### Readiness Probe

Configure readiness probe to stop routing traffic during shutdown:

```yaml
spec:
  containers:
  - name: leaseflow-backend
    readinessProbe:
      httpGet:
        path: /health
        port: 4000
      initialDelaySeconds: 10
      periodSeconds: 5
      timeoutSeconds: 3
      failureThreshold: 3
```

The health endpoint returns 503 during shutdown, causing the pod to be marked as not ready.

## Testing

### Test Suite

Located in `tests/gracefulShutdownSigterm.test.js`

#### Test Coverage

- SIGTERM signal interception
- 503 response during shutdown
- Active request completion (5-second sleep test)
- Connection tracking and timeout
- Database connection closing
- Redis Pub/Sub cleanup
- BullMQ queue pausing and closing
- Timeout boundary enforcement
- Full shutdown flow integration

#### Running Tests

```bash
npm test -- tests/gracefulShutdownSigterm.test.js
```

### Manual Testing

#### Test SIGTERM Handling

```bash
# Start the application
npm start

# Find the process ID
ps aux | grep node

# Send SIGTERM
kill -TERM <PID>

# Verify graceful shutdown in logs
# Should see:
# [GracefulShutdown] Received SIGTERM, starting graceful shutdown...
# [GracefulShutdown] Stopping new connections...
# [GracefulShutdown] Pausing BullMQ queues...
# [GracefulShutdown] Waiting for X active connections...
# [GracefulShutdown] Stopping background jobs...
# [GracefulShutdown] Closing BullMQ workers and queues...
# [GracefulShutdown] Closing database connections...
# [GracefulShutdown] Closing Redis connections...
# [GracefulShutdown] Stopping GraphQL server...
# [GracefulShutdown] Closing HTTP server...
# [GracefulShutdown] Shutdown completed in XXXms
```

#### Test Active Request Completion

```bash
# Start a long-running request
curl -X POST http://localhost:4000/api/leases \
  -H "Content-Type: application/json" \
  -d '{"propertyId": "test", "tenantId": "test"}' &

# Immediately send SIGTERM
kill -TERM <PID>

# Verify the request completed successfully
# Check logs for request completion before shutdown
```

#### Test 503 Response During Shutdown

```bash
# Trigger shutdown
kill -TERM <PID>

# Immediately make a request
curl http://localhost:4000/health

# Should receive:
# {"status":"shutting_down","message":"Server is shutting down, please retry later","timestamp":"..."}
```

## Security Considerations

### Timeout Boundaries

The implementation enforces strict timeout boundaries to prevent hung processes:

- **Total shutdown timeout**: 30 seconds
- **Request drain timeout**: 25 seconds
- **Individual operation timeouts**: Each operation has implicit timeouts

If any operation exceeds its timeout:
- The operation is aborted
- Shutdown continues to next step
- Process exits with error code 1

This ensures:
- No process can hang indefinitely
- Kubernetes can force-kill the pod after terminationGracePeriodSeconds
- No zombie processes remain

### Signal Handling

The service handles multiple signal types:

- **SIGTERM**: Graceful shutdown (Kubernetes default)
- **SIGINT**: Graceful shutdown (Ctrl+C)
- **uncaughtException**: Emergency shutdown
- **unhandledRejection**: Emergency shutdown

Emergency shutdowns:
- Log the error
- Attempt graceful shutdown
- Exit with error code 1

## Monitoring and Observability

### Logs

The graceful shutdown service logs each step:

```
[GracefulShutdown] Received SIGTERM, starting graceful shutdown...
[GracefulShutdown] Stopping new connections...
[GracefulShutdown] Pausing BullMQ queues...
[GracefulShutdown] Pausing queue: webhooks
[GracefulShutdown] All BullMQ queues paused
[GracefulShutdown] Waiting for 5 active connections...
[GracefulShutdown] Still waiting for 5 connections...
[GracefulShutdown] Still waiting for 3 connections...
[GracefulShutdown] All background jobs stopped
[GracefulShutdown] Closing BullMQ workers and queues...
[GracefulShutdown] Closing queue: webhooks
[GracefulShutdown] All BullMQ workers and queues closed
[GracefulShutdown] Closing database connections...
[AppDatabase] Database connection closed
[GracefulShutdown] Closing Redis connections...
[RedisService] Unsubscribed from 3 channels
[RedisService] Redis subscriber disconnected
[RedisService] Disconnected from Redis
[GracefulShutdown] Stopping GraphQL server...
[GracefulShutdown] GraphQL server stopped
[GracefulShutdown] Closing HTTP server...
[GracefulShutdown] HTTP server closed
[GracefulShutdown] Shutdown completed in 1234ms
```

### Metrics

Track the following metrics:

- Shutdown duration
- Active connection count at shutdown
- Time spent in each shutdown phase
- Shutdown success/failure rate

### Alerts

Configure alerts for:

- Shutdown duration > 30 seconds
- Shutdown failures
- High active connection count during shutdown

## Troubleshooting

### Issue: Shutdown Takes Too Long

**Symptoms:** Shutdown exceeds 30 seconds

**Causes:**
- Long-running requests not completing
- Database transactions not committing
- BullMQ jobs not finishing

**Solutions:**
- Check active connection logs
- Review slow queries
- Adjust request drain timeout
- Implement request timeouts at application level

### Issue: Data Loss After Shutdown

**Symptoms:** Missing data after pod restart

**Causes:**
- Database not closing properly
- Transactions not committed
- BullMQ jobs abandoned

**Solutions:**
- Verify database close logs
- Check transaction logs
- Review BullMQ job completion
- Ensure BullMQ pause is working

### Issue: 503 Responses During Normal Operation

**Symptoms:** 503 responses when not shutting down

**Causes:**
- `isShuttingDown` flag stuck true
- Middleware order incorrect

**Solutions:**
- Check for multiple shutdown triggers
- Verify middleware is first in stack
- Restart pod to clear state

### Issue: Redis Subscriber Not Closing

**Symptoms:** Redis connection remains after shutdown

**Causes:**
- Subscriber not tracked
- Unsubscribe fails silently

**Solutions:**
- Verify subscriber is registered
- Check Redis logs
- Implement retry logic for unsubscribe

## Best Practices

### Application Level

1. **Implement request timeouts**: Add timeouts to all external calls
2. **Use database transactions**: Ensure data consistency
3. **Make operations idempotent**: Allow safe retry
4. **Log shutdown events**: Track shutdown patterns
5. **Monitor active connections**: Alert on high connection counts

### Kubernetes Level

1. **Set appropriate terminationGracePeriodSeconds**: 35 seconds recommended
2. **Use pre-stop hooks**: Allow time for shutdown to start
3. **Configure readiness probes**: Stop routing traffic during shutdown
4. **Use pod disruption budgets**: Ensure minimum availability
5. **Monitor pod restarts**: Track shutdown-related restarts

### Development Level

1. **Test shutdown regularly**: Include in CI/CD
2. **Run Game Day exercises**: Simulate failures
3. **Review shutdown logs**: Identify patterns
4. **Update documentation**: Keep procedures current
5. **Train team members**: Ensure everyone understands shutdown

## Migration Guide

### Existing Applications

If you have an existing application without graceful shutdown:

1. **Add GracefulShutdownService**: Import and initialize
2. **Register background jobs**: Add job registration
3. **Register BullMQ queues**: If using BullMQ
4. **Add database close method**: Implement in database class
5. **Add Redis cleanup**: Implement Pub/Sub cleanup
6. **Update Kubernetes config**: Add terminationGracePeriodSeconds
7. **Test thoroughly**: Run test suite and manual tests
8. **Monitor in production**: Watch for issues

### Rollback Plan

If issues occur after deployment:

1. **Revert to previous version**: Roll back deployment
2. **Investigate logs**: Check shutdown logs
3. **Fix issues**: Address root cause
4. **Test again**: Verify fix
5. **Redeploy**: Deploy fixed version

## References

- [Kubernetes Termination of Pods](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)
- [Node.js Graceful Shutdown](https://nodejs.org/api/process.html#process_signal_events)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [ioredis Documentation](https://github.com/luin/ioredis)

## Changelog

### Version 1.0 (2026-04-26)
- Initial implementation
- SIGTERM/SIGINT interception
- 503 middleware for shutdown
- Connection tracking
- Database connection closing
- Redis Pub/Sub cleanup
- BullMQ queue pausing and closing
- Timeout enforcement
- Comprehensive test suite
- Documentation

---

**Document Version:** 1.0
**Last Updated:** 2026-04-26
**Next Review:** 2026-07-26
