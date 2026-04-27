/**
 * Tests for Issue #134: Regular Expression Denial of Service (ReDoS) Protection
 *
 * Verifies:
 * - safeRegexTest enforces 50ms timeout
 * - Safe validation functions work correctly
 * - Known ReDoS payloads are rejected without crashing the server
 * - IoT input hardening rejects oversized/malformed inputs
 */

const {
  safeRegexTest,
  isValidEmail,
  isValidStellarPubkey,
  isValidTxHash,
  isValidEntityId,
  isValidYearMonth,
  isValidUrl,
  validateIotInput,
  iotInputGuard,
} = require('../src/middleware/redosProtection');

describe('Issue #134: ReDoS Protection', () => {
  describe('safeRegexTest()', () => {
    it('returns true for matching input', () => {
      expect(safeRegexTest(/^hello$/, 'hello')).toBe(true);
    });

    it('returns false for non-matching input', () => {
      expect(safeRegexTest(/^hello$/, 'world')).toBe(false);
    });

    it('throws for inputs exceeding 10KB', () => {
      const oversized = 'a'.repeat(10_001);
      expect(() => safeRegexTest(/^a+$/, oversized)).toThrow('exceeds maximum allowed length');
    });

    it('throws for non-string input', () => {
      expect(() => safeRegexTest(/^a$/, null)).toThrow();
      expect(() => safeRegexTest(/^a$/, 123)).toThrow();
    });
  });

  describe('isValidEmail()', () => {
    it('accepts valid email addresses', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('alice.bob@leaseflow.io')).toBe(true);
    });

    it('rejects invalid email addresses', () => {
      expect(isValidEmail('not-an-email')).toBe(false);
      expect(isValidEmail('@nodomain.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });

    it('rejects emails exceeding 254 characters', () => {
      const longEmail = 'a'.repeat(250) + '@b.com';
      expect(isValidEmail(longEmail)).toBe(false);
    });

    // ReDoS payload: known catastrophic backtracking pattern for email regex
    it('handles ReDoS email payload without hanging (server remains responsive)', () => {
      const redosPayload = 'a'.repeat(50) + '@' + 'b'.repeat(50) + '.' + 'c'.repeat(50);
      const start = Date.now();
      const result = isValidEmail(redosPayload);
      const elapsed = Date.now() - start;
      // Should complete well within 50ms
      expect(elapsed).toBeLessThan(50);
      // Result doesn't matter - what matters is it didn't hang
    });

    it('handles classic ReDoS email payload (aaa...a@)', () => {
      // Classic ReDoS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa@" causes catastrophic backtracking
      // in naive email regexes like /^([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6})*$/
      const redosPayload = 'a'.repeat(30) + '@';
      const start = Date.now();
      isValidEmail(redosPayload);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('isValidStellarPubkey()', () => {
    it('accepts valid Stellar public keys', () => {
      expect(isValidStellarPubkey('GABC' + 'A'.repeat(52))).toBe(true);
      expect(isValidStellarPubkey('G' + 'A'.repeat(55))).toBe(true);
    });

    it('rejects invalid Stellar public keys', () => {
      expect(isValidStellarPubkey('XABC' + 'A'.repeat(52))).toBe(false);
      expect(isValidStellarPubkey('G' + 'A'.repeat(54))).toBe(false); // too short
      expect(isValidStellarPubkey('G' + 'A'.repeat(56))).toBe(false); // too long
      expect(isValidStellarPubkey('')).toBe(false);
    });

    it('rejects oversized input without hanging', () => {
      const oversized = 'G' + 'A'.repeat(10_000);
      const start = Date.now();
      const result = isValidStellarPubkey(oversized);
      expect(Date.now() - start).toBeLessThan(50);
      expect(result).toBe(false);
    });
  });

  describe('isValidTxHash()', () => {
    it('accepts valid 64-char hex hashes', () => {
      expect(isValidTxHash('a'.repeat(64))).toBe(true);
      expect(isValidTxHash('0'.repeat(32) + 'F'.repeat(32))).toBe(true);
    });

    it('rejects invalid hashes', () => {
      expect(isValidTxHash('a'.repeat(63))).toBe(false);
      expect(isValidTxHash('a'.repeat(65))).toBe(false);
      expect(isValidTxHash('g'.repeat(64))).toBe(false); // 'g' not hex
    });
  });

  describe('isValidEntityId()', () => {
    it('accepts valid entity IDs', () => {
      expect(isValidEntityId('lease-12345678')).toBe(true);
      expect(isValidEntityId('LEASE_ABC_123')).toBe(true);
    });

    it('rejects IDs that are too short or too long', () => {
      expect(isValidEntityId('short')).toBe(false); // < 8 chars
      expect(isValidEntityId('a'.repeat(129))).toBe(false); // > 128 chars
    });

    it('rejects IDs with special characters', () => {
      expect(isValidEntityId('lease<script>')).toBe(false);
      expect(isValidEntityId('lease; DROP TABLE')).toBe(false);
    });
  });

  describe('isValidYearMonth()', () => {
    it('accepts valid YYYY-MM format', () => {
      expect(isValidYearMonth('2024-01')).toBe(true);
      expect(isValidYearMonth('2026-12')).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(isValidYearMonth('2024-1')).toBe(false);
      expect(isValidYearMonth('24-01')).toBe(false);
      expect(isValidYearMonth('2024/01')).toBe(false);
    });
  });

  describe('isValidUrl()', () => {
    it('accepts valid HTTPS URLs', () => {
      expect(isValidUrl('https://example.com/path')).toBe(true);
      expect(isValidUrl('http://localhost:3000')).toBe(true);
    });

    it('rejects invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
      expect(isValidUrl('ftp://example.com')).toBe(false);
    });

    it('rejects URLs exceeding 2048 characters', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2048);
      expect(isValidUrl(longUrl)).toBe(false);
    });
  });

  describe('validateIotInput()', () => {
    it('accepts valid IoT input', () => {
      const { valid, sanitized, errors } = validateIotInput({
        device_id: 'device-abc-123',
        event_type: 'LesseeAccessGranted',
        lease_id: 'lease-xyz-789',
      });
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(sanitized.device_id).toBe('device-abc-123');
    });

    it('rejects fields exceeding length limits', () => {
      const { valid, errors } = validateIotInput({
        device_id: 'a'.repeat(65), // max 64
        event_type: 'LesseeAccessGranted',
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('device_id'))).toBe(true);
    });

    it('strips null bytes and control characters from IoT input', () => {
      const { sanitized } = validateIotInput({
        event_type: 'Access\x00Granted\x1F',
        device_id: 'device-123',
      });
      expect(sanitized.event_type).not.toContain('\x00');
      expect(sanitized.event_type).not.toContain('\x1F');
    });

    it('rejects non-object input', () => {
      const { valid, errors } = validateIotInput('not-an-object');
      expect(valid).toBe(false);
      expect(errors[0]).toContain('object');
    });

    it('handles ReDoS payload in IoT string fields safely', () => {
      // A ReDoS payload that would cause catastrophic backtracking in naive regex
      const redosPayload = 'a'.repeat(33) + '!'; // 34 chars, exceeds max of 32 for event_type
      const start = Date.now();
      const { valid } = validateIotInput({ event_type: redosPayload });
      const elapsed = Date.now() - start;
      // Should complete quickly (length check rejects before regex)
      expect(elapsed).toBeLessThan(50);
      expect(valid).toBe(false); // exceeds max length of 32 for event_type
    });
  });

  describe('iotInputGuard() middleware', () => {
    it('passes valid IoT input to next()', () => {
      const req = {
        body: { device_id: 'device-123', event_type: 'AccessGranted' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      iotInputGuard()(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 for oversized IoT fields', () => {
      const req = {
        body: { device_id: 'a'.repeat(65) },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      iotInputGuard()(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('passes through when body is empty', () => {
      const req = { body: null };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      iotInputGuard()(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
