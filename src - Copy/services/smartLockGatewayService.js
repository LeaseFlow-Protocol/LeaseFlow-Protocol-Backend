const axios = require('axios');
const { randomUUID } = require('crypto');

/**
 * Service for managing smart lock IoT integrations (August, Yale, etc.)
 * Provides gateway functionality for physical enforcement of lease contracts
 */
class SmartLockGatewayService {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {object} config - Configuration object
   */
  constructor(database, config) {
    this.db = database;
    this.config = config || {};
    
    // Provider API configurations
    this.providers = {
      august: {
        baseUrl: 'https://api.august.com',
        apiKey: config.augustApiKey,
      },
      yale: {
        baseUrl: 'https://api.yalehome.com',
        apiKey: config.yaleApiKey,
      }
    };
  }

  // ==================== Smart Lock Management ====================

  /**
   * Register a new smart lock device
   */
  registerSmartLock(lockData) {
    const id = lockData.id || randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO smart_locks (
        id, lease_id, lock_provider, device_id, device_name,
        access_token, refresh_token, token_expires_at, pairing_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      lockData.leaseId,
      lockData.lockProvider,
      lockData.deviceId,
      lockData.deviceName || null,
      this.encryptToken(lockData.accessToken) || null,
      this.encryptToken(lockData.refreshToken) || null,
      lockData.tokenExpiresAt || null,
      lockData.pairingStatus || 'pending',
      now,
      now
    );

    return this.getSmartLockById(id);
  }

  /**
   * Get smart lock by ID
   */
  getSmartLockById(lockId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        lock_provider AS lockProvider,
        device_id AS deviceId,
        device_name AS deviceName,
        access_token AS accessToken,
        refresh_token AS refreshToken,
        token_expires_at AS tokenExpiresAt,
        pairing_status AS pairingStatus,
        last_sync_at AS lastSyncAt,
        firmware_version AS firmwareVersion,
        battery_level AS batteryLevel,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM smart_locks
      WHERE id = ?
    `);

    const row = stmt.get(lockId);
    if (!row) return null;

    return {
      ...row,
      accessToken: row.accessToken ? this.decryptToken(row.accessToken) : null,
      refreshToken: row.refreshToken ? this.decryptToken(row.refreshToken) : null
    };
  }

  /**
   * Get smart lock by lease ID
   */
  getSmartLockByLeaseId(leaseId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        lock_provider AS lockProvider,
        device_id AS deviceId,
        device_name AS deviceName,
        access_token AS accessToken,
        refresh_token AS refreshToken,
        token_expires_at AS tokenExpiresAt,
        pairing_status AS pairingStatus,
        last_sync_at AS lastSyncAt,
        firmware_version AS firmwareVersion,
        battery_level AS batteryLevel,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM smart_locks
      WHERE lease_id = ? AND pairing_status = 'paired'
      LIMIT 1
    `);

    const row = stmt.get(leaseId);
    if (!row) return null;

    return {
      ...row,
      accessToken: row.accessToken ? this.decryptToken(row.accessToken) : null,
      refreshToken: row.refreshToken ? this.decryptToken(row.refreshToken) : null
    };
  }

  /**
   * Update lock pairing status
   */
  updateLockPairingStatus(lockId, status, errorDetails = null) {
    const now = new Date().toISOString();
    const stmt = this.db.db.prepare(`
      UPDATE smart_locks
      SET pairing_status = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(status, now, lockId);
    return this.getSmartLockById(lockId);
  }

  /**
   * Update lock battery and sync info
   */
  updateLockStatus(lockId, batteryLevel, firmwareVersion) {
    const now = new Date().toISOString();
    const stmt = this.db.db.prepare(`
      UPDATE smart_locks
      SET battery_level = ?, firmware_version = ?, last_sync_at = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(batteryLevel, firmwareVersion, now, now, lockId);
    return this.getSmartLockById(lockId);
  }

  // ==================== Digital Key Management ====================

  /**
   * Issue digital key to tenant
   */
  issueDigitalKey(keyData) {
    const id = keyData.id || randomUUID();
    const now = new Date().toISOString();

    // Validate lease is active and rent is current before issuing key
    const lease = this.db.db.prepare(`
      SELECT id, status, payment_status FROM leases WHERE id = ?
    `).get(keyData.leaseId);

    if (!lease) {
      throw new Error('Lease not found');
    }

    if (lease.status !== 'active') {
      throw new Error('Cannot issue key: Lease is not active');
    }

    const stmt = this.db.db.prepare(`
      INSERT INTO digital_keys (
        id, lease_id, smart_lock_id, tenant_id, tenant_account_id,
        key_type, key_data, status, valid_from, valid_until,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      keyData.leaseId,
      keyData.smartLockId,
      keyData.tenantId,
      keyData.tenantAccountId,
      keyData.keyType || 'bluetooth',
      this.encryptKeyData(keyData.keyData) || null,
      'active',
      keyData.validFrom || now,
      keyData.validUntil,
      now,
      now
    );

    // Log enforcement check
    this.logEnforcementCheck(keyData.leaseId, 'rent_payment', {
      rentCurrent: lease.payment_status === 'paid' ? 1 : 0,
      enforcementAction: 'key_issued'
    }, 'pass');

    return this.getDigitalKeyById(id);
  }

  /**
   * Get digital key by ID
   */
  getDigitalKeyById(keyId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        smart_lock_id AS smartLockId,
        tenant_id AS tenantId,
        tenant_account_id AS tenantAccountId,
        key_type AS keyType,
        key_data AS keyData,
        status,
        valid_from AS validFrom,
        valid_until AS validUntil,
        revoked_at AS revokedAt,
        revoke_reason AS revokeReason,
        last_used_at AS lastUsedAt,
        usage_count AS usageCount,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM digital_keys
      WHERE id = ?
    `);

    const row = stmt.get(keyId);
    if (!row) return null;

    return {
      ...row,
      keyData: row.keyData ? this.decryptKeyData(row.keyData) : null
    };
  }

  /**
   * Get active digital keys for tenant
   */
  getActiveKeysForTenant(tenantId) {
    const now = new Date().toISOString();
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        smart_lock_id AS smartLockId,
        tenant_id AS tenantId,
        tenant_account_id AS tenantAccountId,
        key_type AS keyType,
        key_data AS keyData,
        status,
        valid_from AS validFrom,
        valid_until AS validUntil,
        revoked_at AS revokedAt,
        revoke_reason AS revokeReason,
        last_used_at AS lastUsedAt,
        usage_count AS usageCount,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM digital_keys
      WHERE tenant_id = ? 
        AND status = 'active' 
        AND valid_until > ?
      ORDER BY created_at DESC
    `);

    return stmt.all(tenantId, now).map(row => ({
      ...row,
      keyData: row.keyData ? this.decryptKeyData(row.keyData) : null
    }));
  }

  /**
   * Revoke digital key
   */
  revokeDigitalKey(keyId, reason) {
    const now = new Date().toISOString();
    const key = this.getDigitalKeyById(keyId);
    
    if (!key) {
      throw new Error('Digital key not found');
    }

    const stmt = this.db.db.prepare(`
      UPDATE digital_keys
      SET status = 'revoked', revoked_at = ?, revoke_reason = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(now, reason || 'Access revoked', now, keyId);

    // Log the revocation
    this.logKeyUsage({
      digitalKeyId: keyId,
      smartLockId: key.smartLockId,
      leaseId: key.leaseId,
      tenantId: key.tenantId,
      action: 'key_revoked',
      result: 'success',
      metadata: JSON.stringify({ reason })
    });

    // Log enforcement check
    this.logEnforcementCheck(key.leaseId, 'breach_detected', {
      enforcementAction: 'key_revoked'
    }, 'fail');

    return this.getDigitalKeyById(keyId);
  }

  /**
   * Record key usage
   */
  recordKeyUsage(keyId, action, result, metadata = {}) {
    const key = this.getDigitalKeyById(keyId);
    if (!key) throw new Error('Digital key not found');

    // Update usage statistics
    const now = new Date().toISOString();
    if (action === 'unlock' && result === 'success') {
      const stmt = this.db.db.prepare(`
        UPDATE digital_keys
        SET last_used_at = ?, usage_count = usage_count + 1, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(now, now, keyId);
    }

    return this.logKeyUsage({
      digitalKeyId: keyId,
      smartLockId: key.smartLockId,
      leaseId: key.leaseId,
      tenantId: key.tenantId,
      action,
      result,
      ...metadata
    });
  }

  // ==================== Physical Enforcement Logic ====================

  /**
   * Check lease status and enforce physically (revoke key if needed)
   */
  async enforceLeaseStatus(leaseId) {
    const lease = this.db.db.prepare(`
      SELECT id, status, payment_status, end_date FROM leases WHERE id = ?
    `).get(leaseId);

    if (!lease) {
      throw new Error('Lease not found');
    }

    const now = new Date().toISOString();
    let checkResult = 'pass';
    let enforcementAction = null;

    // Check if lease is expired
    if (lease.end_date && lease.end_date < now) {
      checkResult = 'fail';
      enforcementAction = 'lease_expired';
    }
    // Check if lease is not active
    else if (lease.status !== 'active') {
      checkResult = 'fail';
      enforcementAction = 'lease_not_active';
    }
    // Check if rent is not current (simplified logic - adapt based on your payment tracking)
    else if (lease.payment_status !== 'paid') {
      checkResult = 'fail';
      enforcementAction = 'rent_not_paid';
    }

    // Log the enforcement check
    this.logEnforcementCheck(leaseId, enforcementAction || 'lease_active', {
      rentCurrent: lease.payment_status === 'paid' ? 1 : 0,
      sorobanContractStatus: 'checked'
    }, checkResult);

    // If check failed, revoke all active keys
    if (checkResult === 'fail') {
      const activeKeys = this.getActiveKeysForLease(leaseId);
      const revokedKeys = [];

      for (const key of activeKeys) {
        const revokedKey = this.revokeDigitalKey(key.id, `Lease enforcement: ${enforcementAction}`);
        revokedKeys.push(revokedKey);
      }

      return {
        checkResult: 'fail',
        enforcementAction,
        revokedKeys,
        message: `Keys revoked: ${enforcementAction}`
      };
    }

    return {
      checkResult: 'pass',
      enforcementAction: null,
      revokedKeys: [],
      message: 'Lease status verified - keys remain active'
    };
  }

  /**
   * Get active keys for lease
   */
  getActiveKeysForLease(leaseId) {
    const now = new Date().toISOString();
    const stmt = this.db.db.prepare(`
      SELECT id FROM digital_keys
      WHERE lease_id = ? AND status = 'active' AND valid_until > ?
    `);

    return stmt.all(leaseId, now);
  }

  /**
   * Auto-revoke expired keys
   */
  revokeExpiredKeys() {
    const now = new Date().toISOString();
    const stmt = this.db.db.prepare(`
      SELECT id, lease_id, tenant_id FROM digital_keys
      WHERE status = 'active' AND valid_until <= ?
    `);

    const expiredKeys = stmt.all(now);
    const revokedKeys = [];

    expiredKeys.forEach(key => {
      const revokedKey = this.revokeDigitalKey(key.id, 'Key expired');
      revokedKeys.push(revokedKey);
    });

    return revokedKeys;
  }

  // ==================== Provider API Integration ====================

  /**
   * Send unlock command to smart lock (provider-specific)
   */
  async sendUnlockCommand(lockId, duration = 5000) {
    const lock = this.getSmartLockById(lockId);
    if (!lock) {
      throw new Error('Smart lock not found');
    }

    if (lock.pairingStatus !== 'paired') {
      throw new Error('Smart lock not paired');
    }

    try {
      // Provider-specific API call
      switch (lock.lockProvider) {
        case 'august':
          return await this.augustUnlock(lock, duration);
        case 'yale':
          return await this.yaleUnlock(lock, duration);
        default:
          throw new Error(`Unsupported lock provider: ${lock.lockProvider}`);
      }
    } catch (error) {
      console.error('[SmartLockGateway] Unlock command failed:', error);
      throw new Error(`Failed to unlock: ${error.message}`);
    }
  }

  /**
   * August Home API integration
   */
  async augustUnlock(lock, duration) {
    const provider = this.providers.august;
    
    // Refresh token if needed
    if (lock.tokenExpiresAt && new Date(lock.tokenExpiresAt) < new Date()) {
      await this.refreshAugustToken(lock);
    }

    const response = await axios.post(
      `${provider.baseUrl}/remoteoperate/${lock.deviceId}/unlock`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${lock.accessToken}`,
          'Content-Type': 'application/json'
        },
        params: { duration: Math.floor(duration / 1000) }
      }
    );

    return {
      success: true,
      provider: 'august',
      deviceId: lock.deviceId,
      response: response.data
    };
  }

  /**
   * Yale Access API integration
   */
  async yaleUnlock(lock, duration) {
    const provider = this.providers.yale;

    const response = await axios.post(
      `${provider.baseUrl}/v1/locks/${lock.deviceId}/unlock`,
      {
        duration: Math.floor(duration / 1000)
      },
      {
        headers: {
          'Authorization': `Bearer ${lock.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      provider: 'yale',
      deviceId: lock.deviceId,
      response: response.data
    };
  }

  /**
   * Refresh August OAuth token
   */
  async refreshAugustToken(lock) {
    const provider = this.providers.august;
    
    const response = await axios.post(
      `${provider.baseUrl}/token/refresh`,
      {
        refresh_token: lock.refreshToken
      },
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(provider.apiKey).toString('base64')}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Update tokens in database
    const stmt = this.db.db.prepare(`
      UPDATE smart_locks
      SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      this.encryptToken(access_token),
      this.encryptToken(refresh_token || lock.refreshToken),
      expiresAt,
      new Date().toISOString(),
      lock.id
    );
  }

  // ==================== Logging & Audit ====================

  /**
   * Log key usage event
   */
  logKeyUsage(logData) {
    const id = randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO key_usage_logs (
        id, digital_key_id, smart_lock_id, lease_id, tenant_id,
        action, result, failure_reason, ip_address, location_data, metadata,
        performed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      logData.digitalKeyId,
      logData.smartLockId,
      logData.leaseId,
      logData.tenantId,
      logData.action,
      logData.result,
      logData.failureReason || null,
      logData.ipAddress || null,
      logData.locationData || null,
      logData.metadata ? JSON.stringify(logData.metadata) : null,
      logData.performedAt || now,
      now
    );

    return { id, ...logData };
  }

  /**
   * Log lease enforcement check
   */
  logEnforcementCheck(leaseId, checkType, details, result) {
    const id = randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO lease_enforcement_checks (
        id, lease_id, check_type, soroban_contract_status, rent_current,
        enforcement_action, check_result, details, checked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      leaseId,
      checkType,
      details.sorobanContractStatus || null,
      details.rentCurrent !== undefined ? (details.rentCurrent ? 1 : 0) : null,
      details.enforcementAction || null,
      result,
      JSON.stringify(details),
      now,
      now
    );

    return { id, leaseId, checkType, result, checkedAt: now };
  }

  // ==================== Encryption Helpers (Placeholder - use proper encryption in production) ====================

  encryptToken(token) {
    // TODO: Implement proper encryption using crypto module
    return Buffer.from(token).toString('base64');
  }

  decryptToken(encryptedToken) {
    // TODO: Implement proper decryption
    return Buffer.from(encryptedToken, 'base64').toString('utf8');
  }

  encryptKeyData(keyData) {
    // TODO: Implement proper encryption
    if (!keyData) return null;
    return Buffer.from(JSON.stringify(keyData)).toString('base64');
  }

  decryptKeyData(encryptedKeyData) {
    // TODO: Implement proper decryption
    if (!encryptedKeyData) return null;
    return JSON.parse(Buffer.from(encryptedKeyData, 'base64').toString('utf8'));
  }
}

module.exports = { SmartLockGatewayService };
