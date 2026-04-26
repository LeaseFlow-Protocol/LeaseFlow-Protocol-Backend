const DataLoader = require('dataloader');

/**
 * GraphQL DataLoaders for batching and caching database queries
 * Prevents N+1 query problems by batching requests within a single GraphQL operation
 */

class AssetLoader {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
    
    this.loader = new DataLoader(async (assetIds) => {
      return this.batchLoadAssets(assetIds);
    }, {
      cacheKeyFn: (assetId) => assetId,
      cache: true,
    });
  }

  async batchLoadAssets(assetIds) {
    if (assetIds.length === 0) return [];

    const placeholders = assetIds.map(() => '?').join(',');
    const query = `
      SELECT id, lessor_id as lessorId, type, address, metadata, status,
             created_at as createdAt, updated_at as updatedAt
      FROM assets
      WHERE id IN (${placeholders})
    `;

    const rows = this.database.db.prepare(query).all(...assetIds);
    
    // Create a map for quick lookup
    const assetMap = new Map();
    rows.forEach(row => {
      assetMap.set(row.id, row);
    });

    // Return results in the same order as input
    return assetIds.map(id => assetMap.get(id) || null);
  }

  load(assetId) {
    return this.loader.load(assetId);
  }

  loadMany(assetIds) {
    return this.loader.loadMany(assetIds);
  }

  clear(assetId) {
    this.loader.clear(assetId);
  }

  clearAll() {
    this.loader.clearAll();
  }
}

class LesseeLoader {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
    
    this.loader = new DataLoader(async (lesseeIds) => {
      return this.batchLoadLessees(lesseeIds);
    }, {
      cacheKeyFn: (lesseeId) => lesseeId,
      cache: true,
    });
  }

  async batchLoadLessees(lesseeIds) {
    if (lesseeIds.length === 0) return [];

    const placeholders = lesseeIds.map(() => '?').join(',');
    const query = `
      SELECT id, public_key as publicKey, role, stellar_address as stellarAddress,
             kyc_status as kycStatus, sanctions_status as sanctionsStatus,
             created_at as createdAt, updated_at as updatedAt
      FROM actors
      WHERE id IN (${placeholders}) AND role IN ('TENANT', 'LESSEE')
    `;

    const rows = this.database.db.prepare(query).all(...lesseeIds);
    
    // Create a map for quick lookup
    const lesseeMap = new Map();
    rows.forEach(row => {
      lesseeMap.set(row.id, row);
    });

    // Return results in the same order as input
    return lesseeIds.map(id => lesseeMap.get(id) || null);
  }

  load(lesseeId) {
    return this.loader.load(lesseeId);
  }

  loadMany(lesseeIds) {
    return this.loader.loadMany(lesseeIds);
  }

  clear(lesseeId) {
    this.loader.clear(lesseeId);
  }

  clearAll() {
    this.loader.clearAll();
  }
}

class ConditionReportLoader {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
    
    this.loader = new DataLoader(async (reportIds) => {
      return this.batchLoadConditionReports(reportIds);
    }, {
      cacheKeyFn: (reportId) => reportId,
      cache: true,
    });
  }

  async batchLoadConditionReports(reportIds) {
    if (reportIds.length === 0) return [];

    const placeholders = reportIds.map(() => '?').join(',');
    const query = `
      SELECT id, lease_id as leaseId, asset_id as assetId, report_data, severity_tier as severityTier,
             slash_amount as slashAmount, oracle_signature as oracleSignature, s3_url as s3Url,
             status, created_at as createdAt
      FROM asset_condition_reports
      WHERE id IN (${placeholders})
    `;

    const rows = this.database.db.prepare(query).all(...reportIds);
    
    // Create a map for quick lookup and parse JSON
    const reportMap = new Map();
    rows.forEach(row => {
      reportMap.set(row.id, {
        ...row,
        reportData: JSON.parse(row.report_data)
      });
    });

    // Return results in the same order as input
    return reportIds.map(id => reportMap.get(id) || null);
  }

  load(reportId) {
    return this.loader.load(reportId);
  }

  loadMany(reportIds) {
    return this.loader.loadMany(reportIds);
  }

  clear(reportId) {
    this.loader.clear(reportId);
  }

  clearAll() {
    this.loader.clearAll();
  }
}

class LeaseLoader {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
    
    this.loader = new DataLoader(async (leaseIds) => {
      return this.batchLoadLeases(leaseIds);
    }, {
      cacheKeyFn: (leaseId) => leaseId,
      cache: true,
    });
  }

  async batchLoadLeases(leaseIds) {
    if (leaseIds.length === 0) return [];

    const placeholders = leaseIds.map(() => '?').join(',');
    const query = `
      SELECT id, landlord_id as landlordId, tenant_id as tenantId, lessor_id as lessorId,
             status, rent_amount as rentAmount, currency, start_date as startDate,
             end_date as endDate, renewable, disputed, payment_status as paymentStatus,
             last_payment_at as lastPaymentAt, tenant_account_id as tenantAccountId,
             landlord_stellar_address as landlordStellarAddress, tenant_stellar_address as tenantStellarAddress,
             sanctions_status as sanctionsStatus, sanctions_check_at as sanctionsCheckAt,
             sanctions_violation_count as sanctionsViolationCount, parent_lease_id as parentLeaseId,
             created_at as createdAt, updated_at as updatedAt
      FROM leases
      WHERE id IN (${placeholders})
    `;

    const rows = this.database.db.prepare(query).all(...leaseIds);
    
    // Create a map for quick lookup
    const leaseMap = new Map();
    rows.forEach(row => {
      leaseMap.set(row.id, row);
    });

    // Return results in the same order as input
    return leaseIds.map(id => leaseMap.get(id) || null);
  }

  load(leaseId) {
    return this.loader.load(leaseId);
  }

  loadMany(leaseIds) {
    return this.loader.loadMany(leaseIds);
  }

  clear(leaseId) {
    this.loader.clear(leaseId);
  }

  clearAll() {
    this.loader.clearAll();
  }
}

class RenewalProposalLoader {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
    
    this.loader = new DataLoader(async (proposalIds) => {
      return this.batchLoadRenewalProposals(proposalIds);
    }, {
      cacheKeyFn: (proposalId) => proposalId,
      cache: true,
    });
  }

  async batchLoadRenewalProposals(proposalIds) {
    if (proposalIds.length === 0) return [];

    const placeholders = proposalIds.map(() => '?').join(',');
    const query = `
      SELECT id, lease_id as leaseId, landlord_id as landlordId, tenant_id as tenantId,
             lessor_id as lessorId, target_start_date as targetStartDate, target_end_date as targetEndDate,
             current_terms_snapshot as currentTermsSnapshot, proposed_terms as proposedTerms,
             rule_applied as ruleApplied, status, landlord_accepted_at as landlordAcceptedAt,
             tenant_accepted_at as tenantAcceptedAt, rejected_by as rejectedBy,
             created_at as createdAt, updated_at as updatedAt, expires_at as expiresAt,
             soroban_contract_status as sorobanContractStatus, soroban_contract_reference as sorobanContractReference
      FROM renewal_proposals
      WHERE id IN (${placeholders})
    `;

    const rows = this.database.db.prepare(query).all(...proposalIds);
    
    // Create a map for quick lookup and parse JSON fields
    const proposalMap = new Map();
    rows.forEach(row => {
      proposalMap.set(row.id, {
        ...row,
        currentTermsSnapshot: JSON.parse(row.currentTermsSnapshot),
        proposedTerms: JSON.parse(row.proposedTerms),
        ruleApplied: JSON.parse(row.ruleApplied),
        sorobanContractReference: row.sorobanContractReference ? JSON.parse(row.sorobanContractReference) : null
      });
    });

    // Return results in the same order as input
    return proposalIds.map(id => proposalMap.get(id) || null);
  }

  load(proposalId) {
    return this.loader.load(proposalId);
  }

  loadMany(proposalIds) {
    return this.loader.loadMany(proposalIds);
  }

  clear(proposalId) {
    this.loader.clear(proposalId);
  }

  clearAll() {
    this.loader.clearAll();
  }
}

class PaymentHistoryLoader {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
    
    this.loader = new DataLoader(async (paymentIds) => {
      return this.batchLoadPaymentHistory(paymentIds);
    }, {
      cacheKeyFn: (paymentId) => paymentId,
      cache: true,
    });
  }

  async batchLoadPaymentHistory(paymentIds) {
    if (paymentIds.length === 0) return [];

    const placeholders = paymentIds.map(() => '?').join(',');
    const query = `
      SELECT id, horizon_op_id as horizonOpId, lease_id as leaseId, tenant_account_id as tenantAccountId,
             amount, asset_code as assetCode, asset_issuer as assetIssuer, transaction_hash as transactionHash,
             paid_at as paidAt, recorded_at as recordedAt
      FROM payment_history
      WHERE id IN (${placeholders})
    `;

    const rows = this.database.db.prepare(query).all(...paymentIds);
    
    // Create a map for quick lookup
    const paymentMap = new Map();
    rows.forEach(row => {
      paymentMap.set(row.id, row);
    });

    // Return results in the same order as input
    return paymentIds.map(id => paymentMap.get(id) || null);
  }

  load(paymentId) {
    return this.loader.load(paymentId);
  }

  loadMany(paymentIds) {
    return this.loader.loadMany(paymentIds);
  }

  clear(paymentId) {
    this.loader.clear(paymentId);
  }

  clearAll() {
    this.loader.clearAll();
  }
}

class RentPaymentLoader {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
    
    this.loader = new DataLoader(async (paymentIds) => {
      return this.batchLoadRentPayments(paymentIds);
    }, {
      cacheKeyFn: (paymentId) => paymentId,
      cache: true,
    });
  }

  async batchLoadRentPayments(paymentIds) {
    if (paymentIds.length === 0) return [];

    const placeholders = paymentIds.map(() => '?').join(',');
    const query = `
      SELECT id, lease_id as leaseId, lessor_id as lessorId, period, due_date as dueDate,
             amount_due as amountDue, amount_paid as amountPaid, protocol_fee as protocolFee,
             date_paid as datePaid, status, created_at as createdAt, updated_at as updatedAt
      FROM rent_payments
      WHERE id IN (${placeholders})
    `;

    const rows = this.database.db.prepare(query).all(...paymentIds);
    
    // Create a map for quick lookup
    const paymentMap = new Map();
    rows.forEach(row => {
      paymentMap.set(row.id, row);
    });

    // Return results in the same order as input
    return paymentIds.map(id => paymentMap.get(id) || null);
  }

  load(paymentId) {
    return this.loader.load(paymentId);
  }

  loadMany(paymentIds) {
    return this.loader.loadMany(paymentIds);
  }

  clear(paymentId) {
    this.loader.clear(paymentId);
  }

  clearAll() {
    this.loader.clearAll();
  }
}

class MaintenanceTicketLoader {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
    
    this.loader = new DataLoader(async (ticketIds) => {
      return this.batchLoadMaintenanceTickets(ticketIds);
    }, {
      cacheKeyFn: (ticketId) => ticketId,
      cache: true,
    });
  }

  async batchLoadMaintenanceTickets(ticketIds) {
    if (ticketIds.length === 0) return [];

    const placeholders = ticketIds.map(() => '?').join(',');
    const query = `
      SELECT id, lease_id as leaseId, vendor_id as vendorId, landlord_id as landlordId,
             tenant_id as tenantId, lessor_id as lessorId, title, description, category,
             priority, status, photos, repair_photos, notes, tenant_notes,
             opened_at as openedAt, in_progress_at as inProgressAt, resolved_at as resolvedAt,
             closed_at as closedAt, created_at as createdAt, updated_at as updatedAt
      FROM maintenance_tickets
      WHERE id IN (${placeholders})
    `;

    const rows = this.database.db.prepare(query).all(...ticketIds);
    
    // Create a map for quick lookup and parse arrays
    const ticketMap = new Map();
    rows.forEach(row => {
      ticketMap.set(row.id, {
        ...row,
        photos: row.photos ? JSON.parse(row.photos) : [],
        repairPhotos: row.repairPhotos ? JSON.parse(row.repairPhotos) : []
      });
    });

    // Return results in the same order as input
    return ticketIds.map(id => ticketMap.get(id) || null);
  }

  load(ticketId) {
    return this.loader.load(ticketId);
  }

  loadMany(ticketIds) {
    return this.loader.loadMany(ticketIds);
  }

  clear(ticketId) {
    this.loader.clear(ticketId);
  }

  clearAll() {
    this.loader.clearAll();
  }
}

class VendorLoader {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
    
    this.loader = new DataLoader(async (vendorIds) => {
      return this.batchLoadVendors(vendorIds);
    }, {
      cacheKeyFn: (vendorId) => vendorId,
      cache: true,
    });
  }

  async batchLoadVendors(vendorIds) {
    if (vendorIds.length === 0) return [];

    const placeholders = vendorIds.map(() => '?').join(',');
    const query = `
      SELECT id, name, email, phone, company_name as companyName, license_number as licenseNumber,
             specialties, kyc_status as kycStatus, stellar_account_id as stellarAccountId,
             created_at as createdAt, updated_at as updatedAt
      FROM vendors
      WHERE id IN (${placeholders})
    `;

    const rows = this.database.db.prepare(query).all(...vendorIds);
    
    // Create a map for quick lookup and parse arrays
    const vendorMap = new Map();
    rows.forEach(row => {
      vendorMap.set(row.id, {
        ...row,
        specialties: row.specialties ? JSON.parse(row.specialties) : []
      });
    });

    // Return results in the same order as input
    return vendorIds.map(id => vendorMap.get(id) || null);
  }

  load(vendorId) {
    return this.loader.load(vendorId);
  }

  loadMany(vendorIds) {
    return this.loader.loadMany(vendorIds);
  }

  clear(vendorId) {
    this.loader.clear(vendorId);
  }

  clearAll() {
    this.loader.clearAll();
  }
}

/**
 * DataLoader Factory - Creates data loaders per GraphQL request
 * Ensures data isolation between requests and prevents cross-request data leakage
 */
class DataLoaderFactory {
  constructor(database, rowLevelSecurityService) {
    this.database = database;
    this.rlsService = rowLevelSecurityService;
  }

  createLoaders() {
    return {
      asset: new AssetLoader(this.database, this.rlsService),
      lessee: new LesseeLoader(this.database, this.rlsService),
      conditionReport: new ConditionReportLoader(this.database, this.rlsService),
      lease: new LeaseLoader(this.database, this.rlsService),
      renewalProposal: new RenewalProposalLoader(this.database, this.rlsService),
      paymentHistory: new PaymentHistoryLoader(this.database, this.rlsService),
      rentPayment: new RentPaymentLoader(this.database, this.rlsService),
      maintenanceTicket: new MaintenanceTicketLoader(this.database, this.rlsService),
      vendor: new VendorLoader(this.database, this.rlsService),
    };
  }

  /**
   * Clear all loader caches - useful for testing or when data changes
   */
  clearAllLoaders(loaders) {
    Object.values(loaders).forEach(loader => {
      if (loader && typeof loader.clearAll === 'function') {
        loader.clearAll();
      }
    });
  }
}

module.exports = {
  AssetLoader,
  LesseeLoader,
  ConditionReportLoader,
  LeaseLoader,
  RenewalProposalLoader,
  PaymentHistoryLoader,
  RentPaymentLoader,
  MaintenanceTicketLoader,
  VendorLoader,
  DataLoaderFactory,
};
