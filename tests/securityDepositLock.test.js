const request = require('supertest');
const { createApp } = require('../index');
const {
  createSecurityDepositLockService,
  evaluateSecurityDepositLock,
} = require('../services/securityDepositLock');

describe('Security deposit lock verification', () => {
  it('compares Stellar amounts using 7-decimal precision', () => {
    expect(
      evaluateSecurityDepositLock({
        depositAmount: '1200.0000001',
        escrowBalance: '1200.0000000',
      }),
    ).toEqual({
      allowed: false,
      deposit_amount: '1200.0000001',
      escrow_balance: '1200',
      missing_amount: '0.0000001',
    });
  });

  it('allows Generate Digital Key when escrow covers the full deposit', async () => {
    const getEscrowBalance = jest.fn().mockResolvedValue('2500.0000000');
    const app = createApp({
      securityDepositService: createSecurityDepositLockService({
        getEscrowBalance,
      }),
    });

    const response = await request(app)
      .post('/move-in/generate-digital-key')
      .send({
        lease_id: 'LEASE-101',
        escrow_contract_id: 'ESCROW-101',
        deposit_amount: '2500.0000000',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      action: 'Generate Digital Key',
      allowed: true,
      message:
        'Security deposit verified. Digital key generation is authorized.',
      verification: {
        action: 'Generate Digital Key',
        lease_id: 'LEASE-101',
        escrow_contract_id: 'ESCROW-101',
        allowed: true,
        deposit_amount: '2500',
        escrow_balance: '2500',
        missing_amount: '0',
      },
    });
    expect(getEscrowBalance).toHaveBeenCalledWith({
      action: 'Generate Digital Key',
      leaseId: 'LEASE-101',
      escrowContractId: 'ESCROW-101',
    });
  });

  it('blocks Release Address when escrow is below the required deposit', async () => {
    const app = createApp({
      securityDepositService: createSecurityDepositLockService({
        getEscrowBalance: jest.fn().mockResolvedValue('1499.9999999'),
      }),
    });

    const response = await request(app)
      .post('/move-in/release-address')
      .send({
        lease_id: 'LEASE-202',
        escrow_contract_id: 'ESCROW-202',
        deposit_amount: '1500',
      });

    expect(response.status).toBe(412);
    expect(response.body).toEqual({
      error: 'SECURITY_DEPOSIT_NOT_LOCKED',
      message:
        'Release Address is blocked until the full security deposit is locked in Soroban escrow.',
      details: {
        lease_id: 'LEASE-202',
        escrow_contract_id: 'ESCROW-202',
        allowed: false,
        deposit_amount: '1500',
        escrow_balance: '1499.9999999',
        missing_amount: '0.0000001',
      },
    });
  });

  it('rejects invalid deposit_amount before querying the escrow provider', async () => {
    const getEscrowBalance = jest.fn();
    const app = createApp({
      securityDepositService: createSecurityDepositLockService({
        getEscrowBalance,
      }),
    });

    const response = await request(app)
      .post('/move-in/generate-digital-key')
      .send({ lease_id: 'LEASE-303', deposit_amount: 'invalid-amount' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_DEPOSIT_AMOUNT',
      message:
        'deposit_amount must be a non-negative amount with up to 7 decimal places.',
      details: {},
    });
    expect(getEscrowBalance).not.toHaveBeenCalled();
  });
});
