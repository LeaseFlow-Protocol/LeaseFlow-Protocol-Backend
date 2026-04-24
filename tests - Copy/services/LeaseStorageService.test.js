const LeaseStorage = require('../../src/services/Encrypted_IPFS_Lease_Storage');
const { PrivateKey, decrypt } = require('eciesjs');
const crypto = require('crypto');

describe('Encrypted_IPFS_Lease_Storage Service', () => {
    // Generate valid secp256k1 keys for testing
    const tenantPriv = new PrivateKey();
    const tenantPub = tenantPriv.publicKey.toHex();
    
    const landlordPriv = new PrivateKey();
    const landlordPub = landlordPriv.publicKey.toHex();

    const mockPdf = Buffer.from('PDF_CONTENT_%_SENSITIVE_DATA');

    describe('encryptLease', () => {
        it('should correctly encrypt data and make it decryptable by BOTH parties', async () => {
            const { 
                encryptedPdf, 
                encryptedKeyForTenant, 
                encryptedKeyForLandlord 
            } = await LeaseStorage.encryptLease(mockPdf, tenantPub, landlordPub);

            expect(encryptedPdf).not.toEqual(mockPdf);
            expect(encryptedKeyForTenant).not.toBe(encryptedKeyForLandlord);

            // Verify Tenant can decrypt
            const decryptedTenantData = decrypt(tenantPriv.toHex(), Buffer.from(encryptedKeyForTenant, 'hex'));
            const symmetricKeyT = decryptedTenantData.subarray(0, 32);
            const ivT = decryptedTenantData.subarray(32, 48);
            const authTagT = decryptedTenantData.subarray(48);

            const decipherT = crypto.createDecipheriv('aes-256-gcm', symmetricKeyT, ivT);
            decipherT.setAuthTag(authTagT);
            const decryptedPdfT = Buffer.concat([decipherT.update(encryptedPdf), decipherT.final()]);
            expect(decryptedPdfT.toString()).toBe('PDF_CONTENT_%_SENSITIVE_DATA');

            // Verify Landlord can decrypt
            const decryptedLandlordData = decrypt(landlordPriv.toHex(), Buffer.from(encryptedKeyForLandlord, 'hex'));
            const symmetricKeyL = decryptedLandlordData.subarray(0, 32);
            const ivL = decryptedLandlordData.subarray(32, 48);
            const authTagL = decryptedLandlordData.subarray(48);

            const decipherL = crypto.createDecipheriv('aes-256-gcm', symmetricKeyL, ivL);
            decipherL.setAuthTag(authTagL);
            const decryptedPdfL = Buffer.concat([decipherL.update(encryptedPdf), decipherL.final()]);
            expect(decryptedPdfL.toString()).toBe('PDF_CONTENT_%_SENSITIVE_DATA');
        });
    });
});
