const AutoReclaimWorker = require('../services/autoReclaimWorker');
const algosdk = require('algosdk');

describe('AutoReclaimWorker', () => {
  let worker;
  let mockAlgodClient;

  beforeEach(() => {
    worker = new AutoReclaimWorker();

    mockAlgodClient = {
      getApplicationByID: jest.fn(),
      getTransactionParams: jest.fn(),
      sendRawTransaction: jest.fn()
    };

    worker.algodClient = mockAlgodClient;
  });

  describe('extractLeasesFromGlobalState', () => {
    it('should extract leases with zero or negative balance', () => {
      const globalState = [
        {
          key: Buffer.from('lease_123').toString('base64'),
          value: { type: 1, uint: 0 }
        },
        {
          key: Buffer.from('lease_456').toString('base64'),
          value: { type: 1, uint: -5 }
        },
        {
          key: Buffer.from('lease_789').toString('base64'),
          value: { type: 1, uint: 100 }
        },
        {
          key: Buffer.from('other_data').toString('base64'),
          value: { type: 1, uint: 50 }
        }
      ];

      const leases = worker.extractLeasesFromGlobalState(globalState);

      expect(leases).toHaveLength(3);
      expect(leases[0]).toEqual({ id: '123', renter_balance: 0 });
      expect(leases[1]).toEqual({ id: '456', renter_balance: -5 });
      expect(leases[2]).toEqual({ id: '789', renter_balance: 100 });
    });
  });

  describe('parseLeaseData', () => {
    it('should parse uint values correctly', () => {
      const value = { type: 1, uint: 50 };
      const result = worker.parseLeaseData(value);
      expect(result).toEqual({ renter_balance: 50 });
    });

    it('should parse byte values correctly', () => {
      const leaseData = { renter_balance: 25, tenant: 'alice' };
      const value = { type: 2, bytes: Buffer.from(JSON.stringify(leaseData)).toString('base64') };
      const result = worker.parseLeaseData(value);
      expect(result).toEqual(leaseData);
    });

    it('should handle invalid byte values', () => {
      const value = { type: 2, bytes: Buffer.from('invalid-json').toString('base64') };
      const result = worker.parseLeaseData(value);
      expect(result).toEqual({ renter_balance: 0 });
    });

    it('should handle unknown types', () => {
      const value = { type: 3, bytes: 'some-data' };
      const result = worker.parseLeaseData(value);
      expect(result).toEqual({ renter_balance: 0 });
    });
  });

  describe('checkExpiredLeases', () => {
    it('should identify expired leases with renter_balance <= 0', async () => {
      const globalState = [
        {
          key: Buffer.from('lease_active1').toString('base64'),
          value: { type: 1, uint: 100 }
        },
        {
          key: Buffer.from('lease_expired1').toString('base64'),
          value: { type: 1, uint: 0 }
        },
        {
          key: Buffer.from('lease_expired2').toString('base64'),
          value: { type: 1, uint: -10 }
        }
      ];

      const mockAppInfo = {
        params: {
          'global-state': globalState
        }
      };

      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockResolvedValue(mockAppInfo)
      });

      const expiredLeases = await worker.checkExpiredLeases();

      expect(expiredLeases).toHaveLength(1);
      expect(expiredLeases[0].id).toBe('expired2');
      expect(expiredLeases[0].renter_balance).toBe(-10);
    });

    it('should handle API errors gracefully', async () => {
      mockAlgodClient.getApplicationByID.mockReturnValue({
        do: jest.fn().mockImplementation(() => {
          throw new Error('API Error');
        })
      });

      await expect(worker.checkExpiredLeases()).rejects.toThrow('API Error');
    });
  });

  describe('getOwnerAccount', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create account from mnemonic', () => {
      process.env.OWNER_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

      jest.spyOn(algosdk, 'mnemonicToSecretKey').mockReturnValue({
        addr: 'TEST_ADDRESS_123456789',
        sk: new Uint8Array(32)
      });

      const account = worker.getOwnerAccount();

      expect(account.addr).toBe('TEST_ADDRESS_123456789');
      expect(account.sk).toBeDefined();
    });

    it('should throw error if mnemonic not set', () => {
      delete process.env.OWNER_MNEMONIC;

      expect(() => worker.getOwnerAccount()).toThrow('OWNER_MNEMONIC environment variable not set');
    });
  });

  describe('executeReclaim', () => {
    let originalMakeTxn;

    beforeEach(() => {
      jest.spyOn(worker, 'getOwnerAccount').mockReturnValue({
        addr: 'X2F7A3N3D5A2B6C8E9F1G4H7J0K3L6M9N2O5P8Q1R4S7T0U3V6W9Y2Z5A8B1C4',
        sk: new Uint8Array(32)
      });

      mockAlgodClient.getTransactionParams.mockReturnValue({
        do: jest.fn().mockResolvedValue({
          fee: 1000,
          firstRound: 1000,
          lastRound: 2000,
          genesisID: 'testnet-v1.0',
          genesisHash: 'SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
        })
      });

      mockAlgodClient.sendRawTransaction.mockReturnValue({
        do: jest.fn().mockResolvedValue({ txId: 'test-tx-id' })
      });

      originalMakeTxn = algosdk.makeApplicationCallTxnFromObject;
      algosdk.makeApplicationCallTxnFromObject = jest.fn().mockReturnValue({
        signTxn: jest.fn().mockReturnValue('signed-txn'),
        txID: jest.fn().mockReturnValue('test-tx-id')
      });
    });

    afterEach(() => {
      algosdk.makeApplicationCallTxnFromObject = originalMakeTxn;
      jest.restoreAllMocks();
    });

    it('should execute reclaim transaction', async () => {
      jest.spyOn(algosdk, 'waitForConfirmation').mockResolvedValue({ confirmedRound: 1001 });

      const result = await worker.executeReclaim('test-lease-id');

      expect(algosdk.makeApplicationCallTxnFromObject).toHaveBeenCalledWith(expect.objectContaining({
        from: 'X2F7A3N3D5A2B6C8E9F1G4H7J0K3L6M9N2O5P8Q1R4S7T0U3V6W9Y2Z5A8B1C4',
        appIndex: expect.any(Number),
        appArgs: expect.any(Array)
      }));
      expect(mockAlgodClient.sendRawTransaction().do).toHaveBeenCalled();
      expect(result).toEqual({ confirmedRound: 1001 });
    });

    it('should handle transaction errors', async () => {
      mockAlgodClient.sendRawTransaction.mockReturnValue({
        do: jest.fn().mockImplementation(() => {
          throw new Error('Transaction failed');
        })
      });

      await expect(worker.executeReclaim('test-lease-id')).rejects.toThrow('Transaction failed');
    });
  });
});
