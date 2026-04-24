const { AssetConditionOracleService } = require('../src/services/AssetConditionOracleService');
const crypto = require('crypto');

describe('AssetConditionOracleService', () => {
  let service;
  let mockDb;

  beforeEach(() => {
    mockDb = {
      db: {
        prepare: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue(null),
          run: jest.fn()
        })
      }
    };
    service = new AssetConditionOracleService(mockDb);
  });

  test('should process and sign a moderate damage report', async () => {
    const reportData = {
      leaseId: 'lease-123',
      damageCode: 'DNT-002',
      description: 'Moderate dent in the door',
      inspectorId: 'insp-1'
    };

    const result = await service.processConditionReport(reportData);

    expect(result.status).toBe('signed');
    expect(result.payload.severityTier).toBe('moderate');
    expect(result.payload.slashAmount).toBe(250);
    expect(result.signature).toBeDefined();
  });

  test('should skip minor wear-and-tear reports', async () => {
    const reportData = {
      leaseId: 'lease-123',
      damageCode: 'SCR-001',
      description: 'Minor scratch'
    };

    const result = await service.processConditionReport(reportData);

    expect(result.status).toBe('skipped');
    expect(result.severityTier).toBe('minor');
  });

  test('should prevent duplicate reports for the same lease event', async () => {
    mockDb.db.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 'existing-report' })
    });

    const reportData = {
      leaseId: 'lease-123',
      damageCode: 'WND-003'
    };

    await expect(service.processConditionReport(reportData))
      .rejects.toThrow('Condition report already generated');
  });
});
