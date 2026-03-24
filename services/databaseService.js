const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

class DatabaseService {
  constructor() {
    this.pool = null;
    this.isInitialized = false;
  }

  async initialize() {
    require('dotenv').config();
    
    const connectionString = process.env.DATABASE_URL || 
      `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME}`;
    
    this.pool = new Pool({
      connectionString,
      max: 20, // Maximum number of connections in the pool
      idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
      connectionTimeoutMillis: 2000, // How long to wait when connecting a new client
    });

    try {
      // Test the connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      console.log('Database connection established successfully');
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async runMigrations() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const migrationsDir = path.join(__dirname, '../migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    console.log('Running database migrations...');
    
    for (const file of migrationFiles) {
      try {
        const migrationPath = path.join(migrationsDir, file);
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        
        await this.pool.query(migrationSQL);
        console.log(`Migration ${file} completed successfully`);
      } catch (error) {
        // Ignore "already exists" errors for migrations
        if (!error.message.includes('already exists')) {
          console.error(`Migration ${file} failed:`, error);
          throw error;
        }
      }
    }
    
    console.log('All migrations completed');
  }

  async getAssetMetadata(assetId) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT asset_id, name, description, image_url, attributes, ipfs_hash, created_at, updated_at
      FROM assets
      WHERE asset_id = $1
    `;
    
    try {
      const result = await this.pool.query(query, [assetId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        assetId: row.asset_id,
        name: row.name,
        description: row.description,
        imageUrl: row.image_url,
        attributes: row.attributes,
        ipfsHash: row.ipfs_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      console.error(`Error fetching asset metadata for ${assetId}:`, error);
      throw error;
    }
  }

  async saveAssetMetadata(assetData) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const {
      assetId,
      name,
      description,
      imageUrl,
      attributes,
      ipfsHash
    } = assetData;

    const query = `
      INSERT INTO assets (asset_id, name, description, image_url, attributes, ipfs_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (asset_id) 
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        image_url = EXCLUDED.image_url,
        attributes = EXCLUDED.attributes,
        ipfs_hash = EXCLUDED.ipfs_hash,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [
        assetId,
        name,
        description,
        imageUrl,
        JSON.stringify(attributes),
        ipfsHash
      ]);

      const row = result.rows[0];
      return {
        assetId: row.asset_id,
        name: row.name,
        description: row.description,
        imageUrl: row.image_url,
        attributes: row.attributes,
        ipfsHash: row.ipfs_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      console.error(`Error saving asset metadata for ${assetId}:`, error);
      throw error;
    }
  }

  async getMultipleAssetMetadata(assetIds) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    if (assetIds.length === 0) {
      return [];
    }

    const query = `
      SELECT asset_id, name, description, image_url, attributes, ipfs_hash, created_at, updated_at
      FROM assets
      WHERE asset_id = ANY($1)
      ORDER BY asset_id
    `;

    try {
      const result = await this.pool.query(query, [assetIds]);
      
      return result.rows.map(row => ({
        assetId: row.asset_id,
        name: row.name,
        description: row.description,
        imageUrl: row.image_url,
        attributes: row.attributes,
        ipfsHash: row.ipfs_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      console.error('Error fetching multiple asset metadata:', error);
      throw error;
    }
  }

  async getAllAssetMetadata() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT asset_id, name, description, image_url, attributes, ipfs_hash, created_at, updated_at
      FROM assets
      ORDER BY created_at DESC
    `;

    try {
      const result = await this.pool.query(query);
      
      return result.rows.map(row => ({
        assetId: row.asset_id,
        name: row.name,
        description: row.description,
        imageUrl: row.image_url,
        attributes: row.attributes,
        ipfsHash: row.ipfs_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      console.error('Error fetching all asset metadata:', error);
      throw error;
    }
  }

  async deleteAssetMetadata(assetId) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const query = 'DELETE FROM assets WHERE asset_id = $1 RETURNING *';

    try {
      const result = await this.pool.query(query, [assetId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        assetId: row.asset_id,
        name: row.name,
        description: row.description,
        imageUrl: row.image_url,
        attributes: row.attributes,
        ipfsHash: row.ipfs_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      console.error(`Error deleting asset metadata for ${assetId}:`, error);
      throw error;
    }
  }

  async searchAssets(searchTerm) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT asset_id, name, description, image_url, attributes, ipfs_hash, created_at, updated_at
      FROM assets
      WHERE 
        name ILIKE $1 OR 
        description ILIKE $1 OR
        asset_id ILIKE $1
      ORDER BY 
        CASE 
          WHEN name ILIKE $1 THEN 1
          WHEN asset_id ILIKE $1 THEN 2
          ELSE 3
        END,
        created_at DESC
      LIMIT 50
    `;

    try {
      const result = await this.pool.query(query, [`%${searchTerm}%`]);
      
      return result.rows.map(row => ({
        assetId: row.asset_id,
        name: row.name,
        description: row.description,
        imageUrl: row.image_url,
        attributes: row.attributes,
        ipfsHash: row.ipfs_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      console.error(`Error searching assets with term "${searchTerm}":`, error);
      throw error;
    }
  }

  async getDatabaseStats() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    const query = `
      SELECT 
        COUNT(*) as total_assets,
        COUNT(DISTINCT ipfs_hash) as unique_ipfs_hashes,
        AVG(LENGTH(name)) as avg_name_length,
        MAX(created_at) as latest_asset_created
      FROM assets
    `;

    try {
      const result = await this.pool.query(query);
      const stats = result.rows[0];
      
      return {
        totalAssets: parseInt(stats.total_assets),
        uniqueIpfsHashes: parseInt(stats.unique_ipfs_hashes),
        averageNameLength: Math.round(stats.avg_name_length * 100) / 100,
        latestAssetCreated: stats.latest_asset_created
      };
    } catch (error) {
      console.error('Error fetching database stats:', error);
      throw error;
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('Database connection pool closed');
    }
  }

  async healthCheck() {
    if (!this.isInitialized) {
      return { status: 'unhealthy', message: 'Database not initialized' };
    }

    try {
      const result = await this.pool.query('SELECT 1 as health_check');
      return { 
        status: 'healthy', 
        message: 'Database connection is working',
        totalCount: result.rows[0].health_check
      };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        message: error.message 
      };
    }
  }
}

module.exports = DatabaseService;
