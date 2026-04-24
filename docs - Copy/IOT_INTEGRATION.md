# LeaseFlow IoT Integration Guide

This document explains how lessors can configure their smart lock hardware to receive and process webhooks from the LeaseFlow Protocol.

## Overview

The LeaseFlow IoT Webhook Dispatcher sends real-time updates to your physical assets (smart locks, vehicle ignitions, etc.) based on on-chain lease events. This ensures that only active lessees with current payments can physically access the asset.

## Webhook Configuration

To receive webhooks, your IoT backend must expose a public HTTP POST endpoint.

1. **Endpoint URL**: Configure your backend URL in the LeaseFlow Lessor Dashboard (e.g., `https://your-api.com/leaseflow-webhook`).
2. **Secret Key**: You will be provided with an `IOT_WEBHOOK_SECRET`. This is used to sign all outgoing requests.

## Security & Verification

LeaseFlow signs every webhook payload using HMAC-SHA256. You **must** verify this signature to ensure the request originated from our servers.

### Header Verification

- `X-Hub-Signature-256`: The signature in the format `sha256=<signature>`.
- `X-LeaseFlow-Event`: The type of event (e.g., `LesseeAccessGranted`, `LesseeAccessRevoked`).

### Signature Verification Example (Node.js)

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}
```

## Payload Structure

The payload contains the minimum required cryptographic identifiers to enforce access.

```json
{
  "deviceId": "august-lock-123",
  "eventType": "LesseeAccessGranted",
  "expiration": "2026-12-31T23:59:59Z",
  "lesseePublicKey": "GBO...XYZ",
  "timestamp": 1713872400
}
```

- `deviceId`: The unique ID of your hardware device.
- `eventType`: `LesseeAccessGranted` or `LesseeAccessRevoked`.
- `expiration`: The ISO timestamp when the current access rights expire.
- `lesseePublicKey`: The Stellar public key of the lessee. This should be used for local cryptographic challenge-response (e.g., via Bluetooth).
- `timestamp`: Unix timestamp of the dispatch.

## Retry Logic

LeaseFlow uses **BullMQ** with an exponential backoff strategy. If your server is offline or returns a non-2xx status code:
- We retry up to **10 times**.
- Initial delay is 5 seconds, doubling with each attempt.
- This ensures that temporary network outages do not result in permanently dropped access updates.

## Best Practices

1. **Idempotency**: Your backend should handle duplicate webhooks gracefully using the `timestamp` and `eventType`.
2. **PII Protection**: LeaseFlow never transmits names, emails, or phone numbers. Only use the `lesseePublicKey` for identity verification.
3. **Revocation Priority**: Access revocation events are prioritized in our queue. Ensure your backend processes these with minimal latency.
