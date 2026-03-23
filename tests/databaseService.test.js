const DatabaseService = require('../services/databaseService');

// Mock pg module
jest.mock('pg', () => {
  const mockPool = {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn()
  };
  
  return {
    Pool: jest.fn(() => mockPool)
  };
});

describe('DatabaseService', () => {
  let databaseService;
  let mockPool;

  beforeEach(() => {
    databaseService = new DatabaseService();
    mockPool = require('pg').Pool();
    
    // Reset environment variables
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_NAME = 'test_db';
    process.env.DB_USER = 'test_user';
    process.env.DB_PASSWORD = 'test_password';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize database connection successfully', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
        release: jest.fn()
      };
      
      mockPool.connect.mockResolvedValue(mockClient);
      
      await databaseService.initialize();
      
      expect(databaseService.isInitialized).toBe(true);
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('SELECT NOW()');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw error when connection fails', async () => {
      mockPool.connect.mockRejectedValue(new Error('Connection failed'));
      
      await expect(databaseService.initialize()).rejects.toThrow('Connection failed');
      expect(databaseService.isInitialized).toBe(false);
    });

    it('should use DATABASE_URL when provided', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
      
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
        release: jest.fn()
      };
      
      mockPool.connect.mockResolvedValue(mockClient);
      
      await databaseService.initialize();
      
      const { Pool } = require('pg');
      expect(Pool).toHaveBeenCalledWith({
        connectionString: 'postgresql://user:pass@host:5432/db',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
      });
    });
  });

  describe('getAssetMetadata', () => {
    beforeEach(async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
        release: jest.fn()
      };
      mockPool.connect.mockResolvedValue(mockClient);
      await databaseService.initialize();
    });

    it('should return asset metadata when found', async () => {
      const mockAsset = {
        asset_id: '123',
        name: 'Test Asset',
        description: 'Test Description',
        image_url: 'https://example.com/image.jpg',
        attributes: { trait: 'value' },
        ipfs_hash: 'QmTestHash',
        created_at: new Date('2023-01-01'),
        updated_at: new Date('2023-01-02')
      };

      mockPool.query.mockResolvedValue({ rows: [mockAsset] });

      const result = await databaseService.getAssetMetadata('123');

      expect(result).toEqual({
        assetId: '123',
        name: 'Test Asset',
        description: 'Test Description',
        imageUrl: 'https://example.com/image.jpg',
        attributes: { trait: 'value' },
        ipfsHash: 'QmTestHash',
        createdAt: mockAsset.created_at,
        updatedAt: mockAsset.updated_at
      });
    });

    it('should return null when asset not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await databaseService.getAssetMetadata('999');

      expect(result).toBeNull();
    });

    it('should throw error when query fails', async () => {
      mockPool.query.mockRejectedValue(new Error('Query failed'));

      await expect(databaseService.getAssetMetadata('123')).rejects.toThrow('Query failed');
    });

    it('should throw error when database not initialized', async () => {
      databaseService.isInitialized = false;

      await expect(databaseService.getAssetMetadata('123')).rejects.toThrow('Database not initialized');
    });
  });

  describe('saveAssetMetadata', () => {
    beforeEach(async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
        release: jest.fn()
      };
      mockPool.connect.mockResolvedValue(mockClient);
      await databaseService.initialize();
    });

    it('should save new asset metadata', async () => {
      const mockAsset = {
        asset_id: '123',
        name: 'Test Asset',
        description: 'Test Description',
        image_url: 'https://example.com/image.jpg',
        attributes: { trait: 'value' },
        ipfs_hash: 'QmTestHash',
        created_at: new Date('2023-01-01'),
        updated_at: new Date('2023-01-02')
      };

      mockPool.query.mockResolvedValue({ rows: [mockAsset] });

      const assetData = {
        assetId: '123',
        name: 'Test Asset',
        description: 'Test Description',
        imageUrl: 'https://example.com/image.jpg',
        attributes: { trait: 'value' },
        ipfsHash: 'QmTestHash'
      };

      const result = await databaseService.saveAssetMetadata(assetData);

      expect(result).toEqual({
        assetId: '123',
        name: 'Test Asset',
        description: 'Test Description',
        imageUrl: 'https://example.com/image.jpg',
        attributes: { trait: 'value' },
        ipfsHash: 'QmTestHash',
        createdAt: mockAsset.created_at,
        updatedAt: mockAsset.updated_at
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO assets'),
        [
          '123',
          'Test Asset',
          'Test Description',
          'https://example.com/image.jpg',
          JSON.stringify({ trait: 'value' }),
          'QmTestHash'
        ]
      );
    });

    it('should update existing asset metadata', async () => {
      const mockAsset = {
        asset_id: '123',
        name: 'Updated Asset',
        description: 'Updated Description',
        image_url: 'https://example.com/updated.jpg',
        attributes: { trait: 'updated' },
        ipfs_hash: 'QmUpdatedHash',
        created_at: new Date('2023-01-01'),
        updated_at: new Date('2023-01-02')
      };

      mockPool.query.mockResolvedValue({ rows: [mockAsset] });

      const assetData = {
        assetId: '123',
        name: 'Updated Asset',
        description: 'Updated Description',
        imageUrl: 'https://example.com/updated.jpg',
        attributes: { trait: 'updated' },
        ipfsHash: 'QmUpdatedHash'
      };

      const result = await databaseService.saveAssetMetadata(assetData);

      expect(result.name).toBe('Updated Asset');
      expect(result.description).toBe('Updated Description');
    });
  });

  describe('getMultipleAssetMetadata', () => {
    beforeEach(async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
        release: jest.fn()
      };
      mockPool.connect.mockResolvedValue(mockClient);
      await databaseService.initialize();
    });

    it('should return empty array for empty asset IDs', async () => {
      const result = await databaseService.getMultipleAssetMetadata([]);

      expect(result).toEqual([]);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should return metadata for multiple assets', async () => {
      const mockAssets = [
        {
          asset_id: '123',
          name: 'Asset 1',
          description: 'Description 1',
          image_url: 'https://example.com/image1.jpg',
          attributes: { trait: 'value1' },
          ipfs_hash: 'QmHash1',
          created_at: new Date('2023-01-01'),
          updated_at: new Date('2023-01-02')
        },
        {
          asset_id: '456',
          name: 'Asset 2',
          description: 'Description 2',
          image_url: 'https://example.com/image2.jpg',
          attributes: { trait: 'value2' },
          ipfs_hash: 'QmHash2',
          created_at: new Date('2023-01-01'),
          updated_at: new Date('2023-01-02')
        }
      ];

      mockPool.query.mockResolvedValue({ rows: mockAssets });

      const result = await databaseService.getMultipleAssetMetadata(['123', '456']);

      expect(result).toHaveLength(2);
      expect(result[0].assetId).toBe('123');
      expect(result[1].assetId).toBe('456');
    });
  });

  describe('searchAssets', () => {
    beforeEach(async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
        release: jest.fn()
      };
      mockPool.connect.mockResolvedValue(mockClient);
      await databaseService.initialize();
    });

    it('should search assets by name', async () => {
      const mockAssets = [
        {
          asset_id: '123',
          name: 'Test Asset',
          description: 'Test Description',
          image_url: 'https://example.com/image.jpg',
          attributes: { trait: 'value' },
          ipfs_hash: 'QmTestHash',
          created_at: new Date('2023-01-01'),
          updated_at: new Date('2023-01-02')
        }
      ];

      mockPool.query.mockResolvedValue({ rows: mockAssets });

      const result = await databaseService.searchAssets('Test');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Asset');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE name ILIKE'),
        ['%Test%']
      );
    });

    it('should search assets by description', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await databaseService.searchAssets('Description');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('description ILIKE'),
        ['%Description%']
      );
    });

    it('should limit search results to 50', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await databaseService.searchAssets('test');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 50'),
        ['%test%']
      );
    });
  });

  describe('getDatabaseStats', () => {
    beforeEach(async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
        release: jest.fn()
      };
      mockPool.connect.mockResolvedValue(mockClient);
      await databaseService.initialize();
    });

    it('should return database statistics', async () => {
      const mockStats = {
        total_assets: '100',
        unique_ipfs_hashes: '95',
        avg_name_length: '15.5',
        latest_asset_created: new Date('2023-01-01')
      };

      mockPool.query.mockResolvedValue({ rows: [mockStats] });

      const result = await databaseService.getDatabaseStats();

      expect(result).toEqual({
        totalAssets: 100,
        uniqueIpfsHashes: 95,
        averageNameLength: 15.5,
        latestAssetCreated: mockStats.latest_asset_created
      });
    });
  });

  describe('healthCheck', () => {
    it('should return unhealthy when not initialized', async () => {
      databaseService.isInitialized = false;

      const result = await databaseService.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Database not initialized');
    });

    it('should return healthy when connection works', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
        release: jest.fn()
      };
      mockPool.connect.mockResolvedValue(mockClient);
      await databaseService.initialize();

      mockPool.query.mockResolvedValue({ rows: [{ health_check: 1 }] });

      const result = await databaseService.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.message).toBe('Database connection is working');
    });

    it('should return unhealthy when connection fails', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
        release: jest.fn()
      };
      mockPool.connect.mockResolvedValue(mockClient);
      await databaseService.initialize();

      mockPool.query.mockRejectedValue(new Error('Connection lost'));

      const result = await databaseService.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Connection lost');
    });
  });

  describe('close', () => {
    it('should close the database pool', async () => {
      mockPool.end.mockResolvedValue();

      await databaseService.close();

      expect(mockPool.end).toHaveBeenCalled();
    });

    it('should handle when pool is null', async () => {
      databaseService.pool = null;

      await expect(databaseService.close()).resolves.toBeUndefined();
    });
  });
});
