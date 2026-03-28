const { randomUUID } = require('crypto');

/**
 * Service for managing vendor roles, maintenance tickets, and temporary access grants.
 */
class VendorService {
  /**
   * @param {AppDatabase} database - Database instance
   */
  constructor(database) {
    this.db = database;
  }

  // ==================== Vendor Management ====================

  /**
   * Register a new vendor
   */
  registerVendor(vendorData) {
    const id = vendorData.id || randomUUID();
    const now = new Date().toISOString();
    
    const stmt = this.db.db.prepare(`
      INSERT INTO vendors (
        id, name, email, phone, company_name, license_number, 
        specialties, kyc_status, stellar_account_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      vendorData.name,
      vendorData.email,
      vendorData.phone || null,
      vendorData.companyName || null,
      vendorData.licenseNumber || null,
      JSON.stringify(vendorData.specialties || []),
      vendorData.kycStatus || 'pending',
      vendorData.stellarAccountId || null,
      now,
      now
    );

    return this.getVendorById(id);
  }

  /**
   * Get vendor by ID
   */
  getVendorById(vendorId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        name,
        email,
        phone,
        company_name AS companyName,
        license_number AS licenseNumber,
        specialties,
        kyc_status AS kycStatus,
        stellar_account_id AS stellarAccountId,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM vendors
      WHERE id = ?
    `);

    const row = stmt.get(vendorId);
    if (!row) return null;

    return {
      ...row,
      specialties: JSON.parse(row.specialties || '[]')
    };
  }

  /**
   * Get vendor by email
   */
  getVendorByEmail(email) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        name,
        email,
        phone,
        company_name AS companyName,
        license_number AS licenseNumber,
        specialties,
        kyc_status AS kycStatus,
        stellar_account_id AS stellarAccountId,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM vendors
      WHERE email = ?
    `);

    const row = stmt.get(email);
    if (!row) return null;

    return {
      ...row,
      specialties: JSON.parse(row.specialties || '[]')
    };
  }

  /**
   * Update vendor KYC status
   */
  updateVendorKycStatus(vendorId, kycStatus, additionalFields = {}) {
    const now = new Date().toISOString();
    const updateFields = {
      kyc_status: kycStatus,
      updated_at: now,
      ...additionalFields
    };

    const setClause = Object.keys(updateFields).map(key => `${key.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`).join(', ');
    const values = Object.values(updateFields);

    const stmt = this.db.db.prepare(`
      UPDATE vendors
      SET ${setClause}
      WHERE id = ?
    `);

    stmt.run(...values, vendorId);
    return this.getVendorById(vendorId);
  }

  // ==================== Maintenance Ticket Management ====================

  /**
   * Create a new maintenance ticket
   */
  createMaintenanceTicket(ticketData) {
    const id = ticketData.id || randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO maintenance_tickets (
        id, lease_id, vendor_id, landlord_id, tenant_id,
        title, description, category, priority, status,
        photos, tenant_notes,
        opened_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      ticketData.leaseId,
      ticketData.vendorId || null,
      ticketData.landlordId,
      ticketData.tenantId,
      ticketData.title,
      ticketData.description,
      ticketData.category,
      ticketData.priority || 'medium',
      ticketData.status || 'open',
      JSON.stringify(ticketData.photos || []),
      ticketData.tenantNotes || null,
      now,
      now,
      now
    );

    // Update lease to mark as having active maintenance
    this.db.db.prepare(`
      UPDATE leases SET has_active_maintenance = 1, updated_at = ? WHERE id = ?
    `).run(now, ticketData.leaseId);

    return this.getMaintenanceTicketById(id);
  }

  /**
   * Get maintenance ticket by ID
   */
  getMaintenanceTicketById(ticketId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        vendor_id AS vendorId,
        landlord_id AS landlordId,
        tenant_id AS tenantId,
        title,
        description,
        category,
        priority,
        status,
        photos,
        repair_photos AS repairPhotos,
        notes,
        tenant_notes AS tenantNotes,
        opened_at AS openedAt,
        in_progress_at AS inProgressAt,
        resolved_at AS resolvedAt,
        closed_at AS closedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM maintenance_tickets
      WHERE id = ?
    `);

    const row = stmt.get(ticketId);
    if (!row) return null;

    return {
      ...row,
      photos: JSON.parse(row.photos || '[]'),
      repairPhotos: JSON.parse(row.repairPhotos || '[]')
    };
  }

  /**
   * Get maintenance tickets by lease ID
   */
  getMaintenanceTicketsByLeaseId(leaseId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        vendor_id AS vendorId,
        landlord_id AS landlordId,
        tenant_id AS tenantId,
        title,
        description,
        category,
        priority,
        status,
        photos,
        repair_photos AS repairPhotos,
        notes,
        tenant_notes AS tenantNotes,
        opened_at AS openedAt,
        in_progress_at AS inProgressAt,
        resolved_at AS resolvedAt,
        closed_at AS closedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM maintenance_tickets
      WHERE lease_id = ?
      ORDER BY created_at DESC
    `);

    return stmt.all(leaseId).map(row => ({
      ...row,
      photos: JSON.parse(row.photos || '[]'),
      repairPhotos: JSON.parse(row.repairPhotos || '[]')
    }));
  }

  /**
   * Update maintenance ticket status
   */
  updateMaintenanceTicketStatus(ticketId, status, updates = {}) {
    const now = new Date().toISOString();
    const updateFields = {
      status,
      updated_at: now,
      ...updates
    };

    // Add timestamp fields based on status
    if (status === 'in_progress' && !updates.inProgressAt) {
      updateFields.in_progress_at = now;
    } else if (status === 'resolved' && !updates.resolvedAt) {
      updateFields.resolved_at = now;
    } else if (status === 'closed' && !updates.closedAt) {
      updateFields.closed_at = now;
    }

    const setClause = Object.keys(updateFields).map(key => `${key.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`).join(', ');
    const values = Object.values(updateFields);

    const stmt = this.db.db.prepare(`
      UPDATE maintenance_tickets
      SET ${setClause}
      WHERE id = ?
    `);

    stmt.run(...values, ticketId);

    // If ticket is closed, update lease
    if (status === 'closed') {
      this.db.db.prepare(`
        UPDATE leases SET has_active_maintenance = 0, updated_at = ? WHERE id = ?
      `).run(now, this.getMaintenanceTicketById(ticketId).leaseId);
    }

    return this.getMaintenanceTicketById(ticketId);
  }

  /**
   * Assign vendor to maintenance ticket
   */
  assignVendorToTicket(ticketId, vendorId) {
    return this.updateMaintenanceTicketStatus(ticketId, 'in_progress', { vendorId });
  }

  /**
   * Add repair photos to ticket
   */
  addRepairPhotos(ticketId, photos) {
    const ticket = this.getMaintenanceTicketById(ticketId);
    if (!ticket) throw new Error('Ticket not found');

    const existingPhotos = ticket.repairPhotos || [];
    const updatedPhotos = [...existingPhotos, ...photos];

    return this.updateMaintenanceTicketStatus(ticketId, ticket.status, {
      repairPhotos: JSON.stringify(updatedPhotos)
    });
  }

  // ==================== Vendor Access Grant Management ====================

  /**
   * Grant temporary access to vendor
   */
  grantVendorAccess(grantData) {
    const id = grantData.id || randomUUID();
    const now = new Date().toISOString();
    
    // Default expiration: 7 days from now or when ticket is closed
    const expiresAt = grantData.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO vendor_access_grants (
        id, vendor_id, lease_id, maintenance_ticket_id, granted_by,
        access_type, permissions, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      grantData.vendorId,
      grantData.leaseId,
      grantData.maintenanceTicketId,
      grantData.grantedBy,
      grantData.accessType || 'maintenance_log',
      JSON.stringify(grantData.permissions || {}),
      expiresAt,
      now,
      now
    );

    return this.getAccessGrantById(id);
  }

  /**
   * Get access grant by ID
   */
  getAccessGrantById(grantId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        vendor_id AS vendorId,
        lease_id AS leaseId,
        maintenance_ticket_id AS maintenanceTicketId,
        granted_by AS grantedBy,
        access_type AS accessType,
        permissions,
        expires_at AS expiresAt,
        revoked_at AS revokedAt,
        revoke_reason AS revokeReason,
        accessed_at AS accessedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM vendor_access_grants
      WHERE id = ?
    `);

    const row = stmt.get(grantId);
    if (!row) return null;

    return {
      ...row,
      permissions: JSON.parse(row.permissions || '{}')
    };
  }

  /**
   * Get active access grants for vendor
   */
  getActiveAccessGrantsForVendor(vendorId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        vendor_id AS vendorId,
        lease_id AS leaseId,
        maintenance_ticket_id AS maintenanceTicketId,
        granted_by AS grantedBy,
        access_type AS accessType,
        permissions,
        expires_at AS expiresAt,
        revoked_at AS revokedAt,
        revoke_reason AS revokeReason,
        accessed_at AS accessedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM vendor_access_grants
      WHERE vendor_id = ? 
        AND revoked_at IS NULL 
        AND expires_at > ?
      ORDER BY created_at DESC
    `);

    const now = new Date().toISOString();
    return stmt.all(vendorId, now).map(row => ({
      ...row,
      permissions: JSON.parse(row.permissions || '{}')
    }));
  }

  /**
   * Get access grants by lease ID
   */
  getAccessGrantsByLeaseId(leaseId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        vendor_id AS vendorId,
        lease_id AS leaseId,
        maintenance_ticket_id AS maintenanceTicketId,
        granted_by AS grantedBy,
        access_type AS accessType,
        permissions,
        expires_at AS expiresAt,
        revoked_at AS revokedAt,
        revoke_reason AS revokeReason,
        accessed_at AS accessedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM vendor_access_grants
      WHERE lease_id = ? AND revoked_at IS NULL
      ORDER BY expires_at ASC
    `);

    return stmt.all(leaseId).map(row => ({
      ...row,
      permissions: JSON.parse(row.permissions || '{}')
    }));
  }

  /**
   * Revoke vendor access
   */
  revokeVendorAccess(grantId, reason) {
    const now = new Date().toISOString();
    const stmt = this.db.db.prepare(`
      UPDATE vendor_access_grants
      SET revoked_at = ?, revoke_reason = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(now, reason || 'Access revoked', now, grantId);
    return this.getAccessGrantById(grantId);
  }

  /**
   * Record vendor access (audit trail)
   */
  recordVendorAccess(accessGrantId, vendorId, leaseId, action, resourceAccessed, metadata = {}) {
    const id = randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO vendor_access_logs (
        id, access_grant_id, vendor_id, lease_id, action, 
        resource_accessed, ip_address, user_agent, accessed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      accessGrantId,
      vendorId,
      leaseId,
      action,
      resourceAccessed || null,
      metadata.ipAddress || null,
      metadata.userAgent || null,
      now,
      now
    );

    // Update the grant's accessed_at timestamp
    this.db.db.prepare(`
      UPDATE vendor_access_grants SET accessed_at = ?, updated_at = ? WHERE id = ? AND accessed_at IS NULL
    `).run(now, now, accessGrantId);

    return { id, accessGrantId, action, accessedAt: now };
  }

  /**
   * Get access logs for vendor
   */
  getAccessLogsForVendor(vendorId, limit = 50) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        access_grant_id AS accessGrantId,
        vendor_id AS vendorId,
        lease_id AS leaseId,
        action,
        resource_accessed AS resourceAccessed,
        ip_address AS ipAddress,
        user_agent AS userAgent,
        accessed_at AS accessedAt,
        created_at AS createdAt
      FROM vendor_access_logs
      WHERE vendor_id = ?
      ORDER BY accessed_at DESC
      LIMIT ?
    `);

    return stmt.all(vendorId, limit);
  }

  // ==================== Auto-Revocation Logic ====================

  /**
   * Automatically revoke access when maintenance ticket is closed
   */
  revokeAccessForClosedTicket(ticketId) {
    const ticket = this.getMaintenanceTicketById(ticketId);
    if (!ticket) return [];

    const now = new Date().toISOString();
    const revokedGrants = [];

    // Find all active grants for this ticket
    const stmt = this.db.db.prepare(`
      SELECT id FROM vendor_access_grants
      WHERE maintenance_ticket_id = ? AND revoked_at IS NULL
    `);

    const grants = stmt.all(ticketId);

    grants.forEach(grant => {
      const revokedGrant = this.revokeVendorAccess(grant.id, 'Maintenance ticket closed');
      revokedGrants.push(revokedGrant);
    });

    return revokedGrants;
  }

  /**
   * Revoke expired access grants
   */
  revokeExpiredAccessGrants() {
    const now = new Date().toISOString();
    const stmt = this.db.db.prepare(`
      SELECT id FROM vendor_access_grants
      WHERE expires_at <= ? AND revoked_at IS NULL
    `);

    const expiredGrants = stmt.all(now);
    const revokedGrants = [];

    expiredGrants.forEach(grant => {
      const revokedGrant = this.revokeVendorAccess(grant.id, 'Access grant expired');
      revokedGrants.push(revokedGrant);
    });

    return revokedGrants;
  }

  /**
   * Check if vendor has access to specific resource
   */
  hasVendorAccess(vendorId, leaseId, accessType) {
    const stmt = this.db.db.prepare(`
      SELECT id, permissions FROM vendor_access_grants
      WHERE vendor_id = ? 
        AND lease_id = ? 
        AND access_type = ?
        AND revoked_at IS NULL
        AND expires_at > ?
    `);

    const now = new Date().toISOString();
    const grant = stmt.get(vendorId, leaseId, accessType, now);

    if (!grant) return { hasAccess: false };

    return {
      hasAccess: true,
      grantId: grant.id,
      permissions: JSON.parse(grant.permissions || '{}')
    };
  }

  /**
   * Get vendor-accessible data for a lease (filtered by permissions)
   */
  getVendorAccessibleData(vendorId, leaseId) {
    const accessCheck = this.hasVendorAccess(vendorId, leaseId, 'maintenance_log');
    if (!accessCheck.hasAccess) {
      throw new Error('Vendor does not have access to this lease');
    }

    const data = {};
    const ticket = this.getMaintenanceTicketsByLeaseId(leaseId)[0];
    
    if (accessCheck.permissions.includeMaintenanceLog !== false) {
      data.maintenanceTickets = ticket ? [{
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        notes: ticket.notes,
        tenantNotes: ticket.tenantNotes
      }] : [];
    }

    // Check if tenant contact info is accessible
    const contactAccess = this.hasVendorAccess(vendorId, leaseId, 'tenant_contact');
    if (contactAccess.hasAccess && contactAccess.permissions.includeTenantContact !== false) {
      // Get tenant info from lease (would need to join with tenants table)
      data.tenantContact = {
        note: 'Contact information available - implement tenant lookup based on your schema'
      };
    }

    return data;
  }

  // ==================== Direct-Drip Payment System (Issue #29) ====================

  /**
   * Authorize a direct-drip payment for a vendor.
   * Landlord authorizes $X to be sent to contractor from next rent.
   */
  authorizeVendorPayment(authData) {
    const ticket = this.getMaintenanceTicketById(authData.jobId);
    if (!ticket) throw new Error('Maintenance ticket not found');

    const auth = {
      id: randomUUID(),
      leaseId: ticket.leaseId,
      jobId: authData.jobId,
      landlordId: ticket.landlordId,
      amount: authData.amount,
      status: 'authorized',
      createdAt: new Date().toISOString()
    };

    return this.db.insertVendorPaymentAuthorization(auth);
  }

  /**
   * Get authorized payment for a specific job.
   */
  getAuthorizedVendorPaymentByJobId(jobId) {
    const stmt = this.db.db.prepare(`
      SELECT * FROM vendor_payment_authorizations 
      WHERE job_id = ? AND status = 'authorized'
    `);
    const row = stmt.get(jobId);
    return row ? { ...row, amount: Number(row.amount) } : null;
  }

  /**
   * Trigger the vendor payment once the job is marked as complete.
   */
  async triggerVendorPaymentOnJobCompletion(ticketId) {
    const ticket = this.getMaintenanceTicketById(ticketId);
    if (!ticket) throw new Error('Ticket not found');
    if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
      throw new Error('Job is not complete yet');
    }

    const auth = this.getAuthorizedVendorPaymentByJobId(ticketId);
    if (!auth) {
      console.log(`No authorized payment found for job ${ticketId}`);
      return null;
    }

    const vendor = this.getVendorById(ticket.vendorId);
    if (!vendor || !vendor.stellarAccountId) {
      throw new Error('Vendor or vendor stellar account not found');
    }

    console.log(`[Soroban] Triggering payment of ${auth.amount} to vendor ${vendor.stellarAccountId} for job ${ticketId}`);
    
    // In a real implementation, this would call the Soroban contract.
    // For this issue, we mock the success of the on-chain drip.
    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    
    this.db.markVendorPaymentAsPaid(auth.id);
    this.db.updateMaintenanceJobStatus(ticketId, 'completed'); // sync with maintenance_jobs table if used

    return {
        authorizationId: auth.id,
        amount: auth.amount,
        vendorWallet: vendor.stellarAccountId,
        transactionHash: txHash,
        status: 'paid'
    };
  }
}

module.exports = { VendorService };
