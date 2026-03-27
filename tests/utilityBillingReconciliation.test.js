const request = require('supertest');

jest.mock('../src/routes/sanctionsRoutes', () => {
  const express = require('express');
  return express.Router();
});

jest.mock('../src/routes/evictionNoticeRoutes', () => {
  const express = require('express');
  return express.Router();
});

const { createApp } = require('../index');
const { loadConfig } = require('../src/config');
const { AppDatabase } = require('../src/db/appDatabase');

describe('Variable utility billing reconciliation', () => {
  let app;
  let database;

  beforeEach(() => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_FILENAME: ':memory:',
      AUTH_JWT_SECRET: 'leaseflow-test-secret',
    });

    database = new AppDatabase(':memory:');
    database.seedLease({
      id: 'lease-1',
      landlordId: 'landlord-1',
      tenantId: 'tenant-1',
      status: 'active',
      rentAmount: 100000,
      currency: 'USDC',
      startDate: '2025-08-01',
      endDate: '2026-07-31',
    });

    app = createApp({ config, database });
  });

  test('records utility bill, calculates tenant share, and updates upcoming payment total', async () => {
    const upload = await request(app)
      .post('/api/leases/lease-1/utility-bills')
      .send({
        landlordId: 'landlord-1',
        utilityType: 'water',
        totalAmount: 20000,
        tenantSharePercent: 50,
        billingPeriodStart: '2026-07-01',
        billingPeriodEnd: '2026-07-31',
        nextRentCycleDate: '2026-08-01',
      });

    expect(upload.status).toBe(200);
    expect(upload.body.success).toBe(true);
    expect(upload.body.data.utilityShareTotal).toBe(10000);
    expect(upload.body.data.upcomingPaymentTotal).toBe(110000);

    const upcoming = await request(app)
      .get('/api/tenants/tenant-1/upcoming-payment')
      .query({ asOfDate: '2026-08-01' });

    expect(upcoming.status).toBe(200);
    expect(upcoming.body.success).toBe(true);
    expect(upcoming.body.data.leaseId).toBe('lease-1');
    expect(upcoming.body.data.utilityShareTotal).toBe(10000);
    expect(upcoming.body.data.upcomingPaymentTotal).toBe(110000);
    expect(upcoming.body.data.approvalRequired).toBe(true);
  });

  test('accumulates multiple utility bills for the same rent cycle', async () => {
    await request(app)
      .post('/api/leases/lease-1/utility-bills')
      .send({
        landlordId: 'landlord-1',
        utilityType: 'water',
        totalAmount: 20000,
        tenantSharePercent: 50,
        nextRentCycleDate: '2026-08-01',
      });

    const second = await request(app)
      .post('/api/leases/lease-1/utility-bills')
      .send({
        landlordId: 'landlord-1',
        utilityType: 'electricity',
        totalAmount: 10000,
        tenantShareAmount: 2500,
        nextRentCycleDate: '2026-08-01',
      });

    expect(second.status).toBe(200);
    expect(second.body.data.utilityShareTotal).toBe(12500);
    expect(second.body.data.upcomingPaymentTotal).toBe(112500);
  });

  test('returns 404 for upcoming payment approval before due date', async () => {
    await request(app)
      .post('/api/leases/lease-1/utility-bills')
      .send({
        landlordId: 'landlord-1',
        utilityType: 'water',
        totalAmount: 20000,
        tenantSharePercent: 50,
        nextRentCycleDate: '2026-08-01',
      });

    const response = await request(app)
      .get('/api/tenants/tenant-1/upcoming-payment')
      .query({ asOfDate: '2026-07-30' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('No upcoming payment ready for approval');
  });

  test('rejects utility bill upload from landlord not tied to lease', async () => {
    const response = await request(app)
      .post('/api/leases/lease-1/utility-bills')
      .send({
        landlordId: 'landlord-2',
        utilityType: 'water',
        totalAmount: 20000,
        tenantSharePercent: 50,
        nextRentCycleDate: '2026-08-01',
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Landlord is not authorized for this lease');
  });
});
