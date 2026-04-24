# Identity Provider Fallback Router Implementation

This document describes the implementation of the SEP-12 Identity Provider Fallback Router for the LeaseFlow Protocol Backend, ensuring enterprise lessors can onboard users even if a primary KYC vendor experiences an outage.

## Overview

The Identity Router service provides a robust, fault-tolerant layer for KYC verification that automatically falls back to secondary providers when the primary provider experiences timeouts, server errors, or network issues. This ensures the protocol's onboarding funnel remains structurally immune to single-vendor outages in the Web2 compliance layer.

## Architecture

### Core Components

1. **VerificationResult DTO** (`src/dtos/VerificationResult.js`)
   - Normalizes responses from different identity providers
   - Ensures the rest of the application remains vendor-agnostic
   - Provides consistent interface for all verification outcomes

2. **BaseIdentityAdapter** (`src/adapters/BaseIdentityAdapter.js`)
   - Abstract interface for all identity provider adapters
   - Common utilities for timeout handling and error classification
   - Standardized health check implementation

3. **Vendor-Specific Adapters**
   - **SumSubAdapter** (`src/adapters/SumSubAdapter.js`) - SumSub API integration
   - **JumioAdapter** (`src/adapters/JumioAdapter.js`) - Jumio API integration
   - Each adapter implements the BaseIdentityAdapter interface

4. **IdentityRouterService** (`src/services/identityRouterService.js`)
   - Core fallback logic with timeout and error handling
   - Provider priority management
   - Metrics collection and health monitoring

5. **Prometheus Metrics** (`src/metrics/identityMetrics.js`)
   - Comprehensive monitoring of provider performance
   - Fallback activation tracking
   - Success rate and uptime metrics

6. **Enhanced KYC Controller** (`src/controllers/enhancedKycController.js`)
   - Integrates Identity Router with existing KYC workflows
   - Backward compatibility with Stellar Anchor service
   - Health check and metrics endpoints

## Configuration

### Environment Variables

```bash
# Enable Identity Router (recommended: true)
IDENTITY_ROUTER_ENABLED=true

# Fallback timeout in milliseconds (default: 5000)
IDENTITY_ROUTER_TIMEOUT=5000

# Provider priority (comma-separated, default: sumsub,jumio)
IDENTITY_ROUTER_PROVIDERS=sumsub,jumio

# SumSub Configuration
SUMSUB_API_TOKEN=your-sumsub-api-token
SUMSUB_API_SECRET=your-sumsub-api-secret
SUMSUB_BASE_URL=https://api.sumsub.com
SUMSUB_LEVEL_NAME=basic-kyc-level

# Jumio Configuration
JUMIO_API_TOKEN=your-jumio-api-token
JUMIO_API_SECRET=your-jumio-api-secret
JUMIO_BASE_URL=https://api.jumio.com
JUMIO_CUSTOMER_ID=your-jumio-customer-id
JUMIO_WORKFLOW_DEFINITION_ID=your-workflow-id

# Callback URLs
IDENTITY_CALLBACK_BASE_URL=https://your-domain.com/webhooks
IDENTITY_FRONTEND_BASE_URL=https://your-domain.com

# Prometheus Metrics
IDENTITY_METRICS_ENABLED=true
IDENTITY_METRICS_PORT=9090
```

### Provider Priority Configuration

The router supports configurable provider priority:

```javascript
// Example: Prioritize Jumio over SumSub
IDENTITY_ROUTER_PROVIDERS=jumio,sumsub
```

## API Endpoints

### Enhanced KYC Endpoints

#### Submit KYC Verification
```
POST /api/kyc/enhanced/submit
```

Submits KYC verification with automatic fallback to secondary providers.

**Request Body:**
```json
{
  "actorId": "tenant-123",
  "actorRole": "tenant",
  "stellarAccountId": "GD5JGB56LYV43R2JEDCXJZ4WIF3FWJQYBVKT7HQPI2WDFNLYP3JUA4FK",
  "personalInfo": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "phone": "+1234567890"
  },
  "addressInfo": {
    "streetAddress": "123 Main St",
    "city": "New York",
    "stateProvince": "NY",
    "country": "US",
    "postalCode": "10001"
  },
  "identificationInfo": {
    "idType": "passport",
    "idNumber": "P123456789",
    "idIssueDate": "2020-01-01",
    "idExpiryDate": "2030-01-01",
    "idIssuingCountry": "US"
  },
  "additionalInfo": {
    "sourceOfFunds": "employment",
    "occupation": "Software Engineer",
    "annualIncome": "75000-100000"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "KYC verification submitted successfully",
  "kycRecord": {
    "actorId": "tenant-123",
    "actorRole": "tenant",
    "kycStatus": "in_progress",
    "anchorProvider": "sumsub",
    "verificationReference": "sumsub-12345"
  },
  "verificationSubmission": {
    "success": true,
    "status": "in_progress",
    "verificationReference": "sumsub-12345",
    "providerName": "sumsub",
    "isFallback": false,
    "responseTimeMs": 850
  },
  "providerUsed": "sumsub",
  "isFallback": false
}
```

#### Get KYC Status
```
GET /api/kyc/enhanced/status/{actorId}/{actorRole}
```

Retrieves KYC status with automatic fallback for status checks.

#### Update KYC Verification
```
PUT /api/kyc/enhanced/update/{actorId}/{actorRole}
```

Updates existing KYC verification with fallback support.

#### Get KYC Requirements
```
GET /api/kyc/enhanced/requirements
```

Retrieves supported ID types and requirements from the primary provider.

### Monitoring Endpoints

#### Provider Health Status
```
GET /api/kyc/enhanced/health
```

Returns health status of all configured identity providers.

**Response:**
```json
{
  "success": true,
  "healthStatus": {
    "overall": {
      "status": "healthy",
      "healthyProviders": 2,
      "totalProviders": 2
    },
    "providers": {
      "sumsub": {
        "adapter": "sumsub",
        "status": "healthy",
        "responseTimeMs": 450,
        "lastCheck": "2024-01-15T10:30:00.000Z"
      },
      "jumio": {
        "adapter": "jumio",
        "status": "healthy",
        "responseTimeMs": 620,
        "lastCheck": "2024-01-15T10:30:00.000Z"
      }
    },
    "metrics": {
      "totalRequests": 1250,
      "successfulRequests": 1185,
      "fallbackActivations": 45,
      "successRate": "94.8%",
      "fallbackRate": "3.6%",
      "uptime": "96.4%"
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Prometheus Metrics
```
GET /api/kyc/enhanced/metrics
```

Returns Prometheus-formatted metrics for monitoring.

## Fallback Logic

### Trigger Conditions

The router automatically triggers fallback when:

1. **Timeout**: Primary provider doesn't respond within configured timeout (default: 5 seconds)
2. **Server Errors**: HTTP 5xx responses from primary provider
3. **Network Errors**: Connection refused, DNS errors, network timeouts
4. **Rate Limiting**: HTTP 429 responses

### Fallback Flow

1. **Primary Attempt**: Router attempts verification with primary provider
2. **Error Detection**: If trigger condition is met, router logs the error
3. **Fallback Activation**: Router attempts verification with secondary provider
4. **Success Response**: Returns result with `isFallback: true` flag
5. **Metrics Recording**: All fallback events are logged to Prometheus metrics

### Error Handling

- **All Providers Fail**: Returns error response with details of last error
- **Partial Failures**: Continues to next provider in priority list
- **Network Issues**: Automatic retry with exponential backoff (configurable)

## Metrics and Monitoring

### Prometheus Metrics

The implementation provides comprehensive metrics for DevOps monitoring:

#### Request Metrics
- `identity_verification_requests_total` - Total verification requests by provider and status
- `identity_verification_request_duration_seconds` - Request duration histogram

#### Fallback Metrics
- `identity_fallback_activations_total` - Fallback activations by provider and reason
- `identity_provider_success_rate` - Success rate percentage by provider

#### Health Metrics
- `identity_provider_health_status` - Health status (1=healthy, 0=unhealthy)
- `identity_provider_response_time_seconds` - Current response time by provider

#### Error Metrics
- `identity_provider_errors_total` - Error count by provider and error type
- `identity_verification_outcomes_total` - Verification outcomes by provider

### Grafana Dashboard

Recommended Grafana panels for monitoring:

1. **Provider Health Status**: Gauge showing healthy/unhealthy status
2. **Request Rate**: Graph of verification requests over time
3. **Success Rate**: Percentage of successful verifications
4. **Fallback Rate**: Percentage of requests that triggered fallback
5. **Response Time**: Average response time by provider
6. **Error Rate**: Error count by type and provider

## Testing

### Unit Tests

Comprehensive test suite covering:

- Primary provider success scenarios
- Fallback activation on timeouts
- Fallback activation on server errors
- Fallback activation on network errors
- Both providers failure scenarios
- Status check fallback
- Update verification fallback
- Health status monitoring
- Metrics collection
- Provider priority management

### Running Tests

```bash
# Run all identity router tests
npm test -- tests/identityRouter.test.js

# Run with coverage
npm test -- --coverage tests/identityRouter.test.js
```

### Mock Scenarios

The test suite includes mock scenarios for:

1. **Timeout Simulation**: Primary provider times out, secondary succeeds
2. **Server Error**: Primary returns 500, secondary succeeds
3. **Network Error**: Primary connection refused, secondary succeeds
4. **Complete Failure**: All providers fail
5. **Health Check Failures**: Provider health check failures

## Deployment

### Production Configuration

1. **Environment Setup**: Configure all required environment variables
2. **Provider Credentials**: Securely store API tokens and secrets
3. **Monitoring Setup**: Configure Prometheus and Grafana dashboards
4. **Alerting**: Set up alerts for high fallback rates or provider downtime

### Monitoring Alerts

Recommended alerts:

1. **High Fallback Rate**: Alert when fallback rate > 10%
2. **Provider Down**: Alert when provider health status = unhealthy
3. **High Error Rate**: Alert when error rate > 5%
4. **Slow Response**: Alert when response time > 10 seconds

### Scaling Considerations

1. **Connection Pooling**: Configure appropriate connection pools for each provider
2. **Rate Limiting**: Respect provider rate limits
3. **Circuit Breaker**: Implement circuit breaker pattern for repeated failures
4. **Load Balancing**: Distribute load across multiple provider instances

## Security Considerations

### API Security

1. **Authentication**: All provider API calls use proper authentication
2. **Encryption**: All data in transit is encrypted (HTTPS)
3. **Secrets Management**: API tokens stored securely (environment variables)
4. **Request Validation**: All input data validated before processing

### Data Protection

1. **GDPR Compliance**: User can request deletion of KYC data
2. **Data Minimization**: Only necessary data collected and stored
3. **Audit Trail**: All verification attempts logged for compliance
4. **Retention Policies**: KYC data retained according to regulatory requirements

## Troubleshooting

### Common Issues

1. **Provider Configuration Errors**
   - Verify API tokens and secrets are correct
   - Check provider URLs are accessible
   - Ensure provider accounts are active

2. **High Fallback Rate**
   - Check primary provider health status
   - Review provider response times
   - Verify network connectivity

3. **Verification Failures**
   - Check KYC data format requirements
   - Verify supported ID types for each provider
   - Review provider-specific error messages

### Debug Logging

Enable debug logging for troubleshooting:

```bash
# Enable debug logging
DEBUG=identity:* npm start
```

### Health Check Commands

```bash
# Check provider health
curl http://localhost:3000/api/kyc/enhanced/health

# Get metrics
curl http://localhost:3000/api/kyc/enhanced/metrics
```

## Future Enhancements

### Planned Features

1. **Additional Providers**: Support for more identity providers
2. **Webhook Integration**: Real-time status updates from providers
3. **Advanced Routing**: Intelligent provider selection based on performance
4. **Multi-Region**: Geographic distribution of providers
5. **AI-Based Routing**: Machine learning for optimal provider selection

### Extension Points

The architecture supports easy extension:

1. **New Providers**: Implement BaseIdentityAdapter interface
2. **Custom Metrics**: Add provider-specific metrics
3. **Routing Logic**: Implement custom routing algorithms
4. **Health Checks**: Add custom health check implementations

## Compliance

This implementation follows:

- **Stellar SEP-12 Specification**: Standardized KYC verification
- **GDPR Requirements**: Data protection and user rights
- **AML/KYC Regulations**: Anti-money laundering compliance
- **Financial Industry Standards**: Best practices for identity verification

## Support

For issues related to:

- **Identity Router Implementation**: Create an issue in the repository
- **Provider Integration**: Contact the respective provider's support
- **Configuration Questions**: Consult this documentation
- **Monitoring Issues**: Check Prometheus and Grafana configuration

---

## Summary

The Identity Provider Fallback Router implementation ensures:

✅ **Structural Immunity**: Onboarding funnel immune to single-vendor outages  
✅ **Response Normalization**: Divergent vendor API responses cleanly normalized  
✅ **DevOps Visibility**: Clear, metric-driven visibility into provider performance  
✅ **Comprehensive Testing**: Extensive test coverage for all fallback scenarios  
✅ **Production Ready**: Monitoring, alerting, and deployment guidance included  

This implementation successfully addresses all acceptance criteria for issue #100 and provides a robust, scalable solution for enterprise KYC verification.
