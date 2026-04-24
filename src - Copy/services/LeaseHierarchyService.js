const DatabaseService = require('./databaseService');
const logger = require('./loggerService');

class LeaseHierarchyService {
    constructor() {
        this.db = new DatabaseService();
        this.isInitialized = false;
    }

    async initialize() {
        if (!this.isInitialized) {
            await this.db.initialize();
            this.isInitialized = true;
        }
    }

    /**
     * Fetches a deep hierarchy of subleases using a recursive CTE.
     * @param {string} leaseId The root lease ID to start from.
     * @returns {Promise<Object>} A nested JSON tree of active subleases.
     */
    async getLeaseHierarchy(leaseId) {
        await this.initialize();
        
        const query = `
            WITH RECURSIVE lease_tree AS (
                -- Base case: the starting lease
                SELECT 
                    id, landlord_id, tenant_id, status, rent_amount, currency, 
                    start_date, end_date, parent_lease_id, 
                    0 as depth
                FROM leases
                WHERE id = $1

                UNION ALL

                -- Recursive step: find all child subleases
                SELECT 
                    l.id, l.landlord_id, l.tenant_id, l.status, l.rent_amount, l.currency, 
                    l.start_date, l.end_date, l.parent_lease_id, 
                    lt.depth + 1
                FROM leases l
                INNER JOIN lease_tree lt ON l.parent_lease_id = lt.id
                WHERE l.status = 'ACTIVE' OR l.status = 'active'
            )
            SELECT * FROM lease_tree ORDER BY depth, id;
        `;

        try {
            const start = Date.now();
            const result = await this.db.pool.query(query, [leaseId]);
            const duration = Date.now() - start;
            
            logger.info(`Hierarchy fetch for ${leaseId} took ${duration}ms`);

            if (result.rows.length === 0) return null;

            return this.buildNestedTree(result.rows, leaseId);
        } catch (error) {
            logger.error(`Error fetching lease hierarchy for ${leaseId}:`, error);
            throw error;
        }
    }

    /**
     * Builds a nested JSON structure from flat database rows.
     */
    buildNestedTree(rows, rootId) {
        const map = {};
        rows.forEach(row => {
            map[row.id] = { 
                id: row.id,
                landlordId: row.landlord_id,
                tenantId: row.tenant_id,
                status: row.status,
                rentAmount: row.rent_amount,
                currency: row.currency,
                startDate: row.start_date,
                endDate: row.end_date,
                depth: row.depth,
                children: [] 
            };
        });

        let root = null;
        rows.forEach(row => {
            if (row.parent_lease_id && map[row.parent_lease_id]) {
                map[row.parent_lease_id].children.push(map[row.id]);
            }
            if (row.id === rootId) {
                root = map[row.id];
            }
        });

        return root;
    }

    /**
     * Processes a SubleaseCreated event.
     */
    async handleSubleaseCreated(eventData) {
        await this.initialize();
        const { leaseId, parentLeaseId, tenantId, landlordId, rentAmount, currency, startDate, endDate } = eventData;

        const query = `
            INSERT INTO leases (
                id, parent_lease_id, tenant_id, landlord_id, status, 
                rent_amount, currency, start_date, end_date, updated_at
            )
            VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, $8, NOW())
            ON CONFLICT (id) DO UPDATE SET 
                parent_lease_id = EXCLUDED.parent_lease_id,
                status = 'ACTIVE',
                updated_at = NOW();
        `;

        try {
            await this.db.pool.query(query, [
                leaseId, parentLeaseId, tenantId, landlordId, 
                rentAmount || 0, currency || 'XLM', 
                startDate || new Date(), endDate || new Date()
            ]);
            logger.info(`Sublease ${leaseId} indexed (Parent: ${parentLeaseId})`);
        } catch (error) {
            logger.error(`Failed to index SubleaseCreated for ${leaseId}:`, error);
            throw error;
        }
    }

    /**
     * Processes a DerivedHierarchyBurned event - cascades termination.
     */
    async handleDerivedHierarchyBurned(rootLeaseId) {
        await this.initialize();

        const query = `
            WITH RECURSIVE lease_tree AS (
                SELECT id FROM leases WHERE id = $1
                UNION ALL
                SELECT l.id FROM leases l INNER JOIN lease_tree lt ON l.parent_lease_id = lt.id
            )
            UPDATE leases 
            SET status = 'TERMINATED', updated_at = NOW() 
            WHERE id IN (SELECT id FROM lease_tree);
        `;

        try {
            const result = await this.db.pool.query(query, [rootLeaseId]);
            logger.info(`Cascaded termination for hierarchy starting at ${rootLeaseId}. Affected: ${result.rowCount} leases.`);
        } catch (error) {
            logger.error(`Failed to cascade termination for ${rootLeaseId}:`, error);
            throw error;
        }
    }
}

module.exports = new LeaseHierarchyService();
