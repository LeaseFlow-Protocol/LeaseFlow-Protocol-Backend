const express = require('express');
const router = express.Router();
const multer = require('multer');
const DisputeController = require('../controllers/DisputeController');

// Multer setup for multi-part form data
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 10 * 1024 * 1024, // 10MB limit per file
        files: 5 // Limit to 5 files per request for rate limiting protection
    }
});

/**
 * @openapi
 * /api/v1/disputes/{id}/evidence:
 *   post:
 *     summary: Upload evidence for a dispute
 *     description: Accepts images/PDFs, scans for malware, and stores them in a private bucket.
 *     tags: [Disputes]
 */
router.post('/:id/evidence', upload.single('evidence'), (req, res) => DisputeController.uploadEvidence(req, res));

/**
 * @openapi
 * /api/v1/disputes/{id}/jury-packet:
 *   get:
 *     summary: Retrieve jury packet
 *     description: Returns all evidence for a dispute with expiring signed URLs.
 *     tags: [Disputes]
 */
router.get('/:id/jury-packet', (req, res) => DisputeController.getJuryPacket(req, res));

module.exports = router;
