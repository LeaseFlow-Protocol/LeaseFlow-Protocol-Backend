jest.mock('ioredis', () => require('ioredis-mock'));
const { RentDunningSequencer } = require('../src/services/RentDunningSequencer');
const Redis = require('ioredis');

describe('RentDunningSequencer', () => {
  let sequencer;
  let mockDb;
  let mockNotifications;
  let mockIot;

  beforeEach(() => {
    mockDb = {
      db: {
        prepare: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue(null),
          run: jest.fn(),
          all: jest.fn().mockReturnValue([])
        })
      },
      getLeaseById: jest.fn().mockReturnValue({
        id: 'lease-1',
        tenantId: 'tenant-1',
        currency: 'USDC',
        rent_amount: 1000
      })
    };
    mockNotifications = { sendNotification: jest.fn() };
    mockIot = { enqueueDispatch: jest.fn() };

    sequencer = new RentDunningSequencer(mockDb, mockNotifications, mockIot, {});
  });

  test('should start dunning sequence on delinquency event', async () => {
    await sequencer.startDunningSequence({ leaseId: 'lease-1', amountDue: 1000 });

    expect(mockDb.db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO dunning_sequences'));
    expect(mockNotifications.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DUNNING_STEP_1' })
    );
  });

  test('should abort sequence on payment event', async () => {
    await sequencer.abortDunningSequence('lease-1');

    expect(mockDb.db.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE dunning_sequences'));
    expect(mockDb.db.prepare).toHaveBeenCalledWith(expect.stringContaining('SET status = \'aborted\''));
  });

  test('should trigger IoT lockout on Day 5 (Step 5)', async () => {
    await sequencer.processStep('lease-1', 5, 1000);

    expect(mockIot.enqueueDispatch).toHaveBeenCalledWith(
      'LesseeAccessRevoked',
      expect.objectContaining({ leaseId: 'lease-1' })
    );
    expect(mockNotifications.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DUNNING_STEP_5' })
    );
  });
});
