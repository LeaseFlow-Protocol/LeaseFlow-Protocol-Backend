const { randomUUID } = require('crypto');

/**
 * Service for managing rent escrow during maintenance disputes
 * Handles withholding rent, verification workflow, and automated release
 */
class RentEscrowService {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {object} config - Configuration object
   */
  constructor(database, config) {
    this.db = database;
    this.config = config || {};
    this.autoReleaseDays = config.autoReleaseDays || 7; // Default: 7 days to confirm
  }

  // ==================== Escrow Management ====================

  /**
   * Create rent escrow (withhold disputed amount)
   */
  createEscrow(escrowData) {
    const id = escrowData.id || randomUUID();
    const now = new Date().toISOString();

    // Validate maintenance ticket exists and is open/disputed
    const ticket = this.db.db.prepare(`
      SELECT id, status FROM maintenance_tickets WHERE id = ?
    `).get(escrowData.maintenanceTicketId);

    if (!ticket) {
      throw new Error('Maintenance ticket not found');
    }

    if (!['open', 'in_progress', 'disputed'].includes(ticket.status)) {
      throw new Error('Cannot create escrow: Maintenance ticket is not active');
    }

    const stmt = this.db.db.prepare(`
      INSERT INTO rent_escrows (
        id, lease_id, maintenance_ticket_id, tenant_id, landlord_id,
        disputed_amount, currency, escrow_status, escrow_account_id,
        reason, evidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      escrowData.leaseId,
      escrowData.maintenanceTicketId,
      escrowData.tenantId,
      escrowData.landlordId,
      String(escrowData.disputedAmount),
      escrowData.currency || 'XLM',
      'active',
      escrowData.escrowAccountId || null, // Soroban contract or Stellar account
      escrowData.reason,
      JSON.stringify(escrowData.evidence || []),
      now,
      now
    );

    // Create initial deposit transaction record
    this.logTransaction({
      escrowId: id,
      transactionType: 'deposit',
      amount: escrowData.disputedAmount,
      currency: escrowData.currency || 'XLM',
      status: 'pending'
    });

    // Create repair verification record
    this.createRepairVerification({
      maintenanceTicketId: escrowData.maintenanceTicketId,
      escrowId: id
    });

    return this.getEscrowById(id);
  }

  /**
   * Get escrow by ID
   */
  getEscrowById(escrowId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        maintenance_ticket_id AS maintenanceTicketId,
        tenant_id AS tenantId,
        landlord_id AS landlordId,
        disputed_amount AS disputedAmount,
        currency,
        escrow_status AS escrowStatus,
        escrow_account_id AS escrowAccountId,
        reason,
        evidence,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM rent_escrows
      WHERE id = ?
    `);

    const row = stmt.get(escrowId);
    if (!row) return null;

    return {
      ...row,
      evidence: JSON.parse(row.evidence || '[]')
    };
  }

  /**
   * Get escrows by lease ID
   */
  getEscrowsByLeaseId(leaseId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        maintenance_ticket_id AS maintenanceTicketId,
        tenant_id AS tenantId,
        landlord_id AS landlordId,
        disputed_amount AS disputedAmount,
        currency,
        escrow_status AS escrowStatus,
        escrow_account_id AS escrowAccountId,
        reason,
        evidence,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM rent_escrows
      WHERE lease_id = ?
      ORDER BY created_at DESC
    `);

    return stmt.all(leaseId).map(row => ({
      ...row,
      evidence: JSON.parse(row.evidence || '[]')
    }));
  }

  /**
   * Get escrows by maintenance ticket ID
   */
  getEscrowByTicketId(maintenanceTicketId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        maintenance_ticket_id AS maintenanceTicketId,
        tenant_id AS tenantId,
        landlord_id AS landlordId,
        disputed_amount AS disputedAmount,
        currency,
        escrow_status AS escrowStatus,
        escrow_account_id AS escrowAccountId,
        reason,
        evidence,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM rent_escrows
      WHERE maintenance_ticket_id = ?
      LIMIT 1
    `);

    const row = stmt.get(maintenanceTicketId);
    if (!row) return null;

    return {
      ...row,
      evidence: JSON.parse(row.evidence || '[]')
    };
  }

  /**
   * Update escrow status
   */
  updateEscrowStatus(escrowId, status) {
    const now = new Date().toISOString();
    const stmt = this.db.db.prepare(`
      UPDATE rent_escrows
      SET escrow_status = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(status, now, escrowId);
    return this.getEscrowById(escrowId);
  }

  // ==================== Transaction Management ====================

  /**
   * Log escrow transaction
   */
  logTransaction(transactionData) {
    const id = transactionData.id || randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO escrow_transactions (
        id, escrow_id, transaction_type, amount, currency,
        transaction_hash, stellar_operation_id, recipient_id, recipient_account_id,
        status, failure_reason, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      transactionData.escrowId,
      transactionData.transactionType,
      String(transactionData.amount),
      transactionData.currency,
      transactionData.transactionHash || null,
      transactionData.stellarOperationId || null,
      transactionData.recipientId || null,
      transactionData.recipientAccountId || null,
      transactionData.status || 'pending',
      transactionData.failureReason || null,
      transactionData.metadata ? JSON.stringify(transactionData.metadata) : null,
      now
    );

    return this.getTransactionById(id);
  }

  /**
   * Get transaction by ID
   */
  getTransactionById(transactionId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        escrow_id AS escrowId,
        transaction_type AS transactionType,
        amount,
        currency,
        transaction_hash AS transactionHash,
        stellar_operation_id AS stellarOperationId,
        recipient_id AS recipientId,
        recipient_account_id AS recipientAccountId,
        status,
        failure_reason AS failureReason,
        metadata,
        processed_at AS processedAt,
        created_at AS createdAt
      FROM escrow_transactions
      WHERE id = ?
    `);

    const row = stmt.get(transactionId);
    if (!row) return null;

    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    };
  }

  /**
   * Get transactions for escrow
   */
  getTransactionsByEscrowId(escrowId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        escrow_id AS escrowId,
        transaction_type AS transactionType,
        amount,
        currency,
        transaction_hash AS transactionHash,
        stellar_operation_id AS stellarOperationId,
        recipient_id AS recipientId,
        recipient_account_id AS recipientAccountId,
        status,
        failure_reason AS failureReason,
        metadata,
        processed_at AS processedAt,
        created_at AS createdAt
      FROM escrow_transactions
      WHERE escrow_id = ?
      ORDER BY created_at DESC
    `);

    return stmt.all(escrowId).map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    }));
  }

  // ==================== Repair Verification Workflow ====================

  /**
   * Create repair verification record
   */
  createRepairVerification(verificationData) {
    const id = verificationData.id || randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO repair_verifications (
        id, maintenance_ticket_id, escrow_id,
        repair_photos_before, repair_photos_after, repair_description,
        tenant_confirmation_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      verificationData.maintenanceTicketId,
      verificationData.escrowId || null,
      JSON.stringify(verificationData.photosBefore || []),
      JSON.stringify(verificationData.photosAfter || []),
      verificationData.repairDescription || null,
      'pending',
      now,
      now
    );

    return this.getRepairVerificationById(id);
  }

  /**
   * Get repair verification by ID
   */
  getRepairVerificationById(verificationId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        maintenance_ticket_id AS maintenanceTicketId,
        escrow_id AS escrowId,
        repair_photos_before AS photosBefore,
        repair_photos_after AS photosAfter,
        repair_description AS repairDescription,
        tenant_confirmation_status AS tenantConfirmationStatus,
        tenant_feedback AS tenantFeedback,
        tenant_confirmed_at AS tenantConfirmedAt,
        tenant_rejected_at AS tenantRejectedAt,
        auto_release_triggered AS autoReleaseTriggered,
        verifier_notes AS verifierNotes,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM repair_verifications
      WHERE id = ?
    `);

    const row = stmt.get(verificationId);
    if (!row) return null;

    return {
      ...row,
      photosBefore: JSON.parse(row.photosBefore || '[]'),
      photosAfter: JSON.parse(row.photosAfter || '[]')
    };
  }

  /**
   * Get repair verification by maintenance ticket
   */
  getRepairVerificationByTicketId(maintenanceTicketId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        maintenance_ticket_id AS maintenanceTicketId,
        escrow_id AS escrowId,
        repair_photos_before AS photosBefore,
        repair_photos_after AS photosAfter,
        repair_description AS repairDescription,
        tenant_confirmation_status AS tenantConfirmationStatus,
        tenant_feedback AS tenantFeedback,
        tenant_confirmed_at AS tenantConfirmedAt,
        tenant_rejected_at AS tenantRejectedAt,
        auto_release_triggered AS autoReleaseTriggered,
        verifier_notes AS verifierNotes,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM repair_verifications
      WHERE maintenance_ticket_id = ?
      LIMIT 1
    `);

    const row = stmt.get(maintenanceTicketId);
    if (!row) return null;

    return {
      ...row,
      photosBefore: JSON.parse(row.photosBefore || '[]'),
      photosAfter: JSON.parse(row.photosAfter || '[]')
    };
  }

  /**
   * Upload repair photos (after repairs completed)
   */
  uploadRepairPhotos(verificationId, photos, repairDescription) {
    const now = new Date().toISOString();
    const verification = this.getRepairVerificationById(verificationId);
    
    if (!verification) {
      throw new Error('Repair verification not found');
    }

    const existingPhotos = verification.photosAfter || [];
    const updatedPhotos = [...existingPhotos, ...photos];

    const stmt = this.db.db.prepare(`
      UPDATE repair_verifications
      SET repair_photos_after = ?, repair_description = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(JSON.stringify(updatedPhotos), repairDescription || null, now, verificationId);
    return this.getRepairVerificationById(verificationId);
  }

  /**
   * Tenant confirms repairs
   */
  tenantConfirmRepairs(verificationId, feedback = null) {
    const now = new Date().toISOString();
    const verification = this.getRepairVerificationById(verificationId);
    
    if (!verification) {
      throw new Error('Repair verification not found');
    }

    const stmt = this.db.db.prepare(`
      UPDATE repair_verifications
      SET tenant_confirmation_status = 'confirmed', 
          tenant_feedback = ?, 
          tenant_confirmed_at = ?,
          updated_at = ?
      WHERE id = ?
    `);

    stmt.run(feedback || null, now, now, verificationId);

    // Auto-release escrow to landlord
    const escrow = this.getEscrowById(verification.escrowId);
    if (escrow && escrow.escrowStatus === 'active') {
      this.releaseEscrowToLandlord(verification.escrowId, 'Tenant confirmed repairs completed');
    }

    return this.getRepairVerificationById(verificationId);
  }

  /**
   * Tenant rejects repairs
   */
  tenantRejectRepairs(verificationId, feedback) {
    const now = new Date().toISOString();
    
    if (!feedback) {
      throw new Error('Feedback is required when rejecting repairs');
    }

    const stmt = this.db.db.prepare(`
      UPDATE repair_verifications
      SET tenant_confirmation_status = 'rejected', 
          tenant_feedback = ?, 
          tenant_rejected_at = ?,
          updated_at = ?
      WHERE id = ?
    `);

    stmt.run(feedback, now, now, verificationId);

    // Keep escrow active, notify landlord
    return this.getRepairVerificationById(verificationId);
  }

  // ==================== Escrow Release Logic ====================

  /**
   * Release escrow to landlord (full amount)
   */
  releaseEscrowToLandlord(escrowId, reason) {
    const escrow = this.getEscrowById(escrowId);
    if (!escrow) throw new Error('Escrow not found');

    if (escrow.escrowStatus !== 'active') {
      throw new Error('Escrow is not active');
    }

    // Get landlord's Stellar account from lease
    const lease = this.db.db.prepare(`
      SELECT landlord_stellar_address AS landlordStellarAddress FROM leases WHERE id = ?
    `).get(escrow.leaseId);

    const amount = parseFloat(escrow.disputedAmount);
    const now = new Date().toISOString();

    // Update escrow status
    this.updateEscrowStatus(escrowId, 'released_to_landlord');

    // Record release transaction
    const transaction = this.logTransaction({
      escrowId,
      transactionType: 'release',
      amount,
      currency: escrow.currency,
      recipientId: escrow.landlordId,
      recipientAccountId: lease?.landlordStellarAddress,
      status: 'completed',
      metadata: { reason }
    });

    // TODO: Execute actual blockchain transaction via Soroban/Stellar SDK
    // This would interact with the Soroban escrow contract to release funds

    return {
      escrow,
      transaction,
      message: `Released ${amount} ${escrow.currency} to landlord`
    };
  }

  /**
   * Return escrow to tenant (full amount)
   */
  returnEscrowToTenant(escrowId, reason) {
    const escrow = this.getEscrowById(escrowId);
    if (!escrow) throw new Error('Escrow not found');

    if (escrow.escrowStatus !== 'active') {
      throw new Error('Escrow is not active');
    }

    // Get tenant's Stellar account from lease
    const lease = this.db.db.prepare(`
      SELECT tenant_stellar_address AS tenantStellarAddress FROM leases WHERE id = ?
    `).get(escrow.leaseId);

    const amount = parseFloat(escrow.disputedAmount);
    const now = new Date().toISOString();

    // Update escrow status
    this.updateEscrowStatus(escrowId, 'returned_to_tenant');

    // Record return transaction
    const transaction = this.logTransaction({
      escrowId,
      transactionType: 'return',
      amount,
      currency: escrow.currency,
      recipientId: escrow.tenantId,
      recipientAccountId: lease?.tenantStellarAddress,
      status: 'completed',
      metadata: { reason }
    });

    // TODO: Execute actual blockchain transaction
    return {
      escrow,
      transaction,
      message: `Returned ${amount} ${escrow.currency} to tenant`
    };
  }

  /**
   * Split escrow between parties
   */
  splitEscrow(escrowId, landlordPercentage, reason) {
    const escrow = this.getEscrowById(escrowId);
    if (!escrow) throw new Error('Escrow not found');

    if (escrow.escrowStatus !== 'active') {
      throw new Error('Escrow is not active');
    }

    if (landlordPercentage < 0 || landlordPercentage > 100) {
      throw new Error('Landlord percentage must be between 0 and 100');
    }

    const totalAmount = parseFloat(escrow.disputedAmount);
    const landlordAmount = totalAmount * (landlordPercentage / 100);
    const tenantAmount = totalAmount - landlordAmount;
    const now = new Date().toISOString();

    // Get Stellar accounts
    const lease = this.db.db.prepare(`
      SELECT landlord_stellar_address AS landlordStellarAddress, 
             tenant_stellar_address AS tenantStellarAddress 
      FROM leases WHERE id = ?
    `).get(escrow.leaseId);

    // Update escrow status
    this.updateEscrowStatus(escrowId, 'split');

    // Record landlord transaction
    this.logTransaction({
      escrowId,
      transactionType: 'split',
      amount: landlordAmount,
      currency: escrow.currency,
      recipientId: escrow.landlordId,
      recipientAccountId: lease?.landlordStellarAddress,
      status: 'completed',
      metadata: { reason, splitType: 'landlord' }
    });

    // Record tenant transaction
    this.logTransaction({
      escrowId,
      transactionType: 'split',
      amount: tenantAmount,
      currency: escrow.currency,
      recipientId: escrow.tenantId,
      recipientAccountId: lease?.tenantStellarAddress,
      status: 'completed',
      metadata: { reason, splitType: 'tenant' }
    });

    return {
      escrow,
      landlordAmount,
      tenantAmount,
      message: `Split ${totalAmount} ${escrow.currency}: ${landlordAmount} to landlord, ${tenantAmount} to tenant`
    };
  }

  // ==================== Automation & Background Jobs ====================

  /**
   * Auto-release escrow after timeout (if tenant doesn't respond)
   */
  autoReleaseExpiredVerifications() {
    const now = new Date();
    const expiryDate = new Date(now.getTime() - (this.autoReleaseDays * 24 * 60 * 60 * 1000)).toISOString();

    const stmt = this.db.db.prepare(`
      SELECT id, escrow_id AS escrowId, maintenance_ticket_id AS maintenanceTicketId
      FROM repair_verifications
      WHERE tenant_confirmation_status = 'pending'
        AND created_at < ?
        AND auto_release_triggered = 0
    `);

    const expiredVerifications = stmt.all(expiryDate);
    const results = [];

    for (const verification of expiredVerifications) {
      try {
        // Mark as timeout
        const updateStmt = this.db.db.prepare(`
          UPDATE repair_verifications
          SET tenant_confirmation_status = 'timeout',
              auto_release_triggered = 1,
              updated_at = ?
          WHERE id = ?
        `);
        updateStmt.run(now.toISOString(), verification.id);

        // Auto-release to landlord
        if (verification.escrowId) {
          const result = this.releaseEscrowToLandlord(
            verification.escrowId, 
            `Auto-release: Tenant did not respond within ${this.autoReleaseDays} days`
          );
          results.push(result);
        }
      } catch (error) {
        console.error('[RentEscrowService] Auto-release failed:', error);
      }
    }

    return {
      count: results.length,
      results
    };
  }

  /**
   * Cancel escrow (close without release)
   */
  cancelEscrow(escrowId, reason) {
    const escrow = this.getEscrowById(escrowId);
    if (!escrow) throw new Error('Escrow not found');

    if (escrow.escrowStatus !== 'active') {
      throw new Error('Escrow is not active');
    }

    this.updateEscrowStatus(escrowId, 'cancelled');

    // Record cancellation
    this.logTransaction({
      escrowId,
      transactionType: 'refund',
      amount: parseFloat(escrow.disputedAmount),
      currency: escrow.currency,
      status: 'completed',
      metadata: { reason, note: 'Escrow cancelled - funds returned based on dispute resolution' }
    });

    return {
      escrow,
      message: 'Escrow cancelled'
    };
  }
}

module.exports = { RentEscrowService };
