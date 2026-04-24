const IpfsService = require('../src/services/ipfsService');

// Mock axios for HTTP requests
jest.mock('axios');

// Mock FormData for file uploads
jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getBoundary: jest.fn().mockReturnValue('boundary'),
  }));
});

describe('IpfsService', () => {
  let ipfsService;
  let mockConfig;
  let mockPdfBuffer;
  let mockLeaseId;

  beforeEach(() => {
    mockConfig = {
      ipfs: {
        provider: 'pinata',
        host: 'localhost',
        port: 5001,
        protocol: 'http'
      },
      pinata: {
        apiKey: 'test-api-key',
        secretApiKey: 'test-secret-key',
        gateway: 'https://gateway.pinata.cloud'
      },
      web3Storage: {
        token: 'test-web3-storage-token',
        endpoint: 'https://api.web3.storage'
      }
    };

    ipfsService = new IpfsService(mockConfig);
    mockPdfBuffer = Buffer.from('test pdf content');
    mockLeaseId = 'test-lease-123';

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with Pinata provider by default', () => {
      const service = new IpfsService({});
      expect(service.provider).toBe('pinata');
    });

    it('should initialize with custom provider', () => {
      const config = { ipfs: { provider: 'local' } };
      const service = new IpfsService(config);
      expect(service.provider).toBe('local');
    });
  });

  describe('uploadPdf', () => {
    it('should upload to Pinata when provider is pinata', async () => {
      const axios = require('axios');
      axios.post.mockResolvedValue({
        status: 200,
        data: { IpfsHash: 'test-cid-123' }
      });

      const cid = await ipfsService.uploadPdf(mockPdfBuffer, mockLeaseId);

      expect(cid).toBe('test-cid-123');
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'pinata_api_key': 'test-api-key',
            'pinata_secret_api_key': 'test-secret-key'
          })
        })
      );
    });

    it('should throw error when Pinata credentials are missing', async () => {
      const configWithoutCreds = { ipfs: { provider: 'pinata' } };
      const service = new IpfsService(configWithoutCreds);

      await expect(service.uploadPdf(mockPdfBuffer, mockLeaseId))
        .rejects.toThrow('Pinata API credentials not configured');
    });

    it('should handle upload errors gracefully', async () => {
      const axios = require('axios');
      axios.post.mockRejectedValue(new Error('Network error'));

      await expect(ipfsService.uploadPdf(mockPdfBuffer, mockLeaseId))
        .rejects.toThrow('IPFS upload failed: Network error');
    });
  });

  describe('uploadToPinata', () => {
    it('should format Pinata request correctly', async () => {
      const axios = require('axios');
      const FormData = require('form-data');
      
      axios.post.mockResolvedValue({
        status: 200,
        data: { IpfsHash: 'test-cid-456' }
      });

      const cid = await ipfsService.uploadToPinata(mockPdfBuffer, mockLeaseId);

      expect(cid).toBe('test-cid-456');
      expect(FormData).toHaveBeenCalled();
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        expect.any(Object),
        expect.objectContaining({
          maxContentLength: 'Infinity',
          headers: expect.objectContaining({
            'pinata_api_key': 'test-api-key',
            'pinata_secret_api_key': 'test-secret-key'
          })
        })
      );
    });
  });

  describe('uploadToWeb3Storage', () => {
    beforeEach(() => {
      ipfsService.provider = 'web3storage';
    });

    it('should upload to Web3.Storage when token is provided', async () => {
      const axios = require('axios');
      axios.post.mockResolvedValue({
        status: 200,
        data: { cid: 'web3-cid-789' }
      });

      const cid = await ipfsService.uploadPdf(mockPdfBuffer, mockLeaseId);

      expect(cid).toBe('web3-cid-789');
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.web3.storage/upload',
        expect.any(Object),
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer test-web3-storage-token',
            'Content-Type': 'multipart/form-data'
          }
        })
      );
    });

    it('should throw error when Web3.Storage token is missing', async () => {
      const configWithoutToken = { 
        web3Storage: { token: null },
        ipfs: { provider: 'web3storage' }
      };
      const service = new IpfsService(configWithoutToken);

      await expect(service.uploadPdf(mockPdfBuffer, mockLeaseId))
        .rejects.toThrow('Web3.Storage token not configured');
    });
  });

  describe('uploadToLocalIpfs', () => {
    beforeEach(() => {
      ipfsService.provider = 'local';
      
      // Mock IPFS client
      const mockClient = {
        add: jest.fn().mockResolvedValue({
          cid: { toString: jest.fn().mockReturnValue('local-cid-123') }
        })
      };
      ipfsService.client = mockClient;
    });

    it('should upload to local IPFS node', async () => {
      const cid = await ipfsService.uploadPdf(mockPdfBuffer, mockLeaseId);

      expect(cid).toBe('local-cid-123');
      expect(ipfsService.client.add).toHaveBeenCalledWith(mockPdfBuffer, {
        pin: true,
        progress: expect.any(Function)
      });
    });

    it('should throw error when client is not initialized', async () => {
      ipfsService.client = null;

      await expect(ipfsService.uploadPdf(mockPdfBuffer, mockLeaseId))
        .rejects.toThrow('Local IPFS client not initialized');
    });
  });

  describe('getFile', () => {
    it('should retrieve file from Pinata gateway', async () => {
      const axios = require('axios');
      const mockFileBuffer = Buffer.from('retrieved pdf content');
      
      axios.get.mockResolvedValue({
        data: mockFileBuffer
      });

      const buffer = await ipfsService.getFile('test-cid');

      expect(buffer).toEqual(mockFileBuffer);
      expect(axios.get).toHaveBeenCalledWith(
        'https://gateway.pinata.cloud/ipfs/test-cid',
        { responseType: 'arraybuffer' }
      );
    });

    it('should retrieve file from local IPFS node', async () => {
      ipfsService.provider = 'local';
      const mockFileBuffer = Buffer.from('local ipfs content');
      
      const mockClient = {
        cat: jest.fn().mockImplementation(function* () {
          yield mockFileBuffer;
        })
      };
      ipfsService.client = mockClient;

      const buffer = await ipfsService.getFile('local-cid');

      expect(buffer).toEqual(mockFileBuffer);
      expect(mockClient.cat).toHaveBeenCalledWith('local-cid');
    });
  });

  describe('getGatewayUrl', () => {
    it('should return Pinata gateway URL for pinata provider', () => {
      const url = ipfsService.getGatewayUrl('test-cid');
      expect(url).toBe('https://gateway.pinata.cloud/ipfs/test-cid');
    });

    it('should return Web3.Storage gateway URL for web3storage provider', () => {
      ipfsService.provider = 'web3storage';
      const url = ipfsService.getGatewayUrl('test-cid');
      expect(url).toBe('https://ipfs.io/ipfs/test-cid');
    });

    it('should return local gateway URL for local provider', () => {
      ipfsService.provider = 'local';
      const url = ipfsService.getGatewayUrl('test-cid');
      expect(url).toBe('http://localhost:8080/ipfs/test-cid');
    });

    it('should return default gateway URL for unknown provider', () => {
      ipfsService.provider = 'unknown';
      const url = ipfsService.getGatewayUrl('test-cid');
      expect(url).toBe('https://ipfs.io/ipfs/test-cid');
    });
  });

  describe('verifyFileExists', () => {
    it('should return true when file exists', async () => {
      const axios = require('axios');
      axios.get.mockResolvedValue({
        data: Buffer.from('file content')
      });

      const exists = await ipfsService.verifyFileExists('test-cid');
      expect(exists).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      const axios = require('axios');
      axios.get.mockRejectedValue(new Error('File not found'));

      const exists = await ipfsService.verifyFileExists('test-cid');
      expect(exists).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle unsupported provider', async () => {
      ipfsService.provider = 'unsupported';

      await expect(ipfsService.uploadPdf(mockPdfBuffer, mockLeaseId))
        .rejects.toThrow('Unsupported IPFS provider: unsupported');
    });

    it('should handle network timeouts', async () => {
      const axios = require('axios');
      axios.post.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(ipfsService.uploadPdf(mockPdfBuffer, mockLeaseId))
        .rejects.toThrow('IPFS upload failed: ETIMEDOUT');
    });

    it('should handle API rate limits', async () => {
      const axios = require('axios');
      axios.post.mockRejectedValue(new Error('Rate limit exceeded'));

      await expect(ipfsService.uploadPdf(mockPdfBuffer, mockLeaseId))
        .rejects.toThrow('IPFS upload failed: Rate limit exceeded');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete upload and retrieval cycle', async () => {
      const axios = require('axios');
      
      // Mock upload
      axios.post.mockResolvedValue({
        status: 200,
        data: { IpfsHash: 'integration-test-cid' }
      });

      // Mock retrieval
      axios.get.mockResolvedValue({
        data: mockPdfBuffer
      });

      // Upload
      const cid = await ipfsService.uploadPdf(mockPdfBuffer, mockLeaseId);
      expect(cid).toBe('integration-test-cid');

      // Retrieve
      const retrievedBuffer = await ipfsService.getFile(cid);
      expect(retrievedBuffer).toEqual(mockPdfBuffer);

      // Verify exists
      const exists = await ipfsService.verifyFileExists(cid);
      expect(exists).toBe(true);
    });

    it('should handle large file uploads', async () => {
      const axios = require('axios');
      const largePdfBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
      
      axios.post.mockResolvedValue({
        status: 200,
        data: { IpfsHash: 'large-file-cid' }
      });

      const cid = await ipfsService.uploadPdf(largePdfBuffer, 'large-lease');
      expect(cid).toBe('large-file-cid');
    });
  });
});
