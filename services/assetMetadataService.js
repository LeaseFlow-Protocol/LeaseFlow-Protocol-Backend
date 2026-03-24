const DatabaseService = require('./databaseService');

class AssetMetadataService {
  constructor() {
    this.databaseService = new DatabaseService();
    this.ipfsCache = new Map(); // In-memory cache for frequently accessed IPFS data
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache timeout
  }

  async initialize() {
    await this.databaseService.initialize();
    await this.databaseService.runMigrations();
    console.log('AssetMetadataService initialized');
  }

  async getAssetMetadata(assetId, forceRefresh = false) {
    try {
      // First, try to get from database cache
      if (!forceRefresh) {
        const cachedMetadata = await this.databaseService.getAssetMetadata(assetId);
        if (cachedMetadata) {
          console.log(`Asset ${assetId} metadata found in database cache`);
          return cachedMetadata;
        }
      }

      // If not in cache, fetch from IPFS (simulated - in real implementation, you'd use IPFS client)
      const ipfsMetadata = await this.fetchFromIPFS(assetId);
      
      if (ipfsMetadata) {
        // Cache in database
        await this.databaseService.saveAssetMetadata({
          assetId,
          ...ipfsMetadata
        });
        
        console.log(`Asset ${assetId} metadata fetched from IPFS and cached`);
        return { assetId, ...ipfsMetadata };
      }

      return null;
    } catch (error) {
      console.error(`Error getting asset metadata for ${assetId}:`, error);
      throw error;
    }
  }

  async getMultipleAssetMetadata(assetIds, forceRefresh = false) {
    try {
      const results = [];
      const uncachedAssetIds = [];

      if (!forceRefresh) {
        // Get cached metadata first
        const cachedMetadata = await this.databaseService.getMultipleAssetMetadata(assetIds);
        const cachedAssetIds = cachedMetadata.map(asset => asset.assetId);
        
        results.push(...cachedMetadata);
        
        // Find assets that need to be fetched from IPFS
        uncachedAssetIds.push(...assetIds.filter(id => !cachedAssetIds.includes(id)));
      } else {
        uncachedAssetIds.push(...assetIds);
      }

      // Fetch uncached assets from IPFS
      for (const assetId of uncachedAssetIds) {
        try {
          const ipfsMetadata = await this.fetchFromIPFS(assetId);
          if (ipfsMetadata) {
            const fullMetadata = { assetId, ...ipfsMetadata };
            results.push(fullMetadata);
            
            // Cache in database
            await this.databaseService.saveAssetMetadata(fullMetadata);
          }
        } catch (error) {
          console.error(`Error fetching metadata for asset ${assetId}:`, error);
        }
      }

      return results;
    } catch (error) {
      console.error('Error getting multiple asset metadata:', error);
      throw error;
    }
  }

  async fetchFromIPFS(assetId) {
    // Check in-memory cache first
    const cacheKey = `ipfs_${assetId}`;
    const cached = this.ipfsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    // Simulate IPFS fetch - in real implementation, you'd use an IPFS client
    // This is a mock implementation for demonstration
    const mockIPFSData = await this.mockIPFSCall(assetId);
    
    if (mockIPFSData) {
      // Cache in memory
      this.ipfsCache.set(cacheKey, {
        data: mockIPFSData,
        timestamp: Date.now()
      });
    }

    return mockIPFSData;
  }

  async mockIPFSCall(assetId) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));

    // Mock IPFS data structure
    const mockData = {
      [`asset_${assetId}`]: {
        name: `Asset ${assetId}`,
        description: `Description for asset ${assetId}`,
        image: `https://example.com/asset${assetId}.jpg`,
        attributes: [
          {
            trait_type: 'Rarity',
            value: 'Common'
          },
          {
            trait_type: 'Type',
            value: 'Digital Asset'
          }
        ]
      }
    };

    // Simulate occasional IPFS failures
    if (Math.random() < 0.1) { // 10% chance of failure
      throw new Error('IPFS network error');
    }

    const assetData = mockData[`asset_${assetId}`];
    if (!assetData) {
      return null;
    }

    return {
      name: assetData.name,
      description: assetData.description,
      imageUrl: assetData.image,
      attributes: assetData.attributes,
      ipfsHash: `Qm${assetId}Hash` // Mock IPFS hash
    };
  }

  async saveAssetMetadata(assetData) {
    try {
      const result = await this.databaseService.saveAssetMetadata(assetData);
      
      // Update in-memory cache
      const cacheKey = `ipfs_${assetData.assetId}`;
      this.ipfsCache.set(cacheKey, {
        data: {
          name: assetData.name,
          description: assetData.description,
          imageUrl: assetData.imageUrl,
          attributes: assetData.attributes
        },
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      console.error('Error saving asset metadata:', error);
      throw error;
    }
  }

  async updateAssetMetadata(assetId, updates) {
    try {
      // Get existing metadata
      const existing = await this.getAssetMetadata(assetId);
      if (!existing) {
        throw new Error(`Asset ${assetId} not found`);
      }

      // Merge updates
      const updatedMetadata = { ...existing, ...updates };
      
      // Save to database
      return await this.databaseService.saveAssetMetadata(updatedMetadata);
    } catch (error) {
      console.error(`Error updating asset metadata for ${assetId}:`, error);
      throw error;
    }
  }

  async deleteAssetMetadata(assetId) {
    try {
      const result = await this.databaseService.deleteAssetMetadata(assetId);
      
      // Remove from in-memory cache
      const cacheKey = `ipfs_${assetId}`;
      this.ipfsCache.delete(cacheKey);
      
      return result;
    } catch (error) {
      console.error(`Error deleting asset metadata for ${assetId}:`, error);
      throw error;
    }
  }

  async searchAssets(searchTerm) {
    try {
      return await this.databaseService.searchAssets(searchTerm);
    } catch (error) {
      console.error(`Error searching assets with term "${searchTerm}":`, error);
      throw error;
    }
  }

  async getAllAssetMetadata() {
    try {
      return await this.databaseService.getAllAssetMetadata();
    } catch (error) {
      console.error('Error getting all asset metadata:', error);
      throw error;
    }
  }

  async refreshAssetCache(assetId) {
    try {
      // Force refresh from IPFS
      return await this.getAssetMetadata(assetId, true);
    } catch (error) {
      console.error(`Error refreshing cache for asset ${assetId}:`, error);
      throw error;
    }
  }

  async getCacheStatistics() {
    try {
      const dbStats = await this.databaseService.getDatabaseStats();
      const memoryCacheSize = this.ipfsCache.size;
      
      return {
        database: dbStats,
        memoryCache: {
          size: memoryCacheSize,
          timeoutMinutes: this.cacheTimeout / (60 * 1000)
        }
      };
    } catch (error) {
      console.error('Error getting cache statistics:', error);
      throw error;
    }
  }

  clearMemoryCache() {
    this.ipfsCache.clear();
    console.log('Memory cache cleared');
  }

  async healthCheck() {
    try {
      const dbHealth = await this.databaseService.healthCheck();
      
      return {
        status: dbHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
        database: dbHealth,
        memoryCache: {
          size: this.ipfsCache.size,
          timeoutMinutes: this.cacheTimeout / (60 * 1000)
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  async close() {
    await this.databaseService.close();
    this.ipfsCache.clear();
    console.log('AssetMetadataService closed');
  }
}

module.exports = AssetMetadataService;
