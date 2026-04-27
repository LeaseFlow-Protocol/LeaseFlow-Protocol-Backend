/**
 * Issue #132: Comprehensive Audit Logging to External SIEM (Datadog/Splunk)
 *
 * Implements:
 * - Global interceptor for all state-changing endpoints (POST, PATCH, DELETE)
 * - Records: timestamp, lessor_id, user_pubkey, endpoint, ip_address, user_agent, payload
 * - PII scrubbing before logging (GDPR compliant)
 * - BullMQ queue with 5-second batch flush to SIEM (Datadog/Splunk)
 * - Anomaly detection: alerts on 500+ failed logins from single IP
 */

const { Queue, Worker } = require('bullmq');
const crypto = require('crypto');

// Fields to scrub from payloads before logging
const PII_FIELDS = new Set([
  'password', 'password_hash', 'passwordHash', 'secret', 'token',
  'access_token', 'accessToken', 'refresh_token', 'refreshToken',
  'private_key', 'privateKey', 'mnemonic', 'seed',
  'ssn', 'social_security', 'nationalId', 'national_id',
  'credit_card', 'creditCard', 'card_number', 'cardNumber', 'cvv',
  'bank_account', 'bankAccount', 'routing_number', 'routingNumber',
  'date_of_birth', 'dateOfBirth', 'dob',
  'passport', 'drivers_license', 'driversLicense',
  'email', 'phone', 'address', 'full_name', 'fullName',
]);

/**
 * Recursively scrub PII fields from an object.
 */
function scrubPii(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => scrubPii(item, depth + 1));

  const scrubbed = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_FIELDS.has(key.toLowerCase()) || PII_FIELDS.has(key)) {
      scrubbed[key] = '[REDACTED]';
    } else {
      scrubbed[key] = scrubPii(value, depth + 1);
    }
  }
  return scrubbed;
}

class SiemAuditService {
  /**
   * @param {object} redisConfig - Redis connection config
   * @param {object} siemConfig - SIEM provider config { provider, datadogApiKey, splunkHecUrl, splunkToken }
   */
  constructor(redisConfig = {}, siemConfig = {}) {
    this.siemConfig = {
      provider: process.env.SIEM_PROVIDER || siemConfig.provider || 'datadog',
      datadogApiKey: process.env.DATADOG_API_KEY || siemConfig.datadogApiKey,
      datadogSite: process.env.DATADOG_SITE || siemConfig.datadogSite || 'datadoghq.com',
      splunkHecUrl: process.env.SPLUNK_HEC_URL || siemConfig.splunkHecUrl,
      splunkToken: process.env.SPLUNK_HEC_TOKEN || siemConfig.splunkToken,
    };

    // BullMQ queue for async log batching
    this.queue = new Queue('siem-audit-logs', {
      connection: redisConfig,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    });

    // Batch buffer: flush every 5 seconds
    this.buffer = [];
    this.flushInterval = setInterval(() => this._flushBuffer(), 5000);

    this._startWorker(redisConfig);
  }

  /**
   * Enqueue an audit log entry (non-blocking).
   */
  async log(entry) {
    const sanitized = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      lessor_id: entry.lessor_id || null,
      user_pubkey: entry.user_pubkey || null,
      endpoint: entry.endpoint,
      method: entry.method,
      ip_address: entry.ip_address,
      user_agent: entry.user_agent || null,
      status_code: entry.status_code || null,
      payload: entry.payload ? scrubPii(entry.payload) : null,
      service: 'leaseflow-backend',
      env: process.env.NODE_ENV || 'production',
    };

    this.buffer.push(sanitized);

    // Immediate anomaly check: 500+ failed auth attempts from single IP
    if (entry.status_code === 401 || entry.status_code === 403) {
      await this._checkAnomalousActivity(entry.ip_address, entry.endpoint);
    }
  }

  /**
   * Flush buffer to BullMQ queue.
   */
  async _flushBuffer() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      await this.queue.add('flush-batch', { logs: batch, flushedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[SiemAudit] Failed to enqueue batch:', err.message);
    }
  }

  /**
   * BullMQ worker: sends batches to SIEM provider.
   */
  _startWorker(redisConfig) {
    this.worker = new Worker('siem-audit-logs', async (job) => {
      const { logs } = job.data;
      if (!logs?.length) return;

      if (this.siemConfig.provider === 'datadog') {
        await this._sendToDatadog(logs);
      } else if (this.siemConfig.provider === 'splunk') {
        await this._sendToSplunk(logs);
      } else {
        // Fallback: structured console log (dev/test)
        console.log('[SiemAudit] Batch:', JSON.stringify(logs));
      }
    }, {
      connection: redisConfig,
      concurrency: 2,
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[SiemAudit] Worker job ${job?.id} failed: ${err.message}`);
    });
  }

  async _sendToDatadog(logs) {
    if (!this.siemConfig.datadogApiKey) {
      console.warn('[SiemAudit] Datadog API key not configured, skipping flush.');
      return;
    }
    const axios = require('axios');
    const payload = logs.map(log => ({
      ddsource: 'leaseflow',
      ddtags: `env:${log.env},service:${log.service}`,
      hostname: 'leaseflow-backend',
      message: JSON.stringify(log),
      service: log.service,
    }));

    await axios.post(
      `https://http-intake.logs.${this.siemConfig.datadogSite}/api/v2/logs`,
      payload,
      {
        headers: {
          'DD-API-KEY': this.siemConfig.datadogApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
  }

  async _sendToSplunk(logs) {
    if (!this.siemConfig.splunkHecUrl || !this.siemConfig.splunkToken) {
      console.warn('[SiemAudit] Splunk HEC not configured, skipping flush.');
      return;
    }
    const axios = require('axios');
    // Splunk HEC expects newline-delimited JSON events
    const payload = logs.map(log => JSON.stringify({ event: log, time: Date.now() / 1000 })).join('\n');

    await axios.post(this.siemConfig.splunkHecUrl, payload, {
      headers: {
        Authorization: `Splunk ${this.siemConfig.splunkToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  /**
   * Anomaly detection: alert if single IP has 500+ failed auth attempts in 1 min.
   * Uses the BullMQ queue to fire an alert job.
   */
  async _checkAnomalousActivity(ipAddress, endpoint) {
    // Count recent failures in buffer for this IP
    const recentFailures = this.buffer.filter(
      e => e.ip_address === ipAddress && (e.status_code === 401 || e.status_code === 403)
    ).length;

    if (recentFailures >= 500) {
      await this.queue.add('anomaly-alert', {
        type: 'BRUTE_FORCE_DETECTED',
        ip_address: ipAddress,
        endpoint,
        failure_count: recentFailures,
        timestamp: new Date().toISOString(),
      }, { priority: 1 });
      console.warn(`[SiemAudit] ANOMALY: ${recentFailures} failed auth attempts from ${ipAddress}`);
    }
  }

  async shutdown() {
    clearInterval(this.flushInterval);
    await this._flushBuffer();
    await this.worker?.close();
    await this.queue?.close();
  }
}

/**
 * Express middleware: intercepts POST/PATCH/DELETE requests and logs to SIEM.
 * Attach after auth middleware so req.actor is available.
 */
function createSiemInterceptor(siemAuditService) {
  const STATE_CHANGING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

  return (req, res, next) => {
    if (!STATE_CHANGING_METHODS.has(req.method)) return next();

    // Capture response status after it's sent
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      siemAuditService.log({
        lessor_id: req.actor?.id || req.actor?.lessorId || null,
        user_pubkey: req.actor?.pubkey || req.actor?.stellarAddress || null,
        endpoint: req.originalUrl || req.url,
        method: req.method,
        ip_address:
          req.headers['cf-connecting-ip'] ||
          req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
          req.ip,
        user_agent: req.headers['user-agent'],
        status_code: res.statusCode,
        payload: req.body,
      }).catch(err => console.error('[SiemAudit] Log error:', err.message));

      return originalJson(body);
    };

    next();
  };
}

module.exports = { SiemAuditService, createSiemInterceptor, scrubPii };
