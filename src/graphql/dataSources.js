/**
 * GraphQL Data Sources
 * Provides data access methods for GraphQL resolvers with proper authentication and authorization
 */

class ActorsDataSource {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
  }

  async getActorById(id, user) {
    if (!user || !this.rlsService.canAccessActor(user.id, id)) {
      throw new Error('Access denied');
    }

    const row = this.database.db.prepare(`
      SELECT id, public_key as publicKey, role, stellar_address as stellarAddress,
             kyc_status as kycStatus, sanctions_status as sanctionsStatus,
             created_at as createdAt, updated_at as updatedAt
      FROM actors
      WHERE id = ?
    `).get(id);

    return row || null;
  }

  async getActors({ role, limit = 50, offset = 0 }, user) {
    let query = `
      SELECT id, public_key as publicKey, role, stellar_address as stellarAddress,
             kyc_status as kycStatus, sanctions_status as sanctionsStatus,
             created_at as createdAt, updated_at as updatedAt
      FROM actors
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }

    // Apply RLS filtering
    query += this.rlsService.getActorFilterClause(user);
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.database.db.prepare(query).all(...params);
  }
}

class AssetsDataSource {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
  }

  async getAssetById(id, user) {
    if (!user || !this.rlsService.canAccessAsset(user.id, id)) {
      throw new Error('Access denied');
    }

    const row = this.database.db.prepare(`
      SELECT id, lessor_id as lessorId, type, address, metadata, status,
             created_at as createdAt, updated_at as updatedAt
      FROM assets
      WHERE id = ?
    `).get(id);

    return row || null;
  }

  async getAssets({ lessorId, type, status, limit = 50, offset = 0 }, user) {
    let query = `
      SELECT id, lessor_id as lessorId, type, address, metadata, status,
             created_at as createdAt, updated_at as updatedAt
      FROM assets
      WHERE 1=1
    `;
    const params = [];

    if (lessorId) {
      query += ' AND lessor_id = ?';
      params.push(lessorId);
    }

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    // Apply RLS filtering
    query += this.rlsService.getAssetFilterClause(user);
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.database.db.prepare(query).all(...params);
  }

  async createAsset(input, user) {
    if (!user || user.role !== 'LESSOR') {
      throw new Error('Only lessors can create assets');
    }

    const id = require('crypto').randomUUID();
    const now = new Date().toISOString();

    this.database.db.prepare(`
      INSERT INTO assets (id, lessor_id, type, address, metadata, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user.id,
      input.type,
      input.address,
      JSON.stringify(input.metadata || {}),
      input.status || 'AVAILABLE',
      now,
      now
    );

    return await this.getAssetById(id, user);
  }

  async updateAsset(id, input, user) {
    if (!user || !this.rlsService.canAccessAsset(user.id, id)) {
      throw new Error('Access denied');
    }

    const updates = [];
    const params = [];

    if (input.type !== undefined) {
      updates.push('type = ?');
      params.push(input.type);
    }

    if (input.address !== undefined) {
      updates.push('address = ?');
      params.push(input.address);
    }

    if (input.metadata !== undefined) {
      updates.push('metadata = ?');
      params.push(JSON.stringify(input.metadata));
    }

    if (input.status !== undefined) {
      updates.push('status = ?');
      params.push(input.status);
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    if (updates.length > 0) {
      this.database.db.prepare(`
        UPDATE assets SET ${updates.join(', ')} WHERE id = ?
      `).run(...params);
    }

    return await this.getAssetById(id, user);
  }

  async isUserAsset(assetId, userId) {
    const asset = await this.getAssetById(assetId, { id: userId, role: 'LESSOR' });
    return asset !== null;
  }
}

class LeasesDataSource {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
  }

  async getLeaseById(id, user) {
    if (!user || !this.rlsService.canAccessLease(user.id, id)) {
      throw new Error('Access denied');
    }

    const row = this.database.db.prepare(`
      SELECT id, landlord_id as landlordId, tenant_id as tenantId, lessor_id as lessorId,
             status, rent_amount as rentAmount, currency, start_date as startDate,
             end_date as endDate, renewable, disputed, payment_status as paymentStatus,
             last_payment_at as lastPaymentAt, tenant_account_id as tenantAccountId,
             landlord_stellar_address as landlordStellarAddress, tenant_stellar_address as tenantStellarAddress,
             sanctions_status as sanctionsStatus, sanctions_check_at as sanctionsCheckAt,
             sanctions_violation_count as sanctionsViolationCount, parent_lease_id as parentLeaseId,
             created_at as createdAt, updated_at as updatedAt
      FROM leases
      WHERE id = ?
    `).get(id);

    return row || null;
  }

  async getLeases({ landlordId, tenantId, lessorId, status, renewable, limit = 50, offset = 0 }, user) {
    let query = `
      SELECT id, landlord_id as landlordId, tenant_id as tenantId, lessor_id as lessorId,
             status, rent_amount as rentAmount, currency, start_date as startDate,
             end_date as endDate, renewable, disputed, payment_status as paymentStatus,
             last_payment_at as lastPaymentAt, tenant_account_id as tenantAccountId,
             landlord_stellar_address as landlordStellarAddress, tenant_stellar_address as tenantStellarAddress,
             sanctions_status as sanctionsStatus, sanctions_check_at as sanctionsCheckAt,
             sanctions_violation_count as sanctionsViolationCount, parent_lease_id as parentLeaseId,
             created_at as createdAt, updated_at as updatedAt
      FROM leases
      WHERE 1=1
    `;
    const params = [];

    if (landlordId) {
      query += ' AND landlord_id = ?';
      params.push(landlordId);
    }

    if (tenantId) {
      query += ' AND tenant_id = ?';
      params.push(tenantId);
    }

    if (lessorId) {
      query += ' AND lessor_id = ?';
      params.push(lessorId);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (renewable !== undefined) {
      query += ' AND renewable = ?';
      params.push(renewable ? 1 : 0);
    }

    // Apply RLS filtering
    query += this.rlsService.getLeaseFilterClause(user);
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.database.db.prepare(query).all(...params);
  }

  async getLeaseHierarchy(leaseId, user) {
    if (!user || !this.rlsService.canAccessLease(user.id, leaseId)) {
      throw new Error('Access denied');
    }

    // This would implement recursive hierarchy fetching
    // For now, return the base lease
    return await this.getLeaseById(leaseId, user);
  }

  async getSubleases(parentLeaseId, user) {
    if (!user || !this.rlsService.canAccessLease(user.id, parentLeaseId)) {
      throw new Error('Access denied');
    }

    return this.database.db.prepare(`
      SELECT id, landlord_id as landlordId, tenant_id as tenantId, lessor_id as lessorId,
             status, rent_amount as rentAmount, currency, start_date as startDate,
             end_date as endDate, renewable, disputed, payment_status as paymentStatus,
             last_payment_at as lastPaymentAt, tenant_account_id as tenantAccountId,
             landlord_stellar_address as landlordStellarAddress, tenant_stellar_address as tenantStellarAddress,
             sanctions_status as sanctionsStatus, sanctions_check_at as sanctionsCheckAt,
             sanctions_violation_count as sanctionsViolationCount, parent_lease_id as parentLeaseId,
             created_at as createdAt, updated_at as updatedAt
      FROM leases
      WHERE parent_lease_id = ?
      ORDER BY created_at DESC
    `).all(parentLeaseId);
  }

  async createLease(input, user) {
    if (!user || (user.role !== 'LANDLORD' && user.role !== 'LESSOR')) {
      throw new Error('Only landlords and lessors can create leases');
    }

    const id = require('crypto').randomUUID();
    const now = new Date().toISOString();

    this.database.db.prepare(`
      INSERT INTO leases (
        id, landlord_id, tenant_id, lessor_id, status, rent_amount, currency,
        start_date, end_date, renewable, disputed, payment_status,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user.role === 'LANDLORD' ? user.id : input.landlordId,
      input.tenantId,
      user.role === 'LESSOR' ? user.id : input.lessorId,
      'DRAFT',
      input.rentAmount,
      input.currency,
      input.startDate,
      input.endDate,
      input.renewable ? 1 : 0,
      0,
      'PENDING',
      now,
      now
    );

    return await this.getLeaseById(id, user);
  }

  async updateLease(id, input, user) {
    if (!user || !this.rlsService.canAccessLease(user.id, id)) {
      throw new Error('Access denied');
    }

    const updates = [];
    const params = [];

    if (input.status !== undefined) {
      updates.push('status = ?');
      params.push(input.status);
    }

    if (input.renewable !== undefined) {
      updates.push('renewable = ?');
      params.push(input.renewable ? 1 : 0);
    }

    if (input.disputed !== undefined) {
      updates.push('disputed = ?');
      params.push(input.disputed ? 1 : 0);
    }

    if (input.paymentStatus !== undefined) {
      updates.push('payment_status = ?');
      params.push(input.paymentStatus);
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    if (updates.length > 0) {
      this.database.db.prepare(`
        UPDATE leases SET ${updates.join(', ')} WHERE id = ?
      `).run(...params);
    }

    return await this.getLeaseById(id, user);
  }

  async isUserLease(leaseId, userId) {
    const lease = await this.getLeaseById(leaseId, { id: userId, role: 'USER' });
    return lease !== null;
  }
}

class ConditionReportsDataSource {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
  }

  async getConditionReportById(id, user) {
    if (!user) {
      throw new Error('Authentication required');
    }

    const row = this.database.db.prepare(`
      SELECT id, lease_id as leaseId, asset_id as assetId, report_data, severity_tier as severityTier,
             slash_amount as slashAmount, oracle_signature as oracleSignature, s3_url as s3Url,
             status, created_at as createdAt
      FROM asset_condition_reports
      WHERE id = ?
    `).get(id);

    if (!row) return null;

    // Check if user can access the lease
    if (!this.rlsService.canAccessLease(user.id, row.leaseId)) {
      throw new Error('Access denied');
    }

    return {
      ...row,
      reportData: JSON.parse(row.report_data)
    };
  }

  async getConditionReports({ leaseId, assetId, status, severityTier, limit = 50, offset = 0 }, user) {
    let query = `
      SELECT id, lease_id as leaseId, asset_id as assetId, report_data, severity_tier as severityTier,
             slash_amount as slashAmount, oracle_signature as oracleSignature, s3_url as s3Url,
             status, created_at as createdAt
      FROM asset_condition_reports
      WHERE 1=1
    `;
    const params = [];

    if (leaseId) {
      query += ' AND lease_id = ?';
      params.push(leaseId);
    }

    if (assetId) {
      query += ' AND asset_id = ?';
      params.push(assetId);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (severityTier) {
      query += ' AND severity_tier = ?';
      params.push(severityTier);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.database.db.prepare(query).all(...params);
    
    // Filter results based on RLS
    return rows.filter(row => this.rlsService.canAccessLease(user.id, row.leaseId))
      .map(row => ({
        ...row,
        reportData: JSON.parse(row.report_data)
      }));
  }

  async createConditionReport(input, user) {
    if (!user) {
      throw new Error('Authentication required');
    }

    // Check if user can access the lease
    if (!this.rlsService.canAccessLease(user.id, input.leaseId)) {
      throw new Error('Access denied');
    }

    const id = require('crypto').randomUUID();
    const now = new Date().toISOString();

    this.database.db.prepare(`
      INSERT INTO asset_condition_reports (
        id, lease_id, asset_id, report_data, severity_tier, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.leaseId,
      input.assetId,
      JSON.stringify(input.reportData),
      input.severityTier,
      'SUBMITTED',
      now
    );

    return await this.getConditionReportById(id, user);
  }
}

// Additional data sources would be implemented similarly...
class RenewalProposalsDataSource {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
  }

  async getRenewalProposalById(id, user) {
    if (!user) {
      throw new Error('Authentication required');
    }

    const row = this.database.db.prepare(`
      SELECT id, lease_id as leaseId, landlord_id as landlordId, tenant_id as tenantId,
             lessor_id as lessorId, target_start_date as targetStartDate, target_end_date as targetEndDate,
             current_terms_snapshot as currentTermsSnapshot, proposed_terms as proposedTerms,
             rule_applied as ruleApplied, status, landlord_accepted_at as landlordAcceptedAt,
             tenant_accepted_at as tenantAcceptedAt, rejected_by as rejectedBy,
             created_at as createdAt, updated_at as updatedAt, expires_at as expiresAt,
             soroban_contract_status as sorobanContractStatus, soroban_contract_reference as sorobanContractReference
      FROM renewal_proposals
      WHERE id = ?
    `).get(id);

    if (!row) return null;

    // Check if user can access the lease
    if (!this.rlsService.canAccessLease(user.id, row.leaseId)) {
      throw new Error('Access denied');
    }

    return {
      ...row,
      currentTermsSnapshot: JSON.parse(row.currentTermsSnapshot),
      proposedTerms: JSON.parse(row.proposedTerms),
      ruleApplied: JSON.parse(row.ruleApplied),
      sorobanContractReference: row.sorobanContractReference ? JSON.parse(row.sorobanContractReference) : null
    };
  }

  async getRenewalProposals({ leaseId, landlordId, tenantId, status, limit = 50, offset = 0 }, user) {
    let query = `
      SELECT id, lease_id as leaseId, landlord_id as landlordId, tenant_id as tenantId,
             lessor_id as lessorId, target_start_date as targetStartDate, target_end_date as targetEndDate,
             current_terms_snapshot as currentTermsSnapshot, proposed_terms as proposedTerms,
             rule_applied as ruleApplied, status, landlord_accepted_at as landlordAcceptedAt,
             tenant_accepted_at as tenantAcceptedAt, rejected_by as rejectedBy,
             created_at as createdAt, updated_at as updatedAt, expires_at as expiresAt,
             soroban_contract_status as sorobanContractStatus, soroban_contract_reference as sorobanContractReference
      FROM renewal_proposals
      WHERE 1=1
    `;
    const params = [];

    if (leaseId) {
      query += ' AND lease_id = ?';
      params.push(leaseId);
    }

    if (landlordId) {
      query += ' AND landlord_id = ?';
      params.push(landlordId);
    }

    if (tenantId) {
      query += ' AND tenant_id = ?';
      params.push(tenantId);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.database.db.prepare(query).all(...params);
    
    // Filter results based on RLS and parse JSON fields
    return rows.filter(row => this.rlsService.canAccessLease(user.id, row.leaseId))
      .map(row => ({
        ...row,
        currentTermsSnapshot: JSON.parse(row.currentTermsSnapshot),
        proposedTerms: JSON.parse(row.proposedTerms),
        ruleApplied: JSON.parse(row.ruleApplied),
        sorobanContractReference: row.sorobanContractReference ? JSON.parse(row.sorobanContractReference) : null
      }));
  }
}

// Placeholder data sources for other entities
class PaymentsDataSource {
  constructor(database) {
    this.database = database;
  }

  async getPaymentHistory({ leaseId, tenantAccountId, limit = 50, offset = 0 }, user) {
    // Implementation would follow similar pattern with RLS
    return [];
  }

  async getRentPayments({ leaseId, status, limit = 50, offset = 0 }, user) {
    // Implementation would follow similar pattern with RLS
    return [];
  }
}

class YieldDataSource {
  constructor(database) {
    this.database = database;
  }

  async getYieldEarnings({ leaseId, pubkey, assetCode, harvestedAfter, harvestedBefore, limit = 50, offset = 0 }, user) {
    // Implementation would follow similar pattern with RLS
    return [];
  }
}

class MaintenanceDataSource {
  constructor(database) {
    this.database = database;
  }

  async getMaintenanceTicketById(id, user) {
    // Implementation would follow similar pattern with RLS
    return null;
  }

  async getMaintenanceTickets({ leaseId, vendorId, status, priority, limit = 50, offset = 0 }, user) {
    // Implementation would follow similar pattern with RLS
    return [];
  }
}

class VendorsDataSource {
  constructor(database) {
    this.database = database;
  }

  async getVendorById(id, user) {
    // Implementation would follow similar pattern with RLS
    return null;
  }

  async getVendors({ kycStatus, specialties, limit = 50, offset = 0 }, user) {
    // Implementation would follow similar pattern with RLS
    return [];
  }
}

class UtilitiesDataSource {
  constructor(database) {
    this.database = database;
  }

  async getUtilityBillById(id, user) {
    // Implementation would follow similar pattern with RLS
    return null;
  }

  async getUtilityBills({ leaseId, landlordId, utilityType, billingPeriod, limit = 50, offset = 0 }, user) {
    // Implementation would follow similar pattern with RLS
    return [];
  }
}

class IoTDataSource {
  constructor(database) {
    this.database = database;
  }

  async getIoTEventById(id, user) {
    // Implementation would follow similar pattern with RLS
    return null;
  }

  async getIoTEvents({ leaseId, assetId, eventType, status, limit = 50, offset = 0 }, user) {
    // Implementation would follow similar pattern with RLS
    return [];
  }
}

class AuditDataSource {
  constructor(database) {
    this.database = database;
  }

  async log(entry) {
    // Log GraphQL operations for audit
    this.database.db.prepare(`
      INSERT INTO audit_log (user_id, user_role, action, details, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      entry.userId,
      entry.userRole,
      entry.operation,
      JSON.stringify(entry),
      entry.timestamp
    );
  }
}

module.exports = {
  ActorsDataSource,
  AssetsDataSource,
  LeasesDataSource,
  ConditionReportsDataSource,
  RenewalProposalsDataSource,
  PaymentsDataSource,
  YieldDataSource,
  MaintenanceDataSource,
  VendorsDataSource,
  UtilitiesDataSource,
  IoTDataSource,
  AuditDataSource
};
