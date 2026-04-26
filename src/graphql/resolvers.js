const { GraphQLScalarType } = require('graphql');
const { Kind } = require('graphql/language');

/**
 * Custom scalar resolvers for Soroban integration
 */
const StroopsScalar = new GraphQLScalarType({
  name: 'Stroops',
  description: '128-bit Soroban integer (stroops) for precise financial calculations',
  serialize(value) {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    throw new Error('Stroops must be a string or number');
  },
  parseValue(value) {
    if (typeof value === 'string') {
      // Validate that it's a valid number string
      if (!/^\d+$/.test(value)) {
        throw new Error('Stroops must be a numeric string');
      }
      return value;
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    throw new Error('Stroops must be a string or number');
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING || ast.kind === Kind.INT) {
      const value = ast.value;
      if (!/^\d+$/.test(value)) {
        throw new Error('Stroops must be a numeric string');
      }
      return value;
    }
    throw new Error('Stroops must be a string or integer literal');
  }
});

const TimestampScalar = new GraphQLScalarType({
  name: 'Timestamp',
  description: 'ISO 8601 timestamp string',
  serialize(value) {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      return new Date(value).toISOString();
    }
    throw new Error('Timestamp must be a Date or string');
  },
  parseValue(value) {
    if (typeof value === 'string') {
      return new Date(value);
    }
    if (value instanceof Date) {
      return value;
    }
    throw new Error('Timestamp must be a string or Date');
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      return new Date(ast.value);
    }
    throw new Error('Timestamp must be a string literal');
  }
});

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON object or array',
  serialize(value) {
    return value;
  },
  parseValue(value) {
    return value;
  },
  parseLiteral(ast) {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return parseFloat(ast.value);
      case Kind.OBJECT: {
        const value = Object.create(null);
        ast.fields.forEach(field => {
          value[field.name.value] = JSONScalar.parseLiteral(field.value);
        });
        return value;
      }
      case Kind.LIST:
        return ast.values.map(JSONScalar.parseLiteral);
      default:
        return null;
    }
  }
});

/**
 * GraphQL resolvers for the LeaseFlow Protocol
 */
const resolvers = {
  // Custom scalar types
  Stroops: StroopsScalar,
  Timestamp: TimestampScalar,
  JSON: JSONScalar,

  // Query resolvers
  Query: {
    // Actor queries
    actor: async (_, { id }, { dataSources, user }) => {
      return await dataSources.actors.getActorById(id, user);
    },
    
    actors: async (_, { role, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.actors.getActors({ role, limit, offset }, user);
    },
    
    me: async (_, __, { dataSources, user }) => {
      if (!user) {
        throw new Error('Authentication required');
      }
      return await dataSources.actors.getActorById(user.id, user);
    },

    // Asset queries
    asset: async (_, { id }, { dataSources, user }) => {
      return await dataSources.assets.getAssetById(id, user);
    },
    
    assets: async (_, { lessorId, type, status, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.assets.getAssets({ lessorId, type, status, limit, offset }, user);
    },

    // Lease queries
    lease: async (_, { id }, { dataSources, user }) => {
      return await dataSources.leases.getLeaseById(id, user);
    },
    
    leases: async (_, { landlordId, tenantId, lessorId, status, renewable, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.leases.getLeases({ landlordId, tenantId, lessorId, status, renewable, limit, offset }, user);
    },
    
    leaseHierarchy: async (_, { leaseId }, { dataSources, user }) => {
      return await dataSources.leases.getLeaseHierarchy(leaseId, user);
    },
    
    subleases: async (_, { parentLeaseId }, { dataSources, user }) => {
      return await dataSources.leases.getSubleases(parentLeaseId, user);
    },

    // Condition report queries
    conditionReport: async (_, { id }, { dataSources, user }) => {
      return await dataSources.conditionReports.getConditionReportById(id, user);
    },
    
    conditionReports: async (_, { leaseId, assetId, status, severityTier, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.conditionReports.getConditionReports({ leaseId, assetId, status, severityTier, limit, offset }, user);
    },

    // Renewal proposal queries
    renewalProposal: async (_, { id }, { dataSources, user }) => {
      return await dataSources.renewalProposals.getRenewalProposalById(id, user);
    },
    
    renewalProposals: async (_, { leaseId, landlordId, tenantId, status, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.renewalProposals.getRenewalProposals({ leaseId, landlordId, tenantId, status, limit, offset }, user);
    },

    // Payment queries
    paymentHistory: async (_, { leaseId, tenantAccountId, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.payments.getPaymentHistory({ leaseId, tenantAccountId, limit, offset }, user);
    },
    
    rentPayments: async (_, { leaseId, status, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.payments.getRentPayments({ leaseId, status, limit, offset }, user);
    },

    // Yield earnings queries
    yieldEarnings: async (_, { leaseId, pubkey, assetCode, harvestedAfter, harvestedBefore, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.yield.getYieldEarnings({ leaseId, pubkey, assetCode, harvestedAfter, harvestedBefore, limit, offset }, user);
    },

    // Maintenance queries
    maintenanceTicket: async (_, { id }, { dataSources, user }) => {
      return await dataSources.maintenance.getMaintenanceTicketById(id, user);
    },
    
    maintenanceTickets: async (_, { leaseId, vendorId, status, priority, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.maintenance.getMaintenanceTickets({ leaseId, vendorId, status, priority, limit, offset }, user);
    },

    // Vendor queries
    vendor: async (_, { id }, { dataSources, user }) => {
      return await dataSources.vendors.getVendorById(id, user);
    },
    
    vendors: async (_, { kycStatus, specialties, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.vendors.getVendors({ kycStatus, specialties, limit, offset }, user);
    },

    // Utility bill queries
    utilityBill: async (_, { id }, { dataSources, user }) => {
      return await dataSources.utilities.getUtilityBillById(id, user);
    },
    
    utilityBills: async (_, { leaseId, landlordId, utilityType, billingPeriod, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.utilities.getUtilityBills({ leaseId, landlordId, utilityType, billingPeriod, limit, offset }, user);
    },

    // IoT event queries
    iotEvent: async (_, { id }, { dataSources, user }) => {
      return await dataSources.iot.getIoTEventById(id, user);
    },
    
    iotEvents: async (_, { leaseId, assetId, eventType, status, limit = 50, offset = 0 }, { dataSources, user }) => {
      return await dataSources.iot.getIoTEvents({ leaseId, assetId, eventType, status, limit, offset }, user);
    },
  },

  // Mutation resolvers
  Mutation: {
    // Lease mutations
    createLease: async (_, { input }, { dataSources, user }) => {
      return await dataSources.leases.createLease(input, user);
    },
    
    updateLease: async (_, { id, input }, { dataSources, user }) => {
      return await dataSources.leases.updateLease(id, input, user);
    },
    
    terminateLease: async (_, { id, reason }, { dataSources, user }) => {
      return await dataSources.leases.terminateLease(id, reason, user);
    },

    // Renewal proposal mutations
    createRenewalProposal: async (_, { input }, { dataSources, user }) => {
      return await dataSources.renewalProposals.createRenewalProposal(input, user);
    },
    
    acceptRenewalProposal: async (_, { id }, { dataSources, user }) => {
      return await dataSources.renewalProposals.acceptRenewalProposal(id, user);
    },
    
    rejectRenewalProposal: async (_, { id, reason }, { dataSources, user }) => {
      return await dataSources.renewalProposals.rejectRenewalProposal(id, reason, user);
    },

    // Condition report mutations
    createConditionReport: async (_, { input }, { dataSources, user }) => {
      return await dataSources.conditionReports.createConditionReport(input, user);
    },
    
    updateConditionReport: async (_, { id, input }, { dataSources, user }) => {
      return await dataSources.conditionReports.updateConditionReport(id, input, user);
    },

    // Payment mutations
    recordPayment: async (_, { input }, { dataSources, user }) => {
      return await dataSources.payments.recordPayment(input, user);
    },
    
    updateRentPayment: async (_, { id, input }, { dataSources, user }) => {
      return await dataSources.payments.updateRentPayment(id, input, user);
    },

    // Maintenance mutations
    createMaintenanceTicket: async (_, { input }, { dataSources, user }) => {
      return await dataSources.maintenance.createMaintenanceTicket(input, user);
    },
    
    updateMaintenanceTicket: async (_, { id, input }, { dataSources, user }) => {
      return await dataSources.maintenance.updateMaintenanceTicket(id, input, user);
    },
    
    assignVendor: async (_, { ticketId, vendorId }, { dataSources, user }) => {
      return await dataSources.maintenance.assignVendor(ticketId, vendorId, user);
    },

    // Vendor mutations
    createVendor: async (_, { input }, { dataSources, user }) => {
      return await dataSources.vendors.createVendor(input, user);
    },
    
    updateVendor: async (_, { id, input }, { dataSources, user }) => {
      return await dataSources.vendors.updateVendor(id, input, user);
    },

    // Utility bill mutations
    createUtilityBill: async (_, { input }, { dataSources, user }) => {
      return await dataSources.utilities.createUtilityBill(input, user);
    },
    
    updateUtilityBill: async (_, { id, input }, { dataSources, user }) => {
      return await dataSources.utilities.updateUtilityBill(id, input, user);
    },

    // Asset mutations
    createAsset: async (_, { input }, { dataSources, user }) => {
      return await dataSources.assets.createAsset(input, user);
    },
    
    updateAsset: async (_, { id, input }, { dataSources, user }) => {
      return await dataSources.assets.updateAsset(id, input, user);
    },
  },

  // Subscription resolvers using SubscriptionManager
  Subscription: {
    // Real-time lease updates
    onLeaseStatusChanged: {
      subscribe: async (_, { leaseId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('lease_status_changed', user);
      },
      resolve: (payload) => payload,
    },
    
    onLeaseCreated: {
      subscribe: async (_, { landlordId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('lease_created', user);
      },
      resolve: (payload) => payload,
    },
    
    onLeaseTerminated: {
      subscribe: async (_, { tenantId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('lease_terminated', user);
      },
      resolve: (payload) => payload,
    },

    // Real-time asset updates
    onAssetUnlocked: {
      subscribe: async (_, { assetId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('asset_unlocked', user);
      },
      resolve: (payload) => payload,
    },
    
    onAssetConditionChanged: {
      subscribe: async (_, { assetId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('asset_condition_changed', user);
      },
      resolve: (payload) => payload,
    },

    // Real-time condition report updates
    onConditionReportSubmitted: {
      subscribe: async (_, { leaseId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('condition_report_submitted', user);
      },
      resolve: (payload) => payload,
    },
    
    onConditionReportVerified: {
      subscribe: async (_, { assetId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('condition_report_verified', user);
      },
      resolve: (payload) => payload,
    },

    // Real-time payment updates
    onPaymentReceived: {
      subscribe: async (_, { leaseId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('payment_received', user);
      },
      resolve: (payload) => payload,
    },
    
    onPaymentOverdue: {
      subscribe: async (_, { landlordId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('payment_overdue', user);
      },
      resolve: (payload) => payload,
    },

    // Real-time maintenance updates
    onMaintenanceTicketCreated: {
      subscribe: async (_, { landlordId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('maintenance_ticket_created', user);
      },
      resolve: (payload) => payload,
    },
    
    onMaintenanceTicketUpdated: {
      subscribe: async (_, { vendorId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('maintenance_ticket_updated', user);
      },
      resolve: (payload) => payload,
    },

    // Real-time IoT events
    onIoTEvent: {
      subscribe: async (_, { leaseId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('iot_event', user);
      },
      resolve: (payload) => payload,
    },
    
    onAssetHealthChanged: {
      subscribe: async (_, { lessorId }, { subscriptionManager, user }) => {
        if (!user) {
          throw new Error('Authentication required for subscriptions');
        }
        return await subscriptionManager.createAsyncIterator('asset_health_changed', user);
      },
      resolve: (payload) => payload,
    },
  },

  // Type resolvers for resolving nested relationships using DataLoaders
  Lease: {
    asset: async (lease, _, { dataLoaders, user }) => {
      // Use DataLoader for efficient batching
      if (!lease.assetId) return null;
      return await dataLoaders.asset.load(lease.assetId);
    },
    
    subleases: async (lease, _, { dataSources, user }) => {
      // Subleases are still fetched from data source as they need filtering
      return await dataSources.leases.getSubleases(lease.id, user);
    },
    
    conditionReports: async (lease, _, { dataSources, user }) => {
      // Condition reports need filtering by lease, so use data source
      return await dataSources.conditionReports.getConditionReports({ leaseId: lease.id }, user);
    },
    
    renewalProposals: async (lease, _, { dataSources, user }) => {
      // Renewal proposals need filtering by lease, so use data source
      return await dataSources.renewalProposals.getRenewalProposals({ leaseId: lease.id }, user);
    },
    
    paymentHistory: async (lease, _, { dataSources, user }) => {
      // Payment history needs filtering by lease, so use data source
      return await dataSources.payments.getPaymentHistory({ leaseId: lease.id }, user);
    },
    
    rentPayments: async (lease, _, { dataSources, user }) => {
      // Rent payments need filtering by lease, so use data source
      return await dataSources.payments.getRentPayments({ leaseId: lease.id }, user);
    },
  },

  Asset: {
    conditionReports: async (asset, _, { dataSources, user }) => {
      // Condition reports need filtering by asset, so use data source
      return await dataSources.conditionReports.getConditionReports({ assetId: asset.id }, user);
    },
  },

  MaintenanceTicket: {
    vendor: async (ticket, _, { dataLoaders, user }) => {
      // Use DataLoader for efficient batching
      if (!ticket.vendorId) return null;
      return await dataLoaders.vendor.load(ticket.vendorId);
    },
  },

  YieldEarnings: {
    lease: async (earning, _, { dataLoaders, user }) => {
      // Use DataLoader for efficient batching
      return await dataLoaders.lease.load(earning.leaseId);
    },
  },
};

module.exports = { resolvers };
