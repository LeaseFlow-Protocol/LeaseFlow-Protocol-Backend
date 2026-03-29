# LeaseFlow Protocol API Documentation

## Overview
The LeaseFlow Protocol provides a comprehensive RESTful API for managing lease agreements, rent payments, late fees, vendor management, and compliance features. All endpoints support "Try It Out" functionality directly from the documentation portal.

## Accessing the API Documentation

### Development Environment
Once your server is running, access the interactive API documentation at:
```
http://localhost:3000/api-docs
```

### Production Environment
For production deployments, the documentation is available at:
```
https://api.leaseflow.io/api-docs
```

## Features

### Interactive API Explorer
- **Try It Out**: Test any endpoint directly from the documentation
- **Authentication**: JWT token support with automatic header management
- **Request/Response Examples**: See sample payloads for all endpoints
- **Schema Validation**: Automatic validation of request/response structures

### Supported Categories
1. **Lease Management**
   - Create, read, update, delete leases
   - Lease renewal proposals
   - Lease condition proofs
   - Credit score aggregation

2. **Payment Processing**
   - Rent payment tracking
   - Late fee enforcement
   - Payment history
   - Utility bill reconciliation

3. **Property Management**
   - Property listings
   - Maintenance tickets
   - Vendor management
   - Smart lock integration

4. **Compliance & Security**
   - KYC verification (SEP-12)
   - Sanctions screening
   - Audit logging
   - Emergency eviction notices

5. **Market Analytics**
   - Market trends data
   - Price feeds
   - Tax estimation
   - Referral program

## Authentication

All API endpoints (except health check and documentation) require JWT authentication.

### Obtaining a Token
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "your-password"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 86400
  }
}
```

### Using the Token
Include the JWT token in the Authorization header:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## API Endpoints

### Base URLs
- **Development**: `http://localhost:3000`
- **Production**: `https://api.leaseflow.io`

### Versioning
Current API version: `v1` (implicit in all routes)

### Rate Limiting
- **Standard**: 100 requests per minute per IP
- **Premium**: 1000 requests per minute
- **Enterprise**: Custom limits

Rate limit headers are included in all responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1647389400
```

## Quick Start Guide

### 1. Explore the Documentation
Navigate to `/api-docs` to see all available endpoints.

### 2. Authenticate
Click on any endpoint that requires authentication and use the "Authorize" button at the top right.

### 3. Try an Endpoint
Example: List all leases
```
GET /api/leases
Authorization: Bearer <your-token>
```

### 4. View Response
The response will be displayed in the "Responses" section with status code and body.

## Code Examples

### JavaScript/Node.js
```javascript
const axios = require('axios');

const API_BASE = 'http://localhost:3000';
const token = 'your-jwt-token';

// Get all leases
async function getLeases() {
  const response = await axios.get(`${API_BASE}/api/leases`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.data;
}

// Create a new lease
async function createLease(leaseData) {
  const response = await axios.post(`${API_BASE}/api/leases`, leaseData, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  return response.data;
}
```

### Python
```python
import requests

API_BASE = 'http://localhost:3000'
token = 'your-jwt-token'
headers = {'Authorization': f'Bearer {token}'}

# Get all leases
response = requests.get(f'{API_BASE}/api/leases', headers=headers)
leases = response.json()

# Create a new lease
lease_data = {
    'landlordId': 'landlord-123',
    'tenantId': 'tenant-456',
    'rentAmount': 150000,
    'currency': 'USDC'
}
response = requests.post(f'{API_BASE}/api/leases', json=lease_data, headers=headers)
new_lease = response.json()
```

### cURL
```bash
# Get all leases
curl -X GET http://localhost:3000/api/leases \
  -H "Authorization: Bearer your-token"

# Create a new lease
curl -X POST http://localhost:3000/api/leases \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "landlordId": "landlord-123",
    "tenantId": "tenant-456",
    "rentAmount": 150000,
    "currency": "USDC"
  }'
```

## Error Handling

All API errors follow a consistent format:

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "details": "Human-readable error message"
}
```

### Common Error Codes
- `400`: Bad Request - Invalid input
- `401`: Unauthorized - Missing or invalid token
- `403`: Forbidden - Insufficient permissions
- `404`: Not Found - Resource doesn't exist
- `409`: Conflict - Resource already exists
- `429`: Too Many Requests - Rate limit exceeded
- `500`: Internal Server Error

## Webhooks

LeaseFlow supports webhooks for real-time notifications:

### Available Events
- `lease.created`
- `lease.renewed`
- `payment.received`
- `payment.overdue`
- `maintenance.requested`
- `maintenance.completed`

### Configuring Webhooks
```bash
POST /api/webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://your-app.com/webhooks",
  "events": ["payment.received", "lease.renewed"],
  "secret": "your-webhook-secret"
}
```

## SDK and Libraries

Official SDKs are available for:
- **JavaScript/TypeScript**: `npm install @leaseflow/sdk`
- **Python**: `pip install leaseflow-sdk`
- **Go**: `go get github.com/leaseflow/go-sdk`

## Support

- **Documentation**: https://docs.leaseflow.io
- **API Status**: https://status.leaseflow.io
- **Support Email**: api-support@leaseflow.io
- **Developer Discord**: https://discord.gg/leaseflow-dev

## Changelog

### v1.0.0 (Current)
- Initial release
- Full OpenAPI 3.0 specification
- Interactive documentation portal
- JWT authentication
- Comprehensive error handling

### Upcoming
- GraphQL API (v2)
- Real-time WebSocket API
- Batch operations
- Advanced filtering and pagination
