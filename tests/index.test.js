const request = require('supertest');
const {
  app,
  listings,
  resetListings,
  hasPositiveTrustline,
} = require('../index');

describe('LeaseFlow Backend API', () => {
  beforeEach(() => {
    resetListings();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });


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
    expect(response.body).toMatchObject({
      project: 'LeaseFlow Protocol Backend',
      status: 'Operational',
      version: '1.0.0'
    });
    expect(response.body.endpoints).toBeDefined();
    expect(response.body.endpoints.upload_lease).toBe('POST /api/leases/upload');
    expect(response.body).toEqual({
      project: 'LeaseFlow Protocol',
      status: 'Active',
      contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4',
    });
  });

  it('should require listing fields on POST /listings', async () => {
    const response = await request(app).post('/listings').send({ lister: 'GABC' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Missing required fields',
      required: ['lister', 'assetCode', 'assetIssuer', 'price'],
    });
    expect(listings).toHaveLength(0);
  });

  it('should create a listing when Horizon shows a positive trustline', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        balances: [
          {
            asset_type: 'credit_alphanum12',
            asset_code: 'LEASE-NFT-1',
            asset_issuer: 'GISSUER123',
            balance: '1.0000000',
          },
        ],
      }),
    });

    const response = await request(app).post('/listings').send({
      lister: 'GLISTER123',
      assetCode: 'LEASE-NFT-1',
      assetIssuer: 'GISSUER123',
      price: '1500',
      metadata: { leaseId: 'lease-001' },
    });

    expect(response.status).toBe(201);
    expect(response.body.listing).toMatchObject({
      lister: 'GLISTER123',
      assetCode: 'LEASE-NFT-1',
      assetIssuer: 'GISSUER123',
      price: '1500',
      metadata: { leaseId: 'lease-001' },
    });
    expect(listings).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://horizon.stellar.org/accounts/GLISTER123'
    );
  });

  it('should reject listings when the trustline is missing', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        balances: [
          {
            asset_type: 'native',
            balance: '100.0',
          },
        ],
      }),
    });

    const response = await request(app).post('/listings').send({
      lister: 'GLISTER456',
      assetCode: 'LEASE-NFT-2',
      assetIssuer: 'GISSUER456',
      price: '2200',
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'Lister does not own the NFT on-chain',
      reason: 'TRUSTLINE_MISSING_OR_EMPTY',
    });
    expect(listings).toHaveLength(0);
  });

  it('should reject listings when the trustline exists with zero balance', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        balances: [
          {
            asset_type: 'credit_alphanum12',
            asset_code: 'LEASE-NFT-3',
            asset_issuer: 'GISSUER789',
            balance: '0.0000000',
          },
        ],
      }),
    });

    const response = await request(app).post('/listings').send({
      lister: 'GLISTER789',
      assetCode: 'LEASE-NFT-3',
      assetIssuer: 'GISSUER789',
      price: '3000',
    });

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('TRUSTLINE_MISSING_OR_EMPTY');
    expect(listings).toHaveLength(0);
  });

  it('should reject listings when Horizon account lookup returns 404', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const response = await request(app).post('/listings').send({
      lister: 'GMISSINGACCOUNT',
      assetCode: 'LEASE-NFT-4',
      assetIssuer: 'GISSUER404',
      price: '3500',
    });

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('ACCOUNT_NOT_FOUND');
    expect(listings).toHaveLength(0);
  });

  it('should surface Horizon failures without inserting a listing', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 503,
    });

    const response = await request(app).post('/listings').send({
      lister: 'GUPSTREAMFAIL',
      assetCode: 'LEASE-NFT-5',
      assetIssuer: 'GISSUER500',
      price: '4100',
    });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: 'Unable to verify ownership against Horizon',
      details: 'Horizon lookup failed with status 503',
    });
    expect(listings).toHaveLength(0);
  });

  it('should detect matching trustlines with positive balances only', () => {
    expect(
      hasPositiveTrustline(
        [
          {
            asset_type: 'credit_alphanum12',
            asset_code: 'LEASE-NFT-6',
            asset_issuer: 'GISSUERTRUST',
            balance: '1.0000000',
          },
          {
            asset_type: 'credit_alphanum12',
            asset_code: 'LEASE-NFT-6',
            asset_issuer: 'GISSUERTRUST',
            balance: '0.0000000',
          },
        ],
        'LEASE-NFT-6',
        'GISSUERTRUST'
      )
    ).toBe(true);

    expect(
      hasPositiveTrustline(
        [
          {
            asset_type: 'credit_alphanum12',
            asset_code: 'LEASE-NFT-6',
            asset_issuer: 'GISSUERTRUST',
            balance: '0.0000000',
          },
        ],
        'LEASE-NFT-6',
        'GISSUERTRUST'
      )
    ).toBe(false);
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

  it('should compute and cache tenant credit score', async () => {
    const payload = {
      tenantId: 'tenant-123',
      metrics: {
        onTimePayments: 9,
        totalPayments: 10,
        completedLeases: 3,
        totalLeases: 4,
        successfulDepositReturns: 2,
        totalDepositReturns: 2
      }
    };

    const first = await request(app).post('/tenant-credit-score').send(payload);
    expect(first.status).toBe(200);
    expect(first.body.tenantId).toBe('tenant-123');
    expect(first.body.cached).toBe(false);
    expect(first.body.score).toBe(781);
    expect(first.body.breakdown).toEqual({
      onTimePayments: 90,
      leaseCompletion: 75,
      successfulDepositReturns: 100
    });
    expect(typeof first.body.expiresAt).toBe('string');

    const second = await request(app).post('/tenant-credit-score').send(payload);
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.score).toBe(781);
  });

  it('should return cached score for tenant id', async () => {
    const response = await request(app).get('/tenant-credit-score/tenant-123');
    expect(response.status).toBe(200);
    expect(response.body.tenantId).toBe('tenant-123');
    expect(response.body.score).toBe(781);
  });

  it('should generate and verify a signed share token', async () => {
    const tokenResponse = await request(app)
      .post('/tenant-credit-score/share-token')
      .send({ tenantId: 'tenant-123' });

    expect(tokenResponse.status).toBe(200);
    expect(typeof tokenResponse.body.token).toBe('string');
    expect(tokenResponse.body.payload.tenantId).toBe('tenant-123');
    expect(tokenResponse.body.payload.score).toBe(781);

    const verifyResponse = await request(app)
      .post('/tenant-credit-score/verify-token')
      .send({ token: tokenResponse.body.token });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.valid).toBe(true);
    expect(verifyResponse.body.payload.tenantId).toBe('tenant-123');
    expect(verifyResponse.body.payload.score).toBe(781);
  });
});
