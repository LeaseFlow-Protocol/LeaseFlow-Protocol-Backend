/**
 * Tests for RentPaymentTrackerService — Issue #16
 */

'use strict';

const { AppDatabase } = require('../src/db/appDatabase');
const { RentPaymentTrackerService } = require('../services/rentPaymentTrackerService');

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeDb() {
  return new AppDatabase(':memory:');
}

function seedLease(db, overrides = {}) {
  const lease = {
    id: 'lease-001',
    landlordId: 'landlord-1',
    tenantId: 'tenant-1',
    status: 'active',
    rentAmount: 1000,
    currency: 'USDC',
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    renewable: true,
    disputed: false,
    ...overrides,
  };
  db.seedLease(lease);

  // Manually set tenant_account_id (not in seedLease's original API)
  if (overrides.tenantAccountId) {
    db.db
      .prepare(`UPDATE leases SET tenant_account_id = ? WHERE id = ?`)
      .run(overrides.tenantAccountId, lease.id);
  }

  return lease;
}

function makeOp(overrides = {}) {
  return {
    id: 'op-abc123',
    type: 'payment',
    to: 'CONTRACT_ACCOUNT',
    from: 'TENANT_STELLAR_ACCOUNT',
    amount: '500.0000000',
    asset_code: 'USDC',
    asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    transaction_hash: 'deadbeefdeadbeef',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTracker(db, extraOptions = {}, horizonPayload = null, sorobanService = null) {
  const options = {
    contractAccountId: 'CONTRACT_ACCOUNT',
    ...extraOptions,
  };
  const tracker = new RentPaymentTrackerService(db, sorobanService, options);

  // Stub _fetchHorizon to avoid real HTTP calls
  tracker._fetchHorizon = async () =>
    horizonPayload ?? {
      _embedded: { records: [] },
    };

  return tracker;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('RentPaymentTrackerService', () => {
  describe('poll()', () => {
    test('returns zero counts when Horizon returns no records', async () => {
      const db = makeDb();
      const tracker = makeTracker(db);

      const result = await tracker.poll();

      expect(result.processed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    test('skips operations that are not payment types', async () => {
      const db = makeDb();
      const op = makeOp({ type: 'create_account', to: 'CONTRACT_ACCOUNT' });
      const tracker = makeTracker(db, {}, { _embedded: { records: [op] } });

      const result = await tracker.poll();

      expect(result.processed).toBe(0);
      expect(result.skipped).toBe(1);
    });

    test('skips payments not directed at the contract account', async () => {
      const db = makeDb();
      const op = makeOp({ to: 'SOMEONE_ELSE' });
      const tracker = makeTracker(db, {}, { _embedded: { records: [op] } });

      const result = await tracker.poll();

      expect(result.processed).toBe(0);
      expect(result.skipped).toBe(1);
    });

    test('records a valid incoming payment and returns processed=1', async () => {
      const db = makeDb();
      const op = makeOp();
      const tracker = makeTracker(db, {}, { _embedded: { records: [op] } });

      const result = await tracker.poll();

      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      const saved = db.getPaymentByHorizonOpId(op.id);
      expect(saved).not.toBeNull();
      expect(saved.tenantAccountId).toBe('TENANT_STELLAR_ACCOUNT');
      expect(saved.amount).toBe('500.0000000');
    });

    test('is idempotent — duplicate Horizon op IDs are skipped', async () => {
      const db = makeDb();
      const op = makeOp();
      const tracker = makeTracker(db, {}, { _embedded: { records: [op] } });

      await tracker.poll();
      const result = await tracker.poll();

      expect(result.processed).toBe(0);
      expect(result.skipped).toBe(1);

      // Only one record should exist in the DB
      expect(db.listPaymentsByTenantAccount('TENANT_STELLAR_ACCOUNT')).toHaveLength(1);
    });

    test('updates lease payment_status when tenant account matches an active lease', async () => {
      const db = makeDb();
      seedLease(db, { tenantAccountId: 'TENANT_STELLAR_ACCOUNT' });

      const op = makeOp();
      const tracker = makeTracker(db, {}, { _embedded: { records: [op] } });

      await tracker.poll();

      const lease = db.getLeaseById('lease-001');
      expect(lease.paymentStatus).toBe('paid');
      expect(lease.lastPaymentAt).toBe(op.created_at);
    });

    test('records payment without lease_id when no matching lease found', async () => {
      const db = makeDb();
      // No lease seeded for this tenant
      const op = makeOp({ from: 'UNKNOWN_TENANT' });
      const tracker = makeTracker(db, {}, { _embedded: { records: [op] } });

      await tracker.poll();

      const saved = db.getPaymentByHorizonOpId(op.id);
      expect(saved.leaseId).toBeNull();
    });

    test('updates purchase credit when purchase option is enabled', async () => {
      const db = makeDb();
      seedLease(db, { 
        tenantAccountId: 'TENANT_STELLAR_ACCOUNT',
        rentAmount: 1000,
        purchaseOptionEnabled: 1,
        purchaseOptionRentShare: 0.2, // 20% equity
        purchaseCredit: 100 // Existing equity
      });

      const op = makeOp({ amount: '1000.0000000' });
      const sorobanService = {
        updatePurchaseCredit: jest.fn().mockReturnValue({ txHash: 'tx_test' })
      };
      const tracker = makeTracker(db, {}, { _embedded: { records: [op] } }, sorobanService);

      await tracker.poll();

      const lease = db.getLeaseById('lease-001');
      // 1000 * 0.2 = 200 equity earned. 100 + 200 = 300 total.
      expect(lease.purchaseCredit).toBe(300);
      expect(sorobanService.updatePurchaseCredit).toHaveBeenCalledWith({
        leaseId: 'lease-001',
        tenantId: 'tenant-1',
        purchaseCredit: 300
      });
    });
  });
});

// --------------------------------------------------------------------------
// AppDatabase payment methods
// --------------------------------------------------------------------------

describe('AppDatabase — payment methods', () => {
  test('insertPayment and getPaymentByHorizonOpId roundtrip', () => {
    const db = makeDb();

    const payment = {
      horizonOperationId: 'op-xyz',
      leaseId: 'lease-xyz',
      tenantAccountId: 'GTENANTXXX',
      amount: '250.0000000',
      assetCode: 'XLM',
      assetIssuer: null,
      transactionHash: 'tx-hash-001',
      paidAt: new Date().toISOString(),
    };

    db.insertPayment(payment);
    const found = db.getPaymentByHorizonOpId('op-xyz');

    expect(found).not.toBeNull();
    expect(found.amount).toBe('250.0000000');
    expect(found.tenantAccountId).toBe('GTENANTXXX');
  });

  test('listPaymentsByLeaseId returns only matching records', () => {
    const db = makeDb();

    db.insertPayment({ horizonOperationId: 'op-1', leaseId: 'lease-A', tenantAccountId: 'GT1', amount: '100', assetCode: 'XLM', assetIssuer: null, transactionHash: 'tx1', paidAt: new Date().toISOString() });
    db.insertPayment({ horizonOperationId: 'op-2', leaseId: 'lease-B', tenantAccountId: 'GT2', amount: '200', assetCode: 'XLM', assetIssuer: null, transactionHash: 'tx2', paidAt: new Date().toISOString() });

    const results = db.listPaymentsByLeaseId('lease-A');
    expect(results).toHaveLength(1);
    expect(results[0].horizonOpId).toBe('op-1');
  });

  test('listPaymentsByTenantAccount returns only matching records', () => {
    const db = makeDb();

    db.insertPayment({ horizonOperationId: 'op-T1', leaseId: null, tenantAccountId: 'GT_ALICE', amount: '50', assetCode: 'XLM', assetIssuer: null, transactionHash: 'txA', paidAt: new Date().toISOString() });
    db.insertPayment({ horizonOperationId: 'op-T2', leaseId: null, tenantAccountId: 'GT_BOB', amount: '75', assetCode: 'XLM', assetIssuer: null, transactionHash: 'txB', paidAt: new Date().toISOString() });

    expect(db.listPaymentsByTenantAccount('GT_ALICE')).toHaveLength(1);
    expect(db.listPaymentsByTenantAccount('GT_BOB')).toHaveLength(1);
  });

  test('getActiveLeaseByTenantAccount returns null when tenant has no active lease', () => {
    const db = makeDb();
    expect(db.getActiveLeaseByTenantAccount('GNONEXISTENT')).toBeNull();
  });

  test('getActiveLeaseByTenantAccount returns active lease for matching account', () => {
    const db = makeDb();
    seedLease(db, { tenantAccountId: 'GTENANTABC' });

    const found = db.getActiveLeaseByTenantAccount('GTENANTABC');
    expect(found).not.toBeNull();
    expect(found.id).toBe('lease-001');
  });
});
