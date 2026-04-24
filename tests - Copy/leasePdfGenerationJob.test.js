const LeasePdfGenerationJob = require('../src/jobs/leasePdfGenerationJob');
const { AppDatabase } = require('../src/db/appDatabase');
const { loadConfig } = require('../src/config');

// Mock dependencies
jest.mock('../src/services/leasePdfService');
jest.mock('../src/services/ipfsService');
jest.mock('../src/db/appDatabase');
jest.mock('../src/config');

describe('LeasePdfGenerationJob', () => {
  let pdfJob;
  let mockDatabase;
  let mockConfig;
  let mockPdfService;
  let mockIpfsService;

  beforeEach(() => {
    // Mock database
    mockDatabase = {
      getLeaseById: jest.fn(),
      getLandlordById: jest.fn(),
      getTenantById: jest.fn(),
      getAssetByLeaseId: jest.fn(),
      getPaymentsByLeaseId: jest.fn(),
      updateLeasePdfStatus: jest.fn(),
      db: {
        prepare: jest.fn().mockReturnValue({
          run: jest.fn()
        })
      }
    };

    // Mock config
    mockConfig = {
      redis: {
        host: 'localhost',
        port: 6379
      },
      ipfs: {
        provider: 'pinata'
      },
      pinata: {
        apiKey: 'test-key',
        secretApiKey: 'test-secret'
      }
    };

    // Mock services
    mockPdfService = require('../src/services/leasePdfService');
    mockIpfsService = require('../src/services/ipfsService');

    // Mock loadConfig
    loadConfig.mockReturnValue(mockConfig);

    // Mock AppDatabase
    AppDatabase.mockImplementation(() => mockDatabase);

    pdfJob = new LeasePdfGenerationJob(mockDatabase, mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with dependencies', () => {
      expect(pdfJob.database).toBe(mockDatabase);
      expect(pdfJob.config).toBe(mockConfig);
      expect(pdfJob.pdfService).toBeDefined();
      expect(pdfJob.ipfsService).toBeDefined();
    });
  });

  describe('addPdfGenerationJob', () => {
    it('should add job to queue successfully', async () => {
      const mockJob = {
        id: 'job-123',
        data: { leaseId: 'lease-456' }
      };

      pdfJob.queue = {
        add: jest.fn().mockResolvedValue(mockJob)
      };

      const job = await pdfJob.addPdfGenerationJob('lease-456');

      expect(job).toBe(mockJob);
      expect(pdfJob.queue.add).toHaveBeenCalledWith(
        'generate-lease-pdf',
        expect.objectContaining({
          leaseId: 'lease-456',
          timestamp: expect.any(String)
        }),
        expect.any(Object)
      );
    });

    it('should handle queue errors', async () => {
      pdfJob.queue = {
        add: jest.fn().mockRejectedValue(new Error('Queue error'))
      };

      await expect(pdfJob.addPdfGenerationJob('lease-456'))
        .rejects.toThrow('Failed to add PDF generation job: Queue error');
    });
  });

  describe('processJob', () => {
    let mockJob;

    beforeEach(() => {
      mockJob = {
        id: 'job-123',
        data: { leaseId: 'lease-456' },
        updateProgress: jest.fn()
      };

      // Mock successful data fetching
      mockDatabase.getLeaseById.mockReturnValue({
        id: 'lease-456',
        landlord_id: 'landlord-123',
        tenant_id: 'tenant-123',
        rent_amount: 1500,
        currency: 'USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        status: 'active',
        renewable: true,
        security_deposit: 3000
      });

      mockDatabase.getLandlordById.mockReturnValue({
        id: 'landlord-123',
        name: 'John Landlord',
        address: '123 Landlord St'
      });

      mockDatabase.getTenantById.mockReturnValue({
        id: 'tenant-123',
        name: 'Jane Tenant',
        address: '456 Tenant Ave'
      });

      mockDatabase.getAssetByLeaseId.mockReturnValue({
        leaseId: 'lease-456',
        property_type: 'Apartment',
        bedrooms: 2,
        bathrooms: 1
      });

      mockDatabase.getPaymentsByLeaseId.mockReturnValue([]);

      // Mock PDF generation
      mockPdfService.prototype.generateLeaseAgreement.mockResolvedValue(
        Buffer.from('pdf content')
      );

      // Mock IPFS upload
      mockIpfsService.prototype.uploadPdf.mockResolvedValue('ipfs-cid-123');
      mockIpfsService.prototype.getGatewayUrl.mockReturnValue('https://gateway.ipfs/ipfs-cid-123');
    });

    it('should process job successfully', async () => {
      const result = await pdfJob.processJob(mockJob);

      expect(result).toEqual({
        leaseId: 'lease-456',
        ipfsCid: 'ipfs-cid-123',
        transactionHash: expect.any(String),
        gatewayUrl: 'https://gateway.ipfs/ipfs-cid-123',
        generatedAt: expect.any(String),
        pdfSize: 11 // Length of 'pdf content'
      });

      expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
    });

    it('should handle lease not found', async () => {
      mockDatabase.getLeaseById.mockReturnValue(null);

      await expect(pdfJob.processJob(mockJob))
        .rejects.toThrow('Lease not found: lease-456');
    });

    it('should handle PDF generation errors', async () => {
      mockPdfService.prototype.generateLeaseAgreement.mockRejectedValue(
        new Error('PDF generation failed')
      );

      await expect(pdfJob.processJob(mockJob))
        .rejects.toThrow('PDF generation failed');
    });

    it('should handle IPFS upload errors', async () => {
      mockIpfsService.prototype.uploadPdf.mockRejectedValue(
        new Error('IPFS upload failed')
      );

      await expect(pdfJob.processJob(mockJob))
        .rejects.toThrow('IPFS upload failed');
    });

    it('should update progress correctly', async () => {
      await pdfJob.processJob(mockJob);

      expect(mockJob.updateProgress).toHaveBeenCalledWith(10);
      expect(mockJob.updateProgress).toHaveBeenCalledWith(20);
      expect(mockJob.updateProgress).toHaveBeenCalledWith(30);
      expect(mockJob.updateProgress).toHaveBeenCalledWith(40);
      expect(mockJob.updateProgress).toHaveBeenCalledWith(70);
      expect(mockJob.updateProgress).toHaveBeenCalledWith(90);
      expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
    });
  });

  describe('fetchLeaseData', () => {
    it('should fetch lease data successfully', async () => {
      const leaseData = {
        id: 'lease-456',
        rent_amount: 1500,
        currency: 'USD'
      };

      mockDatabase.getLeaseById.mockReturnValue(leaseData);

      const result = await pdfJob.fetchLeaseData('lease-456');

      expect(result).toEqual(leaseData);
      expect(mockDatabase.getLeaseById).toHaveBeenCalledWith('lease-456');
    });

    it('should throw error when lease not found', async () => {
      mockDatabase.getLeaseById.mockReturnValue(null);

      await expect(pdfJob.fetchLeaseData('lease-456'))
        .rejects.toThrow('Lease not found: lease-456');
    });
  });

  describe('fetchLessorData', () => {
    it('should fetch lessor data successfully', async () => {
      const lessorData = {
        id: 'landlord-123',
        name: 'John Landlord'
      };

      mockDatabase.getLandlordById.mockReturnValue(lessorData);

      const result = await pdfJob.fetchLessorData('landlord-123');

      expect(result).toEqual(lessorData);
    });

    it('should return fallback data when lessor not found', async () => {
      mockDatabase.getLandlordById.mockReturnValue(undefined);

      const result = await pdfJob.fetchLessorData('landlord-123');

      expect(result).toEqual({
        id: 'landlord-123',
        name: 'Landlord landlord-123',
        address: 'N/A'
      });
    });

    it('should handle database errors gracefully', async () => {
      mockDatabase.getLandlordById.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await pdfJob.fetchLessorData('landlord-123');

      expect(result).toEqual({
        id: 'landlord-123',
        name: 'Landlord landlord-123',
        address: 'N/A'
      });
    });
  });

  describe('fetchLesseeData', () => {
    it('should fetch lessee data successfully', async () => {
      const lesseeData = {
        id: 'tenant-123',
        name: 'Jane Tenant'
      };

      mockDatabase.getTenantById.mockReturnValue(lesseeData);

      const result = await pdfJob.fetchLesseeData('tenant-123');

      expect(result).toEqual(lesseeData);
    });

    it('should return fallback data when lessee not found', async () => {
      mockDatabase.getTenantById.mockReturnValue(undefined);

      const result = await pdfJob.fetchLesseeData('tenant-123');

      expect(result).toEqual({
        id: 'tenant-123',
        name: 'Tenant tenant-123',
        address: 'N/A'
      });
    });
  });

  describe('fetchAssetData', () => {
    it('should fetch asset data successfully', async () => {
      const assetData = {
        leaseId: 'lease-456',
        property_type: 'Apartment'
      };

      mockDatabase.getAssetByLeaseId.mockReturnValue(assetData);

      const result = await pdfJob.fetchAssetData('lease-456');

      expect(result).toEqual(assetData);
    });

    it('should return fallback data when asset not found', async () => {
      mockDatabase.getAssetByLeaseId.mockReturnValue(undefined);
      mockDatabase.getLeaseById.mockReturnValue({
        property_type: 'House',
        bedrooms: 3,
        bathrooms: 2,
        square_footage: 1200
      });

      const result = await pdfJob.fetchAssetData('lease-456');

      expect(result).toEqual({
        leaseId: 'lease-456',
        property_type: 'House',
        bedrooms: 3,
        bathrooms: 2,
        square_footage: 1200
      });
    });
  });

  describe('getTransactionHash', () => {
    it('should return transaction hash from lease', async () => {
      mockDatabase.getLeaseById.mockReturnValue({
        transaction_hash: '0x1234567890'
      });

      const result = await pdfJob.getTransactionHash('lease-456');

      expect(result).toBe('0x1234567890');
    });

    it('should return transaction hash from payments', async () => {
      mockDatabase.getLeaseById.mockReturnValue({});
      mockDatabase.getPaymentsByLeaseId.mockReturnValue([
        { transaction_hash: '0xpayment123' }
      ]);

      const result = await pdfJob.getTransactionHash('lease-456');

      expect(result).toBe('0xpayment123');
    });

    it('should return placeholder when no transaction hash found', async () => {
      mockDatabase.getLeaseById.mockReturnValue({});
      mockDatabase.getPaymentsByLeaseId.mockReturnValue([]);

      const result = await pdfJob.getTransactionHash('lease-456');

      expect(result).toMatch(/^pending-lease-lease-456-/);
    });
  });

  describe('updateLeaseWithPdfCid', () => {
    it('should update lease record successfully', async () => {
      const mockPrepare = {
        run: jest.fn()
      };
      mockDatabase.db.prepare.mockReturnValue(mockPrepare);

      await pdfJob.updateLeaseWithPdfCid('lease-456', 'ipfs-cid-123', '0x123456');

      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE leases')
      );
      expect(mockPrepare.run).toHaveBeenCalledWith(
        'ipfs-cid-123',
        '0x123456',
        expect.any(String),
        expect.any(String),
        'lease-456'
      );
    });

    it('should create PDF records table when update fails', async () => {
      const mockPrepare = {
        run: jest.fn().mockImplementation(() => {
          throw new Error('Column does not exist');
        })
      };
      mockDatabase.db.prepare.mockReturnValue(mockPrepare);

      await pdfJob.updateLeaseWithPdfCid('lease-456', 'ipfs-cid-123', '0x123456');

      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO lease_pdf_records')
      );
    });
  });

  describe('getJobStatus', () => {
    it('should return job status successfully', async () => {
      const mockJob = {
        id: 'job-123',
        getState: jest.fn().mockResolvedValue('completed'),
        progress: 100,
        data: { leaseId: 'lease-456' },
        processedOn: '2024-01-01T10:00:00Z',
        finishedOn: '2024-01-01T10:05:00Z',
        failedReason: null
      };

      pdfJob.queue = {
        getJob: jest.fn().mockResolvedValue(mockJob)
      };

      const status = await pdfJob.getJobStatus('job-123');

      expect(status).toEqual({
        id: 'job-123',
        status: 'completed',
        progress: 100,
        data: { leaseId: 'lease-456' },
        processedOn: '2024-01-01T10:00:00Z',
        finishedOn: '2024-01-01T10:05:00Z',
        failedReason: null
      });
    });

    it('should return not_found when job does not exist', async () => {
      pdfJob.queue = {
        getJob: jest.fn().mockResolvedValue(null)
      };

      const status = await pdfJob.getJobStatus('nonexistent-job');

      expect(status).toEqual({ status: 'not_found' });
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      pdfJob.queue = {
        getWaiting: jest.fn().mockResolvedValue([1, 2]),
        getActive: jest.fn().mockResolvedValue([3]),
        getCompleted: jest.fn().mockResolvedValue([4, 5, 6]),
        getFailed: jest.fn().mockResolvedValue([7])
      };

      const stats = await pdfJob.getQueueStats();

      expect(stats).toEqual({
        waiting: 2,
        active: 1,
        completed: 3,
        failed: 1,
        total: 7
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      mockDatabase.getLeaseById.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const mockJob = {
        id: 'job-123',
        data: { leaseId: 'lease-456' },
        updateProgress: jest.fn()
      };

      await expect(pdfJob.processJob(mockJob))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle service initialization errors', async () => {
      mockPdfService.prototype.generateLeaseAgreement.mockImplementation(() => {
        throw new Error('Service initialization failed');
      });

      const mockJob = {
        id: 'job-123',
        data: { leaseId: 'lease-456' },
        updateProgress: jest.fn()
      };

      await expect(pdfJob.processJob(mockJob))
        .rejects.toThrow('Service initialization failed');
    });
  });
});
