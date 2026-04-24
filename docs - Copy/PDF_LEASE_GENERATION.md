# PDF Lease Agreement Generator & IPFS Anchoring

This document describes the implementation of the PDF Lease Agreement Generator & IPFS Anchoring feature for the LeaseFlow Protocol backend.

## Overview

The PDF Lease Agreement Generator bridges the gap between decentralized smart contracts and legally binding, real-world rental agreements. Users can initialize a lease on-chain and receive a human-readable PDF document to present to local legal authorities.

## Features

- **PDF Generation**: Creates professional, legally-formatted lease agreements using pdfmake
- **IPFS Integration**: Uploads PDFs to IPFS via Pinata, Web3.Storage, or local IPFS node
- **Asynchronous Processing**: Uses BullMQ for non-blocking PDF generation
- **Blockchain Anchoring**: Embeds Soroban transaction hash in PDF footer
- **REST API**: Provides endpoints for PDF generation, retrieval, and status checking
- **Comprehensive Testing**: Full test coverage for all components

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   API Endpoint  │───▶│   BullMQ Queue   │───▶│  PDF Generator  │
│   (Controller)   │    │   (Worker)       │    │   (Service)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   Job Tracking   │    │   IPFS Upload   │
                       │   (Database)     │    │   (Service)     │
                       └──────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │   IPFS Storage  │
                                               │ (Pinata/Web3)   │
                                               └─────────────────┘
```

## Components

### 1. LeasePdfService (`src/services/leasePdfService.js`)

Handles PDF generation from lease data:

- **generateLeaseAgreement()**: Main method to create PDF from lease data
- **createDocumentDefinition()**: Creates pdfmake document structure
- **formatCurrency()**: Formats monetary amounts
- **formatDate()**: Formats date strings

### 2. IpfsService (`src/services/ipfsService.js`)

Manages IPFS uploads and retrievals:

- **uploadPdf()**: Uploads PDF buffer to IPFS
- **getFile()**: Retrieves files from IPFS
- **verifyFileExists()**: Checks file availability
- **getGatewayUrl()**: Returns appropriate gateway URL

### 3. LeasePdfGenerationJob (`src/jobs/leasePdfGenerationJob.js`)

BullMQ worker for asynchronous processing:

- **addPdfGenerationJob()**: Queues PDF generation tasks
- **processJob()**: Handles the complete generation workflow
- **getJobStatus()**: Tracks job progress
- **getQueueStats()**: Provides queue statistics

### 4. LeaseContractController (`src/controllers/LeaseContractController.js`)

API endpoint controller:

- **getLeaseContract()**: Main endpoint for PDF retrieval
- **getContractGenerationStatus()**: Status checking endpoint
- **triggerContractGeneration()**: Manual generation trigger
- **getQueueStats()**: Queue statistics endpoint

## API Endpoints

### GET /api/v1/leases/:id/contract

Streams the lease agreement PDF directly from IPFS.

**Response:**
- `200`: PDF file streamed (Content-Type: application/pdf)
- `202`: PDF generation in progress (returns job info)
- `404`: Lease not found
- `500`: Internal server error

**Example Response (202):**
```json
{
  "success": true,
  "message": "PDF generation in progress",
  "jobId": "job-123",
  "leaseId": "lease-456",
  "statusUrl": "/api/v1/leases/lease-456/contract/status"
}
```

### GET /api/v1/leases/:id/contract/status

Checks PDF generation status.

**Query Parameters:**
- `jobId` (optional): Specific job ID to check

**Example Response:**
```json
{
  "success": true,
  "data": {
    "leaseId": "lease-456",
    "status": "completed",
    "ipfsCid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy3fb6i64",
    "gatewayUrl": "https://gateway.pinata.cloud/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy3fb6i64",
    "contractUrl": "/api/v1/leases/lease-456/contract",
    "message": "PDF is ready for download"
  }
}
```

### POST /api/v1/leases/:id/contract/generate

Manually triggers PDF generation.

**Request Body:**
```json
{
  "priority": "high",  // low, normal, high
  "force": false       // Force regeneration
}
```

### GET /api/v1/leases/contracts/queue/stats

Returns PDF generation queue statistics.

**Example Response:**
```json
{
  "success": true,
  "data": {
    "queue": "lease-pdf-generation",
    "waiting": 2,
    "active": 1,
    "completed": 10,
    "failed": 1,
    "total": 14,
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

## Configuration

### Environment Variables

```bash
# IPFS Configuration
IPFS_PROVIDER=pinata  # pinata, web3storage, local

# Pinata Configuration
PINATA_API_KEY=your_pinata_api_key
PINATA_SECRET_KEY=your_pinata_secret_key
PINATA_GATEWAY=https://gateway.pinata.cloud

# Web3.Storage Configuration
WEB3_STORAGE_TOKEN=your_web3_storage_token

# Local IPFS Configuration
IPFS_HOST=localhost
IPFS_PORT=5001
IPFS_PROTOCOL=http

# Redis Configuration (for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Job Configuration
PDF_GENERATION_ENABLED=true
```

### Configuration File

```javascript
// config.js
module.exports = {
  ipfs: {
    provider: process.env.IPFS_PROVIDER || 'pinata',
    host: process.env.IPFS_HOST || 'localhost',
    port: process.env.IPFS_PORT || 5001,
    protocol: process.env.IPFS_PROTOCOL || 'http'
  },
  pinata: {
    apiKey: process.env.PINATA_API_KEY,
    secretApiKey: process.env.PINATA_SECRET_KEY,
    gateway: process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud'
  },
  web3Storage: {
    token: process.env.WEB3_STORAGE_TOKEN,
    endpoint: process.env.WEB3_STORAGE_ENDPOINT || 'https://api.web3.storage'
  },
  jobs: {
    pdfGenerationEnabled: process.env.PDF_GENERATION_ENABLED !== 'false'
  }
};
```

## Database Schema

### lease_pdf_records Table

```sql
CREATE TABLE lease_pdf_records (
    lease_id TEXT PRIMARY KEY,
    ipfs_cid TEXT NOT NULL,
    transaction_hash TEXT,
    generated_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'pending', 'regenerating')),
    error_message TEXT,
    pdf_size INTEGER,
    generation_time_ms INTEGER,
    retry_count INTEGER DEFAULT 0,
    FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE
);
```

### pdf_generation_jobs Table

```sql
CREATE TABLE pdf_generation_jobs (
    job_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    progress INTEGER DEFAULT 0,
    ipfs_cid TEXT,
    pdf_size INTEGER,
    worker_id TEXT,
    priority TEXT DEFAULT 'normal',
    retry_count INTEGER DEFAULT 0,
    FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE
);
```

## PDF Template Structure

The generated PDF includes the following sections:

1. **Header**: "LEASE AGREEMENT" title
2. **Parties**: Lessor and Lessee information
3. **Property Details**: Asset/property information
4. **Lease Terms**: Financial terms and dates
5. **Blockchain Verification**: Transaction hash and anchoring info
6. **Terms and Conditions**: Legal clauses
7. **Signatures**: Signature lines for both parties
8. **Footer**: Generation timestamp and transaction hash

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test tests/leasePdfService.test.js
npm test tests/ipfsService.test.js
npm test tests/leasePdfGenerationJob.test.js
npm test tests/leaseContractController.test.js

# Run with coverage
npm test -- --coverage
```

### Test Coverage

- **PDF Generation**: Complete coverage of LeasePdfService
- **IPFS Integration**: Mocked tests for all IPFS providers
- **Job Processing**: BullMQ workflow testing
- **API Endpoints**: Full integration testing
- **Error Handling**: Comprehensive error scenarios

## Performance Considerations

### PDF Generation

- **Asynchronous Processing**: All PDF generation happens in background jobs
- **Queue Management**: BullMQ provides retry logic and job prioritization
- **Memory Efficiency**: PDFs are streamed directly to IPFS without disk storage
- **Caching**: IPFS CIDs are cached for instant retrieval

### IPFS Upload

- **Provider Support**: Multiple providers for reliability
- **Retry Logic**: Built-in retry for failed uploads
- **Verification**: File existence verification after upload
- **Gateway Optimization**: Fast gateway URLs for retrieval

## Security Considerations

### Data Protection

- **No Sensitive Data**: PDFs contain only lease information, not private keys
- **IPFS Pinning**: Files are pinned to prevent garbage collection
- **Access Control**: API endpoints require lease ownership verification
- **Audit Trail**: All PDF generation events are logged

### Blockchain Integration

- **Immutable Link**: Transaction hash provides cryptographic proof
- **Tamper Evidence**: Any PDF modification breaks the hash link
- **Verification**: Easy verification of document authenticity

## Monitoring and Maintenance

### Health Checks

The service includes health monitoring for:

- Queue status and job processing
- IPFS connectivity and upload success rates
- Database connectivity and performance
- PDF generation success/failure rates

### Maintenance Tasks

- **Cleanup**: Automatic cleanup of old failed records
- **Monitoring**: Queue statistics and performance metrics
- **Alerting**: Error notifications for critical failures
- **Scaling**: Horizontal scaling of worker processes

## Troubleshooting

### Common Issues

1. **PDF Generation Fails**
   - Check lease data completeness
   - Verify transaction hash availability
   - Review error logs in job tracking

2. **IPFS Upload Fails**
   - Verify API credentials for chosen provider
   - Check network connectivity
   - Monitor rate limits and quotas

3. **Queue Processing Stalls**
   - Check Redis connectivity
   - Monitor worker process status
   - Review job error logs

### Debug Mode

Enable debug logging:

```bash
DEBUG=leaseflow:pdf* npm start
```

## Future Enhancements

### Planned Features

1. **Template Customization**: Customizable PDF templates per jurisdiction
2. **Multi-language Support**: PDF generation in multiple languages
3. **Digital Signatures**: Integrated digital signature capabilities
4. **Batch Processing**: Bulk PDF generation for multiple leases
5. **Advanced Analytics**: PDF generation analytics and reporting

### Performance Improvements

1. **PDF Caching**: Intelligent caching of generated PDFs
2. **CDN Integration**: Content delivery network for PDF serving
3. **Compression**: PDF optimization for faster downloads
4. **Streaming**: Real-time PDF streaming for large documents

## Integration Examples

### Frontend Integration

```javascript
// Request PDF generation
const response = await fetch('/api/v1/leases/lease-123/contract');
const data = await response.json();

if (response.status === 202) {
  // PDF generation in progress
  const jobId = data.jobId;
  // Poll status endpoint
  const statusResponse = await fetch(`/api/v1/leases/lease-123/contract/status?jobId=${jobId}`);
  const statusData = await statusResponse.json();
  
  if (statusData.data.status === 'completed') {
    // Download PDF
    window.open(statusData.data.contractUrl);
  }
} else if (response.status === 200) {
  // PDF streamed directly
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url);
}
```

### Smart Contract Integration

```javascript
// After lease initialization on blockchain
const leaseId = 'lease-123';
const transactionHash = '0x1234567890abcdef...';

// Trigger PDF generation
await fetch(`/api/v1/leases/${leaseId}/contract/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    priority: 'high',
    force: false
  })
});
```

## Support and Contributing

For issues, questions, or contributions:

1. Check existing GitHub issues
2. Create new issue with detailed description
3. Include logs and error messages
4. Provide reproduction steps
5. Follow contribution guidelines

---

*This document is part of the LeaseFlow Protocol documentation. For more information, see the main project documentation.*
