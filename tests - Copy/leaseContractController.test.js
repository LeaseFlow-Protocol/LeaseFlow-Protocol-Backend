const request = require('supertest');
const express = require('express');
const LeaseContractController = require('../src/controllers/LeaseContractController');

// Mock dependencies
jest.mock('../src/services/ipfsService');
jest.mock('../src/jobs/leasePdfGenerationJob');
jest.mock('../src/db/appDatabase');

describe('LeaseContractController API Integration', () => {
  let app;
  let controller;
  let mockDatabase;
  let mockConfig;
  let mockIpfsService;
  let mockPdfJob;

  beforeEach(() => {
    // Mock database
    mockDatabase = {
      getLeaseById: jest.fn(),
      db: {
        prepare: jest.fn().mockReturnValue({
          get: jest.fn(),
          run: jest.fn()
        })
      }
    };

    // Mock config
    mockConfig = {
      ipfs: {
        provider: 'pinata'
      }
    };

    // Mock services
    mockIpfsService = require('../src/services/ipfsService');
    mockPdfJob = require('../src/jobs/leasePdfGenerationJob');

    // Create controller
    controller = new LeaseContractController(mockDatabase, mockConfig);

    // Create Express app for testing
    app = express();
    app.use(express.json());
    
    // Mock app.locals
    app.locals.leaseContractController = controller;

    // Import and use routes
    const leaseContractRoutes = require('../src/routes/leaseContractRoutes');
    app.use('/api/v1/leases', leaseContractRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/leases/:id/contract', () => {
    it('should return 202 when PDF generation is triggered', async () => {
      // Mock lease exists
      mockDatabase.getLeaseById.mockReturnValue({
        id: 'lease-123',
        status: 'active'
      });

      // Mock no existing PDF
      controller.getExistingPdfCid = jest.fn().mockResolvedValue(null);

      // Mock job addition
      const mockJob = {
        id: 'job-123',
        data: { leaseId: 'lease-123' }
      };
      controller.pdfJob = {
        addPdfGenerationJob: jest.fn().mockResolvedValue(mockJob)
      };

      const response = await request(app)
        .get('/api/v1/leases/lease-123/contract')
        .expect(202);

      expect(response.body).toEqual({
        success: true,
        message: 'PDF generation in progress',
        jobId: 'job-123',
        leaseId: 'lease-123',
        statusUrl: '/api/v1/leases/lease-123/contract/status'
      });
    });

    it('should stream PDF when already exists', async () => {
      // Mock lease exists
      mockDatabase.getLeaseById.mockReturnValue({
        id: 'lease-123',
        status: 'active'
      });

      // Mock existing PDF
      controller.getExistingPdfCid = jest.fn().mockResolvedValue('ipfs-cid-123');
      controller.ipfsService = {
        verifyFileExists: jest.fn().mockResolvedValue(true),
        getFile: jest.fn().mockResolvedValue(Buffer.from('pdf content'))
      };

      const response = await request(app)
        .get('/api/v1/leases/lease-123/contract')
        .expect(200);

      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain('lease-agreement-lease-123.pdf');
      expect(response.body).toEqual(Buffer.from('pdf content'));
    });

    it('should return 404 when lease not found', async () => {
      mockDatabase.getLeaseById.mockReturnValue(null);

      const response = await request(app)
        .get('/api/v1/leases/nonexistent/contract')
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: 'Lease not found or access denied'
      });
    });

    it('should return 202 when PDF needs regeneration', async () => {
      // Mock lease exists
      mockDatabase.getLeaseById.mockReturnValue({
        id: 'lease-123',
        status: 'active'
      });

      // Mock existing PDF but not accessible
      controller.getExistingPdfCid = jest.fn().mockResolvedValue('ipfs-cid-123');
      controller.ipfsService = {
        verifyFileExists: jest.fn().mockResolvedValue(false)
      };

      // Mock job addition
      const mockJob = {
        id: 'job-456',
        data: { leaseId: 'lease-123' }
      };
      controller.pdfJob = {
        addPdfGenerationJob: jest.fn().mockResolvedValue(mockJob)
      };

      const response = await request(app)
        .get('/api/v1/leases/lease-123/contract')
        .expect(202);

      expect(response.body.message).toBe('PDF regeneration in progress');
    });
  });

  describe('GET /api/v1/leases/:id/contract/status', () => {
    it('should return status for existing job', async () => {
      const mockJobStatus = {
        id: 'job-123',
        status: 'completed',
        progress: 100
      };

      controller.pdfJob = {
        getJobStatus: jest.fn().mockResolvedValue(mockJobStatus)
      };

      const response = await request(app)
        .get('/api/v1/leases/lease-123/contract/status?jobId=job-123')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          leaseId: 'lease-123',
          jobId: 'job-123',
          jobStatus: mockJobStatus,
          status: 'completed',
          message: expect.any(String)
        }
      });
    });

    it('should return not_generated status when no PDF exists', async () => {
      controller.getExistingPdfCid = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/leases/lease-123/contract/status')
        .expect(200);

      expect(response.body.data.status).toBe('not_generated');
    });

    it('should return completed status when PDF exists and accessible', async () => {
      controller.getExistingPdfCid = jest.fn().mockResolvedValue('ipfs-cid-123');
      controller.ipfsService = {
        verifyFileExists: jest.fn().mockResolvedValue(true),
        getGatewayUrl: jest.fn().mockReturnValue('https://gateway.ipfs/ipfs-cid-123')
      };

      const response = await request(app)
        .get('/api/v1/leases/lease-123/contract/status')
        .expect(200);

      expect(response.body.data).toEqual({
        leaseId: 'lease-123',
        status: 'completed',
        ipfsCid: 'ipfs-cid-123',
        gatewayUrl: 'https://gateway.ipfs/ipfs-cid-123',
        contractUrl: '/api/v1/leases/lease-123/contract',
        message: 'PDF is ready for download'
      });
    });

    it('should return regeneration_needed status when PDF not accessible', async () => {
      controller.getExistingPdfCid = jest.fn().mockResolvedValue('ipfs-cid-123');
      controller.ipfsService = {
        verifyFileExists: jest.fn().mockResolvedValue(false)
      };

      const response = await request(app)
        .get('/api/v1/leases/lease-123/contract/status')
        .expect(200);

      expect(response.body.data.status).toBe('regeneration_needed');
    });
  });

  describe('POST /api/v1/leases/:id/contract/generate', () => {
    it('should trigger PDF generation successfully', async () => {
      // Mock lease exists
      mockDatabase.getLeaseById.mockReturnValue({
        id: 'lease-123',
        status: 'active'
      });

      // Mock job addition
      const mockJob = {
        id: 'job-789',
        data: { leaseId: 'lease-123' }
      };
      controller.pdfJob = {
        addPdfGenerationJob: jest.fn().mockResolvedValue(mockJob)
      };

      const response = await request(app)
        .post('/api/v1/leases/lease-123/contract/generate')
        .send({ priority: 'high' })
        .expect(202);

      expect(response.body).toEqual({
        success: true,
        message: 'PDF generation started',
        jobId: 'job-789',
        leaseId: 'lease-123',
        statusUrl: '/api/v1/leases/lease-123/contract/status?jobId=job-789'
      });

      expect(controller.pdfJob.addPdfGenerationJob).toHaveBeenCalledWith(
        'lease-123',
        { priority: 'high', force: false }
      );
    });

    it('should return 404 when lease not found', async () => {
      mockDatabase.getLeaseById.mockReturnValue(null);

      const response = await request(app)
        .post('/api/v1/leases/nonexistent/contract/generate')
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: 'Lease not found or access denied'
      });
    });

    it('should use default priority when not specified', async () => {
      mockDatabase.getLeaseById.mockReturnValue({
        id: 'lease-123',
        status: 'active'
      });

      const mockJob = {
        id: 'job-default',
        data: { leaseId: 'lease-123' }
      };
      controller.pdfJob = {
        addPdfGenerationJob: jest.fn().mockResolvedValue(mockJob)
      };

      await request(app)
        .post('/api/v1/leases/lease-123/contract/generate')
        .send({})
        .expect(202);

      expect(controller.pdfJob.addPdfGenerationJob).toHaveBeenCalledWith(
        'lease-123',
        { priority: 'normal', force: false }
      );
    });
  });

  describe('GET /api/v1/leases/contracts/queue/stats', () => {
    it('should return queue statistics', async () => {
      const mockStats = {
        waiting: 2,
        active: 1,
        completed: 10,
        failed: 1,
        total: 14
      };

      controller.pdfJob = {
        getQueueStats: jest.fn().mockResolvedValue(mockStats)
      };

      const response = await request(app)
        .get('/api/v1/leases/contracts/queue/stats')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          queue: 'lease-pdf-generation',
          ...mockStats,
          timestamp: expect.any(String)
        }
      });
    });
  });

  describe('POST /api/v1/leases/contracts/cleanup', () => {
    it('should cleanup old records successfully', async () => {
      const mockPrepare = {
        run: jest.fn()
          .mockReturnValueOnce({ changes: 5 })  // failed records
          .mockReturnValueOnce({ changes: 3 })  // completed records
      };
      mockDatabase.db.prepare.mockReturnValue(mockPrepare);

      const response = await request(app)
        .post('/api/v1/leases/contracts/cleanup')
        .send({ daysOld: 30 })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Cleanup completed',
        data: {
          deletedFailedRecords: 5,
          deletedCompletedRecords: 3,
          cutoffDate: expect.any(String)
        }
      });

      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM lease_pdf_records WHERE status = \'failed\'')
      );
    });

    it('should use default daysOld when not specified', async () => {
      const mockPrepare = {
        run: jest.fn().mockReturnValue({ changes: 0 })
      };
      mockDatabase.db.prepare.mockReturnValue(mockPrepare);

      await request(app)
        .post('/api/v1/leases/contracts/cleanup')
        .send({})
        .expect(200);

      // Should use default 30 days
      expect(mockDatabase.db.prepare).toHaveBeenCalled();
    });
  });

  describe('Helper Methods', () => {
    describe('verifyLeaseAccess', () => {
      it('should return lease when found', async () => {
        const lease = { id: 'lease-123', status: 'active' };
        mockDatabase.getLeaseById.mockReturnValue(lease);

        const result = await controller.verifyLeaseAccess('lease-123', {});

        expect(result).toBe(lease);
      });

      it('should return null when lease not found', async () => {
        mockDatabase.getLeaseById.mockReturnValue(null);

        const result = await controller.verifyLeaseAccess('nonexistent', {});

        expect(result).toBeNull();
      });
    });

    describe('getExistingPdfCid', () => {
      it('should get CID from lease record', async () => {
        mockDatabase.getLeaseById.mockReturnValue({
          id: 'lease-123',
          pdf_cid: 'ipfs-cid-from-lease'
        });

        const cid = await controller.getExistingPdfCid('lease-123');

        expect(cid).toBe('ipfs-cid-from-lease');
      });

      it('should get CID from PDF records table', async () => {
        mockDatabase.getLeaseById.mockReturnValue({});
        const mockPrepare = {
          get: jest.fn().mockReturnValue({ ipfs_cid: 'ipfs-cid-from-records' })
        };
        mockDatabase.db.prepare.mockReturnValue(mockPrepare);

        const cid = await controller.getExistingPdfCid('lease-123');

        expect(cid).toBe('ipfs-cid-from-records');
      });

      it('should return null when no CID found', async () => {
        mockDatabase.getLeaseById.mockReturnValue({});
        const mockPrepare = {
          get: jest.fn().mockReturnValue(undefined)
        };
        mockDatabase.db.prepare.mockReturnValue(mockPrepare);

        const cid = await controller.getExistingPdfCid('lease-123');

        expect(cid).toBeNull();
      });
    });

    describe('mapJobStatusToContractStatus', () => {
      it('should map job statuses correctly', () => {
        expect(controller.mapJobStatusToContractStatus('waiting')).toBe('queued');
        expect(controller.mapJobStatusToContractStatus('active')).toBe('generating');
        expect(controller.mapJobStatusToContractStatus('completed')).toBe('completed');
        expect(controller.mapJobStatusToContractStatus('failed')).toBe('failed');
        expect(controller.mapJobStatusToContractStatus('delayed')).toBe('queued');
        expect(controller.mapJobStatusToContractStatus('paused')).toBe('paused');
        expect(controller.mapJobStatusToContractStatus('unknown')).toBe('unknown');
      });
    });

    describe('getJobStatusMessage', () => {
      it('should return appropriate messages', () => {
        const waitingStatus = { status: 'waiting' };
        const activeStatus = { status: 'active' };
        const completedStatus = { status: 'completed' };
        const failedStatus = { status: 'failed', failedReason: 'Network error' };

        expect(controller.getJobStatusMessage(waitingStatus))
          .toBe('PDF generation is queued and waiting to be processed');
        expect(controller.getJobStatusMessage(activeStatus))
          .toBe('PDF is currently being generated');
        expect(controller.getJobStatusMessage(completedStatus))
          .toBe('PDF generation completed successfully');
        expect(controller.getJobStatusMessage(failedStatus))
          .toBe('PDF generation failed: Network error');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors gracefully', async () => {
      mockDatabase.getLeaseById.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await request(app)
        .get('/api/v1/leases/lease-123/contract')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Internal server error',
        message: 'Database error'
      });
    });

    it('should handle IPFS service errors', async () => {
      mockDatabase.getLeaseById.mockReturnValue({ id: 'lease-123' });
      controller.getExistingPdfCid = jest.fn().mockResolvedValue('ipfs-cid-123');
      controller.ipfsService = {
        verifyFileExists: jest.fn().mockResolvedValue(true),
        getFile: jest.fn().mockRejectedValue(new Error('IPFS error'))
      };

      const response = await request(app)
        .get('/api/v1/leases/lease-123/contract')
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });

    it('should handle job queue errors', async () => {
      mockDatabase.getLeaseById.mockReturnValue({ id: 'lease-123' });
      controller.getExistingPdfCid = jest.fn().mockResolvedValue(null);
      controller.pdfJob = {
        addPdfGenerationJob: jest.fn().mockRejectedValue(new Error('Queue error'))
      };

      const response = await request(app)
        .get('/api/v1/leases/lease-123/contract')
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });
  });
});
