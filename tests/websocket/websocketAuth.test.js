const WebSocketAuthMiddleware = require('../../src/websocket/middleware/websocketAuth');
const jwt = require('jsonwebtoken');

// Mock dependencies
jest.mock('jsonwebtoken');

describe('WebSocketAuthMiddleware', () => {
  let authMiddleware;
  let mockConfig;
  let mockSocket;
  let mockNext;

  beforeEach(() => {
    mockConfig = {
      jwt: {
        secret: 'test-secret',
        algorithm: 'HS256',
        expiry: '24h'
      }
    };

    authMiddleware = new WebSocketAuthMiddleware(mockConfig);

    mockSocket = {
      id: 'socket-123',
      handshake: {
        query: {},
        headers: {}
      },
      user: null,
      on: jest.fn()
    };

    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAuthMiddleware', () => {
    it('should authenticate with valid token in query', async () => {
      const token = 'valid-jwt-token';
      const decodedToken = {
        sub: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890',
        iss: 'leaseflow-protocol',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400
      };

      mockSocket.handshake.query.token = token;
      jwt.verify.mockReturnValue(decodedToken);

      const middleware = authMiddleware.createAuthMiddleware();
      await middleware(mockSocket, mockNext);

      expect(mockSocket.user.pubkey).toBe(decodedToken.sub);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should authenticate with valid token in authorization header', async () => {
      const token = 'valid-jwt-token';
      const decodedToken = {
        sub: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890',
        iss: 'leaseflow-protocol',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400
      };

      mockSocket.handshake.headers.authorization = `Bearer ${token}`;
      jwt.verify.mockReturnValue(decodedToken);

      const middleware = authMiddleware.createAuthMiddleware();
      await middleware(mockSocket, mockNext);

      expect(mockSocket.user.pubkey).toBe(decodedToken.sub);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject connection without token', async () => {
      const middleware = authMiddleware.createAuthMiddleware();
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(new Error('Authentication token required'));
    });

    it('should reject connection with invalid token', async () => {
      const token = 'invalid-token';
      mockSocket.handshake.query.token = token;
      jwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const middleware = authMiddleware.createAuthMiddleware();
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(new Error('Authentication failed: Invalid token'));
    });

    it('should reject connection with expired token', async () => {
      const token = 'expired-token';
      mockSocket.handshake.query.token = token;
      jwt.verify.mockImplementation(() => {
        const error = new Error('Token expired');
        error.name = 'TokenExpiredError';
        throw error;
      });

      const middleware = authMiddleware.createAuthMiddleware();
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(new Error('Authentication failed: Token expired'));
    });

    it('should reject connection with invalid Stellar pubkey', async () => {
      const token = 'valid-jwt-token';
      const decodedToken = {
        sub: 'invalid-pubkey',
        iss: 'leaseflow-protocol',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400
      };

      mockSocket.handshake.query.token = token;
      jwt.verify.mockReturnValue(decodedToken);

      const middleware = authMiddleware.createAuthMiddleware();
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(new Error('Invalid Stellar public key format'));
    });

    it('should reject connection with invalid SEP-10 token structure', async () => {
      const token = 'valid-jwt-token';
      const decodedToken = {
        // Missing required SEP-10 fields
        sub: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890'
      };

      mockSocket.handshake.query.token = token;
      jwt.verify.mockReturnValue(decodedToken);

      const middleware = authMiddleware.createAuthMiddleware();
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(new Error('Authentication failed: Invalid SEP-10 token structure'));
    });
  });

  describe('validateSep10Token', () => {
    it('should validate valid SEP-10 token', () => {
      const decodedToken = {
        sub: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890',
        iss: 'leaseflow-protocol',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400
      };

      const result = authMiddleware.validateSep10Token(decodedToken);

      expect(result).toBe(true);
    });

    it('should reject token without sub field', () => {
      const decodedToken = {
        iss: 'leaseflow-protocol',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400
      };

      const result = authMiddleware.validateSep10Token(decodedToken);

      expect(result).toBe(false);
    });

    it('should reject token with invalid sub field', () => {
      const decodedToken = {
        sub: 'invalid-pubkey',
        iss: 'leaseflow-protocol',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400
      };

      const result = authMiddleware.validateSep10Token(decodedToken);

      expect(result).toBe(false);
    });

    it('should reject token without iss field', () => {
      const decodedToken = {
        sub: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400
      };

      const result = authMiddleware.validateSep10Token(decodedToken);

      expect(result).toBe(false);
    });
  });

  describe('isValidStellarPubkey', () => {
    it('should validate correct Stellar pubkey', () => {
      const validPubkey = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';
      
      const result = authMiddleware.isValidStellarPubkey(validPubkey);

      expect(result).toBe(true);
    });

    it('should reject pubkey starting with wrong character', () => {
      const invalidPubkey = 'ABL...TEST123456789012345678901234567890123456789012345678901234567890';
      
      const result = authMiddleware.isValidStellarPubkey(invalidPubkey);

      expect(result).toBe(false);
    });

    it('should reject pubkey with wrong length', () => {
      const invalidPubkey = 'GBL...TOO_SHORT';
      
      const result = authMiddleware.isValidStellarPubkey(invalidPubkey);

      expect(result).toBe(false);
    });

    it('should reject empty pubkey', () => {
      const result = authMiddleware.isValidStellarPubkey('');

      expect(result).toBe(false);
    });

    it('should reject null pubkey', () => {
      const result = authMiddleware.isValidStellarPubkey(null);

      expect(result).toBe(false);
    });
  });

  describe('extractToken', () => {
    it('should extract token from query', () => {
      mockSocket.handshake.query.token = 'query-token';

      const token = authMiddleware.extractToken(mockSocket);

      expect(token).toBe('query-token');
    });

    it('should extract token from authorization header', () => {
      mockSocket.handshake.headers.authorization = 'Bearer header-token';

      const token = authMiddleware.extractToken(mockSocket);

      expect(token).toBe('header-token');
    });

    it('should extract token from custom header', () => {
      mockSocket.handshake.headers['x-auth-token'] = 'custom-header-token';

      const token = authMiddleware.extractToken(mockSocket);

      expect(token).toBe('custom-header-token');
    });

    it('should return null when no token found', () => {
      const token = authMiddleware.extractToken(mockSocket);

      expect(token).toBeNull();
    });

    it('should prioritize query over headers', () => {
      mockSocket.handshake.query.token = 'query-token';
      mockSocket.handshake.headers.authorization = 'Bearer header-token';

      const token = authMiddleware.extractToken(mockSocket);

      expect(token).toBe('query-token');
    });
  });

  describe('connection tracking', () => {
    it('should track active connections', () => {
      const pubkey = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';
      const socketId = 'socket-123';

      authMiddleware.trackConnection(socketId, pubkey);

      expect(authMiddleware.getSocketPubkey(socketId)).toBe(pubkey);
      expect(authMiddleware.getActiveConnections(pubkey).has(socketId)).toBe(true);
      expect(authMiddleware.isUserConnected(pubkey)).toBe(true);
    });

    it('should clean up connections on disconnect', () => {
      const pubkey = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';
      const socketId = 'socket-123';

      authMiddleware.trackConnection(socketId, pubkey);
      authMiddleware.cleanupConnection(socketId);

      expect(authMiddleware.getSocketPubkey(socketId)).toBeNull();
      expect(authMiddleware.isUserConnected(pubkey)).toBe(false);
    });

    it('should handle multiple connections per user', () => {
      const pubkey = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';
      const socketId1 = 'socket-1';
      const socketId2 = 'socket-2';

      authMiddleware.trackConnection(socketId1, pubkey);
      authMiddleware.trackConnection(socketId2, pubkey);

      expect(authMiddleware.getActiveConnections(pubkey).size).toBe(2);
      expect(authMiddleware.isUserConnected(pubkey)).toBe(true);
    });
  });

  describe('rate limiting', () => {
    it('should allow connections within limit', () => {
      const pubkey = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';

      // Add 4 connections (limit is 5)
      for (let i = 0; i < 4; i++) {
        authMiddleware.trackConnection(`socket-${i}`, pubkey);
      }

      expect(authMiddleware.isConnectionAllowed(pubkey)).toBe(true);
    });

    it('should block connections exceeding limit', () => {
      const pubkey = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';

      // Add 5 connections (limit is 5)
      for (let i = 0; i < 5; i++) {
        authMiddleware.trackConnection(`socket-${i}`, pubkey);
      }

      expect(authMiddleware.isConnectionAllowed(pubkey)).toBe(false);
    });
  });

  describe('cleanupOldConnections', () => {
    it('should clean up old connections', () => {
      const pubkey = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';
      const socketId = 'old-socket';

      // Set old timestamp (more than 30 minutes ago)
      authMiddleware.connectionTimestamps.set(socketId, Date.now() - 31 * 60 * 1000);

      const cleaned = authMiddleware.cleanupOldConnections();

      expect(cleaned).toBe(1);
    });

    it('should not clean up recent connections', () => {
      const pubkey = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';
      const socketId = 'recent-socket';

      // Set recent timestamp (less than 30 minutes ago)
      authMiddleware.connectionTimestamps.set(socketId, Date.now() - 10 * 60 * 1000);

      const cleaned = authMiddleware.cleanupOldConnections();

      expect(cleaned).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should return connection statistics', () => {
      const pubkey1 = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';
      const pubkey2 = 'GBL...TEST987654321098765432109876543210987654321098765432109876543210';

      authMiddleware.trackConnection('socket-1', pubkey1);
      authMiddleware.trackConnection('socket-2', pubkey1);
      authMiddleware.trackConnection('socket-3', pubkey2);

      const stats = authMiddleware.getStats();

      expect(stats.totalConnections).toBe(3);
      expect(stats.uniqueUsers).toBe(2);
      expect(stats.connectionsPerUser).toHaveLength(2);
    });
  });

  describe('test token generation', () => {
    it('should generate test token in non-production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const pubkey = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';
      const token = authMiddleware.generateTestToken(pubkey);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      process.env.NODE_ENV = originalEnv;
    });

    it('should reject test token generation in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const pubkey = 'GBL...TEST123456789012345678901234567890123456789012345678901234567890';

      expect(() => {
        authMiddleware.generateTestToken(pubkey);
      }).toThrow('Test token generation not allowed in production');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('token format validation', () => {
    it('should validate correct JWT format', () => {
      const validToken = 'header.payload.signature';

      const result = authMiddleware.validateTokenFormat(validToken);

      expect(result).toBe(true);
    });

    it('should reject invalid JWT format', () => {
      const invalidToken = 'invalid-token';

      const result = authMiddleware.validateTokenFormat(invalidToken);

      expect(result).toBe(false);
    });

    it('should reject empty token', () => {
      const result = authMiddleware.validateTokenFormat('');

      expect(result).toBe(false);
    });
  });

  describe('namespace authentication', () => {
    it('should allow access to user namespace', async () => {
      const token = 'valid-jwt-token';
      const decodedToken = {
        sub: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890',
        iss: 'leaseflow-protocol',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400
      };

      mockSocket.handshake.query.token = token;
      mockSocket.user = { pubkey: decodedToken.sub };
      mockSocket.nsp = { name: '/user/GBL...TEST123456789012345678901234567890123456789012345678901234567890' };
      jwt.verify.mockReturnValue(decodedToken);

      const middleware = authMiddleware.createNamespaceAuthMiddleware(null, mockSocket.nsp.name);
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject access to wrong user namespace', async () => {
      const token = 'valid-jwt-token';
      const decodedToken = {
        sub: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890',
        iss: 'leaseflow-protocol',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400
      };

      mockSocket.handshake.query.token = token;
      mockSocket.user = { pubkey: decodedToken.sub };
      mockSocket.nsp = { name: '/user/GBL...WRONG_USER987654321098765432109876543210987654321098765432109876543210' };
      jwt.verify.mockReturnValue(decodedToken);

      const middleware = authMiddleware.createNamespaceAuthMiddleware(null, mockSocket.nsp.name);
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(new Error('Unauthorized access to user namespace'));
    });
  });
});
