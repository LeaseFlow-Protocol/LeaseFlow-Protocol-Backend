const StellarEventListener = require('../../src/services/rwa/stellarEventListener');
const RwaAdapterRegistry = require('../../src/services/rwa/rwaAdapterRegistry');

// Mock dependencies
jest.mock('@stellar/stellar-sdk');
jest.mock('../../src/services/rwa/rwaAdapterRegistry');

describe('StellarEventListener', () => {
  let eventListener;
  let mockDatabase;
  let mockAdapterRegistry;
  let mockAdapter;
  let mockServer;

  beforeEach(() => {
    // Mock database
    mockDatabase = {
      db: {
        prepare: jest.fn().mockReturnValue({
          get: jest.fn(),
          all: jest.fn(),
          run: jest.fn()
        })
      }
    };

    // Mock adapter registry
    mockAdapterRegistry = {
      getAdapter: jest.fn()
    };

    // Mock adapter
    mockAdapter = {
      parseTransferEvents: jest.fn(),
      getStandard: jest.fn().mockReturnValue('stellar-asset')
    };

    mockAdapterRegistry.getAdapter.mockReturnValue(mockAdapter);

    // Mock Stellar server
    mockServer = {
      transactions: jest.fn().mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        cursor: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        stream: jest.fn()
      })
    };

    const config = {
      network: 'testnet',
      maxRetries: 3,
      retryDelay: 1000
    };

    eventListener = new StellarEventListener(mockDatabase, config, mockAdapterRegistry);
    eventListener.server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(eventListener.config.network).toBe('testnet');
      expect(eventListener.maxRetries).toBe(3);
      expect(eventListener.retryDelay).toBe(1000);
      expect(eventListener.isRunning).toBe(false);
    });
  });

  describe('start', () => {
    it('should start listening for events', async () => {
      const contracts = [
        {
          contract_address: 'GBL...CONTRACT1',
          rwa_standard: 'stellar-asset',
          asset_type: 'real_estate'
        }
      ];

      mockDatabase.db.prepare().all.mockReturnValue(contracts);
      mockServer.transactions().forAccount().cursor().limit().stream.mockReturnValue({
        onmessage: jest.fn(),
        onerror: jest.fn(),
        onclose: jest.fn()
      });

      await eventListener.start();

      expect(eventListener.isRunning).toBe(true);
      expect(mockAdapterRegistry.getAdapter).toHaveBeenCalledWith('stellar-asset');
    });

    it('should handle no active contracts gracefully', async () => {
      mockDatabase.db.prepare().all.mockReturnValue([]);

      await eventListener.start();

      expect(eventListener.isRunning).toBe(true);
    });

    it('should handle errors during startup', async () => {
      mockDatabase.db.prepare().all.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(eventListener.start()).rejects.toThrow('Database error');
    });
  });

  describe('stop', () => {
    it('should stop listening for events', async () => {
      // Mock a stream
      const mockStream = {
        close: jest.fn()
      };
      eventListener.streams.set('GBL...CONTRACT1', mockStream);

      await eventListener.stop();

      expect(eventListener.isRunning).toBe(false);
      expect(mockStream.close).toHaveBeenCalled();
    });
  });

  describe('handleTransaction', () => {
    it('should process transaction with events', async () => {
      const transaction = {
        hash: 'tx-hash-123',
        ledger_attr: 12345,
        created_at: '2024-01-01T00:00:00Z',
        source_account: 'GBL...SOURCE',
        operations: [
          { type: 'payment', id: 'op-1' }
        ]
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset',
        asset_type: 'real_estate'
      };

      const events = [
        {
          id: 'event-1',
          assetId: 'asset-123',
          fromOwnerPubkey: 'GBL...FROM',
          toOwnerPubkey: 'GBL...TO',
          contractAddress: 'GBL...CONTRACT1',
          transactionHash: 'tx-hash-123',
          ledgerSequence: 12345,
          operationIndex: 0,
          eventType: 'transfer',
          eventData: {},
          timestamp: '2024-01-01T00:00:00Z'
        }
      ];

      mockAdapter.parseTransferEvents.mockReturnValue(events);
      mockDatabase.db.prepare().run.mockImplementation(() => {});

      await eventListener.handleTransaction(transaction, contract, mockAdapter);

      expect(mockAdapter.parseTransferEvents).toHaveBeenCalledWith(transaction, 'GBL...CONTRACT1');
      expect(mockDatabase.db.prepare().run).toHaveBeenCalled();
    });

    it('should handle transaction with no events', async () => {
      const transaction = {
        hash: 'tx-hash-123',
        operations: []
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset'
      };

      mockAdapter.parseTransferEvents.mockReturnValue([]);

      await eventListener.handleTransaction(transaction, contract, mockAdapter);

      expect(mockAdapter.parseTransferEvents).toHaveBeenCalled();
    });

    it('should handle processing errors', async () => {
      const transaction = {
        hash: 'tx-hash-123',
        operations: []
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset'
      };

      mockAdapter.parseTransferEvents.mockImplementation(() => {
        throw new Error('Parse error');
      });

      await eventListener.handleTransaction(transaction, contract, mockAdapter);

      // Should not throw, but error should be logged
      expect(mockAdapter.parseTransferEvents).toHaveBeenCalled();
    });
  });

  describe('processEvent', () => {
    it('should process transfer event', async () => {
      const event = {
        id: 'event-1',
        assetId: 'asset-123',
        fromOwnerPubkey: 'GBL...FROM',
        toOwnerPubkey: 'GBL...TO',
        contractAddress: 'GBL...CONTRACT1',
        transactionHash: 'tx-hash-123',
        eventType: 'transfer',
        eventData: {}
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset',
        asset_type: 'real_estate'
      };

      mockDatabase.db.prepare().run.mockImplementation(() => {});

      await eventListener.processEvent(event, contract);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalled();
    });

    it('should process freeze event', async () => {
      const event = {
        id: 'event-1',
        assetId: 'asset-123',
        contractAddress: 'GBL...CONTRACT1',
        eventType: 'freeze',
        eventData: {}
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset'
      };

      mockDatabase.db.prepare().run.mockImplementation(() => {});

      await eventListener.processEvent(event, contract);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalled();
    });

    it('should process burn event', async () => {
      const event = {
        id: 'event-1',
        assetId: 'asset-123',
        contractAddress: 'GBL...CONTRACT1',
        eventType: 'burn',
        eventData: {}
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset'
      };

      mockDatabase.db.prepare().run.mockImplementation(() => {});

      await eventListener.processEvent(event, contract);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalled();
    });
  });

  describe('storeTransferEvent', () => {
    it('should store transfer event in database', () => {
      const event = {
        id: 'event-1',
        assetId: 'asset-123',
        fromOwnerPubkey: 'GBL...FROM',
        toOwnerPubkey: 'GBL...TO',
        contractAddress: 'GBL...CONTRACT1',
        transactionHash: 'tx-hash-123',
        ledgerSequence: 12345,
        operationIndex: 0,
        eventType: 'transfer',
        eventData: {}
      };

      mockDatabase.db.prepare().run.mockImplementation(() => {});

      eventListener.storeTransferEvent(event);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'event-1',
          'asset-123',
          'GBL...FROM',
          'GBL...TO',
          'GBL...CONTRACT1',
          'tx-hash-123',
          12345,
          0,
          'transfer',
          expect.any(String),
          expect.any(String),
          expect.any(String)
        ])
      );
    });
  });

  describe('updateAssetOwnershipCache', () => {
    it('should update asset cache for transfer event', () => {
      const event = {
        assetId: 'asset-123',
        toOwnerPubkey: 'GBL...TO',
        contractAddress: 'GBL...CONTRACT1',
        eventType: 'transfer',
        timestamp: '2024-01-01T00:00:00Z'
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset',
        asset_type: 'real_estate'
      };

      mockDatabase.db.prepare().run.mockImplementation(() => {});
      mockDatabase.db.prepare().get.mockReturnValue({ count: 1 });

      eventListener.updateAssetOwnershipCache(event, contract);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalled();
    });

    it('should update asset cache for freeze event', () => {
      const event = {
        assetId: 'asset-123',
        contractAddress: 'GBL...CONTRACT1',
        eventType: 'freeze',
        timestamp: '2024-01-01T00:00:00Z'
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset'
      };

      mockDatabase.db.prepare().run.mockImplementation(() => {});

      eventListener.updateAssetOwnershipCache(event, contract);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalled();
    });

    it('should update asset cache for burn event', () => {
      const event = {
        assetId: 'asset-123',
        contractAddress: 'GBL...CONTRACT1',
        eventType: 'burn',
        timestamp: '2024-01-01T00:00:00Z'
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset'
      };

      mockDatabase.db.prepare().run.mockImplementation(() => {});

      eventListener.updateAssetOwnershipCache(event, contract);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalled();
    });
  });

  describe('getActiveRwaContracts', () => {
    it('should return active RWA contracts', () => {
      const contracts = [
        {
          id: 'contract-1',
          contract_address: 'GBL...CONTRACT1',
          rwa_standard: 'stellar-asset',
          asset_type: 'real_estate',
          is_active: 1,
          monitoring_enabled: 1
        }
      ];

      mockDatabase.db.prepare().all.mockReturnValue(contracts);

      const result = eventListener.getActiveRwaContracts();

      expect(result).toHaveLength(1);
      expect(result[0].contract_address).toBe('GBL...CONTRACT1');
    });

    it('should handle database errors', () => {
      mockDatabase.db.prepare().all.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = eventListener.getActiveRwaContracts();

      expect(result).toEqual([]);
    });
  });

  describe('getLatestCursor', () => {
    it('should get latest cursor from Stellar', async () => {
      const transactions = {
        records: [
          { paging_token: 'cursor-123' }
        ]
      };

      mockServer.transactions().forAccount().order().limit().call.mockResolvedValue(transactions);

      const cursor = await eventListener.getLatestCursor('GBL...CONTRACT1');

      expect(cursor).toBe('cursor-123');
    });

    it('should return default cursor on error', async () => {
      mockServer.transactions().forAccount().order().limit().call.mockRejectedValue(new Error('Network error'));

      const cursor = await eventListener.getLatestCursor('GBL...CONTRACT1');

      expect(cursor).toBe('now');
    });
  });

  describe('updateContractCursor', () => {
    it('should update contract cursor in database', () => {
      const contractAddress = 'GBL...CONTRACT1';
      const cursor = 'cursor-123';

      mockDatabase.db.prepare().run.mockImplementation(() => {});

      eventListener.updateContractCursor(contractAddress, cursor);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        contractAddress
      );
    });
  });

  describe('getTransferCount', () => {
    it('should get transfer count for asset', () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT1';

      mockDatabase.db.prepare().get.mockReturnValue({ count: 5 });

      const count = eventListener.getTransferCount(assetId, contractAddress);

      expect(count).toBe(5);
    });

    it('should return 0 on error', () => {
      const assetId = 'asset-123';
      const contractAddress = 'GBL...CONTRACT1';

      mockDatabase.db.prepare().get.mockImplementation(() => {
        throw new Error('Database error');
      });

      const count = eventListener.getTransferCount(assetId, contractAddress);

      expect(count).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('should return listener status', () => {
      eventListener.isRunning = true;
      eventListener.streams.set('GBL...CONTRACT1', {});
      eventListener.cursors.set('GBL...CONTRACT1', 'cursor-123');
      eventListener.retryAttempts.set('GBL...CONTRACT1', 0);

      const status = eventListener.getStatus();

      expect(status.isRunning).toBe(true);
      expect(status.activeStreams).toBe(1);
      expect(status.lastCursors).toEqual({ 'GBL...CONTRACT1': 'cursor-123' });
      expect(status.retryAttempts).toEqual({ 'GBL...CONTRACT1': 0 });
    });
  });

  describe('addContract', () => {
    it('should add new contract to monitoring', async () => {
      const contract = {
        contract_address: 'GBL...NEW_CONTRACT',
        contract_name: 'New Contract',
        rwa_standard: 'stellar-asset',
        asset_type: 'real_estate'
      };

      mockDatabase.db.prepare().run.mockImplementation(() => {});
      eventListener.streams.set('GBL...NEW_CONTRACT', {
        close: jest.fn()
      });

      await eventListener.addContract(contract);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalled();
    });

    it('should start streaming if listener is running', async () => {
      const contract = {
        contract_address: 'GBL...NEW_CONTRACT',
        contract_name: 'New Contract',
        rwa_standard: 'stellar-asset',
        asset_type: 'real_estate'
      };

      eventListener.isRunning = true;
      mockDatabase.db.prepare().run.mockImplementation(() => {});
      mockServer.transactions().forAccount().cursor().limit().stream.mockReturnValue({
        onmessage: jest.fn(),
        onerror: jest.fn(),
        onclose: jest.fn()
      });

      await eventListener.addContract(contract);

      expect(mockServer.transactions().forAccount).toHaveBeenCalledWith('GBL...NEW_CONTRACT');
    });
  });

  describe('removeContract', () => {
    it('should remove contract from monitoring', async () => {
      const contractAddress = 'GBL...CONTRACT1';
      const mockStream = { close: jest.fn() };
      eventListener.streams.set(contractAddress, mockStream);

      mockDatabase.db.prepare().run.mockImplementation(() => {});

      await eventListener.removeContract(contractAddress);

      expect(mockStream.close).toHaveBeenCalled();
      expect(mockDatabase.db.prepare().run).toHaveBeenCalled();
    });
  });

  describe('handleStreamError', () => {
    it('should retry on stream errors', () => {
      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset'
      };

      const error = new Error('Stream error');

      eventListener.retryAttempts.set('GBL...CONTRACT1', 0);

      // Mock setTimeout
      jest.useFakeTimers();

      eventListener.handleStreamError(contract, error);

      expect(eventListener.retryAttempts.get('GBL...CONTRACT1')).toBe(1);

      jest.useRealTimers();
    });

    it('should stop retrying after max attempts', () => {
      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset'
      };

      const error = new Error('Stream error');

      eventListener.retryAttempts.set('GBL...CONTRACT1', 3); // Max retries reached

      eventListener.handleStreamError(contract, error);

      expect(eventListener.retryAttempts.get('GBL...CONTRACT1')).toBe(3);
    });
  });

  describe('event emission', () => {
    it('should emit events on asset freeze', () => {
      const event = {
        assetId: 'asset-123',
        contractAddress: 'GBL...CONTRACT1',
        timestamp: '2024-01-01T00:00:00Z'
      };

      const mockEmit = jest.spyOn(eventListener, 'emit');

      eventListener.handleAssetFrozen(event);

      expect(mockEmit).toHaveBeenCalledWith('assetFrozen', event);
    });

    it('should emit events on asset burn', () => {
      const event = {
        assetId: 'asset-123',
        contractAddress: 'GBL...CONTRACT1',
        timestamp: '2024-01-01T00:00:00Z'
      };

      const mockEmit = jest.spyOn(eventListener, 'emit');

      eventListener.handleAssetBurned(event);

      expect(mockEmit).toHaveBeenCalledWith('assetBurned', event);
    });
  });

  describe('error handling', () => {
    it('should handle adapter errors gracefully', async () => {
      const transaction = {
        hash: 'tx-hash-123',
        operations: []
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset'
      };

      mockAdapterRegistry.getAdapter.mockReturnValue(null);

      await eventListener.handleTransaction(transaction, contract, null);

      // Should not throw
      expect(mockAdapterRegistry.getAdapter).toHaveBeenCalledWith('stellar-asset');
    });

    it('should handle database errors gracefully', async () => {
      const event = {
        id: 'event-1',
        assetId: 'asset-123',
        contractAddress: 'GBL...CONTRACT1',
        eventType: 'transfer',
        eventData: {}
      };

      const contract = {
        contract_address: 'GBL...CONTRACT1',
        rwa_standard: 'stellar-asset'
      };

      mockDatabase.db.prepare().run.mockImplementation(() => {
        throw new Error('Database error');
      });

      // Should not throw, but error should be logged
      await eventListener.processEvent(event, contract);
    });
  });
});
