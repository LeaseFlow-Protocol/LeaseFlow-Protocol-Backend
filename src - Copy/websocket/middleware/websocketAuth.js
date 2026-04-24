const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

/**
 * SEP-10 JWT Authentication Middleware for WebSocket connections
 * Ensures only authenticated users can establish WebSocket connections
 */
class WebSocketAuthMiddleware {
  constructor(config) {
    this.config = config;
    this.jwtSecret = config.jwt?.secret || process.env.JWT_SECRET || 'default-secret';
    this.jwtAlgorithm = config.jwt?.algorithm || 'HS256';
    this.tokenExpiry = config.jwt?.expiry || '24h';
    
    // In-memory store for active connections (in production, use Redis)
    this.activeConnections = new Map(); // pubkey -> Set of socket IDs
    this.socketToPubkey = new Map(); // socketId -> pubkey
    this.connectionTimestamps = new Map(); // socketId -> timestamp
  }

  /**
   * Create authentication middleware for Socket.IO
   * @param {Server} io - Socket.IO server instance
   * @returns {Function} Authentication middleware function
   */
  createAuthMiddleware(io) {
    return async (socket, next) => {
      try {
        // Extract token from handshake query or headers
        const token = this.extractToken(socket);
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const decoded = await this.verifyToken(token);
        
        if (!decoded || !decoded.pubkey) {
          return next(new Error('Invalid authentication token'));
        }

        // Validate Stellar public key format
        if (!this.isValidStellarPubkey(decoded.pubkey)) {
          return next(new Error('Invalid Stellar public key format'));
        }

        // Attach user info to socket
        socket.user = {
          pubkey: decoded.pubkey,
          sub: decoded.sub,
          iat: decoded.iat,
          exp: decoded.exp,
          iss: decoded.iss
        };

        // Track connection
        this.trackConnection(socket.id, decoded.pubkey);

        // Set up cleanup on disconnect
        socket.on('disconnect', () => {
          this.cleanupConnection(socket.id);
        });

        console.log(`[WebSocketAuth] Authenticated connection: ${decoded.pubkey} (${socket.id})`);
        next();

      } catch (error) {
        console.error('[WebSocketAuth] Authentication error:', error.message);
        next(new Error(`Authentication failed: ${error.message}`));
      }
    };
  }

  /**
   * Extract JWT token from socket handshake
   * @param {object} socket - Socket.IO socket instance
   * @returns {string|null} JWT token or null if not found
   */
  extractToken(socket) {
    // Try query parameter first
    if (socket.handshake.query && socket.handshake.query.token) {
      return socket.handshake.query.token;
    }

    // Try authorization header
    if (socket.handshake.headers && socket.handshake.headers.authorization) {
      const authHeader = socket.handshake.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
    }

    // Try custom header
    if (socket.handshake.headers && socket.handshake.headers['x-auth-token']) {
      return socket.handshake.headers['x-auth-token'];
    }

    return null;
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token to verify
   * @returns {Promise<object>} Decoded token payload
   */
  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: [this.jwtAlgorithm]
      });

      // Additional validation for SEP-10 tokens
      if (!this.validateSep10Token(decoded)) {
        throw new Error('Invalid SEP-10 token structure');
      }

      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      } else {
        throw error;
      }
    }
  }

  /**
   * Validate SEP-10 token structure
   * @param {object} decoded - Decoded JWT payload
   * @returns {boolean} True if valid SEP-10 token
   */
  validateSep10Token(decoded) {
    // SEP-10 tokens should contain specific fields
    const requiredFields = ['sub', 'iss', 'iat', 'exp'];
    
    for (const field of requiredFields) {
      if (!(field in decoded)) {
        return false;
      }
    }

    // Check if subject (sub) is a valid Stellar public key
    if (!this.isValidStellarPubkey(decoded.sub)) {
      return false;
    }

    // Check issuer (should be the domain of the service)
    if (!decoded.iss || typeof decoded.iss !== 'string') {
      return false;
    }

    // Check issued at time
    if (!decoded.iat || typeof decoded.iat !== 'number') {
      return false;
    }

    // Check expiration time
    if (!decoded.exp || typeof decoded.exp !== 'number') {
      return false;
    }

    return true;
  }

  /**
   * Validate Stellar public key format
   * @param {string} pubkey - Stellar public key to validate
   * @returns {boolean} True if valid Stellar public key
   */
  isValidStellarPubkey(pubkey) {
    if (!pubkey || typeof pubkey !== 'string') {
      return false;
    }

    // Stellar public keys start with 'G' followed by 56 alphanumeric characters
    return /^G[A-Z0-9]{55}$/.test(pubkey);
  }

  /**
   * Track active connection
   * @param {string} socketId - Socket ID
   * @param {string} pubkey - User's Stellar public key
   */
  trackConnection(socketId, pubkey) {
    // Add to active connections
    if (!this.activeConnections.has(pubkey)) {
      this.activeConnections.set(pubkey, new Set());
    }
    this.activeConnections.get(pubkey).add(socketId);

    // Map socket to pubkey
    this.socketToPubkey.set(socketId, pubkey);

    // Record connection timestamp
    this.connectionTimestamps.set(socketId, Date.now());

    // Log connection count
    const connectionCount = this.activeConnections.get(pubkey).size;
    console.log(`[WebSocketAuth] User ${pubkey} now has ${connectionCount} active connections`);
  }

  /**
   * Clean up connection on disconnect
   * @param {string} socketId - Socket ID
   */
  cleanupConnection(socketId) {
    const pubkey = this.socketToPubkey.get(socketId);
    
    if (pubkey) {
      // Remove from active connections
      const connections = this.activeConnections.get(pubkey);
      if (connections) {
        connections.delete(socketId);
        
        // Clean up empty connection sets
        if (connections.size === 0) {
          this.activeConnections.delete(pubkey);
        }
      }

      // Remove socket mapping
      this.socketToPubkey.delete(socketId);
      
      // Remove timestamp
      this.connectionTimestamps.delete(socketId);

      console.log(`[WebSocketAuth] Disconnected: ${pubkey} (${socketId})`);
    }
  }

  /**
   * Get pubkey for a socket
   * @param {string} socketId - Socket ID
   * @returns {string|null} Stellar public key or null
   */
  getSocketPubkey(socketId) {
    return this.socketToPubkey.get(socketId) || null;
  }

  /**
   * Get all active connections for a pubkey
   * @param {string} pubkey - Stellar public key
   * @returns {Set} Set of socket IDs
   */
  getActiveConnections(pubkey) {
    return this.activeConnections.get(pubkey) || new Set();
  }

  /**
   * Get all active pubkeys
   * @returns {Array} Array of active pubkeys
   */
  getActivePubkeys() {
    return Array.from(this.activeConnections.keys());
  }

  /**
   * Get connection statistics
   * @returns {object} Connection statistics
   */
  getStats() {
    const totalConnections = this.socketToPubkey.size;
    const uniqueUsers = this.activeConnections.size;
    
    const connectionsPerUser = [];
    for (const [pubkey, sockets] of this.activeConnections) {
      connectionsPerUser.push({
        pubkey,
        connectionCount: sockets.size
      });
    }

    return {
      totalConnections,
      uniqueUsers,
      connectionsPerUser,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check if user is connected
   * @param {string} pubkey - Stellar public key
   * @returns {boolean} True if user has active connections
   */
  isUserConnected(pubkey) {
    return this.activeConnections.has(pubkey) && this.activeConnections.get(pubkey).size > 0;
  }

  /**
   * Get connection age for monitoring
   * @param {string} socketId - Socket ID
   * @returns {number|null} Connection age in milliseconds or null
   */
  getConnectionAge(socketId) {
    const timestamp = this.connectionTimestamps.get(socketId);
    return timestamp ? Date.now() - timestamp : null;
  }

  /**
   * Clean up old connections (zombie connections)
   * @param {number} maxAge - Maximum age in milliseconds (default: 30 minutes)
   */
  cleanupOldConnections(maxAge = 30 * 60 * 1000) {
    const now = Date.now();
    const cleanedUp = [];

    for (const [socketId, timestamp] of this.connectionTimestamps) {
      if (now - timestamp > maxAge) {
        // This connection is too old, mark for cleanup
        cleanedUp.push(socketId);
      }
    }

    for (const socketId of cleanedUp) {
      this.cleanupConnection(socketId);
    }

    if (cleanedUp.length > 0) {
      console.log(`[WebSocketAuth] Cleaned up ${cleanedUp.length} old connections`);
    }

    return cleanedUp.length;
  }

  /**
   * Create namespace-based authentication middleware
   * @param {Server} io - Socket.IO server instance
   * @param {string} namespace - Namespace name
   * @returns {Function} Namespace-specific auth middleware
   */
  createNamespaceAuthMiddleware(io, namespace) {
    return async (socket, next) => {
      try {
        // First run the general auth middleware
        const generalAuth = this.createAuthMiddleware(io);
        await generalAuth(socket, () => {});

        // Additional namespace-specific validation
        const pubkey = socket.user.pubkey;
        
        // For user-specific namespaces, validate that the namespace matches the user
        if (namespace.startsWith('/user/')) {
          const namespacePubkey = namespace.split('/')[2];
          if (namespacePubkey !== pubkey) {
            return next(new Error('Unauthorized access to user namespace'));
          }
        }

        console.log(`[WebSocketAuth] Authenticated for namespace ${namespace}: ${pubkey}`);
        next();

      } catch (error) {
        console.error(`[WebSocketAuth] Namespace auth error for ${namespace}:`, error.message);
        next(new Error(`Namespace authentication failed: ${error.message}`));
      }
    };
  }

  /**
   * Rate limiting for connection attempts
   * @param {string} pubkey - Stellar public key
   * @param {number} maxConnections - Maximum connections per user
   * @returns {boolean} True if connection is allowed
   */
  isConnectionAllowed(pubkey, maxConnections = 5) {
    const connections = this.activeConnections.get(pubkey);
    return !connections || connections.size < maxConnections;
  }

  /**
   * Generate a JWT token for testing (development only)
   * @param {string} pubkey - Stellar public key
   * @returns {string} JWT token
   */
  generateTestToken(pubkey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Test token generation not allowed in production');
    }

    const payload = {
      sub: pubkey,
      iss: 'leaseflow-protocol',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      pubkey: pubkey
    };

    return jwt.sign(payload, this.jwtSecret, {
      algorithm: this.jwtAlgorithm
    });
  }

  /**
   * Validate token format without verification (for testing)
   * @param {string} token - JWT token
   * @returns {boolean} True if token format is valid
   */
  validateTokenFormat(token) {
    try {
      const parts = token.split('.');
      return parts.length === 3;
    } catch (error) {
      return false;
    }
  }
}

module.exports = WebSocketAuthMiddleware;
