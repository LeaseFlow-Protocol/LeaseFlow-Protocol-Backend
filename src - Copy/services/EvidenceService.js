const crypto = require('crypto');
const sharp = require('sharp');
const DatabaseService = require('./databaseService');
const logger = require('./loggerService');

class EvidenceService {
    constructor() {
        this.db = new DatabaseService();
        this.isInitialized = false;
        this.s3Bucket = 'leaseflow-private-evidence';
    }

    async initialize() {
        if (!this.isInitialized) {
            await this.db.initialize();
            this.isInitialized = true;
        }
    }

    /**
     * Scans file for malware (mock implementation)
     */
    async scanForMalware(buffer) {
        // In a real implementation, we would call an external API or use a library like clamdjs
        logger.info('Scanning file for malware...');
        // Simulate scanning delay
        await new Promise(resolve => setTimeout(resolve, 100));
        return true; // Assume clean
    }

    /**
     * Compresses image to save space
     */
    async compressImage(buffer, fileType) {
        if (!fileType.startsWith('image/')) return buffer;
        
        logger.info('Compressing image...');
        return await sharp(buffer)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
    }

    /**
     * Generates SHA-256 hash
     */
    generateHash(buffer) {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    /**
     * Mocks S3 upload and returns a key
     */
    async uploadToS3(buffer, fileName, disputeId) {
        const key = `disputes/${disputeId}/${Date.now()}_${fileName}`;
        logger.info(`[S3 Mock] Uploaded ${fileName} to ${this.s3Bucket}/${key}`);
        return key;
    }

    /**
     * Generates an expiring signed URL for S3 (Mock)
     */
    async getSignedUrl(s3Key) {
        // In real life, use AWS SDK: s3.getSignedUrl('getObject', { Bucket, Key, Expires: 3600 })
        const expiration = Math.floor(Date.now() / 1000) + 3600;
        return `https://${this.s3Bucket}.s3.amazonaws.com/${s3Key}?X-Amz-Signature=mock_sig&Expires=${expiration}`;
    }

    /**
     * Stores evidence metadata and file
     */
    async storeEvidence(disputeId, uploaderId, file) {
        await this.initialize();

        // 1. Malware Scan
        const isClean = await this.scanForMalware(file.buffer);
        if (!isClean) throw new Error('Malware detected in uploaded file.');

        // 2. Compress (if image)
        const processedBuffer = await this.compressImage(file.buffer, file.mimetype);
        
        // 3. Hash
        const hash = this.generateHash(processedBuffer);

        // 4. Upload to S3 (Mock)
        const s3Key = await this.uploadToS3(processedBuffer, file.originalname, disputeId);

        // 5. Save to DB
        const query = `
            INSERT INTO dispute_evidence (
                dispute_id, uploader_id, file_name, file_type, file_size, s3_key, file_hash, is_malware_scanned
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *;
        `;
        
        const result = await this.db.pool.query(query, [
            disputeId, uploaderId, file.originalname, file.mimetype, 
            processedBuffer.length, s3Key, hash, true
        ]);

        return result.rows[0];
    }

    /**
     * Gets all evidence for a specific dispute
     */
    async getJuryPacket(disputeId) {
        await this.initialize();

        const query = `
            SELECT * FROM dispute_evidence WHERE dispute_id = $1 ORDER BY created_at ASC;
        `;
        
        const result = await this.db.pool.query(query, [disputeId]);
        
        const evidenceWithUrls = await Promise.all(result.rows.map(async (item) => {
            return {
                ...item,
                signedUrl: await this.getSignedUrl(item.s3_key)
            };
        }));

        return {
            disputeId,
            evidenceCount: evidenceWithUrls.length,
            evidence: evidenceWithUrls
        };
    }
}

module.exports = new EvidenceService();
