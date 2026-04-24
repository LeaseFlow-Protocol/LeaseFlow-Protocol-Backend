# PDF Lease Agreement Generator & IPFS Anchoring

## Summary
This PR implements a comprehensive PDF lease agreement generation system with IPFS anchoring, bridging the gap between decentralized smart contracts and legally binding, real-world rental agreements.

## Issue Reference
Closes #90

## 🚀 Features Implemented

### Core Functionality
- **PDF Generation Service**: Professional lease agreements using pdfmake with complete lease data mapping
- **IPFS Integration**: Multi-provider support (Pinata, Web3.Storage, Local IPFS) with automatic fallback
- **Asynchronous Processing**: BullMQ worker for non-blocking PDF generation with retry logic
- **Blockchain Anchoring**: Embeds Soroban transaction hash in PDF footer for cryptographic verification

### API Endpoints
- `GET /api/v1/leases/:id/contract` - Stream PDF directly from IPFS
- `GET /api/v1/leases/:id/contract/status` - Check generation status
- `POST /api/v1/leases/:id/contract/generate` - Manual generation trigger
- `GET /api/v1/leases/contracts/queue/stats` - Queue monitoring
- `POST /api/v1/leases/contracts/cleanup` - Maintenance endpoint

### Database Schema
- `lease_pdf_records` table for PDF metadata and IPFS CIDs
- `pdf_generation_jobs` table for job tracking and monitoring
- Proper indexing for performance optimization

## 📁 Files Added

### Services
- `src/services/leasePdfService.js` - PDF generation with professional templates
- `src/services/ipfsService.js` - Multi-provider IPFS upload/retrieval

### Jobs & Workers
- `src/jobs/leasePdfGenerationJob.js` - BullMQ async processing worker

### API Layer
- `src/controllers/LeaseContractController.js` - REST API endpoints
- `src/routes/leaseContractRoutes.js` - Route definitions with OpenAPI docs

### Database & Configuration
- `migrations/014_add_lease_pdf_records.sql` - Database schema updates
- Updated `package.json` with pdfmake dependency
- Updated `.env.example` with IPFS configuration

### Testing
- `tests/leasePdfService.test.js` - PDF generation tests
- `tests/ipfsService.test.js` - IPFS service tests
- `tests/leasePdfGenerationJob.test.js` - Job processing tests
- `tests/leaseContractController.test.js` - API integration tests

### Documentation
- `docs/PDF_LEASE_GENERATION.md` - Complete feature documentation

## ✅ Acceptance Criteria Met

- **✅ Acceptance 1**: Users receive compliant, professional PDF rental agreements backing their crypto transactions
- **✅ Acceptance 2**: The IPFS integration provides an unbreakable cryptographic link between the legal document and the blockchain  
- **✅ Acceptance 3**: The generation process scales efficiently, separating heavy rendering tasks from the core REST API

## 🧪 Testing

- **Unit Tests**: Complete coverage for all services and utilities
- **Integration Tests**: Full API endpoint testing with mocked dependencies
- **Error Handling**: Comprehensive error scenario testing
- **Performance**: Async processing verification and queue management

## 🔧 Configuration

### Environment Variables
```bash
# IPFS Provider (pinata, web3storage, local)
IPFS_PROVIDER=pinata

# Pinata Configuration
PINATA_API_KEY=your_pinata_api_key
PINATA_SECRET_KEY=your_pinata_secret_key

# Web3.Storage Configuration
WEB3_STORAGE_TOKEN=your_web3_storage_token

# Redis Configuration (for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379

# PDF Generation
PDF_GENERATION_ENABLED=true
```

## 🏗 Architecture

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

## 🔒 Security & Reliability

- **Cryptographic Linking**: Transaction hash embedding ensures document authenticity
- **Immutable Storage**: IPFS provides permanent, tamper-proof storage
- **Access Control**: API endpoints verify lease ownership
- **Error Handling**: Comprehensive retry logic and fallback mechanisms
- **Audit Trail**: Complete logging of all PDF generation events

## 📊 Performance

- **Asynchronous Processing**: Non-blocking PDF generation
- **Queue Management**: BullMQ provides job prioritization and scaling
- **Memory Efficiency**: Streaming PDF generation without disk storage
- **Caching**: IPFS CID caching for instant retrieval

## 🚀 Deployment

1. Install dependencies: `npm install`
2. Configure IPFS provider credentials in `.env`
3. Run database migration
4. Ensure Redis is running for BullMQ
5. Start the application

## 📝 Usage Examples

### Frontend Integration
```javascript
// Request PDF generation
const response = await fetch('/api/v1/leases/lease-123/contract');
if (response.status === 202) {
  // PDF generation in progress
  const { jobId } = await response.json();
  // Poll status endpoint for completion
}
```

### Smart Contract Integration
```javascript
// After lease initialization on blockchain
await fetch(`/api/v1/leases/${leaseId}/contract/generate`, {
  method: 'POST',
  body: JSON.stringify({ priority: 'high' })
});
```

## 🧩 Dependencies

- **pdfmake**: PDF generation library
- **bullmq**: Job queue management
- **ipfs-http-client**: IPFS client library
- **axios**: HTTP client for IPFS providers

## 📋 Checklist

- [x] All tests passing
- [x] Documentation updated
- [x] Environment variables documented
- [x] Database migration included
- [x] API endpoints documented with OpenAPI
- [x] Error handling implemented
- [x] Security considerations addressed
- [x] Performance optimizations implemented

## 🤝 Review Notes

Please review the following areas:
1. **Security**: IPFS provider credentials and access control
2. **Performance**: Queue configuration and concurrency settings
3. **Documentation**: API clarity and integration examples
4. **Testing**: Coverage of edge cases and error scenarios

## 🔄 Migration Notes

Run the database migration to add the new tables:
```bash
sqlite3 data/leaseflow-protocol.sqlite < migrations/014_add_lease_pdf_records.sql
```

---

**This implementation provides a complete, production-ready solution for PDF lease agreement generation with IPFS anchoring, fully addressing the requirements of issue #90.**
