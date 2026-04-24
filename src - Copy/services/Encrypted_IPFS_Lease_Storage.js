const { encrypt } = require('eciesjs');
const crypto = require('crypto');
require('dotenv').config();

class Encrypted_IPFS_Lease_Storage {
    constructor() {
        this.ipfsClient = null;
    }

    async _getIpfs() {
        if (this.ipfsClient) return this.ipfsClient;
        
        // Dynamically import ESM module in CommonJS
        const { create } = await import('ipfs-http-client');
        
        const host = process.env.IPFS_HOST || 'ipfs.infura.io';
        const port = process.env.IPFS_PORT || 5001;
        const protocol = process.env.IPFS_PROTOCOL || 'https';
        const projectId = process.env.IPFS_PROJECT_ID;
        const projectSecret = process.env.IPFS_PROJECT_SECRET;

        const options = { host, port, protocol };

        if (projectId && projectSecret) {
            const auth = 'Basic ' + Buffer.from(projectId + ':' + projectSecret).toString('base64');
            options.headers = { authorization: auth };
        }

        this.ipfsClient = create(options);
        return this.ipfsClient;
    }

    /**
     * Encrypts the PDF buffer using a generated symmetric key,
     * then encrypts that symmetric key using BOTH tenant and landlord public keys.
     * @param {Buffer} pdfBuffer - Real PDF content
     * @param {string} tenantPubKey - Public key of the tenant (ECIES/secp256k1)
     * @param {string} landlordPubKey - Public key of the landlord (ECIES/secp256k1)
     */
    async encryptLease(pdfBuffer, tenantPubKey, landlordPubKey) {
        // 1. Generate a random 32-byte symmetric key for AES-256
        const symmetricKey = crypto.randomBytes(32);
        const iv = crypto.randomBytes(16);

        // 2. Encrypt the PDF contents with the symmetric key (AES-256-GCM)
        const cipher = crypto.createCipheriv('aes-256-gcm', symmetricKey, iv);
        const encryptedPdf = Buffer.concat([cipher.update(pdfBuffer), cipher.final()]);
        const authTag = cipher.getAuthTag();

        // 3. Encrypt the symmetric key + IV + authTag using Tenant's public key (ECIES)
        // We pack them together into a small buffer for encryption
        const keyData = Buffer.concat([symmetricKey, iv, authTag]);
        
        const encryptedKeyForTenant = encrypt(tenantPubKey, keyData).toString('hex');
        const encryptedKeyForLandlord = encrypt(landlordPubKey, keyData).toString('hex');

        return {
            encryptedPdf,
            encryptedKeyForTenant,
            encryptedKeyForLandlord
        };
    }

    /**
     * Uploads the encrypted data to IPFS and returns the overall Lease CID.
     */
    async storeLease(pdfBuffer, tenantPubKey, landlordPubKey) {
        // 1. Encrypt first
        const { 
            encryptedPdf, 
            encryptedKeyForTenant, 
            encryptedKeyForLandlord 
        } = await this.encryptLease(pdfBuffer, tenantPubKey, landlordPubKey);

        // 2. Upload the encrypted PDF to IPFS
        const ipfs = await this._getIpfs();
        const pdfResult = await ipfs.add(encryptedPdf);
        const pdfCID = pdfResult.path;

        // 3. Create metadata and upload to IPFS
        // This metadata contains the CID of the encrypted file and the encrypted keys for each party.
        const metadata = {
            version: "1.0.0",
            encrypted_file_cid: pdfCID,
            keys: {
                tenant: {
                    public_key: tenantPubKey,
                    encrypted_data: encryptedKeyForTenant
                },
                landlord: {
                    public_key: landlordPubKey,
                    encrypted_data: encryptedKeyForLandlord
                }
            },
            timestamp: new Date().toISOString()
        };

        const metadataResult = await ipfs.add(JSON.stringify(metadata));
        const leaseCID = metadataResult.path;

        return leaseCID;
    }

    /**
     * Retrieves the metadata from IPFS by CID.
     */
    async getLeaseMetadata(leaseCID) {
        const ipfs = await this._getIpfs();
        const stream = ipfs.cat(leaseCID);
        let data = '';
        for await (const chunk of stream) {
            data += chunk.toString();
        }
        return JSON.parse(data);
    }

    /**
     * Facilitates the decryption handshake by providing necessary parts.
     * In a real scenario, this would ensure auth-level access first.
     */
    async getHandshakeData(leaseCID, userPubKey) {
        const metadata = await this.getLeaseMetadata(leaseCID);
        
        // Find which encrypted key to provide
        let encryptedKeyData = null;
        if (metadata.keys.tenant.public_key === userPubKey) {
            encryptedKeyData = metadata.keys.tenant.encrypted_data;
        } else if (metadata.keys.landlord.public_key === userPubKey) {
            encryptedKeyData = metadata.keys.landlord.encrypted_data;
        } else {
            throw new Error("Unauthorized: Public key does not match either lease party.");
        }

        return {
            encrypted_file_cid: metadata.encrypted_file_cid,
            encrypted_symmetric_key: encryptedKeyData
        };
    }
}

module.exports = new Encrypted_IPFS_Lease_Storage();
