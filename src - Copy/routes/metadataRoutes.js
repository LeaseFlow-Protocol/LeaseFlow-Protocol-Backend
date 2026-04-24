const express = require('express');
const router = express.Router();
const NftMetadataService = require('../services/NftMetadataService');

/**
 * @openapi
 * /api/v1/metadata/{contract}/{token_id}:
 *   get:
 *     summary: Retrieve dynamic NFT metadata
 *     description: Returns JSON metadata compliant with OpenSea/StellarX standards.
 *     tags: [NFT]
 */
router.get('/:contract/:token_id', async (req, res) => {
    try {
        const { contract, token_id } = req.params;
        const metadata = await NftMetadataService.getMetadata(contract, token_id);
        return res.status(200).json(metadata);
    } catch (error) {
        console.error('[Metadata] Error:', error);
        return res.status(500).json({ error: 'Failed to fetch metadata.' });
    }
});

module.exports = router;
