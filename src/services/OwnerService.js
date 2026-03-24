/**
 * OwnerService handles analytics and retrieval for property owners.
 * In a real-world scenario, this service would fetch historical data from a 
 * blockchain indexer (like Soroban event logs) or a local database.
 */

class OwnerService {
    constructor() {
        // Mock data representing a subset of Indexed Leases
        // Status: 'Draft', 'Active', 'Completed', 'Cancelled'
        this.leases = [
            { id: 'lease-101', owner_id: 'owner-A', status: 'Completed', tenant_id: 'tenant-1' },
            { id: 'lease-102', owner_id: 'owner-B', status: 'Completed', tenant_id: 'tenant-2' },
            { id: 'lease-103', owner_id: 'owner-A', status: 'Completed', tenant_id: 'tenant-3' },
            { id: 'lease-104', owner_id: 'owner-C', status: 'Completed', tenant_id: 'tenant-4' },
            { id: 'lease-105', owner_id: 'owner-B', status: 'Active', tenant_id: 'tenant-5' },
            { id: 'lease-106', owner_id: 'owner-A', status: 'Completed', tenant_id: 'tenant-6' },
            { id: 'lease-107', owner_id: 'owner-D', status: 'Completed', tenant_id: 'tenant-7' },
            { id: 'lease-108', owner_id: 'owner-B', status: 'Completed', tenant_id: 'tenant-8' },
        ];

        // Mock data for Owner profiles
        this.owners = {
            'owner-A': { id: 'owner-A', name: 'Alice Estate', public_key: 'G...A1' },
            'owner-B': { id: 'owner-B', name: 'Bob Properties', public_key: 'G...B2' },
            'owner-C': { id: 'owner-C', name: 'Charlie Homes', public_key: 'G...C3' },
            'owner-D': { id: 'owner-D', name: 'David Rentals', public_key: 'G...D4' },
        };
    }

    /**
     * Retrieves a leaderboard of Owners with the most 'Completed' leases.
     * @param {number} limit - Maximum number of top owners to return.
     * @returns {Array} - List of top owners with their success count.
     */
    async getTopRatedOwners(limit = 5) {
        // 1. Filter for completed leases only
        const completedLeases = this.leases.filter(lease => lease.status === 'Completed');

        // 2. Count completions per owner
        const countsByOwner = {};
        completedLeases.forEach(lease => {
            countsByOwner[lease.owner_id] = (countsByOwner[lease.owner_id] || 0) + 1;
        });

        // 3. Map to owner objects and sort
        const topRated = Object.keys(countsByOwner)
            .map(ownerId => ({
                ...this.owners[ownerId],
                successful_rentals: countsByOwner[ownerId]
            }))
            .sort((a, b) => b.successful_rentals - a.successful_rentals) // Descending
            .slice(0, limit);

        return topRated;
    }
}

module.exports = new OwnerService();
