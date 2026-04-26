const { DataLoaderFactory } = require('./dataloaders');

/**
 * GraphQLExecutionContext - Centralized context for GraphQL requests
 * Passes authenticated user's session data into every resolver
 */

class GraphQLExecutionContext {
  constructor(req, dataSources, pubSub, dataLoaders) {
    this.req = req;
    this.user = req.actor || null; // From existing auth middleware
    this.dataSources = dataSources;
    this.pubSub = pubSub;
    this.dataLoaders = dataLoaders; // DataLoaders for N+1 query prevention
  }

  /**
   * Get the authenticated user
   * @returns {Object|null} User object or null if not authenticated
   */
  getUser() {
    return this.user;
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} True if user is authenticated
   */
  isAuthenticated() {
    return this.user !== null;
  }

  /**
   * Check if user has specific role
   * @param {string} role - Role to check
   * @returns {boolean} True if user has the role
   */
  hasRole(role) {
    return this.user && this.user.role === role;
  }

  /**
   * Check if user can access a specific lease
   * @param {string} leaseId - Lease ID to check
   * @returns {boolean} True if user can access the lease
   */
  canAccessLease(leaseId) {
    if (!this.user) return false;
    
    // Admin can access all leases
    if (this.user.role === 'ADMIN') return true;
    
    // Users can access their own leases
    return this.dataSources.leases.isUserLease(leaseId, this.user.id);
  }

  /**
   * Check if user can access a specific asset
   * @param {string} assetId - Asset ID to check
   * @returns {boolean} True if user can access the asset
   */
  canAccessAsset(assetId) {
    if (!this.user) return false;
    
    // Admin can access all assets
    if (this.user.role === 'ADMIN') return true;
    
    // Users can access their own assets
    return this.dataSources.assets.isUserAsset(assetId, this.user.id);
  }

  /**
   * Get user's public key for filtering
   * @returns {string|null} User's public key
   */
  getUserPublicKey() {
    return this.user ? this.user.publicKey : null;
  }

  /**
   * Log GraphQL operation for audit
   * @param {string} operation - GraphQL operation name
   * @param {Object} variables - GraphQL variables
   */
  async logOperation(operation, variables) {
    if (this.user) {
      await this.dataSources.audit.log({
        userId: this.user.id,
        userRole: this.user.role,
        operation,
        variables: JSON.stringify(variables),
        timestamp: new Date().toISOString(),
        ip: this.req.ip,
        userAgent: this.req.get('User-Agent')
      });
    }
  }
}

/**
 * Create GraphQL context for each request
 * @param {Object} req - Express request object
 * @param {Object} dataSources - GraphQL data sources
 * @param {Object} pubSub - GraphQL pub/sub instance
 * @param {Object} dataLoaders - DataLoaders for batching
 * @returns {GraphQLExecutionContext} GraphQL context
 */
function createGraphQLContext(req, dataSources, pubSub, dataLoaders) {
  return new GraphQLExecutionContext(req, dataSources, pubSub, dataLoaders);
}

module.exports = {
  GraphQLExecutionContext,
  createGraphQLContext
};
