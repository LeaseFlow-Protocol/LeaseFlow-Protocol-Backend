const DatabaseService = require('./databaseService');
const logger = require('./loggerService');

// Mock Redis for now as it's not in package.json
const mockRedis = {
    cache: new Map(),
    get: async (key) => mockRedis.cache.get(key),
    set: async (key, val, ttl) => {
        mockRedis.cache.set(key, val);
        setTimeout(() => mockRedis.cache.delete(key), ttl * 1000);
    },
    del: async (key) => mockRedis.cache.delete(key)
};

class NftMetadataService {
    constructor() {
        this.db = new DatabaseService();
        this.isInitialized = false;
        this.redis = mockRedis; // In a real app, use require('ioredis')
    }

    async initialize() {
        if (!this.isInitialized) {
            await this.db.initialize();
            this.isInitialized = true;
        }
    }

    /**
     * Retrieves NFT metadata dynamically based on on-chain lease state.
     */
    async getMetadata(contractId, tokenId) {
        const cacheKey = `metadata:${contractId}:${tokenId}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) {
            logger.info(`[NFT Metadata] Cache hit for ${cacheKey}`);
            return JSON.parse(cached);
        }

        await this.initialize();

        // Query the database for the lease associated with this NFT
        // In this protocol, token_id usually maps to lease_id or an asset_id
        const query = `
            SELECT l.*, a.name as asset_name, a.description as asset_desc
            FROM leases l
            LEFT JOIN assets a ON l.id = a.asset_id
            WHERE l.id = $1 OR l.tenant_id = $1 -- Simplified mapping
            LIMIT 1;
        `;
        
        const result = await this.db.pool.query(query, [tokenId]);
        const lease = result.rows[0];

        let metadata;
        if (!lease) {
            // Default "Unlinked" or "Generic" metadata
            metadata = this.generateGenericMetadata(tokenId);
        } else {
            metadata = this.generateLeaseMetadata(lease);
        }

        // Cache for 5 minutes (300 seconds)
        await this.redis.set(cacheKey, JSON.stringify(metadata), 300);
        
        return metadata;
    }

    generateLeaseMetadata(lease) {
        const isActive = lease.status.toUpperCase() === 'ACTIVE';
        const isTerminated = ['TERMINATED', 'DEFAULTED', 'BURNED'].includes(lease.status.toUpperCase());

        return {
            name: `${lease.asset_name || 'LeaseFlow Asset'} #${lease.id}`,
            description: lease.asset_desc || "A cryptographic rental agreement on the LeaseFlow Protocol.",
            image: isActive 
                ? "https://leaseflow.io/assets/active-lease.png" 
                : "https://leaseflow.io/assets/revoked-burned.png",
            external_url: `https://leaseflow.io/leases/${lease.id}`,
            attributes: [
                {
                    trait_type: "Status",
                    value: lease.status
                },
                {
                    trait_type: "Rent Amount",
                    value: lease.rent_amount,
                    display_type: "number"
                },
                {
                    trait_type: "Currency",
                    value: lease.currency
                },
                {
                    trait_type: "Expiration Date",
                    value: lease.end_date,
                    display_type: "date"
                }
            ]
        };
    }

    generateGenericMetadata(tokenId) {
        return {
            name: `LeaseFlow Token #${tokenId}`,
            description: "A LeaseFlow utility NFT with no active lease associated.",
            image: "https://leaseflow.io/assets/inactive-token.png",
            attributes: [
                {
                    trait_type: "Status",
                    value: "Inactive"
                }
            ]
        };
    }

    /**
     * Invalidates the cache for a specific token when state changes.
     */
    async invalidateCache(contractId, tokenId) {
        const cacheKey = `metadata:${contractId}:${tokenId}`;
        await this.redis.del(cacheKey);
        logger.info(`[NFT Metadata] Cache invalidated for ${cacheKey}`);
    }
}

module.exports = new NftMetadataService();
