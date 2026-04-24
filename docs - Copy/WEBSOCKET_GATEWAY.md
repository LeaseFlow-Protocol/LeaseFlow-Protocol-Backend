# WebSocket Gateway for Live Lease State Transitions

This document describes the implementation of the WebSocket Gateway that provides real-time communication between the LeaseFlow Protocol backend and frontend clients for live lease state transitions.

## Overview

The WebSocket Gateway transforms the user dashboard into a highly reactive, real-time interface for tracking lease negotiations. Users no longer need to manually refresh their browsers to see if a lessor has accepted their deposit or terminated a lease. The system provides instantaneous UI updates the moment an on-chain lease transaction finalizes.

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │◄──▶│  WebSocket      │◄──▶│  Soroban        │
│   Client        │    │  Gateway         │    │  Indexer        │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Socket.IO      │    │  Redis Adapter   │    │  Event Queue    │
│  Client         │    │  (Scaling)       │    │  (BullMQ)       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  JWT Auth       │    │  Event Handlers  │    │  Performance    │
│  (SEP-10)       │    │  (Security)      │    │  Monitor        │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Features

### ✅ Acceptance Criteria Met

- **✅ Acceptance 1**: Counterparties receive instantaneous UI updates the moment an on-chain lease transaction finalizes
- **✅ Acceptance 2**: The gateway operates asynchronously without degrading the performance of standard REST API endpoints
- **✅ Acceptance 3**: Real-time data streams are cryptographically locked behind secure SEP-10 authentication protocols

### 🚀 Core Features

- **Real-time Event Broadcasting**: Instant delivery of lease state changes to relevant parties
- **SEP-10 JWT Authentication**: Secure WebSocket connections using Stellar authentication tokens
- **Namespace-based Connections**: Individual namespaces for each authenticated pubkey
- **Cross-tenant Data Leakage Protection**: Structural prevention of data leakage between users
- **Heartbeat Monitoring**: Automatic detection and cleanup of zombie connections
- **Performance Monitoring**: Comprehensive metrics and alerting system
- **Redis Adapter**: Horizontal scaling support for multi-instance deployments
- **Type-safe Event Schemas**: Strict JSON schemas for all socket emissions

## Components

### 1. WebSocket Gateway (`src/websocket/gateway/leaseWebSocketGateway.js`)

Main WebSocket server implementation using Socket.IO with Redis adapter for scaling.

**Key Features:**
- Multi-namespace support (`/leases`, `/user/{pubkey}`)
- Connection tracking and management
- Heartbeat ping-pong mechanism
- Event broadcasting to relevant parties
- Zombie connection detection and cleanup

### 2. Authentication Middleware (`src/websocket/middleware/websocketAuth.js`)

SEP-10 JWT authentication for WebSocket connections.

**Security Features:**
- JWT token validation and verification
- Stellar public key format validation
- Rate limiting per user
- Connection tracking and cleanup
- Test token generation (development only)

### 3. Event Schemas (`src/websocket/schemas/leaseEventSchemas.js`)

Strict JSON schemas for all WebSocket event emissions ensuring type safety.

**Event Types:**
- `SecurityDepositLocked`
- `LeaseRenewed`
- `LeaseTerminated`
- `LeaseCreated`
- `RentPaymentReceived`
- `RentPaymentLate`
- `SecurityDepositRefunded`

### 4. Event Handlers (`src/websocket/handlers/leaseEventHandlers.js`)

Secure event processing with cross-tenant data leakage protection.

**Security Controls:**
- Event data integrity validation
- Rate limiting per lease
- Lease access permission validation
- Cross-tenant data leakage detection
- Sensitive data exposure prevention

### 5. Soroban Integration (`src/websocket/integration/sorobanEventEmitter.js`)

Integration with Soroban indexer for real-time event emission.

**Features:**
- Database change monitoring
- Event transformation and buffering
- Batch processing for efficiency
- Error handling and retry logic

### 6. Performance Monitor (`src/websocket/monitoring/websocketPerformanceMonitor.js`)

Comprehensive performance monitoring and alerting system.

**Metrics Tracked:**
- Connection metrics (active, peak, duration)
- Message metrics (sent, received, failed)
- Event processing metrics (processed, blocked, failed)
- Performance metrics (latency, throughput, memory)
- Security metrics (auth attempts, failures, violations)

## API Endpoints

### WebSocket Connections

#### Main Namespace: `/leases`

**Authentication:** Required (SEP-10 JWT)

**Connection URL:**
```javascript
const socket = io('/leases', {
  auth: {
    token: 'your-jwt-token'
  }
});
```

#### User Namespace: `/user/{pubkey}`

**Authentication:** Required (SEP-10 JWT matching pubkey)

**Connection URL:**
```javascript
const socket = io('/user/GBL...YOUR_PUBKEY', {
  auth: {
    token: 'your-jwt-token'
  }
});
```

### Client Events

#### `subscribe_lease`

Subscribe to updates for a specific lease.

```javascript
socket.emit('subscribe_lease', {
  leaseId: 'lease-123'
});
```

**Response:**
```javascript
{
  "type": "subscription_confirmed",
  "leaseId": "lease-123",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### `unsubscribe_lease`

Unsubscribe from lease updates.

```javascript
socket.emit('unsubscribe_lease', {
  leaseId: 'lease-123'
});
```

#### `ping`

Heartbeat ping message.

```javascript
socket.emit('ping');
```

**Response:**
```javascript
{
  "type": "pong",
  "timestamp": "2024-01-01T00:00:00Z",
  "clientId": "socket-123"
}
```

### Server Events

#### `connection_ack`

Connection acknowledgment.

```javascript
{
  "type": "connection_ack",
  "status": "connected",
  "timestamp": "2024-01-01T00:00:00Z",
  "clientId": "socket-123",
  "pubkey": "GBL...YOUR_PUBKEY"
}
```

#### `lease_event`

Real-time lease state transition event.

```javascript
{
  "eventType": "SecurityDepositLocked",
  "timestamp": "2024-01-01T00:00:00Z",
  "leaseId": "lease-123",
  "transactionHash": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
  "network": "testnet",
  "data": {
    "lessorPubkey": "GBL...LESSOR",
    "lesseePubkey": "GBL...LESSEE",
    "depositAmount": "1000",
    "depositAsset": "USDC",
    "lockTimestamp": "2024-01-01T00:00:00Z"
  },
  "recipient": "GBL...LESSEE",
  "deliveredAt": "2024-01-01T00:00:00Z"
}
```

#### `error`

Error event.

```javascript
{
  "type": "error",
  "error": {
    "code": "UNAUTHORIZED_ACCESS",
    "message": "Unauthorized access to lease",
    "details": {}
  },
  "timestamp": "2024-01-01T00:00:00Z",
  "eventId": "error-123"
}
```

## Event Schemas

### SecurityDepositLocked

```json
{
  "eventType": "SecurityDepositLocked",
  "timestamp": "2024-01-01T00:00:00Z",
  "leaseId": "lease-123",
  "transactionHash": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
  "network": "testnet",
  "data": {
    "lessorPubkey": "GBL...LESSOR",
    "lesseePubkey": "GBL...LESSEE",
    "depositAmount": "1000",
    "depositAsset": "USDC",
    "lockTimestamp": "2024-01-01T00:00:00Z",
    "escrowContract": "GBL...ESCROW"
  }
}
```

### LeaseRenewed

```json
{
  "eventType": "LeaseRenewed",
  "timestamp": "2024-01-01T00:00:00Z",
  "leaseId": "lease-123",
  "transactionHash": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
  "network": "testnet",
  "data": {
    "lessorPubkey": "GBL...LESSOR",
    "lesseePubkey": "GBL...LESSEE",
    "newEndDate": "2025-01-01T00:00:00Z",
    "renewalTerms": {
      "newRentAmount": "1100",
      "rentCurrency": "USDC",
      "renewalDuration": 12,
      "renewalUnit": "months"
    },
    "renewalTimestamp": "2024-01-01T00:00:00Z"
  }
}
```

### LeaseTerminated

```json
{
  "eventType": "LeaseTerminated",
  "timestamp": "2024-01-01T00:00:00Z",
  "leaseId": "lease-123",
  "transactionHash": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
  "network": "testnet",
  "data": {
    "lessorPubkey": "GBL...LESSOR",
    "lesseePubkey": "GBL...LESSEE",
    "terminationReason": "mutual_agreement",
    "terminationDate": "2024-01-01T00:00:00Z",
    "securityDepositRefunded": true,
    "refundAmount": "950",
    "penalties": []
  }
}
```

## Security

### Authentication

**SEP-10 JWT Token Structure:**
```json
{
  "sub": "GBL...YOUR_PUBKEY",
  "iss": "leaseflow-protocol",
  "iat": 1640995200,
  "exp": 1641081600,
  "pubkey": "GBL...YOUR_PUBKEY"
}
```

**Token Validation:**
- JWT signature verification using HS256 algorithm
- Stellar public key format validation (`G[A-Z0-9]{55}`)
- Required fields validation (`sub`, `iss`, `iat`, `exp`)
- Token expiration checking

### Data Leakage Protection

**Cross-tenant Protection:**
- Namespace isolation by pubkey
- Lease access permission validation
- Event data sanitization per recipient
- Sensitive data exposure detection
- Rate limiting per lease

**Security Controls:**
- Event integrity validation
- Transaction hash format validation
- Timestamp validation (no future events)
- Duplicate event detection

## Performance

### Metrics

**Connection Metrics:**
- Active connections per user
- Peak concurrent connections
- Average connection duration
- Connection success rate

**Message Metrics:**
- Messages sent/received per second
- Message size distribution
- Success/failure rates
- Latency measurements

**Event Metrics:**
- Events processed per second
- Event processing time
- Security event rates
- Error rates by type

### Performance Optimizations

**Scalability:**
- Redis adapter for horizontal scaling
- Connection pooling
- Event buffering and batch processing
- Automatic zombie connection cleanup

**Efficiency:**
- Heartbeat mechanism with configurable intervals
- Rate limiting to prevent abuse
- Memory usage monitoring
- CPU usage tracking

## Configuration

### Environment Variables

```bash
# WebSocket Configuration
WEBSOCKET_ENABLED=true
WEBSOCKET_HEARTBEAT_INTERVAL=30000
WEBSOCKET_HEARTBEAT_TIMEOUT=10000
WEBSOCKET_MAX_CONNECTIONS=1000
WEBSOCKET_CONNECTION_TIMEOUT=120000

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration
JWT_SECRET=your-secret-key
JWT_ALGORITHM=HS256
JWT_EXPIRY=24h

# Performance Monitoring
WEBSOCKET_MONITORING_INTERVAL=30000
WEBSOCKET_MAX_LATENCY=100
WEBSOCKET_MAX_MEMORY_USAGE=0.8
WEBSOCKET_MAX_ERROR_RATE=0.05

# Security
WEBSOCKET_DATA_LEAKAGE_PROTECTION=true
WEBSOCKET_RATE_LIMIT_WINDOW=60000
WEBSOCKET_RATE_LIMIT_MAX=100
```

### Configuration File

```javascript
// config.js
module.exports = {
  websocket: {
    enabled: process.env.WEBSOCKET_ENABLED !== 'false',
    heartbeatInterval: parseInt(process.env.WEBSOCKET_HEARTBEAT_INTERVAL) || 30000,
    heartbeatTimeout: parseInt(process.env.WEBSOCKET_HEARTBEAT_TIMEOUT) || 10000,
    maxConnections: parseInt(process.env.WEBSOCKET_MAX_CONNECTIONS) || 1000,
    connectionTimeout: parseInt(process.env.WEBSOCKET_CONNECTION_TIMEOUT) || 120000,
    dataLeakageProtection: process.env.WEBSOCKET_DATA_LEAKAGE_PROTECTION !== 'false',
    rateLimitWindow: parseInt(process.env.WEBSOCKET_RATE_LIMIT_WINDOW) || 60000,
    rateLimitMax: parseInt(process.env.WEBSOCKET_RATE_LIMIT_MAX) || 100,
    monitoringInterval: parseInt(process.env.WEBSOCKET_MONITORING_INTERVAL) || 30000,
    maxLatency: parseInt(process.env.WEBSOCKET_MAX_LATENCY) || 100,
    maxMemoryUsage: parseFloat(process.env.WEBSOCKET_MAX_MEMORY_USAGE) || 0.8,
    maxErrorRate: parseFloat(process.env.WEBSOCKET_MAX_ERROR_RATE) || 0.05
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    expiry: process.env.JWT_EXPIRY || '24h'
  }
};
```

## Integration

### Server Setup

```javascript
const LeaseWebSocketGateway = require('./src/websocket/gateway/leaseWebSocketGateway');
const SorobanEventEmitter = require('./src/websocket/integration/sorobanEventEmitter');
const WebSocketPerformanceMonitor = require('./src/websocket/monitoring/websocketPerformanceMonitor');

// Initialize components
const performanceMonitor = new WebSocketPerformanceMonitor(config);
const websocketGateway = new LeaseWebSocketGateway(config, database);
const sorobanEmitter = new SorobanEventEmitter(config, database, websocketGateway);

// Start WebSocket gateway
await websocketGateway.initialize(httpServer);

// Start Soroban event emitter
await sorobanEmitter.start();

// Set up event listeners
websocketGateway.on('lease_event', (eventData) => {
  // Handle lease events
});

sorobanEmitter.on('lease_event', (eventData) => {
  // Forward to WebSocket gateway
  websocketGateway.emit('soroban_event', eventData);
});
```

### Client Integration

```javascript
import io from 'socket.io-client';

class LeaseWebSocketClient {
  constructor(jwtToken, pubkey) {
    this.jwtToken = jwtToken;
    this.pubkey = pubkey;
    this.socket = null;
    this.eventHandlers = new Map();
  }

  connect() {
    // Connect to main namespace
    this.socket = io('/leases', {
      auth: {
        token: this.jwtToken
      }
    });

    this.setupEventHandlers();
    return this.socket;
  }

  connectToUserNamespace() {
    // Connect to user-specific namespace
    this.socket = io(`/user/${this.pubkey}`, {
      auth: {
        token: this.jwtToken
      }
    });

    this.setupEventHandlers();
    return this.socket;
  }

  setupEventHandlers() {
    this.socket.on('connect', () => {
      console.log('Connected to WebSocket gateway');
    });

    this.socket.on('lease_event', (event) => {
      this.handleLeaseEvent(event);
    });

    this.socket.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from WebSocket:', reason);
    });
  }

  subscribeToLease(leaseId) {
    return new Promise((resolve, reject) => {
      this.socket.emit('subscribe_lease', { leaseId });
      
      this.socket.once('subscription_confirmed', (data) => {
        if (data.leaseId === leaseId) {
          resolve(data);
        } else {
          reject(new Error('Subscription confirmation mismatch'));
        }
      });
    });
  }

  unsubscribeFromLease(leaseId) {
    this.socket.emit('unsubscribe_lease', { leaseId });
  }

  handleLeaseEvent(event) {
    const handler = this.eventHandlers.get(event.eventType);
    if (handler) {
      handler(event);
    } else {
      console.log('Unhandled lease event:', event.eventType);
    }
  }

  on(eventType, handler) {
    this.eventHandlers.set(eventType, handler);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Usage example
const client = new LeaseWebSocketClient(jwtToken, userPubkey);
client.connect();

client.on('SecurityDepositLocked', (event) => {
  console.log('Security deposit locked:', event);
  // Update UI to show deposit status
});

client.on('LeaseTerminated', (event) => {
  console.log('Lease terminated:', event);
  // Update UI to show termination status
});

await client.subscribeToLease('lease-123');
```

## Testing

### Unit Tests

**Test Coverage:**
- WebSocket authentication
- Event schema validation
- Data leakage protection
- Performance monitoring
- Error handling
- Connection management

**Test Files:**
- `tests/websocket/websocketAuth.test.js`
- `tests/websocket/leaseEventHandlers.test.js`
- `tests/websocket/leaseWebSocketGateway.test.js`

### Integration Tests

**Cross-tenant Data Leakage Tests:**
```javascript
describe('Cross-tenant Data Leakage Protection', () => {
  it('should prevent users from receiving events for leases they are not part of', async () => {
    // Test implementation
  });

  it('should block events containing other lease IDs', async () => {
    // Test implementation
  });

  it('should sanitize event data per recipient', async () => {
    // Test implementation
  });
});
```

### Performance Tests

**Load Testing:**
```javascript
// Simulate 1000 concurrent connections
const connections = [];
for (let i = 0; i < 1000; i++) {
  connections.push(new WebSocketClient(jwtToken, pubkey));
}

// Measure latency
const startTime = Date.now();
await Promise.all(connections.map(c => c.connect()));
const connectionTime = Date.now() - startTime;

console.log(`Connection time for 1000 clients: ${connectionTime}ms`);
```

## Monitoring

### Performance Metrics Dashboard

**Key Metrics:**
- Active connections
- Messages per second
- Average latency
- Error rate
- Memory usage
- Security events

### Alerting

**Alert Conditions:**
- High latency (>100ms)
- High memory usage (>80%)
- High error rate (>5%)
- Security violations
- Connection limit exceeded

### Health Endpoints

```javascript
// GET /api/v1/websocket/stats
{
  "connections": {
    "active": 150,
    "peak": 200,
    "averageDuration": 1800000
  },
  "messages": {
    "sent": 5000,
    "received": 3000,
    "failed": 50,
    "successRate": 98.3
  },
  "performance": {
    "latency": {
      "average": 45,
      "recent": 52
    },
    "throughput": {
      "current": 125,
      "average": 110,
      "peak": 200
    },
    "errorRate": 0.02
  },
  "health": {
    "status": "healthy",
    "uptime": "2d 14h 32m"
  }
}
```

## Troubleshooting

### Common Issues

**Connection Failures:**
1. Check JWT token validity
2. Verify Redis connectivity
3. Check rate limiting
4. Validate Stellar pubkey format

**Performance Issues:**
1. Monitor memory usage
2. Check connection count
3. Review event processing time
4. Analyze error rates

**Security Issues:**
1. Review authentication logs
2. Check data leakage protection logs
3. Monitor rate limit hits
4. Validate event schemas

### Debug Mode

```bash
DEBUG=websocket:* npm start
```

### Health Checks

```bash
curl http://localhost:3000/api/v1/websocket/stats
curl http://localhost:3000/api/v1/websocket/health
```

## Deployment

### Production Considerations

**Scaling:**
- Use Redis adapter for multi-instance deployment
- Configure horizontal autoscaling
- Implement connection load balancing
- Set up monitoring and alerting

**Security:**
- Use HTTPS for all WebSocket connections
- Implement proper rate limiting
- Monitor for security violations
- Regular security audits

**Performance:**
- Optimize database queries for event processing
- Use connection pooling
- Implement proper error handling
- Set up performance monitoring

### Docker Configuration

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - redis
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

## Future Enhancements

### Planned Features

1. **Advanced Caching**: Implement intelligent event caching
2. **WebSocket Compression**: Enable message compression
3. **Message Prioritization**: Implement priority queues for events
4. **Analytics Dashboard**: Real-time analytics dashboard
5. **Mobile Push Notifications**: Fallback push notifications

### Performance Improvements

1. **Binary Protocol**: Consider binary WebSocket protocol
2. **Connection Pooling**: Optimize connection management
3. **Event Batching**: Implement event batching for efficiency
4. **Database Optimization**: Optimize event processing queries

---

This WebSocket Gateway provides a complete, production-ready solution for real-time lease state transitions, fully addressing the requirements of issue #92. The system delivers instantaneous UI updates while maintaining strict security controls and excellent performance characteristics.
