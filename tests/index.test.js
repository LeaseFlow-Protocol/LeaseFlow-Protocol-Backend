const request = require('supertest');

const { createApp } = require('../index');
const { loadConfig } = require('../src/config');
const { AppDatabase } = require('../src/db/appDatabase');
const { LeaseRenewalService, STATUS } = require('../src/services/leaseRenewalService');
const { NotificationService } = require('../src/services/notificationService');
const { ActorAuthService } = require('../src/services/actorAuthService');
const { LeaseRenewalJob } = require('../src/jobs/leaseRenewalJob');

describe('LeaseFlow Backend API', () => {
  let config;
  let database;
  let actorAuthService;
  let notificationService;
  let sorobanLeaseService;
  let leaseRenewalService;
  let leaseRenewalJob;
  let app;

  beforeEach(() => {
    config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_FILENAME: ':memory:',
      AUTH_JWT_SECRET: 'leaseflow-test-secret',
      LEASE_RENEWAL_SCAN_WINDOW_DAYS: '0',
    });

    database = new AppDatabase(':memory:');
    actorAuthService = new ActorAuthService(config);
    notificationService = new NotificationService(database);
    sorobanLeaseService = {
      prepareRenewalContract: jest.fn(({ proposal }) => ({
        contractId: `prepared-${proposal.id}`,
        sourceProposalId: proposal.id,
      })),
    };
    leaseRenewalService = new LeaseRenewalService(
      database,
      notificationService,
      sorobanLeaseService,
      config,
    );
    leaseRenewalJob = new LeaseRenewalJob(leaseRenewalService);
    app = createApp({
      config,
      database,
      actorAuthService,
      notificationService,
      sorobanLeaseService,
      leaseRenewalService,
    });
  });

  function seedEligibleLease() {
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
    database.seedRenewalRule({
      landlordId: 'landlord-1',
      increaseType: 'percentage',
      increaseValue: 5,
      termMonths: 12,
      noticeDays: 60,
    });
  }

  function authHeader(actorId, role) {
    return `Bearer ${actorAuthService.issueToken({ actorId, role })}`;
  }

  it('should return 200 and project details on GET /', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toEqual({
      project: 'LeaseFlow Protocol',
      status: 'Active',
      contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4',
    });
  });

  it('generates a proposal for an active lease expiring in 60 days', () => {
    seedEligibleLease();

    const result = leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const proposal = database.getProposalByLeaseCycle('lease-1', '2026-08-01');

    expect(result.generated).toBe(1);
    expect(proposal).toBeTruthy();
    expect(proposal.proposedTerms.rentAmount).toBe(105000);
    expect(proposal.proposedTerms.startDate).toBe('2026-08-01');
    expect(proposal.proposedTerms.endDate).toBe('2027-07-31');
    expect(proposal.status).toBe(STATUS.generated);
  });

  it('does not generate proposals for leases outside the eligibility window', () => {
    seedEligibleLease();

    const result = leaseRenewalJob.run({ asOfDate: '2026-05-31' });

    expect(result.generated).toBe(0);
    expect(database.getProposalByLeaseCycle('lease-1', '2026-08-01')).toBeNull();
  });

  it('does not generate proposals for inactive leases', () => {
    database.seedLease({
      id: 'lease-2',
      landlordId: 'landlord-2',
      tenantId: 'tenant-2',
      status: 'terminated',
      rentAmount: 120000,
      currency: 'USDC',
      startDate: '2025-08-01',
      endDate: '2026-07-31',
    });
    database.seedRenewalRule({
      landlordId: 'landlord-2',
      increaseType: 'percentage',
      increaseValue: 5,
      termMonths: 12,
      noticeDays: 60,
    });

    const result = leaseRenewalJob.run({ asOfDate: '2026-06-01' });

    expect(result.generated).toBe(0);
    expect(database.getProposalByLeaseCycle('lease-2', '2026-08-01')).toBeNull();
  });

  it('prevents duplicate proposal generation on repeated job runs', () => {
    seedEligibleLease();

    const first = leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const second = leaseRenewalJob.run({ asOfDate: '2026-06-01' });

    expect(first.generated).toBe(1);
    expect(second.generated).toBe(0);
    expect(database.getProposalByLeaseCycle('lease-1', '2026-08-01')).toBeTruthy();
  });

  it('creates notifications for both landlord and tenant', () => {
    seedEligibleLease();

    leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const proposal = database.getProposalByLeaseCycle('lease-1', '2026-08-01');
    const notifications = database.listNotificationsByProposalId(proposal.id);

    expect(notifications).toHaveLength(2);
    expect(notifications.map((entry) => entry.recipientRole).sort()).toEqual([
      'landlord',
      'tenant',
    ]);
  });

  it('lets the landlord and tenant accept and then prepares a Soroban contract', async () => {
    seedEligibleLease();
    leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const proposal = database.getProposalByLeaseCycle('lease-1', '2026-08-01');

    const landlordAccept = await request(app)
      .post(`/renewal-proposals/${proposal.id}/accept`)
      .set('Authorization', authHeader('landlord-1', 'landlord'));

    expect(landlordAccept.status).toBe(200);
    expect(landlordAccept.body.data.status).toBe(STATUS.landlordAccepted);
    expect(sorobanLeaseService.prepareRenewalContract).not.toHaveBeenCalled();

    const tenantAccept = await request(app)
      .post(`/renewal-proposals/${proposal.id}/accept`)
      .set('Authorization', authHeader('tenant-1', 'tenant'));

    expect(tenantAccept.status).toBe(200);
    expect(tenantAccept.body.data.status).toBe(STATUS.contractPrepared);
    expect(tenantAccept.body.data.sorobanContractStatus).toBe('prepared');
    expect(sorobanLeaseService.prepareRenewalContract).toHaveBeenCalledTimes(1);
  });

  it('prevents unauthorized users from accepting a proposal', async () => {
    seedEligibleLease();
    leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const proposal = database.getProposalByLeaseCycle('lease-1', '2026-08-01');

    const response = await request(app)
      .post(`/renewal-proposals/${proposal.id}/accept`)
      .set('Authorization', authHeader('tenant-999', 'tenant'));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('You are not authorized to act on this proposal');
  });

  it('allows a participant to reject an open proposal', async () => {
    seedEligibleLease();
    leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const proposal = database.getProposalByLeaseCycle('lease-1', '2026-08-01');

    const response = await request(app)
      .post(`/renewal-proposals/${proposal.id}/reject`)
      .set('Authorization', authHeader('tenant-1', 'tenant'));

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(STATUS.rejected);
    expect(response.body.data.rejectedBy).toBe('tenant');
  });

  it('does not prepare Soroban before both parties accept', async () => {
    seedEligibleLease();
    leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const proposal = database.getProposalByLeaseCycle('lease-1', '2026-08-01');

    await request(app)
      .post(`/renewal-proposals/${proposal.id}/accept`)
      .set('Authorization', authHeader('tenant-1', 'tenant'));

    const stored = database.getRenewalProposalById(proposal.id);
    expect(stored.status).toBe(STATUS.tenantAccepted);
    expect(stored.sorobanContractStatus).toBe('not_started');
    expect(sorobanLeaseService.prepareRenewalContract).not.toHaveBeenCalled();
  });

  it('lets participants view only their own proposal', async () => {
    seedEligibleLease();
    leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const proposal = database.getProposalByLeaseCycle('lease-1', '2026-08-01');

    const allowed = await request(app)
      .get(`/renewal-proposals/${proposal.id}`)
      .set('Authorization', authHeader('tenant-1', 'tenant'));

    expect(allowed.status).toBe(200);
    expect(allowed.body.data.id).toBe(proposal.id);

    const denied = await request(app)
      .get(`/renewal-proposals/${proposal.id}`)
      .set('Authorization', authHeader('landlord-999', 'landlord'));

    expect(denied.status).toBe(403);
  });

  it('handles missing landlord renewal rules safely', () => {
    database.seedLease({
      id: 'lease-3',
      landlordId: 'landlord-3',
      tenantId: 'tenant-3',
      status: 'active',
      rentAmount: 90000,
      currency: 'USDC',
      startDate: '2025-08-01',
      endDate: '2026-07-31',
    });

    const result = leaseRenewalJob.run({ asOfDate: '2026-06-01' });

    expect(result.generated).toBe(0);
    expect(database.getProposalByLeaseCycle('lease-3', '2026-08-01')).toBeNull();
  });

  it('does not allow accepting a rejected proposal', async () => {
    seedEligibleLease();
    leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const proposal = database.getProposalByLeaseCycle('lease-1', '2026-08-01');

    await request(app)
      .post(`/renewal-proposals/${proposal.id}/reject`)
      .set('Authorization', authHeader('landlord-1', 'landlord'));

    const response = await request(app)
      .post(`/renewal-proposals/${proposal.id}/accept`)
      .set('Authorization', authHeader('tenant-1', 'tenant'));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Proposal can no longer be accepted');
  });

  it('keeps acceptance state intact if Soroban preparation fails', async () => {
    seedEligibleLease();
    sorobanLeaseService.prepareRenewalContract.mockImplementation(() => {
      throw new Error('Soroban unavailable');
    });
    leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const proposal = database.getProposalByLeaseCycle('lease-1', '2026-08-01');

    await request(app)
      .post(`/renewal-proposals/${proposal.id}/accept`)
      .set('Authorization', authHeader('landlord-1', 'landlord'));

    const response = await request(app)
      .post(`/renewal-proposals/${proposal.id}/accept`)
      .set('Authorization', authHeader('tenant-1', 'tenant'));

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(STATUS.fullyAccepted);
    expect(response.body.data.sorobanContractStatus).toBe('failed');
    expect(response.body.warning).toBe(
      'Proposal fully accepted, but Soroban contract preparation failed',
    );
  });

  it('continues scanning other leases if one lease errors', () => {
    seedEligibleLease();
    database.seedLease({
      id: 'lease-4',
      landlordId: 'landlord-4',
      tenantId: 'tenant-4',
      status: 'active',
      rentAmount: 100000,
      currency: 'USDC',
      startDate: '2025-08-01',
      endDate: '2026-07-31',
    });
    database.seedRenewalRule({
      landlordId: 'landlord-4',
      increaseType: 'unsupported',
      increaseValue: 0,
      termMonths: 12,
      noticeDays: 60,
    });

    const result = leaseRenewalJob.run({ asOfDate: '2026-06-01' });

    expect(result.generated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].leaseId).toBe('lease-4');
  });

  it('blocks unauthenticated proposal access', async () => {
    seedEligibleLease();
    leaseRenewalJob.run({ asOfDate: '2026-06-01' });
    const proposal = database.getProposalByLeaseCycle('lease-1', '2026-08-01');

    const response = await request(app).get(`/renewal-proposals/${proposal.id}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication required');
  });
});
