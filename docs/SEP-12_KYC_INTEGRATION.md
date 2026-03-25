# Stellar Anchor KYC Integration (SEP-12)

This document describes the implementation of the Stellar SEP-12 KYC (Know Your Customer) workflow integration in the LeaseFlow Protocol Backend.

## Overview

The SEP-12 integration ensures that both landlords and tenants complete proper identity verification through a Stellar Anchor before they can participate in lease agreements. This compliance measure prevents money laundering and ensures legal accountability in global real estate transactions.

## Architecture

### Components

1. **Database Layer** (`src/db/appDatabase.js`)
   - `kyc_verifications` table to store KYC status
   - Methods for CRUD operations on KYC records
   - Compliance checking for lease agreements

2. **Stellar Anchor Service** (`src/services/stellarAnchorKycService.js`)
   - SEP-12 compliant API client
   - Communication with Stellar Anchor endpoints
   - Status mapping and validation

3. **KYC Controller** (`src/controllers/kycController.js`)
   - HTTP request handling
   - Business logic for KYC workflows
   - Integration with database and anchor service

4. **KYC Routes** (`src/routes/kycRoutes.js`)
   - RESTful API endpoints
   - OpenAPI documentation
   - Request/response validation

5. **Lease Integration** (`src/controllers/LeaseController.js`)
   - KYC validation before lease creation
   - Compliance enforcement

## Database Schema

### kyc_verifications Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique identifier |
| actor_id | TEXT | NOT NULL | Landlord or tenant ID |
| actor_role | TEXT | NOT NULL, CHECK | 'landlord' or 'tenant' |
| stellar_account_id | TEXT | NULLABLE | Stellar account address |
| kyc_status | TEXT | NOT NULL, CHECK | 'pending', 'in_progress', 'verified', 'rejected' |
| anchor_provider | TEXT | NOT NULL | Anchor hostname |
| verification_reference | TEXT | NULLABLE | Anchor reference ID |
| submitted_at | TEXT | NULLABLE | Submission timestamp |
| verified_at | TEXT | NULLABLE | Verification timestamp |
| rejected_at | TEXT | NULLABLE | Rejection timestamp |
| rejection_reason | TEXT | NULLABLE | Rejection details |
| created_at | TEXT | NOT NULL | Record creation |
| updated_at | TEXT | NOT NULL | Last update |

## API Endpoints

### Submit KYC Verification
```
POST /api/kyc/submit
```

Submits KYC information to the Stellar Anchor for verification.

**Request Body:**
```json
{
  "actorId": "landlord-123",
  "actorRole": "landlord",
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

### Get KYC Status
```
GET /api/kyc/status/{actorId}/{actorRole}
```

Retrieves the current KYC verification status for an actor.

### Update KYC Verification
```
PUT /api/kyc/update/{actorId}/{actorRole}
```

Updates existing KYC information (for additional verification requests).

### Check Lease Compliance
```
POST /api/kyc/compliance
```

Checks if both landlord and tenant are KYC verified for a lease.

**Request Body:**
```json
{
  "landlordId": "landlord-123",
  "tenantId": "tenant-456"
}
```

### Get KYC Requirements
```
GET /api/kyc/requirements
```

Retrieves supported ID types and requirements from the anchor.

### Delete KYC Data
```
DELETE /api/kyc/delete/{actorId}/{actorRole}
```

Deletes KYC verification data (GDPR compliance).

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Stellar Anchor KYC Configuration (SEP-12)
STELLAR_ANCHOR_URL=https://your-anchor.com/sep12
STELLAR_ANCHOR_AUTH_KEY=your-anchor-auth-key
HORIZON_URL=https://horizon.stellar.org
```

### Anchor Requirements

Your Stellar Anchor must implement the SEP-12 specification with the following endpoints:

- `POST /customer` - Submit new customer verification
- `GET /customer` - Get customer status
- `PUT /customer/{id}` - Update customer information
- `DELETE /customer/{id}` - Delete customer data

## Integration with Lease Flow

### Lease Upload Validation

When uploading a lease agreement, the system now validates KYC compliance:

1. **Optional KYC Check**: If `landlordId` and `tenantId` are provided in the lease upload request, the system verifies both parties have KYC status of 'verified'.

2. **Enforcement**: Leases cannot be created unless both parties are verified.

3. **Response**: The lease upload response includes KYC verification status.

**Enhanced Lease Upload Request:**
```json
{
  "tenantPubKey": "public-key-1",
  "landlordPubKey": "public-key-2",
  "landlordId": "landlord-123",
  "tenantId": "tenant-456"
}
```

**Response with KYC Validation:**
```json
{
  "status": "success",
  "message": "Lease record created and uploaded to IPFS. KYC compliance verified.",
  "leaseCID": "bafybeigdyrzt5syp7...",
  "kycVerified": true
}
```

## KYC Status Flow

1. **pending** - Initial state, verification not yet submitted
2. **in_progress** - Submitted to anchor, awaiting verification
3. **verified** - Successfully verified, can participate in leases
4. **rejected** - Verification failed, requires resubmission

## Error Handling

### Common Error Responses

**403 Forbidden - KYC Required:**
```json
{
  "error": "KYC verification required",
  "message": "KYC verification is required for: landlord, tenant",
  "compliance": {
    "landlord": { "isVerified": false, "kycStatus": "not_started" },
    "tenant": { "isVerified": false, "kycStatus": "not_started" },
    "leaseCanProceed": false
  },
  "kycRequired": true
}
```

**409 Conflict - KYC Exists:**
```json
{
  "error": "KYC verification already exists for this actor",
  "existingKyc": { ... }
}
```

## Security Considerations

1. **Data Encryption**: All personal data is encrypted in transit to the anchor
2. **Access Control**: KYC data is only accessible to authorized actors
3. **Audit Trail**: All KYC operations are logged for compliance
4. **Data Retention**: KYC data is retained according to regulatory requirements
5. **GDPR Compliance**: Users can request deletion of their KYC data

## Testing

Run the KYC tests:

```bash
npm test -- tests/kyc.test.js
```

The test suite covers:
- Database operations
- Status mapping
- Compliance checking
- Field validation

## Deployment Notes

1. **Anchor Integration**: Ensure your Stellar Anchor is properly configured and accessible
2. **Environment Variables**: Set all required environment variables in production
3. **Database Migration**: The KYC table will be automatically created on first run
4. **Monitoring**: Monitor anchor API response times and error rates
5. **Backup**: Regularly backup the KYC verification database

## Troubleshooting

### Common Issues

1. **Anchor Connection Failed**
   - Verify `STELLAR_ANCHOR_URL` is correct
   - Check anchor authentication key
   - Ensure anchor is SEP-12 compliant

2. **Stellar Account Validation Failed**
   - Verify account exists on Stellar network
   - Check account has minimum 1 XLM balance
   - Ensure account address is valid

3. **KYC Status Not Updating**
   - Check anchor webhook configuration
   - Verify anchor is processing verification requests
   - Check database connection

## Future Enhancements

1. **Multiple Anchor Support**: Support for multiple Stellar Anchors
2. **Webhook Integration**: Real-time status updates from anchors
3. **Advanced Risk Scoring**: Integration with risk assessment services
4. **Document Upload**: Support for document upload and verification
5. **Biometric Verification**: Integration with biometric verification services

## Compliance

This implementation follows:
- Stellar SEP-12 specification
- GDPR data protection requirements
- AML/KYC regulatory standards
- Financial industry best practices

## Support

For issues related to:
- **Stellar Anchor Integration**: Contact your anchor provider
- **LeaseFlow Integration**: Create an issue in the repository
- **Compliance Questions**: Consult your legal team
