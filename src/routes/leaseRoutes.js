const express = require('express');
const router = express.Router();
const multer = require('multer');
const LeaseController = require('../controllers/LeaseController');

// Multer setup (using memory storage for immediate encryption)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Endpoint: Upload new PDF lease
router.post('/upload', upload.single('leaseFile'), (req, res) => LeaseController.uploadLease(req, res));

// Endpoint: Initiate decryption handshake for viewing
router.get('/:leaseCID/handshake', (req, res) => LeaseController.getHandshake(req, res));

module.exports = router;
