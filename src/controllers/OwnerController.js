const OwnerService = require('../services/OwnerService');

class OwnerController {
    /**
     * Retrieves the top-rated owners based on completed lease counts.
     * @route GET /api/owners/top
     */
    async getTopRated(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 10;
            const topOwners = await OwnerService.getTopRatedOwners(limit);

            console.log(`[OwnerController] Found ${topOwners.length} top-rated owners.`);

            return res.status(200).json({
                status: 'success',
                message: 'Top-rated owners retrieved successfully.',
                data: topOwners
            });
        } catch (error) {
            console.error('[OwnerController] Error fetching top owners:', error);
            return res.status(500).json({ error: 'Internal server error while retrieving top owners.', details: error.message });
        }
    }
}

module.exports = new OwnerController();
