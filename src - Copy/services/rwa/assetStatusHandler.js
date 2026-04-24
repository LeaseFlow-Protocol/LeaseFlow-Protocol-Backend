/**
 * Asset Status Handler
 * Handles edge cases for burned/frozen assets and marketplace visibility
 */
class AssetStatusHandler {
  constructor(database, cacheService, config) {
    this.database = database;
    this.cacheService = cacheService;
    this.config = config;
    this.marketplaceHideDelay = config.rwaCache?.marketplaceHideDelay || 30000; // 30 seconds
  }

  /**
   * Handle asset freeze event
   * @param {object} event - Asset freeze event
   * @returns {Promise<void>}
   */
  async handleAssetFreeze(event) {
    try {
      console.log(`[AssetStatusHandler] Handling asset freeze: ${event.assetId}`);
      
      // Update cache immediately
      await this.updateAssetStatus(event.assetId, event.contractAddress, {
        is_frozen: 1,
        freeze_reason: event.eventData?.reason || 'Frozen by issuer',
        freeze_at: event.timestamp
      });

      // Hide from marketplace after delay (to allow frontend to show notification)
      setTimeout(async () => {
        await this.hideFromMarketplace(event.assetId, event.contractAddress, 'frozen');
      }, this.marketplaceHideDelay);

      // Notify stakeholders
      await this.notifyStakeholders(event.assetId, event.contractAddress, 'frozen', {
        reason: event.eventData?.reason,
        timestamp: event.timestamp
      });

      // Log compliance event
      await this.logComplianceEvent(event.assetId, event.contractAddress, 'asset_frozen', {
        issuer: event.eventData?.issuer,
        reason: event.eventData?.reason,
        transactionHash: event.transactionHash
      });

    } catch (error) {
      console.error('[AssetStatusHandler] Error handling asset freeze:', error);
      throw error;
    }
  }

  /**
   * Handle asset burn event
   * @param {object} event - Asset burn event
   * @returns {Promise<void>}
   */
  async handleAssetBurn(event) {
    try {
      console.log(`[AssetStatusHandler] Handling asset burn: ${event.assetId}`);
      
      // Update cache immediately
      await this.updateAssetStatus(event.assetId, event.contractAddress, {
        is_burned: 1,
        burn_reason: event.eventData?.reason || 'Burned by issuer',
        burn_at: event.timestamp,
        owner_pubkey: null // Clear ownership
      });

      // Remove from marketplace immediately (burned assets should not be visible)
      await this.hideFromMarketplace(event.assetId, event.contractAddress, 'burned');

      // Notify stakeholders
      await this.notifyStakeholders(event.assetId, event.contractAddress, 'burned', {
        reason: event.eventData?.reason,
        timestamp: event.timestamp
      });

      // Log compliance event
      await this.logComplianceEvent(event.assetId, event.contractAddress, 'asset_burned', {
        issuer: event.eventData?.issuer,
        reason: event.eventData?.reason,
        transactionHash: event.transactionHash,
        previousOwner: event.fromOwnerPubkey
      });

      // Handle active leases for this asset
      await this.handleActiveLeases(event.assetId, event.contractAddress, 'burned');

    } catch (error) {
      console.error('[AssetStatusHandler] Error handling asset burn:', error);
      throw error;
    }
  }

  /**
   * Handle asset unfreeze event
   * @param {object} event - Asset unfreeze event
   * @returns {Promise<void>}
   */
  async handleAssetUnfreeze(event) {
    try {
      console.log(`[AssetStatusHandler] Handling asset unfreeze: ${event.assetId}`);
      
      // Update cache immediately
      await this.updateAssetStatus(event.assetId, event.contractAddress, {
        is_frozen: 0,
        unfreeze_reason: event.eventData?.reason || 'Unfrozen by issuer',
        unfreeze_at: event.timestamp
      });

      // Show in marketplace if not burned and has owner
      await this.showInMarketplace(event.assetId, event.contractAddress);

      // Notify stakeholders
      await this.notifyStakeholders(event.assetId, event.contractAddress, 'unfrozen', {
        reason: event.eventData?.reason,
        timestamp: event.timestamp
      });

      // Log compliance event
      await this.logComplianceEvent(event.assetId, event.contractAddress, 'asset_unfrozen', {
        issuer: event.eventData?.issuer,
        reason: event.eventData?.reason,
        transactionHash: event.transactionHash
      });

    } catch (error) {
      console.error('[AssetStatusHandler] Error handling asset unfreeze:', error);
      throw error;
    }
  }

  /**
   * Update asset status in database
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {object} updates - Status updates
   * @returns {Promise<void>}
   */
  async updateAssetStatus(assetId, contractAddress, updates) {
    try {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const values = Object.values(updates);
      
      this.database.db.prepare(`
        UPDATE asset_ownership_cache
        SET ${setClause}, cache_updated_at = ?, updated_at = ?
        WHERE asset_id = ? AND rwa_contract_address = ?
      `).run(...values, new Date().toISOString(), new Date().toISOString(), assetId, contractAddress);

    } catch (error) {
      console.error('[AssetStatusHandler] Error updating asset status:', error);
      throw error;
    }
  }

  /**
   * Hide asset from marketplace
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {string} reason - Hide reason
   * @returns {Promise<void>}
   */
  async hideFromMarketplace(assetId, contractAddress, reason) {
    try {
      // Add to marketplace visibility table
      this.database.db.prepare(`
        INSERT OR REPLACE INTO marketplace_visibility (
          asset_id, contract_address, is_visible, hide_reason, hidden_at, updated_at
        ) VALUES (?, ?, 0, ?, ?, ?)
      `).run(assetId, contractAddress, reason, new Date().toISOString(), new Date().toISOString());

      console.log(`[AssetStatusHandler] Asset ${assetId} hidden from marketplace (${reason})`);

    } catch (error) {
      console.error('[AssetStatusHandler] Error hiding from marketplace:', error);
    }
  }

  /**
   * Show asset in marketplace
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @returns {Promise<void>}
   */
  async showInMarketplace(assetId, contractAddress) {
    try {
      // Check if asset can be shown (not burned, has owner)
      const asset = await this.cacheService.getCachedAssetOwnership(assetId, contractAddress);
      
      if (!asset || asset.is_burned || !asset.owner_pubkey) {
        console.log(`[AssetStatusHandler] Asset ${assetId} cannot be shown in marketplace (burned or no owner)`);
        return;
      }

      // Update marketplace visibility
      this.database.db.prepare(`
        INSERT OR REPLACE INTO marketplace_visibility (
          asset_id, contract_address, is_visible, hide_reason, shown_at, updated_at
        ) VALUES (?, ?, 1, NULL, ?, ?)
      `).run(assetId, contractAddress, new Date().toISOString(), new Date().toISOString());

      console.log(`[AssetStatusHandler] Asset ${assetId} shown in marketplace`);

    } catch (error) {
      console.error('[AssetStatusHandler] Error showing in marketplace:', error);
    }
  }

  /**
   * Check if asset is visible in marketplace
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @returns {Promise<boolean>} True if visible
   */
  async isMarketplaceVisible(assetId, contractAddress) {
    try {
      const visibility = this.database.db.prepare(`
        SELECT is_visible FROM marketplace_visibility
        WHERE asset_id = ? AND contract_address = ?
      `).get(assetId, contractAddress);

      if (!visibility) {
        // No record exists, check asset status
        const asset = await this.cacheService.getCachedAssetOwnership(assetId, contractAddress);
        return asset && !asset.is_frozen && !asset.is_burned && asset.owner_pubkey;
      }

      return visibility.is_visible === 1;
    } catch (error) {
      console.error('[AssetStatusHandler] Error checking marketplace visibility:', error);
      return false;
    }
  }

  /**
   * Notify stakeholders about asset status changes
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {string} status - Status change
   * @param {object} details - Event details
   * @returns {Promise<void>}
   */
  async notifyStakeholders(assetId, contractAddress, status, details) {
    try {
      // Get current owner
      const asset = await this.cacheService.getCachedAssetOwnership(assetId, contractAddress);
      
      if (!asset || !asset.owner_pubkey) {
        return;
      }

      // Create notification record
      const notificationId = `notif_${assetId}_${contractAddress}_${Date.now()}`;
      
      this.database.db.prepare(`
        INSERT INTO asset_status_notifications (
          id, asset_id, contract_address, owner_pubkey, status, details, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        notificationId,
        assetId,
        contractAddress,
        asset.owner_pubkey,
        status,
        JSON.stringify(details),
        new Date().toISOString()
      );

      // In a real implementation, this would trigger push notifications, emails, etc.
      console.log(`[AssetStatusHandler] Notification created for ${status} asset ${assetId}`);

    } catch (error) {
      console.error('[AssetStatusHandler] Error notifying stakeholders:', error);
    }
  }

  /**
   * Log compliance event
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {string} eventType - Event type
   * @param {object} metadata - Event metadata
   * @returns {Promise<void>}
   */
  async logComplianceEvent(assetId, contractAddress, eventType, metadata) {
    try {
      const eventId = `compliance_${assetId}_${contractAddress}_${Date.now()}`;
      
      this.database.db.prepare(`
        INSERT INTO rwa_compliance_log (
          id, asset_id, contract_address, event_type, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        assetId,
        contractAddress,
        eventType,
        JSON.stringify(metadata),
        new Date().toISOString()
      );

      console.log(`[AssetStatusHandler] Compliance event logged: ${eventType} for asset ${assetId}`);

    } catch (error) {
      console.error('[AssetStatusHandler] Error logging compliance event:', error);
    }
  }

  /**
   * Handle active leases for affected assets
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @param {string} status - Status change
   * @returns {Promise<void>}
   */
  async handleActiveLeases(assetId, contractAddress, status) {
    try {
      // Find active leases for this asset
      const leases = this.database.db.prepare(`
        SELECT id, landlord_id, tenant_id, status, start_date, end_date
        FROM leases
        WHERE asset_id = ? AND rwa_contract_address = ? AND status IN ('active', 'pending')
      `).all(assetId, contractAddress);

      for (const lease of leases) {
        if (status === 'burned') {
          // Terminate leases for burned assets
          await this.terminateLease(lease.id, 'asset_burned', {
            assetId,
            contractAddress,
            terminatedAt: new Date().toISOString()
          });
        } else if (status === 'frozen') {
          // Suspend leases for frozen assets
          await this.suspendLease(lease.id, 'asset_frozen', {
            assetId,
            contractAddress,
            suspendedAt: new Date().toISOString()
          });
        }
      }

    } catch (error) {
      console.error('[AssetStatusHandler] Error handling active leases:', error);
    }
  }

  /**
   * Terminate a lease
   * @param {string} leaseId - Lease ID
   * @param {string} reason - Termination reason
   * @param {object} metadata - Termination metadata
   * @returns {Promise<void>}
   */
  async terminateLease(leaseId, reason, metadata) {
    try {
      this.database.db.prepare(`
        UPDATE leases
        SET status = 'terminated', termination_reason = ?, terminated_at = ?, updated_at = ?
        WHERE id = ?
      `).run(reason, new Date().toISOString(), new Date().toISOString(), leaseId);

      console.log(`[AssetStatusHandler] Lease ${leaseId} terminated (${reason})`);

    } catch (error) {
      console.error('[AssetStatusHandler] Error terminating lease:', error);
    }
  }

  /**
   * Suspend a lease
   * @param {string} leaseId - Lease ID
   * @param {string} reason - Suspension reason
   * @param {object} metadata - Suspension metadata
   * @returns {Promise<void>}
   */
  async suspendLease(leaseId, reason, metadata) {
    try {
      this.database.db.prepare(`
        UPDATE leases
        SET status = 'suspended', suspension_reason = ?, suspended_at = ?, updated_at = ?
        WHERE id = ?
      `).run(reason, new Date().toISOString(), new Date().toISOString(), leaseId);

      console.log(`[AssetStatusHandler] Lease ${leaseId} suspended (${reason})`);

    } catch (error) {
      console.error('[AssetStatusHandler] Error suspending lease:', error);
    }
  }

  /**
   * Get asset status history
   * @param {string} assetId - Asset ID
   * @param {string} contractAddress - Contract address
   * @returns {Promise<Array>} Status history
   */
  async getAssetStatusHistory(assetId, contractAddress) {
    try {
      const events = this.database.db.prepare(`
        SELECT event_id, asset_id, contract_address, from_owner_pubkey, to_owner_pubkey,
               event_type, event_data, processed_at, created_at
        FROM asset_transfer_events
        WHERE asset_id = ? AND rwa_contract_address = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).all(assetId, contractAddress);

      const notifications = this.database.db.prepare(`
        SELECT id, status, details, created_at
        FROM asset_status_notifications
        WHERE asset_id = ? AND contract_address = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).all(assetId, contractAddress);

      const compliance = this.database.db.prepare(`
        SELECT event_type, metadata, created_at
        FROM rwa_compliance_log
        WHERE asset_id = ? AND contract_address = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).all(assetId, contractAddress);

      return {
        transferEvents: events,
        statusNotifications: notifications,
        complianceEvents: compliance
      };

    } catch (error) {
      console.error('[AssetStatusHandler] Error getting asset status history:', error);
      return {
        transferEvents: [],
        statusNotifications: [],
        complianceEvents: []
      };
    }
  }

  /**
   * Get assets requiring attention (frozen, burned, etc.)
   * @param {object} filters - Filter options
   * @returns {Promise<Array>} Assets requiring attention
   */
  async getAssetsRequiringAttention(filters = {}) {
    try {
      let query = `
        SELECT aoc.id, aoc.asset_id, aoc.owner_pubkey, aoc.rwa_contract_address,
               aoc.rwa_standard, aoc.asset_type, aoc.is_frozen, aoc.is_burned,
               aoc.cache_updated_at, mv.is_visible, mv.hide_reason, mv.hidden_at
        FROM asset_ownership_cache aoc
        LEFT JOIN marketplace_visibility mv ON aoc.asset_id = mv.asset_id AND aoc.rwa_contract_address = mv.contract_address
        WHERE (aoc.is_frozen = 1 OR aoc.is_burned = 1 OR (aoc.owner_pubkey IS NULL AND aoc.is_burned = 0))
      `;

      const params = [];

      if (filters.status === 'frozen') {
        query += ` AND aoc.is_frozen = 1`;
      } else if (filters.status === 'burned') {
        query += ` AND aoc.is_burned = 1`;
      } else if (filters.status === 'ownerless') {
        query += ` AND aoc.owner_pubkey IS NULL AND aoc.is_burned = 0`;
      }

      query += ` ORDER BY aoc.cache_updated_at DESC`;

      if (filters.limit) {
        query += ` LIMIT ?`;
        params.push(filters.limit);
      }

      const assets = this.database.db.prepare(query).all(...params);

      return assets.map(asset => ({
        ...asset,
        is_frozen: Boolean(asset.is_frozen),
        is_burned: Boolean(asset.is_burned),
        is_visible: asset.is_visible === 1,
        attentionReason: this.getAttentionReason(asset)
      }));

    } catch (error) {
      console.error('[AssetStatusHandler] Error getting assets requiring attention:', error);
      return [];
    }
  }

  /**
   * Get attention reason for an asset
   * @param {object} asset - Asset data
   * @returns {string} Attention reason
   */
  getAttentionReason(asset) {
    if (asset.is_burned) {
      return 'Asset has been burned';
    }
    if (asset.is_frozen) {
      return 'Asset has been frozen';
    }
    if (!asset.owner_pubkey) {
      return 'Asset has no owner';
    }
    return 'Unknown';
  }

  /**
   * Create marketplace visibility table if not exists
   * @returns {void}
   */
  createMarketplaceVisibilityTable() {
    try {
      this.database.db.exec(`
        CREATE TABLE IF NOT EXISTS marketplace_visibility (
          asset_id TEXT NOT NULL,
          contract_address TEXT NOT NULL,
          is_visible INTEGER DEFAULT 1 CHECK (is_visible IN (0, 1)),
          hide_reason TEXT,
          hidden_at TEXT,
          shown_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (asset_id, contract_address),
          FOREIGN KEY (asset_id, contract_address) REFERENCES asset_ownership_cache(asset_id, rwa_contract_address)
        );

        CREATE INDEX IF NOT EXISTS idx_marketplace_visibility_visible ON marketplace_visibility(is_visible);
        CREATE INDEX IF NOT EXISTS idx_marketplace_visibility_hidden_at ON marketplace_visibility(hidden_at);
      `);

    } catch (error) {
      console.error('[AssetStatusHandler] Error creating marketplace visibility table:', error);
    }
  }

  /**
   * Create asset status notifications table if not exists
   * @returns {void}
   */
  createAssetStatusNotificationsTable() {
    try {
      this.database.db.exec(`
        CREATE TABLE IF NOT EXISTS asset_status_notifications (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL,
          contract_address TEXT NOT NULL,
          owner_pubkey TEXT NOT NULL,
          status TEXT NOT NULL,
          details TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (asset_id, contract_address) REFERENCES asset_ownership_cache(asset_id, rwa_contract_address)
        );

        CREATE INDEX IF NOT EXISTS idx_asset_status_notifications_asset ON asset_status_notifications(asset_id, contract_address);
        CREATE INDEX IF NOT EXISTS idx_asset_status_notifications_owner ON asset_status_notifications(owner_pubkey);
        CREATE INDEX IF NOT EXISTS idx_asset_status_notifications_status ON asset_status_notifications(status);
      `);

    } catch (error) {
      console.error('[AssetStatusHandler] Error creating asset status notifications table:', error);
    }
  }

  /**
   * Create RWA compliance log table if not exists
   * @returns {void}
   */
  createRwaComplianceLogTable() {
    try {
      this.database.db.exec(`
        CREATE TABLE IF NOT EXISTS rwa_compliance_log (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL,
          contract_address TEXT NOT NULL,
          event_type TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (asset_id, contract_address) REFERENCES asset_ownership_cache(asset_id, rwa_contract_address)
        );

        CREATE INDEX IF NOT EXISTS idx_rwa_compliance_log_asset ON rwa_compliance_log(asset_id, contract_address);
        CREATE INDEX IF NOT EXISTS idx_rwa_compliance_log_type ON rwa_compliance_log(event_type);
        CREATE INDEX IF NOT EXISTS idx_rwa_compliance_log_created_at ON rwa_compliance_log(created_at);
      `);

    } catch (error) {
      console.error('[AssetStatusHandler] Error creating RWA compliance log table:', error);
    }
  }

  /**
   * Initialize all required tables
   * @returns {void}
   */
  initializeTables() {
    this.createMarketplaceVisibilityTable();
    this.createAssetStatusNotificationsTable();
    this.createRwaComplianceLogTable();
  }
}

module.exports = AssetStatusHandler;
