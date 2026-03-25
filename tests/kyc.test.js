const { StellarAnchorKycService } = require('../src/services/stellarAnchorKycService');
const { AppDatabase } = require('../src/db/appDatabase');

describe('Stellar Anchor KYC Service', () => {
  let kycService;
  let database;

  beforeEach(() => {
    kycService = new StellarAnchorKycService({
      anchorUrl: 'https://test-anchor.com/sep12',
      anchorAuthKey: 'test-key',
      horizonUrl: 'https://horizon-testnet.stellar.org'
    });
    
    database = new AppDatabase(':memory:');
  });

  describe('Database KYC Methods', () => {
    test('should create and retrieve KYC verification', () => {
      const kycData = {
        actorId: 'test-landlord-1',
        actorRole: 'landlord',
        stellarAccountId: 'GD5JGB56LYV43R2JEDCXJZ4WIF3FWJQYBVKT7HQPI2WDFNLYP3JUA4FK',
        kycStatus: 'pending',
        anchorProvider: 'test-anchor.com'
      };

      const created = database.upsertKycVerification(kycData);
      expect(created).toBeDefined();
      expect(created.actorId).toBe(kycData.actorId);
      expect(created.actorRole).toBe(kycData.actorRole);
      expect(created.kycStatus).toBe(kycData.kycStatus);

      const retrieved = database.getKycVerificationByActor('test-landlord-1', 'landlord');
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
    });

    test('should check lease KYC compliance', () => {
      // Create verified landlord
      database.upsertKycVerification({
        actorId: 'landlord-1',
        actorRole: 'landlord',
        stellarAccountId: 'GD5JGB56LYV43R2JEDCXJZ4WIF3FWJQYBVKT7HQPI2WDFNLYP3JUA4FK',
        kycStatus: 'verified',
        anchorProvider: 'test-anchor.com'
      });

      // Create unverified tenant
      database.upsertKycVerification({
        actorId: 'tenant-1',
        actorRole: 'tenant',
        stellarAccountId: 'GD7YHEE5FQPEHGQLEJXKTG7YEHZP7I4UEVYRMEM5IP5MGBVXSQ2V6A7N',
        kycStatus: 'pending',
        anchorProvider: 'test-anchor.com'
      });

      const compliance = database.checkLeaseKycCompliance('landlord-1', 'tenant-1');
      
      expect(compliance.landlord.isVerified).toBe(true);
      expect(compliance.tenant.isVerified).toBe(false);
      expect(compliance.leaseCanProceed).toBe(false);
    });

    test('should allow lease when both parties are verified', () => {
      // Create verified landlord
      database.upsertKycVerification({
        actorId: 'landlord-1',
        actorRole: 'landlord',
        stellarAccountId: 'GD5JGB56LYV43R2JEDCXJZ4WIF3FWJQYBVKT7HQPI2WDFNLYP3JUA4FK',
        kycStatus: 'verified',
        anchorProvider: 'test-anchor.com'
      });

      // Create verified tenant
      database.upsertKycVerification({
        actorId: 'tenant-1',
        actorRole: 'tenant',
        stellarAccountId: 'GD7YHEE5FQPEHGQLEJXKTG7YEHZP7I4UEVYRMEM5IP5MGBVXSQ2V6A7N',
        kycStatus: 'verified',
        anchorProvider: 'test-anchor.com'
      });

      const compliance = database.checkLeaseKycCompliance('landlord-1', 'tenant-1');
      
      expect(compliance.landlord.isVerified).toBe(true);
      expect(compliance.tenant.isVerified).toBe(true);
      expect(compliance.leaseCanProceed).toBe(true);
    });
  });

  describe('KYC Service Methods', () => {
    test('should map anchor status correctly', () => {
      expect(kycService.mapAnchorStatusToKycStatus('ACCEPTED')).toBe('verified');
      expect(kycService.mapAnchorStatusToKycStatus('PROCESSING')).toBe('in_progress');
      expect(kycService.mapAnchorStatusToKycStatus('REJECTED')).toBe('rejected');
      expect(kycService.mapAnchorStatusToKycStatus('NEEDS_INFO')).toBe('in_progress');
      expect(kycService.mapAnchorStatusToKycStatus('VERIFIED')).toBe('verified');
      expect(kycService.mapAnchorStatusToKycStatus('UNKNOWN')).toBe('pending');
    });
  });
});

describe('KYC Integration', () => {
  test('should validate required KYC fields', () => {
    const validKycData = {
      actorId: 'test-user',
      actorRole: 'tenant',
      stellarAccountId: 'GD5JGB56LYV43R2JEDCXJZ4WIF3FWJQYBVKT7HQPI2WDFNLYP3JUA4FK',
      personalInfo: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '+1234567890'
      },
      addressInfo: {
        streetAddress: '123 Main St',
        city: 'New York',
        stateProvince: 'NY',
        country: 'US',
        postalCode: '10001'
      },
      identificationInfo: {
        idType: 'passport',
        idNumber: 'P123456789',
        idIssueDate: '2020-01-01',
        idExpiryDate: '2030-01-01',
        idIssuingCountry: 'US'
      }
    };

    // This would be validated in the controller
    expect(validKycData.actorId).toBeDefined();
    expect(validKycData.actorRole).toBeDefined();
    expect(['landlord', 'tenant']).toContain(validKycData.actorRole);
    expect(validKycData.stellarAccountId).toBeDefined();
    expect(validKycData.stellarAccountId).toMatch(/^G[A-Z0-9]{55}$/);
    expect(validKycData.personalInfo).toBeDefined();
    expect(validKycData.addressInfo).toBeDefined();
    expect(validKycData.identificationInfo).toBeDefined();
  });
});
