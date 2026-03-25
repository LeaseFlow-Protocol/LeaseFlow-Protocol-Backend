const EmergencyEvictionNoticeService = require('../services/emergencyEvictionNoticeService');
const { Pool } = require('pg');

// Mock dependencies
jest.mock('nodemailer');
jest.mock('@stellar/stellar-sdk');

describe('EmergencyEvictionNoticeService', () => {
  let service;
  let mockDb;
  let mockTransporter;
  let mockStellarServer;

  beforeEach(() => {
    // Mock database
    mockDb = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue({
        query: jest.fn(),
        release: jest.fn()
      })
    };

    // Mock email transporter
    mockTransporter = {
      verify: jest.fn().mockResolvedValue(true),
      sendMail: jest.fn().mockResolvedValue({
        messageId: 'test-message-id',
        response: '250 OK'
      })
    };

    // Mock Stellar server
    mockStellarServer = {
      // Add Stellar server mock methods as needed
    };

    // Mock nodemailer
    const nodemailer = require('nodemailer');
    nodemailer.createTransporter = jest.fn().mockReturnValue(mockTransporter);

    service = new EmergencyEvictionNoticeService(mockDb, mockStellarServer);
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      mockDb.query = jest.fn().mockResolvedValue({});

      await service.initialize();

      expect(service.isInitialized).toBe(true);
      expect(mockTransporter.verify).toHaveBeenCalled();
      expect(mockDb.query).toHaveBeenCalledTimes(2); // Two table creations
    });

    it('should throw error if email verification fails', async () => {
      mockTransporter.verify.mockRejectedValue(new Error('Email config error'));

      await expect(service.initialize()).rejects.toThrow('Email config error');
    });
  });

  describe('serveNotice', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    const noticeData = {
      leaseId: 'lease-123',
      landlordAddress: 'GD...LANDLORD',
      tenantAddress: 'GD...TENANT',
      tenantEmail: 'tenant@example.com',
      noticeType: 'breach',
      breachDescription: 'Non-payment of rent',
      noticeContent: 'You are hereby notified of breach of lease agreement...'
    };

    it('should serve notice successfully', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn()
      };
      mockDb.connect.mockResolvedValue(mockClient);

      // Mock insert notice
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 1 }]
      });

      // Mock update notice
      mockClient.query.mockResolvedValueOnce({});

      const result = await service.serveNotice(noticeData);

      expect(result.noticeId).toBe(1);
      expect(result.status).toBe('served');
      expect(result.emailReceipt).toBeDefined();
      expect(result.onChainReceipt).toBeDefined();
      expect(result.cryptographicHash).toBeDefined();
    });

    it('should validate required fields', async () => {
      const invalidNoticeData = { ...noticeData, tenantEmail: '' };

      await expect(service.serveNotice(invalidNoticeData)).rejects.toThrow();
    });

    it('should rollback on error', async () => {
      const mockClient = {
        query: jest.fn().mockRejectedValue(new Error('Database error')),
        release: jest.fn()
      };
      mockDb.connect.mockResolvedValue(mockClient);

      await expect(service.serveNotice(noticeData)).rejects.toThrow('Database error');
    });
  });

  describe('sendEmailNotice', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    const noticeData = {
      leaseId: 'lease-123',
      tenantEmail: 'tenant@example.com',
      noticeType: 'breach',
      noticeContent: 'Test notice content'
    };

    it('should send email successfully', async () => {
      const result = await service.sendEmailNotice(noticeData, 1);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'tenant@example.com',
          subject: 'Official Eviction Notice - Lease lease-123'
        })
      );
      expect(result.sent).toBe(true);
      expect(result.messageId).toBe('test-message-id');
    });

    it('should handle email sending failure', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('SMTP error'));

      await expect(service.sendEmailNotice(noticeData, 1)).rejects.toThrow('Email delivery failed');
    });
  });

  describe('recordOnChainReceipt', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should record on-chain receipt', async () => {
      const noticeData = {
        leaseId: 'lease-123'
      };
      const noticeId = 1;
      const noticeHash = 'abc123';

      const result = await service.recordOnChainReceipt(noticeData, noticeId, noticeHash);

      expect(result.transactionHash).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.memo).toContain('EVICT_NOTICE:1:abc123');
    });
  });

  describe('generateHash', () => {
    it('should generate consistent hash', () => {
      const data = 'test content';
      const hash1 = service.generateHash(data);
      const hash2 = service.generateHash(data);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex format
    });
  });

  describe('getNotice', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should get notice by ID', async () => {
      const mockNotice = {
        id: 1,
        lease_id: 'lease-123',
        status: 'served'
      };
      mockDb.query.mockResolvedValue({ rows: [mockNotice] });

      const result = await service.getNotice(1);

      expect(result).toEqual(mockNotice);
    });

    it('should throw error if notice not found', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(service.getNotice(999)).rejects.toThrow('Notice not found');
    });
  });

  describe('verifyNotice', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should verify notice successfully', async () => {
      const notice = {
        id: 1,
        notice_content: 'test content',
        digital_receipt_hash: service.generateHash('test content')
      };
      const proofs = [
        {
          proof_type: 'email',
          proof_data: { sentAt: new Date(), messageId: 'test-id' }
        },
        {
          proof_type: 'on_chain',
          proof_data: { transactionHash: 'tx-hash', timestamp: new Date() }
        }
      ];

      mockDb.query.mockImplementation((query, params) => {
        if (query.includes('eviction_notices')) {
          return Promise.resolve({ rows: [notice] });
        }
        if (query.includes('notice_proofs')) {
          return Promise.resolve({ rows: proofs });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await service.verifyNotice(1);

      expect(result.isValid).toBe(true);
      expect(result.verifications).toHaveLength(3); // content_integrity, email_delivery, on_chain_receipt
    });

    it('should detect tampered content', async () => {
      const notice = {
        id: 1,
        notice_content: 'modified content',
        digital_receipt_hash: service.generateHash('original content')
      };

      mockDb.query.mockImplementation((query, params) => {
        if (query.includes('eviction_notices')) {
          return Promise.resolve({ rows: [notice] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await service.verifyNotice(1);

      expect(result.isValid).toBe(false);
      expect(result.verifications.find(v => v.type === 'content_integrity').status).toBe('failed');
    });
  });

  describe('generateEmailContent', () => {
    it('should generate proper email content', () => {
      const noticeData = {
        leaseId: 'lease-123',
        noticeType: 'breach',
        breachDescription: 'Non-payment',
        noticeContent: 'You are notified...'
      };

      const content = service.generateEmailContent(noticeData, 1);

      expect(content).toContain('Official Eviction Notice');
      expect(content).toContain('Notice ID: 1');
      expect(content).toContain('Lease ID: lease-123');
      expect(content).toContain('Non-payment');
      expect(content).toContain('You are notified...');
    });
  });
});
