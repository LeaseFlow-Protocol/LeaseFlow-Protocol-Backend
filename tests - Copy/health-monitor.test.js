jest.mock('ioredis', () => require('ioredis-mock'));
const { CollateralHealthMonitorWorker } = require('../src/services/CollateralHealthMonitorWorker');
const Redis = require('ioredis');

describe('CollateralHealthMonitorWorker', () => {
  let worker;
  let mockDb;
  let mockNotifications;
  let mockSoroban;

  beforeEach(() => {
    mockDb = {
      db: {
        prepare: jest.fn().mockReturnValue({
          all: jest.fn().mockReturnValue([
            { id: 'lease-1', rent_amount: 1000, currency: 'XLM', tenant_id: 'tenant-1' }
          ]),
          run: jest.fn()
        })
      }
    };
    mockNotifications = { sendNotification: jest.fn() };
    mockSoroban = { callContract: jest.fn() };

    worker = new CollateralHealthMonitorWorker(mockDb, mockNotifications, mockSoroban, {});
  });

  test('should identify unhealthy leases and trigger alerts/margin calls', async () => {
    // Mock price feed to return a very low price (flash crash simulation)
    jest.spyOn(worker, 'getTokenPrice').mockResolvedValue(0.05); // Price crashed to 0.05

    await worker.performHealthChecks();

    // Check if notification was sent
    expect(mockNotifications.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'MARGIN_CALL',
        leaseId: 'lease-1'
      })
    );

    // Check if audit log was written with 'margin_call' action
    expect(mockDb.db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO collateral_health_logs'));
  });

  test('should not take action for healthy leases', async () => {
    jest.spyOn(worker, 'getTokenPrice').mockResolvedValue(1.0); // Normal price

    await worker.performHealthChecks();

    expect(mockNotifications.sendNotification).not.toHaveBeenCalled();
  });
});
