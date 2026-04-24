const { SmartLockGatewayService } = require('../services/smartLockGatewayService');

class SmartLockController {
  constructor(smartLockService) {
    this.smartLockService = smartLockService;
  }

  // ==================== Smart Lock Management ====================

  /**
   * Register a new smart lock
   */
  async registerSmartLock(req, res) {
    try {
      const lockData = req.body;
      
      if (!lockData.leaseId || !lockData.lockProvider || !lockData.deviceId) {
        return res.status(400).json({
          success: false,
          error: 'Lease ID, lock provider, and device ID are required'
        });
      }

      const lock = this.smartLockService.registerSmartLock(lockData);
      
      res.status(201).json({
        success: true,
        message: 'Smart lock registered successfully',
        data: lock
      });
    } catch (error) {
      console.error('[SmartLockController] Error registering smart lock:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to register smart lock',
        details: error.message
      });
    }
  }

  /**
   * Get smart lock details
   */
  async getSmartLock(req, res) {
    try {
      const { lockId } = req.params;
      const lock = this.smartLockService.getSmartLockById(lockId);

      if (!lock) {
        return res.status(404).json({
          success: false,
          error: 'Smart lock not found'
        });
      }

      res.status(200).json({
        success: true,
        data: lock
      });
    } catch (error) {
      console.error('[SmartLockController] Error fetching smart lock:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch smart lock',
        details: error.message
      });
    }
  }

  /**
   * Get smart lock by lease
   */
  async getSmartLockByLease(req, res) {
    try {
      const { leaseId } = req.params;
      const lock = this.smartLockService.getSmartLockByLeaseId(leaseId);

      if (!lock) {
        return res.status(404).json({
          success: false,
          error: 'No paired smart lock found for this lease'
        });
      }

      res.status(200).json({
        success: true,
        data: lock
      });
    } catch (error) {
      console.error('[SmartLockController] Error fetching smart lock:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch smart lock',
        details: error.message
      });
    }
  }

  // ==================== Digital Key Management ====================

  /**
   * Issue digital key to tenant
   */
  async issueDigitalKey(req, res) {
    try {
      const keyData = req.body;
      
      if (!keyData.leaseId || !keyData.smartLockId || !keyData.tenantId || !keyData.validUntil) {
        return res.status(400).json({
          success: false,
          error: 'Lease ID, Smart Lock ID, Tenant ID, and valid until date are required'
        });
      }

      const key = this.smartLockService.issueDigitalKey(keyData);
      
      res.status(201).json({
        success: true,
        message: 'Digital key issued successfully',
        data: key
      });
    } catch (error) {
      console.error('[SmartLockController] Error issuing digital key:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        details: error.message
      });
    }
  }

  /**
   * Get active keys for tenant
   */
  async getTenantKeys(req, res) {
    try {
      const { tenantId } = req.params;
      const keys = this.smartLockService.getActiveKeysForTenant(tenantId);

      res.status(200).json({
        success: true,
        data: keys
      });
    } catch (error) {
      console.error('[SmartLockController] Error fetching tenant keys:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch tenant keys',
        details: error.message
      });
    }
  }

  /**
   * Revoke digital key
   */
  async revokeDigitalKey(req, res) {
    try {
      const { keyId } = req.params;
      const { reason } = req.body;

      const revokedKey = this.smartLockService.revokeDigitalKey(keyId, reason);
      
      res.status(200).json({
        success: true,
        message: 'Digital key revoked successfully',
        data: revokedKey
      });
    } catch (error) {
      console.error('[SmartLockController] Error revoking digital key:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke digital key',
        details: error.message
      });
    }
  }

  // ==================== Physical Enforcement ====================

  /**
   * Enforce lease status (check and revoke keys if needed)
   */
  async enforceLease(req, res) {
    try {
      const { leaseId } = req.params;
      const result = await this.smartLockService.enforceLeaseStatus(leaseId);

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('[SmartLockController] Error enforcing lease:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to enforce lease',
        details: error.message
      });
    }
  }

  /**
   * Unlock smart lock remotely
   */
  async unlockLock(req, res) {
    try {
      const { lockId } = req.params;
      const { duration = 5000 } = req.body;

      const result = await this.smartLockService.sendUnlockCommand(lockId, duration);
      
      res.status(200).json({
        success: true,
        message: 'Unlock command sent successfully',
        data: result
      });
    } catch (error) {
      console.error('[SmartLockController] Error unlocking smart lock:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to unlock smart lock',
        details: error.message
      });
    }
  }

  /**
   * Record key usage (called from mobile app or IoT device)
   */
  async recordKeyUsage(req, res) {
    try {
      const { keyId, action, result, metadata } = req.body;
      
      if (!keyId || !action || !result) {
        return res.status(400).json({
          success: false,
          error: 'Key ID, action, and result are required'
        });
      }

      const log = this.smartLockService.recordKeyUsage(keyId, action, result, metadata);
      
      res.status(200).json({
        success: true,
        data: log
      });
    } catch (error) {
      console.error('[SmartLockController] Error recording key usage:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to record key usage',
        details: error.message
      });
    }
  }

  // ==================== Maintenance & Monitoring ====================

  /**
   * Revoke all expired keys
   */
  async revokeExpiredKeys(req, res) {
    try {
      const revokedKeys = this.smartLockService.revokeExpiredKeys();
      
      res.status(200).json({
        success: true,
        message: `Revoked ${revokedKeys.length} expired keys`,
        data: { count: revokedKeys.length }
      });
    } catch (error) {
      console.error('[SmartLockController] Error revoking expired keys:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke expired keys',
        details: error.message
      });
    }
  }

  /**
   * Update lock status (battery, firmware, etc.)
   */
  async updateLockStatus(req, res) {
    try {
      const { lockId } = req.params;
      const { batteryLevel, firmwareVersion } = req.body;

      const lock = this.smartLockService.updateLockStatus(lockId, batteryLevel, firmwareVersion);
      
      res.status(200).json({
        success: true,
        message: 'Lock status updated successfully',
        data: lock
      });
    } catch (error) {
      console.error('[SmartLockController] Error updating lock status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update lock status',
        details: error.message
      });
    }
  }
}

module.exports = { SmartLockController };
