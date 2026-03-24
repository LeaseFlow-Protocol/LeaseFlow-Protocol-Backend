const crypto = require('crypto');

const WEIGHTS = {
  onTimePayments: 0.5,
  leaseCompletion: 0.3,
  successfulDepositReturns: 0.2
};

const SCORE_RANGE = {
  min: 300,
  max: 850
};

const DEFAULT_CACHE_TTL_SECONDS = 60 * 60;
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 30;

function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, numerator / denominator));
}

function getBreakdown(metrics) {
  const onTimePaymentsRatio = safeRatio(metrics.onTimePayments, metrics.totalPayments);
  const leaseCompletionRatio = safeRatio(metrics.completedLeases, metrics.totalLeases);
  const successfulDepositReturnsRatio = safeRatio(
    metrics.successfulDepositReturns,
    metrics.totalDepositReturns
  );

  return {
    onTimePayments: Math.round(onTimePaymentsRatio * 100),
    leaseCompletion: Math.round(leaseCompletionRatio * 100),
    successfulDepositReturns: Math.round(successfulDepositReturnsRatio * 100)
  };
}

function calculateScore(metrics) {
  const breakdown = getBreakdown(metrics);
  const weightedPercent =
    breakdown.onTimePayments * WEIGHTS.onTimePayments +
    breakdown.leaseCompletion * WEIGHTS.leaseCompletion +
    breakdown.successfulDepositReturns * WEIGHTS.successfulDepositReturns;

  const spread = SCORE_RANGE.max - SCORE_RANGE.min;
  const score = Math.round(SCORE_RANGE.min + (weightedPercent / 100) * spread);

  return {
    score,
    breakdown
  };
}

function parseDurationSeconds(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function createSignedToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const content = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(content)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${content}.${signature}`;
}

function verifySignedToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const content = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(content)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw new Error('Invalid token signature');
  }

  return JSON.parse(fromBase64Url(encodedPayload));
}

class TenantCreditScoreAggregator {
  constructor(options = {}) {
    this.cacheTtlSeconds = parseDurationSeconds(
      options.cacheTtlSeconds,
      DEFAULT_CACHE_TTL_SECONDS
    );
    this.tokenTtlSeconds = parseDurationSeconds(
      options.tokenTtlSeconds,
      DEFAULT_TOKEN_TTL_SECONDS
    );
    this.signingSecret = options.signingSecret || process.env.SHARE_TOKEN_SECRET || 'leaseflow-dev-secret';
    this.cache = new Map();
  }

  getCached(tenantId) {
    const key = String(tenantId || '');
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() >= item.expiresAtMs) {
      this.cache.delete(key);
      return null;
    }

    return {
      tenantId: key,
      score: item.score,
      breakdown: item.breakdown,
      expiresAt: new Date(item.expiresAtMs).toISOString()
    };
  }

  computeAndCache(tenantId, metrics, ttlSeconds) {
    const key = String(tenantId || '').trim();
    if (!key) {
      throw new Error('tenantId is required');
    }

    const { score, breakdown } = calculateScore(metrics);
    const ttl = parseDurationSeconds(ttlSeconds, this.cacheTtlSeconds);
    const expiresAtMs = Date.now() + ttl * 1000;
    this.cache.set(key, { score, breakdown, expiresAtMs });

    return {
      tenantId: key,
      score,
      breakdown,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  getOrCompute(tenantId, metrics, ttlSeconds) {
    const cached = this.getCached(tenantId);
    if (cached) {
      return { ...cached, cached: true };
    }
    const computed = this.computeAndCache(tenantId, metrics, ttlSeconds);
    return { ...computed, cached: false };
  }

  generateShareToken(tenantId, tokenTtlSeconds) {
    const cached = this.getCached(tenantId);
    if (!cached) {
      throw new Error('No cached score found for tenant');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttl = parseDurationSeconds(tokenTtlSeconds, this.tokenTtlSeconds);
    const payload = {
      tenantId: cached.tenantId,
      score: cached.score,
      breakdown: cached.breakdown,
      iat: nowSeconds,
      exp: nowSeconds + ttl
    };

    const token = createSignedToken(payload, this.signingSecret);
    return { token, payload };
  }

  verifyShareToken(token) {
    const payload = verifySignedToken(token, this.signingSecret);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds) {
      throw new Error('Token expired');
    }
    return payload;
  }
}

module.exports = {
  TenantCreditScoreAggregator,
  calculateScore
};
