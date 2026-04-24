# Emergency Eviction Notice Timestamp Service

## Overview

The Emergency Eviction Notice Timestamp Service provides landlords with a legally compliant method to serve eviction notices to tenants. This service ensures proper documentation and creates an indisputable timeline that can be presented in court as evidence of fair and documented eviction processes.

## Features

### 🔔 **Email Notice Delivery**
- Sends professionally formatted eviction notices via registered email
- Includes all required legal information and notice details
- Provides digital receipts and delivery confirmations

### ⛓️ **On-Chain Digital Receipts**
- Records cryptographic proof of notice delivery on the Stellar blockchain
- Creates immutable timestamps that cannot be altered
- Provides verifiable evidence for legal proceedings

### 🔐 **Cryptographic Proofs**
- Generates SHA-256 hashes of all notice content
- Stores multiple proof types (email, on-chain, content integrity)
- Enables verification of notice authenticity

### 📊 **Database Storage**
- Securely stores all notice records and proofs
- Provides audit trail for all eviction proceedings
- Supports querying and reporting functionality

## API Endpoints

### Serve an Eviction Notice
```http
POST /api/eviction-notices/serve
```

**Request Body:**
```json
{
  "leaseId": "lease-123",
  "landlordAddress": "GD...LANDLORD",
  "tenantAddress": "GD...TENANT", 
  "tenantEmail": "tenant@example.com",
  "noticeType": "breach",
  "breachDescription": "Non-payment of rent for 3 months",
  "noticeContent": "You are hereby notified of breach of lease agreement..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Eviction notice served successfully",
  "data": {
    "noticeId": 1,
    "status": "served",
    "emailReceipt": {
      "sent": true,
      "messageId": "test-message-id",
      "sentAt": "2024-01-15T10:30:00.000Z"
    },
    "onChainReceipt": {
      "transactionHash": "abc123...",
      "timestamp": "2024-01-15T10:30:05.000Z",
      "memo": "EVICT_NOTICE:1:abc123..."
    },
    "cryptographicHash": "sha256hash...",
    "servedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### Get Notice Details
```http
GET /api/eviction-notices/{noticeId}
```

### Get Notice Proofs
```http
GET /api/eviction-notices/{noticeId}/proofs
```

### Verify Notice Authenticity
```http
GET /api/eviction-notices/{noticeId}/verify
```

### List Notices (with filtering)
```http
GET /api/eviction-notices?leaseId=lease-123&status=served&limit=10&offset=0
```

### Resend Notice
```http
POST /api/eviction-notices/{noticeId}/resend
```

## Notice Types

The service supports the following notice types:

- `breach` - General lease agreement breach
- `non_payment` - Failure to pay rent
- `property_damage` - Damage to rental property
- `illegal_activity` - Illegal activities on premises
- `lease_violation` - Specific lease term violations
- `other` - Other types of violations

## Legal Compliance

### Email Requirements
- All emails include proper legal formatting
- Notice ID and lease ID clearly displayed
- Delivery date and timestamp recorded
- Professional legal language used

### On-Chain Recording
- Transaction memo includes notice ID and content hash
- Immutable timestamp created on blockchain
- Verifiable through Stellar explorers
- Cannot be altered or deleted

### Cryptographic Integrity
- SHA-256 hashing of all notice content
- Content integrity verification
- Tamper-evident design
- Court-admissible digital evidence

## Configuration

### Environment Variables

```bash
# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
FROM_EMAIL=noreply@leaseflow.protocol

# Stellar Configuration
STELLAR_NETWORK=testnet  # or 'public' for mainnet

# Database Configuration
DATABASE_URL=postgresql://user:pass@localhost:5432/leaseflow_db
```

### Database Tables

#### eviction_notices
- `id` - Primary key
- `lease_id` - Associated lease identifier
- `landlord_address` - Landlord's wallet address
- `tenant_address` - Tenant's wallet address
- `tenant_email` - Tenant's email address
- `notice_type` - Type of eviction notice
- `breach_description` - Description of the breach
- `notice_content` - Full notice content
- `email_sent_at` - Email delivery timestamp
- `email_message_id` - Email message identifier
- `on_chain_tx_hash` - Stellar transaction hash
- `on_chain_timestamp` - Blockchain timestamp
- `digital_receipt_hash` - Content hash
- `status` - Current notice status
- `created_at` - Record creation timestamp
- `updated_at` - Last update timestamp

#### notice_proofs
- `id` - Primary key
- `notice_id` - Associated notice ID
- `proof_type` - Type of proof (email, on_chain, content_hash)
- `proof_data` - JSON proof data
- `cryptographic_hash` - Proof hash
- `created_at` - Proof creation timestamp

## Security Considerations

### Data Protection
- All sensitive data encrypted at rest
- Email addresses protected in database
- Access logging and audit trails
- Role-based access controls

### Cryptographic Security
- Industry-standard SHA-256 hashing
- Secure random number generation
- Immutable blockchain records
- Tamper-evident design

### Privacy Compliance
- GDPR-compliant data handling
- Minimal data collection
- Secure data retention policies
- Right to deletion implementation

## Usage Examples

### Serving a Basic Notice
```javascript
const noticeData = {
  leaseId: 'lease-123',
  landlordAddress: 'GD...LANDLORD',
  tenantAddress: 'GD...TENANT',
  tenantEmail: 'tenant@example.com',
  noticeType: 'non_payment',
  breachDescription: 'Rent overdue for 90 days',
  noticeContent: 'You are hereby notified that your rent is overdue...'
};

const result = await evictionService.serveNotice(noticeData);
console.log('Notice served:', result.noticeId);
```

### Verifying Notice Authenticity
```javascript
const verification = await evictionService.verifyNotice(noticeId);
if (verification.isValid) {
  console.log('Notice is authentic and untampered');
} else {
  console.log('Notice verification failed');
}
```

### Retrieving Legal Evidence
```javascript
const notice = await evictionService.getNotice(noticeId);
const proofs = await evictionService.getNoticeProofs(noticeId);

// This data can be presented as legal evidence
const legalEvidence = {
  noticeDetails: notice,
  deliveryProofs: proofs,
  verificationStatus: await evictionService.verifyNotice(noticeId)
};
```

## Integration Guide

### Adding to Your Application

1. **Install Dependencies**
```bash
npm install nodemailer @stellar/stellar-sdk pg
```

2. **Configure Environment**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Initialize Service**
```javascript
const EmergencyEvictionNoticeService = require('./services/emergencyEvictionNoticeService');

const service = new EmergencyEvictionNoticeService(databasePool, stellarServer);
await service.initialize();
```

4. **Add Routes**
```javascript
const evictionNoticeRoutes = require('./src/routes/evictionNoticeRoutes');
app.use('/api/eviction-notices', evictionNoticeRoutes);
```

## Testing

### Unit Tests
```bash
npm test -- tests/emergencyEvictionNoticeService.test.js
```

### Integration Tests
```bash
npm test -- tests/evictionNoticeRoutes.test.js
```

### Test Coverage
The service includes comprehensive test coverage for:
- Notice serving functionality
- Email delivery verification
- On-chain receipt recording
- Cryptographic proof generation
- API endpoint validation
- Error handling scenarios

## Troubleshooting

### Common Issues

#### Email Delivery Failures
- Check SMTP configuration
- Verify email credentials
- Ensure recipient email is valid
- Check spam filters

#### On-Chain Recording Issues
- Verify Stellar network configuration
- Check network connectivity
- Ensure sufficient gas fees
- Validate transaction format

#### Database Connection Problems
- Check database URL format
- Verify database credentials
- Ensure database is running
- Check network connectivity

### Debug Mode
Enable debug logging by setting:
```bash
DEBUG=eviction-notice-service
```

## Legal Disclaimer

This service provides tools for creating and documenting eviction notices, but it does not constitute legal advice. Users should:

1. Consult with legal professionals before serving notices
2. Ensure compliance with local and state eviction laws
3. Follow proper legal procedures in their jurisdiction
4. Maintain proper documentation beyond this system

The service is designed to support, not replace, proper legal processes.

## Support

For technical support:
- Create an issue in the repository
- Check the troubleshooting section
- Review the API documentation
- Contact the development team

## License

This service is part of the LeaseFlow Protocol and is licensed under the same terms as the main project.
