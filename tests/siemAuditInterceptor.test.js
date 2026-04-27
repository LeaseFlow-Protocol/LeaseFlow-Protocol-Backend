/**
 * Tests for Issue #132: Comprehensive Audit Logging to External SIEM
 */

const { scrubPii, createSiemInterceptor } = require('../src/middleware/siemAuditInterceptor');

// Mock BullMQ Queue and Worker
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const { SiemAuditService } = require('../src/middleware/siemAuditInterceptor');

describe('Issue #132: SIEM Audit Logging', () => {
  describe('scrubPii()', () => {
    it('redacts password fields', () => {
      const result = scrubPii({ username: 'alice', password: 'secret123' });
      expect(result.username).toBe('alice');
      expect(result.password).toBe('[REDACTED]');
    });

    it('redacts nested PII fields', () => {
      const result = scrubPii({
        user: { email: 'alice@example.com', name: 'Alice' },
        payment: { credit_card: '4111111111111111', amount: 100 },
      });
      expect(result.user.email).toBe('[REDACTED]');
      expect(result.user.name).toBe('Alice');
      expect(result.payment.credit_card).toBe('[REDACTED]');
      expect(result.payment.amount).toBe(100);
    });

    it('redacts all known PII field names', () => {
      const piiFields = {
        password: 'x', ssn: 'x', credit_card: 'x', bank_account: 'x',
        private_key: 'x', mnemonic: 'x', access_token: 'x', refresh_token: 'x',
        date_of_birth: 'x', passport: 'x', email: 'x', phone: 'x',
      };
      const result = scrubPii(piiFields);
      for (const key of Object.keys(piiFields)) {
        expect(result[key]).toBe('[REDACTED]');
      }
    });

    it('preserves non-PII fields', () => {
      const result = scrubPii({ leaseId: 'lease-123', amount: 500, status: 'active' });
      expect(result).toEqual({ leaseId: 'lease-123', amount: 500, status: 'active' });
    });

    it('handles null and non-object values safely', () => {
      expect(scrubPii(null)).toBeNull();
      expect(scrubPii('string')).toBe('string');
      expect(scrubPii(42)).toBe(42);
    });

    it('handles arrays', () => {
      const result = scrubPii([{ password: 'x', name: 'Alice' }]);
      expect(result[0].password).toBe('[REDACTED]');
      expect(result[0].name).toBe('Alice');
    });
  });

  describe('SiemAuditService', () => {
    let service;

    beforeEach(() => {
      jest.useFakeTimers();
      service = new SiemAuditService({}, { provider: 'console' });
    });

    afterEach(async () => {
      clearInterval(service.flushInterval);
      jest.useRealTimers();
    });

    it('enqueues a log entry when log() is called', async () => {
      await service.log({
        lessor_id: 'lessor-1',
        user_pubkey: 'GABC123',
        endpoint: '/api/leases',
        method: 'POST',
        ip_address: '1.2.3.4',
        user_agent: 'test',
        status_code: 200,
        payload: { leaseId: 'lease-1', amount: 500 },
      });

      expect(service.buffer).toHaveLength(1);
      expect(service.buffer[0].lessor_id).toBe('lessor-1');
      expect(service.buffer[0].payload).toEqual({ leaseId: 'lease-1', amount: 500 });
    });

    it('scrubs PII from payload before buffering', async () => {
      await service.log({
        endpoint: '/api/kyc',
        method: 'POST',
        ip_address: '1.2.3.4',
        status_code: 200,
        payload: { email: 'alice@example.com', password: 'secret', leaseId: 'lease-1' },
      });

      expect(service.buffer[0].payload.email).toBe('[REDACTED]');
      expect(service.buffer[0].payload.password).toBe('[REDACTED]');
      expect(service.buffer[0].payload.leaseId).toBe('lease-1');
    });

    it('flushes buffer to queue every 5 seconds', async () => {
      await service.log({ endpoint: '/api/leases', method: 'POST', ip_address: '1.2.3.4', status_code: 200 });
      expect(service.buffer).toHaveLength(1);

      // Trigger flush
      await service._flushBuffer();
      expect(service.buffer).toHaveLength(0);
      expect(service.queue.add).toHaveBeenCalledWith('flush-batch', expect.objectContaining({ logs: expect.any(Array) }));
    });

    it('generates immutable forensic footprint for admin lease alteration', async () => {
      await service.log({
        lessor_id: 'admin-1',
        user_pubkey: 'GADMIN123',
        endpoint: '/api/leases/lease-1',
        method: 'PATCH',
        ip_address: '10.0.0.1',
        user_agent: 'admin-dashboard/1.0',
        status_code: 200,
        payload: { rentAmount: 2000 },
      });

      const entry = service.buffer[0];
      expect(entry).toMatchObject({
        lessor_id: 'admin-1',
        user_pubkey: 'GADMIN123',
        endpoint: '/api/leases/lease-1',
        method: 'PATCH',
        ip_address: '10.0.0.1',
        status_code: 200,
      });
      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
    });
  });

  describe('createSiemInterceptor()', () => {
    it('only intercepts state-changing methods (POST, PATCH, DELETE, PUT)', async () => {
      const mockService = { log: jest.fn().mockResolvedValue(undefined) };
      const middleware = createSiemInterceptor(mockService);

      const makeReq = (method) => ({
        method,
        originalUrl: '/api/leases',
        headers: { 'user-agent': 'test' },
        ip: '1.2.3.4',
        actor: null,
        body: {},
      });

      const makeRes = () => {
        const res = { statusCode: 200, json: null };
        res.json = jest.fn(function (body) { return body; });
        return res;
      };

      const next = jest.fn();

      // GET should pass through without logging
      middleware(makeReq('GET'), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(mockService.log).not.toHaveBeenCalled();

      next.mockClear();

      // POST should intercept
      const postRes = makeRes();
      middleware(makeReq('POST'), postRes, next);
      postRes.json({ success: true }); // trigger the intercepted json()
      expect(mockService.log).toHaveBeenCalled();
    });

    it('captures lessor_id and user_pubkey from req.actor', async () => {
      const mockService = { log: jest.fn().mockResolvedValue(undefined) };
      const middleware = createSiemInterceptor(mockService);

      const req = {
        method: 'DELETE',
        originalUrl: '/api/leases/lease-1',
        headers: { 'user-agent': 'test' },
        ip: '5.6.7.8',
        actor: { id: 'lessor-99', pubkey: 'GLESSOR99' },
        body: {},
      };
      const res = { statusCode: 204, json: null };
      res.json = jest.fn(function (body) { return body; });
      const next = jest.fn();

      middleware(req, res, next);
      res.json({});

      expect(mockService.log).toHaveBeenCalledWith(expect.objectContaining({
        lessor_id: 'lessor-99',
        user_pubkey: 'GLESSOR99',
        endpoint: '/api/leases/lease-1',
        method: 'DELETE',
        ip_address: '5.6.7.8',
      }));
    });
  });
});
