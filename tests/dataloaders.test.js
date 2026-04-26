const DataLoader = require('dataloader');
const { 
  AssetLoader, 
  LesseeLoader, 
  ConditionReportLoader, 
  LeaseLoader,
  RenewalProposalLoader,
  MaintenanceTicketLoader,
  VendorLoader,
  DataLoaderFactory 
} = require('../src/graphql/dataloaders');

describe('DataLoaders Performance Tests', () => {
  let mockDatabase;
  let mockRlsService;

  beforeEach(() => {
    mockDatabase = {
      db: {
        prepare: jest.fn().mockReturnValue({
          all: jest.fn(),
          get: jest.fn(),
          run: jest.fn(),
        }),
      },
    };

    mockRlsService = {
      canAccessActor: jest.fn().mockReturnValue(true),
      canAccessAsset: jest.fn().mockReturnValue(true),
      canAccessLease: jest.fn().mockReturnValue(true),
      getActorFilterClause: jest.fn().mockReturnValue(''),
      getAssetFilterClause: jest.fn().mockReturnValue(''),
      getLeaseFilterClause: jest.fn().mockReturnValue(''),
    };
  });

  describe('AssetLoader Batch Performance', () => {
    it('should execute single query for multiple asset loads', async () => {
      const mockAssets = Array.from({ length: 50 }, (_, i) => ({
        id: `asset${i}`,
        name: `Asset ${i}`,
        type: 'RESIDENTIAL_PROPERTY',
        status: 'AVAILABLE'
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockAssets),
      });

      const loader = new AssetLoader(mockDatabase, mockRlsService);
      
      // Load 50 assets
      const assetIds = Array.from({ length: 50 }, (_, i) => `asset${i}`);
      const startTime = Date.now();
      
      const results = await loader.loadMany(assetIds);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should execute only one database query
      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id IN')
      );
      
      // Should return all results
      expect(results).toHaveLength(50);
      
      // Should complete quickly (under 100ms for in-memory data)
      expect(duration).toBeLessThan(100);
    });

    it('should handle large batches efficiently', async () => {
      const mockAssets = Array.from({ length: 100 }, (_, i) => ({
        id: `asset${i}`,
        name: `Asset ${i}`,
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockAssets),
      });

      const loader = new AssetLoader(mockDatabase, mockRlsService);
      
      // Load 100 assets
      const assetIds = Array.from({ length: 100 }, (_, i) => `asset${i}`);
      const results = await loader.loadMany(assetIds);

      // Should still execute only one query
      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(100);
    });
  });

  describe('LesseeLoader Batch Performance', () => {
    it('should batch load lessees efficiently', async () => {
      const mockLessees = Array.from({ length: 25 }, (_, i) => ({
        id: `lessee${i}`,
        publicKey: `publickey${i}`,
        role: 'LESSEE',
        kycStatus: 'APPROVED'
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockLessees),
      });

      const loader = new LesseeLoader(mockDatabase, mockRlsService);
      
      const lesseeIds = Array.from({ length: 25 }, (_, i) => `lessee${i}`);
      const results = await loader.loadMany(lesseeIds);

      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(25);
      expect(mockDatabase.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id IN')
      );
    });
  });

  describe('ConditionReportLoader Batch Performance', () => {
    it('should batch load condition reports and parse JSON', async () => {
      const mockReports = Array.from({ length: 30 }, (_, i) => ({
        id: `report${i}`,
        leaseId: `lease${i}`,
        reportData: JSON.stringify({ condition: 'GOOD', photos: [`photo${i}.jpg`] }),
        severityTier: 'LOW',
        status: 'SUBMITTED'
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockReports),
      });

      const loader = new ConditionReportLoader(mockDatabase, mockRlsService);
      
      const reportIds = Array.from({ length: 30 }, (_, i) => `report${i}`);
      const results = await loader.loadMany(reportIds);

      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(30);
      
      // Check that JSON was parsed correctly
      results.forEach(report => {
        expect(report.reportData).toBeInstanceOf(Object);
        expect(report.reportData.condition).toBe('GOOD');
      });
    });
  });

  describe('LeaseLoader Batch Performance', () => {
    it('should batch load leases with all fields', async () => {
      const mockLeases = Array.from({ length: 40 }, (_, i) => ({
        id: `lease${i}`,
        landlordId: `landlord${i}`,
        tenantId: `tenant${i}`,
        lessorId: `lessor${i}`,
        status: 'ACTIVE',
        rentAmount: '100000000', // 1 XLM in stroops
        currency: 'XLM',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-12-31T23:59:59.999Z',
        renewable: 1,
        disputed: 0,
        paymentStatus: 'PAID'
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockLeases),
      });

      const loader = new LeaseLoader(mockDatabase, mockRlsService);
      
      const leaseIds = Array.from({ length: 40 }, (_, i) => `lease${i}`);
      const results = await loader.loadMany(leaseIds);

      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(40);
    });
  });

  describe('RenewalProposalLoader Batch Performance', () => {
    it('should batch load renewal proposals and parse JSON fields', async () => {
      const mockProposals = Array.from({ length: 20 }, (_, i) => ({
        id: `proposal${i}`,
        leaseId: `lease${i}`,
        currentTermsSnapshot: JSON.stringify({ rentAmount: '100000000' }),
        proposedTerms: JSON.stringify({ rentAmount: '110000000' }),
        ruleApplied: JSON.stringify({ type: 'PERCENTAGE', value: 10 }),
        status: 'PENDING'
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockProposals),
      });

      const loader = new RenewalProposalLoader(mockDatabase, mockRlsService);
      
      const proposalIds = Array.from({ length: 20 }, (_, i) => `proposal${i}`);
      const results = await loader.loadMany(proposalIds);

      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(20);
      
      // Check that JSON fields were parsed correctly
      results.forEach(proposal => {
        expect(proposal.currentTermsSnapshot).toBeInstanceOf(Object);
        expect(proposal.proposedTerms).toBeInstanceOf(Object);
        expect(proposal.ruleApplied).toBeInstanceOf(Object);
      });
    });
  });

  describe('MaintenanceTicketLoader Batch Performance', () => {
    it('should batch load maintenance tickets and parse arrays', async () => {
      const mockTickets = Array.from({ length: 15 }, (_, i) => ({
        id: `ticket${i}`,
        leaseId: `lease${i}`,
        title: `Maintenance Request ${i}`,
        status: 'OPEN',
        photos: JSON.stringify([`photo1_${i}.jpg`, `photo2_${i}.jpg`]),
        repairPhotos: JSON.stringify([])
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockTickets),
      });

      const loader = new MaintenanceTicketLoader(mockDatabase, mockRlsService);
      
      const ticketIds = Array.from({ length: 15 }, (_, i) => `ticket${i}`);
      const results = await loader.loadMany(ticketIds);

      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(15);
      
      // Check that arrays were parsed correctly
      results.forEach(ticket => {
        expect(ticket.photos).toBeInstanceOf(Array);
        expect(ticket.repairPhotos).toBeInstanceOf(Array);
      });
    });
  });

  describe('VendorLoader Batch Performance', () => {
    it('should batch load vendors and parse specialties array', async () => {
      const mockVendors = Array.from({ length: 10 }, (_, i) => ({
        id: `vendor${i}`,
        name: `Vendor ${i}`,
        email: `vendor${i}@example.com`,
        specialties: JSON.stringify(['PLUMBING', 'ELECTRICAL']),
        kycStatus: 'APPROVED'
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockVendors),
      });

      const loader = new VendorLoader(mockDatabase, mockRlsService);
      
      const vendorIds = Array.from({ length: 10 }, (_, i) => `vendor${i}`);
      const results = await loader.loadMany(vendorIds);

      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(10);
      
      // Check that specialties array was parsed correctly
      results.forEach(vendor => {
        expect(vendor.specialties).toBeInstanceOf(Array);
        expect(vendor.specialties).toContain('PLUMBING');
        expect(vendor.specialties).toContain('ELECTRICAL');
      });
    });
  });

  describe('DataLoaderFactory Integration', () => {
    it('should create all loaders efficiently', () => {
      const factory = new DataLoaderFactory(mockDatabase, mockRlsService);
      const loaders = factory.createLoaders();

      expect(loaders.asset).toBeInstanceOf(AssetLoader);
      expect(loaders.lessee).toBeInstanceOf(LesseeLoader);
      expect(loaders.conditionReport).toBeInstanceOf(ConditionReportLoader);
      expect(loaders.lease).toBeInstanceOf(LeaseLoader);
      expect(loaders.renewalProposal).toBeInstanceOf(RenewalProposalLoader);
      expect(loaders.maintenanceTicket).toBeInstanceOf(MaintenanceTicketLoader);
      expect(loaders.vendor).toBeInstanceOf(VendorLoader);
    });

    it('should clear all loaders', () => {
      const factory = new DataLoaderFactory(mockDatabase, mockRlsService);
      const loaders = factory.createLoaders();

      // Mock clearAll methods
      Object.values(loaders).forEach(loader => {
        loader.clearAll = jest.fn();
      });

      factory.clearAllLoaders(loaders);

      Object.values(loaders).forEach(loader => {
        expect(loader.clearAll).toHaveBeenCalled();
      });
    });
  });

  describe('N+1 Query Prevention', () => {
    it('should prevent N+1 queries when loading nested relationships', async () => {
      // Simulate a GraphQL query that would normally cause N+1 queries
      const mockAssets = Array.from({ length: 10 }, (_, i) => ({
        id: `asset${i}`,
        lessorId: `lessor${i}`,
        name: `Asset ${i}`,
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockAssets),
      });

      const assetLoader = new AssetLoader(mockDatabase, mockRlsService);
      
      // Simulate loading 10 assets in a GraphQL resolver
      const assetIds = Array.from({ length: 10 }, (_, i) => `asset${i}`);
      
      // This should result in only 1 database query, not 10
      const results = await Promise.all(
        assetIds.map(id => assetLoader.load(id))
      );

      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(10);
    });

    it('should cache results to avoid repeated queries', async () => {
      const mockAsset = { id: 'asset1', name: 'Asset 1' };

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([mockAsset]),
      });

      const assetLoader = new AssetLoader(mockDatabase, mockRlsService);
      
      // Load the same asset multiple times
      await assetLoader.load('asset1');
      await assetLoader.load('asset1');
      await assetLoader.load('asset1');

      // Should only query database once due to caching
      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
    });

    it('should handle mixed loads efficiently', async () => {
      const mockAssets = [
        { id: 'asset1', name: 'Asset 1' },
        { id: 'asset2', name: 'Asset 2' },
        { id: 'asset3', name: 'Asset 3' },
      ];

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockAssets),
      });

      const assetLoader = new AssetLoader(mockDatabase, mockRlsService);
      
      // Mix of individual and batch loads
      const [asset1] = await assetLoader.load('asset1');
      const [asset2, asset3] = await assetLoader.loadMany(['asset2', 'asset3']);
      const [asset1Again] = await assetLoader.load('asset1'); // Should use cache

      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
      expect(asset1.name).toBe('Asset 1');
      expect(asset2.name).toBe('Asset 2');
      expect(asset3.name).toBe('Asset 3');
      expect(asset1Again.name).toBe('Asset 1');
    });
  });

  describe('Memory Usage and Performance', () => {
    it('should handle large numbers of cached items efficiently', async () => {
      const mockAssets = Array.from({ length: 1000 }, (_, i) => ({
        id: `asset${i}`,
        name: `Asset ${i}`,
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockAssets),
      });

      const assetLoader = new AssetLoader(mockDatabase, mockRlsService);
      
      // Load 1000 assets
      const assetIds = Array.from({ length: 1000 }, (_, i) => `asset${i}`);
      const startTime = Date.now();
      
      await assetLoader.loadMany(assetIds);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete quickly even with 1000 items
      expect(duration).toBeLessThan(200);
      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(1);
    });

    it('should clear cache to free memory', async () => {
      const mockAssets = Array.from({ length: 100 }, (_, i) => ({
        id: `asset${i}`,
        name: `Asset ${i}`,
      }));

      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockAssets),
      });

      const assetLoader = new AssetLoader(mockDatabase, mockRlsService);
      
      // Load assets to populate cache
      const assetIds = Array.from({ length: 100 }, (_, i) => `asset${i}`);
      await assetLoader.loadMany(assetIds);
      
      // Clear cache
      assetLoader.clearAll();
      
      // Load again should hit database
      await assetLoader.loadMany(assetIds);
      
      expect(mockDatabase.db.prepare).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockRejectedValue(new Error('Database connection failed')),
      });

      const assetLoader = new AssetLoader(mockDatabase, mockRlsService);
      
      await expect(assetLoader.loadMany(['asset1', 'asset2'])).rejects.toThrow('Database connection failed');
    });

    it('should handle missing items gracefully', async () => {
      mockDatabase.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'asset1', name: 'Asset 1' },
          // asset2 is missing
        ]),
      });

      const assetLoader = new AssetLoader(mockDatabase, mockRlsService);
      
      const results = await assetLoader.loadMany(['asset1', 'asset2']);
      
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: 'asset1', name: 'Asset 1' });
      expect(results[1]).toBeNull(); // Missing asset should be null
    });
  });
});
