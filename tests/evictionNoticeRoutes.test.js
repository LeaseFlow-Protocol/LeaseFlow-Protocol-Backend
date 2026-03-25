const request = require('supertest');
const express = require('express');
const evictionNoticeRoutes = require('../src/routes/evictionNoticeRoutes');

// Mock the service
jest.mock('../services/emergencyEvictionNoticeService');
jest.mock('../services/databaseService');

describe('Eviction Notice Routes', () => {
  let app;
  let mockService;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock service
    mockService = {
      initialize: jest.fn().mockResolvedValue(true),
      serveNotice: jest.fn(),
      getNotice: jest.fn(),
      getNoticeProofs: jest.fn(),
      verifyNotice: jest.fn(),
      db: {
        query: jest.fn()
      }
    };

    // Mock the service module
    const EmergencyEvictionNoticeService = require('../services/emergencyEvictionNoticeService');
    EmergencyEvictionNoticeService.mockImplementation(() => mockService);

    // Create Express app
    app = express();
    app.use(express.json());
    app.use('/api/eviction-notices', evictionNoticeRoutes);
  });

  describe('POST /api/eviction-notices/serve', () => {
    const validNoticeData = {
      leaseId: 'lease-123',
      landlordAddress: 'GD...LANDLORD',
      tenantAddress: 'GD...TENANT',
      tenantEmail: 'tenant@example.com',
      noticeType: 'breach',
      breachDescription: 'Non-payment of rent',
      noticeContent: 'You are hereby notified of breach of lease agreement...'
    };

    it('should serve notice successfully', async () => {
      const mockResult = {
        noticeId: 1,
        status: 'served',
        emailReceipt: { messageId: 'test-id' },
        onChainReceipt: { transactionHash: 'tx-hash' },
        cryptographicHash: 'hash-123',
        servedAt: new Date().toISOString()
      };

      mockService.serveNotice.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/eviction-notices/serve')
        .send(validNoticeData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockResult);
      expect(mockService.serveNotice).toHaveBeenCalledWith(validNoticeData);
    });

    it('should validate required fields', async () => {
      const invalidData = {
        leaseId: 'lease-123',
        // Missing other required fields
      };

      const response = await request(app)
        .post('/api/eviction-notices/serve')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
      expect(response.body.required).toContain('landlordAddress');
    });

    it('should validate email format', async () => {
      const invalidEmailData = {
        ...validNoticeData,
        tenantEmail: 'invalid-email'
      };

      const response = await request(app)
        .post('/api/eviction-notices/serve')
        .send(invalidEmailData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid email format');
    });

    it('should validate notice type', async () => {
      const invalidTypeData = {
        ...validNoticeData,
        noticeType: 'invalid-type'
      };

      const response = await request(app)
        .post('/api/eviction-notices/serve')
        .send(invalidTypeData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid notice type');
    });

    it('should handle service errors', async () => {
      mockService.serveNotice.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .post('/api/eviction-notices/serve')
        .send(validNoticeData);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to serve eviction notice');
    });
  });

  describe('GET /api/eviction-notices/:noticeId', () => {
    it('should get notice by ID', async () => {
      const mockNotice = {
        id: 1,
        lease_id: 'lease-123',
        status: 'served',
        created_at: new Date()
      };

      mockService.getNotice.mockResolvedValue(mockNotice);

      const response = await request(app)
        .get('/api/eviction-notices/1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockNotice);
      expect(mockService.getNotice).toHaveBeenCalledWith(1);
    });

    it('should handle invalid notice ID', async () => {
      const response = await request(app)
        .get('/api/eviction-notices/invalid');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid notice ID');
    });

    it('should handle notice not found', async () => {
      mockService.getNotice.mockRejectedValue(new Error('Notice not found'));

      const response = await request(app)
        .get('/api/eviction-notices/999');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Eviction notice not found');
    });
  });

  describe('GET /api/eviction-notices/:noticeId/proofs', () => {
    it('should get notice proofs', async () => {
      const mockProofs = [
        {
          id: 1,
          notice_id: 1,
          proof_type: 'email',
          cryptographic_hash: 'hash-123'
        }
      ];

      mockService.getNoticeProofs.mockResolvedValue(mockProofs);

      const response = await request(app)
        .get('/api/eviction-notices/1/proofs');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockProofs);
      expect(mockService.getNoticeProofs).toHaveBeenCalledWith(1);
    });

    it('should handle invalid notice ID', async () => {
      const response = await request(app)
        .get('/api/eviction-notices/invalid/proofs');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid notice ID');
    });
  });

  describe('GET /api/eviction-notices/:noticeId/verify', () => {
    it('should verify notice', async () => {
      const mockVerification = {
        noticeId: 1,
        isValid: true,
        verifications: [
          { type: 'content_integrity', status: 'verified' },
          { type: 'email_delivery', status: 'verified' },
          { type: 'on_chain_receipt', status: 'verified' }
        ]
      };

      mockService.verifyNotice.mockResolvedValue(mockVerification);

      const response = await request(app)
        .get('/api/eviction-notices/1/verify');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockVerification);
      expect(mockService.verifyNotice).toHaveBeenCalledWith(1);
    });

    it('should handle invalid notice ID', async () => {
      const response = await request(app)
        .get('/api/eviction-notices/invalid/verify');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid notice ID');
    });

    it('should handle notice not found during verification', async () => {
      mockService.verifyNotice.mockRejectedValue(new Error('Notice not found'));

      const response = await request(app)
        .get('/api/eviction-notices/999/verify');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Eviction notice not found');
    });
  });

  describe('GET /api/eviction-notices', () => {
    it('should get filtered notices', async () => {
      const mockNotices = [
        { id: 1, lease_id: 'lease-123', status: 'served' },
        { id: 2, lease_id: 'lease-456', status: 'pending' }
      ];

      mockService.db.query.mockResolvedValue({ rows: mockNotices });

      const response = await request(app)
        .get('/api/eviction-notices?leaseId=lease-123&status=served');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockNotices);
      expect(mockService.db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE lease_id = $1 AND status = $2'),
        ['lease-123', 'served', 50, 0]
      );
    });

    it('should handle pagination', async () => {
      mockService.db.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/api/eviction-notices?limit=10&offset=20');

      expect(response.status).toBe(200);
      expect(mockService.db.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1 OFFSET $2'),
        [10, 20]
      );
    });
  });

  describe('POST /api/eviction-notices/:noticeId/resend', () => {
    it('should resend notice successfully', async () => {
      const mockNotice = {
        id: 1,
        lease_id: 'lease-123',
        landlord_address: 'GD...LANDLORD',
        tenant_address: 'GD...TENANT',
        notice_type: 'breach',
        breach_description: 'Non-payment',
        notice_content: 'Test notice content'
      };

      const mockEmailResult = {
        sent: true,
        messageId: 'new-message-id',
        sentAt: new Date()
      };

      mockService.getNotice.mockResolvedValue(mockNotice);
      mockService.sendEmailNotice.mockResolvedValue(mockEmailResult);
      mockService.db.query.mockResolvedValue({});

      const response = await request(app)
        .post('/api/eviction-notices/1/resend')
        .send({ tenantEmail: 'new-email@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Eviction notice resent successfully');
      expect(mockService.sendEmailNotice).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantEmail: 'new-email@example.com'
        }),
        1
      );
    });

    it('should validate tenant email', async () => {
      const response = await request(app)
        .post('/api/eviction-notices/1/resend')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Tenant email is required');
    });

    it('should handle invalid notice ID', async () => {
      const response = await request(app)
        .post('/api/eviction-notices/invalid/resend')
        .send({ tenantEmail: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid notice ID');
    });

    it('should handle notice not found', async () => {
      mockService.getNotice.mockRejectedValue(new Error('Notice not found'));

      const response = await request(app)
        .post('/api/eviction-notices/999/resend')
        .send({ tenantEmail: 'test@example.com' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Eviction notice not found');
    });
  });
});
