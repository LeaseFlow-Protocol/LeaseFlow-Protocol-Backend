const RwaAdapterRegistry = require('../../src/services/rwa/rwaAdapterRegistry');
const StellarAssetAdapter = require('../../src/services/rwa/stellarAssetAdapter');
const TokenizedRealtyAdapter = require('../../src/services/rwa/tokenizedRealtyAdapter');
const VehicleRegistryAdapter = require('../../src/services/rwa/vehicleRegistryAdapter');

// Mock adapters
jest.mock('../../src/services/rwa/stellarAssetAdapter');
jest.mock('../../src/services/rwa/tokenizedRealtyAdapter');
jest.mock('../../src/services/rwa/vehicleRegistryAdapter');

describe('RwaAdapterRegistry', () => {
  let registry;
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      network: 'testnet',
      redis: {
        host: 'localhost',
        port: 6379
      }
    };

    // Mock adapter instances
    const mockStellarAdapter = {
      getStandard: jest.fn().mockReturnValue('stellar-asset'),
      parseTransferEvents: jest.fn(),
      queryAssetOwnership: jest.fn(),
      validateContractAddress: jest.fn(),
      isAssetFrozen: jest.fn(),
      isAssetBurned: jest.fn(),
      getAssetType: jest.fn()
    };

    const mockRealtyAdapter = {
      getStandard: jest.fn().mockReturnValue('tokenized-realty'),
      parseTransferEvents: jest.fn(),
      queryAssetOwnership: jest.fn(),
      validateContractAddress: jest.fn(),
      isAssetFrozen: jest.fn(),
      isAssetBurned: jest.fn(),
      getAssetType: jest.fn()
    };

    const mockVehicleAdapter = {
      getStandard: jest.fn().mockReturnValue('vehicle-registry'),
      parseTransferEvents: jest.fn(),
      queryAssetOwnership: jest.fn(),
      validateContractAddress: jest.fn(),
      isAssetFrozen: jest.fn(),
      isAssetBurned: jest.fn(),
      getAssetType: jest.fn()
    };

    StellarAssetAdapter.mockImplementation(() => mockStellarAdapter);
    TokenizedRealtyAdapter.mockImplementation(() => mockRealtyAdapter);
    VehicleRegistryAdapter.mockImplementation(() => mockVehicleAdapter);

    registry = new RwaAdapterRegistry(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with all adapters', () => {
      expect(registry.adapters.size).toBe(3);
      expect(registry.getSupportedStandards()).toContain('stellar-asset');
      expect(registry.getSupportedStandards()).toContain('tokenized-realty');
      expect(registry.getSupportedStandards()).toContain('vehicle-registry');
    });

    it('should validate adapters during registration', () => {
      const invalidAdapter = {
        // Missing required methods
      };

      expect(() => {
        registry.registerAdapter('invalid', invalidAdapter);
      }).toThrow('Adapter must implement getStandard() method');
    });
  });

  describe('registerAdapter', () => {
    it('should register a valid adapter', () => {
      const customAdapter = {
        getStandard: jest.fn().mockReturnValue('custom'),
        parseTransferEvents: jest.fn(),
        queryAssetOwnership: jest.fn(),
        validateContractAddress: jest.fn(),
        isAssetFrozen: jest.fn(),
        isAssetBurned: jest.fn(),
        getAssetType: jest.fn()
      };

      registry.registerAdapter('custom', customAdapter);

      expect(registry.getAdapter('custom')).toBe(customAdapter);
      expect(registry.getSupportedStandards()).toContain('custom');
    });

    it('should throw error for invalid adapter', () => {
      const invalidAdapter = {
        getStandard: jest.fn(),
        // Missing other required methods
      };

      expect(() => {
        registry.registerAdapter('invalid', invalidAdapter);
      }).toThrow('Adapter must implement parseTransferEvents() method');
    });
  });

  describe('getAdapter', () => {
    it('should return adapter for supported standard', () => {
      const adapter = registry.getAdapter('stellar-asset');
      expect(adapter).toBeDefined();
      expect(adapter.getStandard()).toBe('stellar-asset');
    });

    it('should return null for unsupported standard', () => {
      const adapter = registry.getAdapter('unsupported');
      expect(adapter).toBeNull();
    });
  });

  describe('getAllAdapters', () => {
    it('should return all adapters', () => {
      const adapters = registry.getAllAdapters();
      expect(adapters.size).toBe(3);
      expect(adapters.has('stellar-asset')).toBe(true);
      expect(adapters.has('tokenized-realty')).toBe(true);
      expect(adapters.has('vehicle-registry')).toBe(true);
    });
  });

  describe('getSupportedStandards', () => {
    it('should return array of supported standards', () => {
      const standards = registry.getSupportedStandards();
      expect(standards).toHaveLength(3);
      expect(standards).toContain('stellar-asset');
      expect(standards).toContain('tokenized-realty');
      expect(standards).toContain('vehicle-registry');
    });
  });

  describe('isStandardSupported', () => {
    it('should return true for supported standard', () => {
      expect(registry.isStandardSupported('stellar-asset')).toBe(true);
    });

    it('should return false for unsupported standard', () => {
      expect(registry.isStandardSupported('unsupported')).toBe(false);
    });
  });

  describe('getAdapterForContract', () => {
    it('should return adapter for contract', async () => {
      const mockDatabase = {
        db: {
          prepare: jest.fn().mockReturnValue({
            get: jest.fn().mockReturnValue({
              rwa_standard: 'stellar-asset'
            })
          })
        }
      };

      const adapter = await registry.getAdapterForContract('GBL...CONTRACT1', mockDatabase);
      expect(adapter).toBeDefined();
      expect(adapter.getStandard()).toBe('stellar-asset');
    });

    it('should return null for non-existent contract', async () => {
      const mockDatabase = {
        db: {
          prepare: jest.fn().mockReturnValue({
            get: jest.fn().mockReturnValue(null)
          })
        }
      };

      const adapter = await registry.getAdapterForContract('GBL...NONEXISTENT', mockDatabase);
      expect(adapter).toBeNull();
    });

    it('should return null for inactive contract', async () => {
      const mockDatabase = {
        db: {
          prepare: jest.fn().mockReturnValue({
            get: jest.fn().mockReturnValue({
              rwa_standard: 'stellar-asset',
              is_active: 0
            })
          })
        }
      };

      const adapter = await registry.getAdapterForContract('GBL...INACTIVE', mockDatabase);
      expect(adapter).toBeNull();
    });
  });

  describe('validateContractAddress', () => {
    it('should validate contract address with correct adapter', () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.validateContractAddress.mockReturnValue(true);

      const result = registry.validateContractAddress('GBL...VALID', 'stellar-asset');
      expect(result).toBe(true);
      expect(stellarAdapter.validateContractAddress).toHaveBeenCalledWith('GBL...VALID');
    });

    it('should return false for unsupported standard', () => {
      const result = registry.validateContractAddress('GBL...VALID', 'unsupported');
      expect(result).toBe(false);
    });
  });

  describe('parseTransferEvents', () => {
    it('should parse events with correct adapter', () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      const mockEvents = [{ id: 'event-1' }];
      stellarAdapter.parseTransferEvents.mockReturnValue(mockEvents);

      const transaction = { hash: 'tx-123' };
      const events = registry.parseTransferEvents(transaction, 'GBL...CONTRACT1', 'stellar-asset');

      expect(events).toEqual(mockEvents);
      expect(stellarAdapter.parseTransferEvents).toHaveBeenCalledWith(transaction, 'GBL...CONTRACT1');
    });

    it('should return empty array for unsupported standard', () => {
      const transaction = { hash: 'tx-123' };
      const events = registry.parseTransferEvents(transaction, 'GBL...CONTRACT1', 'unsupported');

      expect(events).toEqual([]);
    });

    it('should handle adapter errors gracefully', () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.parseTransferEvents.mockImplementation(() => {
        throw new Error('Parse error');
      });

      const transaction = { hash: 'tx-123' };
      const events = registry.parseTransferEvents(transaction, 'GBL...CONTRACT1', 'stellar-asset');

      expect(events).toEqual([]);
    });
  });

  describe('queryAssetOwnership', () => {
    it('should query ownership with correct adapter', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      const mockOwnership = { currentOwner: 'GBL...OWNER' };
      stellarAdapter.queryAssetOwnership.mockResolvedValue(mockOwnership);

      const result = await registry.queryAssetOwnership('asset-123', 'GBL...CONTRACT1', 'stellar-asset');

      expect(result).toEqual(mockOwnership);
      expect(stellarAdapter.queryAssetOwnership).toHaveBeenCalledWith('asset-123', 'GBL...CONTRACT1');
    });

    it('should return null for unsupported standard', async () => {
      const result = await registry.queryAssetOwnership('asset-123', 'GBL...CONTRACT1', 'unsupported');
      expect(result).toBeNull();
    });

    it('should handle adapter errors gracefully', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.queryAssetOwnership.mockRejectedValue(new Error('Query error'));

      const result = await registry.queryAssetOwnership('asset-123', 'GBL...CONTRACT1', 'stellar-asset');
      expect(result).toBeNull();
    });
  });

  describe('isAssetFrozen', () => {
    it('should check frozen status with correct adapter', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.isAssetFrozen.mockResolvedValue(true);

      const result = await registry.isAssetFrozen('asset-123', 'GBL...CONTRACT1', 'stellar-asset');

      expect(result).toBe(true);
      expect(stellarAdapter.isAssetFrozen).toHaveBeenCalledWith('asset-123', 'GBL...CONTRACT1');
    });

    it('should return false for unsupported standard', async () => {
      const result = await registry.isAssetFrozen('asset-123', 'GBL...CONTRACT1', 'unsupported');
      expect(result).toBe(false);
    });

    it('should handle adapter errors gracefully', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.isAssetFrozen.mockRejectedValue(new Error('Check error'));

      const result = await registry.isAssetFrozen('asset-123', 'GBL...CONTRACT1', 'stellar-asset');
      expect(result).toBe(false);
    });
  });

  describe('isAssetBurned', () => {
    it('should check burned status with correct adapter', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.isAssetBurned.mockResolvedValue(true);

      const result = await registry.isAssetBurned('asset-123', 'GBL...CONTRACT1', 'stellar-asset');

      expect(result).toBe(true);
      expect(stellarAdapter.isAssetBurned).toHaveBeenCalledWith('asset-123', 'GBL...CONTRACT1');
    });

    it('should return false for unsupported standard', async () => {
      const result = await registry.isAssetBurned('asset-123', 'GBL...CONTRACT1', 'unsupported');
      expect(result).toBe(false);
    });

    it('should handle adapter errors gracefully', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.isAssetBurned.mockRejectedValue(new Error('Check error'));

      const result = await registry.isAssetBurned('asset-123', 'GBL...CONTRACT1', 'stellar-asset');
      expect(result).toBe(false);
    });
  });

  describe('getAssetType', () => {
    it('should get asset type with correct adapter', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.getAssetType.mockResolvedValue('real_estate');

      const result = await registry.getAssetType('GBL...CONTRACT1', 'stellar-asset');

      expect(result).toBe('real_estate');
      expect(stellarAdapter.getAssetType).toHaveBeenCalledWith('GBL...CONTRACT1');
    });

    it('should return unknown for unsupported standard', async () => {
      const result = await registry.getAssetType('GBL...CONTRACT1', 'unsupported');
      expect(result).toBe('unknown');
    });

    it('should handle adapter errors gracefully', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.getAssetType.mockRejectedValue(new Error('Type error'));

      const result = await registry.getAssetType('GBL...CONTRACT1', 'stellar-asset');
      expect(result).toBe('unknown');
    });
  });

  describe('getStats', () => {
    it('should return registry statistics', () => {
      const stats = registry.getStats();

      expect(stats.totalAdapters).toBe(3);
      expect(stats.supportedStandards).toHaveLength(3);
      expect(stats.adapters).toHaveLength(3);
      expect(stats.adapters[0]).toHaveProperty('standard');
      expect(stats.adapters[0]).toHaveProperty('type');
      expect(stats.adapters[0]).toHaveProperty('network');
    });
  });

  describe('testAllAdapters', () => {
    it('should test all adapters successfully', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.validateContractAddress.mockReturnValue(true);

      const realtyAdapter = registry.getAdapter('tokenized-realty');
      realtyAdapter.validateContractAddress.mockReturnValue(true);

      const vehicleAdapter = registry.getAdapter('vehicle-registry');
      vehicleAdapter.validateContractAddress.mockReturnValue(true);

      const results = await registry.testAllAdapters();

      expect(results.total).toBe(3);
      expect(results.passed).toBe(3);
      expect(results.failed).toBe(0);
      expect(results.results['stellar-asset']).toHaveProperty('passed', true);
      expect(results.results['tokenized-realty']).toHaveProperty('passed', true);
      expect(results.results['vehicle-registry']).toHaveProperty('passed', true);
    });

    it('should handle adapter test failures', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.validateContractAddress.mockImplementation(() => {
        throw new Error('Validation error');
      });

      const results = await registry.testAllAdapters();

      expect(results.total).toBe(3);
      expect(results.passed).toBe(2);
      expect(results.failed).toBe(1);
      expect(results.results['stellar-asset']).toHaveProperty('passed', false);
      expect(results.results['stellar-asset']).toHaveProperty('error');
    });
  });

  describe('refreshAdapters', () => {
    it('should refresh adapters with new config', () => {
      const newConfig = { network: 'public' };

      registry.refreshAdapters(newConfig);

      expect(registry.config.network).toBe('public');
      expect(registry.adapters.size).toBe(3); // Should still have all adapters
    });
  });

  describe('getAdapterHealth', () => {
    it('should return health status for all adapters', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.validateContractAddress.mockReturnValue(true);

      const realtyAdapter = registry.getAdapter('tokenized-realty');
      realtyAdapter.validateContractAddress.mockReturnValue(true);

      const vehicleAdapter = registry.getAdapter('vehicle-registry');
      vehicleAdapter.validateContractAddress.mockRejectedValue(new Error('Health check failed'));

      const health = await registry.getAdapterHealth();

      expect(health['stellar-asset']).toHaveProperty('status', 'healthy');
      expect(health['tokenized-realty']).toHaveProperty('status', 'healthy');
      expect(health['vehicle-registry']).toHaveProperty('status', 'unhealthy');
      expect(health['vehicle-registry']).toHaveProperty('error');
    });

    it('should include timestamps in health status', async () => {
      const stellarAdapter = registry.getAdapter('stellar-asset');
      stellarAdapter.validateContractAddress.mockReturnValue(true);

      const health = await registry.getAdapterHealth();

      expect(health['stellar-asset']).toHaveProperty('lastCheck');
      expect(health['stellar-asset']).toHaveProperty('network');
    });
  });

  describe('edge cases', () => {
    it('should handle empty adapter registry', () => {
      const emptyRegistry = new RwaAdapterRegistry(mockConfig);
      emptyRegistry.adapters.clear();

      expect(emptyRegistry.getSupportedStandards()).toHaveLength(0);
      expect(emptyRegistry.getAdapter('stellar-asset')).toBeNull();
      expect(emptyRegistry.isStandardSupported('stellar-asset')).toBe(false);
    });

    it('should handle multiple registrations of same standard', () => {
      const customAdapter1 = {
        getStandard: jest.fn().mockReturnValue('custom'),
        parseTransferEvents: jest.fn(),
        queryAssetOwnership: jest.fn(),
        validateContractAddress: jest.fn(),
        isAssetFrozen: jest.fn(),
        isAssetBurned: jest.fn(),
        getAssetType: jest.fn()
      };

      const customAdapter2 = {
        getStandard: jest.fn().mockReturnValue('custom'),
        parseTransferEvents: jest.fn(),
        queryAssetOwnership: jest.fn(),
        validateContractAddress: jest.fn(),
        isAssetFrozen: jest.fn(),
        isAssetBurned: jest.fn(),
        getAssetType: jest.fn()
      };

      registry.registerAdapter('custom', customAdapter1);
      registry.registerAdapter('custom', customAdapter2);

      expect(registry.getAdapter('custom')).toBe(customAdapter2); // Should replace
      expect(registry.getSupportedStandards()).toContain('custom');
    });

    it('should handle database errors in getAdapterForContract', async () => {
      const mockDatabase = {
        db: {
          prepare: jest.fn().mockReturnValue({
            get: jest.fn().mockImplementation(() => {
              throw new Error('Database error');
            })
          })
        }
      };

      const adapter = await registry.getAdapterForContract('GBL...CONTRACT1', mockDatabase);
      expect(adapter).toBeNull();
    });
  });
});
