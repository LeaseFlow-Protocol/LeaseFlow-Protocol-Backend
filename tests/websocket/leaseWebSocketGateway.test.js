const LeaseWebSocketGateway = require('../../src/websocket/gateway/leaseWebSocketGateway');
const { Server } = require('socket.io');

// Mock dependencies
jest.mock('socket.io');
jest.mock('@socket.io/redis-adapter');
jest.mock('../../src/websocket/middleware/websocketAuth');
jest.mock('../../src/websocket/schemas/leaseEventSchemas');

describe('LeaseWebSocketGateway', () => {
  let gateway;
  let mockConfig;
  let mockDatabase;
  let mockHttpServer;

  beforeEach(() => {
    mockConfig = {
      cors: {
        allowedOrigins: ['http://localhost:3000']
      },
      redis: {
        host: 'localhost',
        port: 6379
      },
      websocket: {
        heartbeatInterval: 30000,
        heartbeatTimeout: 10000,
        maxConnections: 1000,
        connectionTimeout: 120000
      }
    };

    mockDatabase = {
      db: {
        prepare: jest.fn().mockReturnValue({
          get: jest.fn(),
          run: jest.fn()
        })
      }
    };

    mockHttpServer = {
      on: jest.fn()
    };

    // Mock Socket.IO server
    const mockIO = {
      of: jest.fn().mockReturnThis(),
      use: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      to: jest.fn().mockReturnValue({
        emit: jest.fn()
      }),
      emit: jest.fn(),
      disconnectSockets: jest.fn(),
      close: jest.fn(),
      sockets: new Map()
    };

    // Mock Redis adapter
    const mockAdapter = {
      name: 'redis',
      init: jest.fn()
    };

    Server.mockImplementation(() => mockIO);
    require('@socket.io/redis-adapter').createAdapter.mockReturnValue(mockAdapter);

    gateway = new LeaseWebSocketGateway(mockConfig, mockDatabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      // Mock Redis client methods
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue()
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      await gateway.initialize(mockHttpServer);

      expect(mockCreateClient).toHaveBeenCalledTimes(2);
      expect(mockCreateClient).toHaveBeenCalledWith(mockConfig.redis);
      expect(Server).toHaveBeenCalledWith(mockHttpServer, expect.objectContaining({
        cors: {
          origin: mockConfig.cors.allowedOrigins,
          methods: ['GET', 'POST'],
          credentials: true
        },
        adapter: mockAdapter,
        transports: ['websocket', 'polling'],
        pingTimeout: mockConfig.websocket.heartbeatTimeout,
        pingInterval: mockConfig.websocket.heartbeatInterval
      }));
    });

    it('should emit initialized event', async () => {
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue()
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      const emitSpy = jest.spyOn(gateway, 'emit');

      await gateway.initialize(mockHttpServer);

      expect(emitSpy).toHaveBeenCalledWith('initialized');
    });

    it('should handle initialization errors', async () => {
      const mockRedisClient = {
        connect: jest.fn().mockRejectedValue(new Error('Redis connection failed'))
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      await expect(gateway.initialize(mockHttpServer)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('connection handling', () => {
    beforeEach(async () => {
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue()
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      await gateway.initialize(mockHttpServer);
    });

    it('should track connections', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        join: jest.fn(),
        on: jest.fn(),
        leave: jest.fn()
      };

      gateway.handleMainNamespaceConnection(mockSocket);

      expect(gateway.connectedClients.has('socket-123')).toBe(true);
      expect(gateway.connectedClients.get('socket-123').pubkey).toBe('GBL...TEST123456789012345678901234567890123456789012345678901234567890');
      expect(mockSocket.emit).toHaveBeenCalledWith('connection_ack', expect.objectContaining({
        type: 'connection_ack',
        status: 'connected',
        pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890'
      }));
    });

    it('should handle disconnections', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        join: jest.fn(),
        on: jest.fn(),
        leave: jest.fn()
      };

      // First track the connection
      gateway.handleMainNamespaceConnection(mockSocket);
      expect(gateway.connectedClients.size).toBe(1);

      // Then handle disconnect
      gateway.handleDisconnect(mockSocket, 'client disconnect');

      expect(gateway.connectedClients.size).toBe(0);
      expect(gateway.metrics.activeConnections).toBe(0);
    });

    it('should handle user namespace connections', () => {
      const mockSocket = {
        id: 'socket-456',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/user/GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        connected: true,
        emit: jest.fn(),
        join: jest.fn(),
        on: jest.fn(),
        leave: jest.fn()
      };

      gateway.handleUserNamespaceConnection(mockSocket);

      expect(gateway.connectedClients.has('socket-456')).toBe(true);
      expect(gateway.connectedClients.get('socket-456').type).toBe('user');
      expect(mockSocket.emit).toHaveBeenCalledWith('connection_ack', expect.objectContaining({
        type: 'connection_ack',
        status: 'connected',
        namespace: '/user/GBL...TEST123456789012345678901234567890123456789012345678901234567890'
      }));
    });
  });

  describe('lease subscription handling', () => {
    beforeEach(async () => {
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue()
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      await gateway.initialize(mockHttpServer);
    });

    it('should handle lease subscription with valid access', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...LESSOR' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        join: jest.fn(),
        on: jest.fn(),
        leave: jest.fn()
      };

      const subscriptionData = { leaseId: 'lease-123' };

      // Mock lease access validation
      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...LESSOR',
        tenant_id: 'GBL...LESSEE'
      });

      gateway.handleLeaseSubscription(mockSocket, subscriptionData);

      expect(mockSocket.join).toHaveBeenCalledWith('lease:lease-123');
      expect(mockSocket.emit).toHaveBeenCalledWith('subscription_confirmed', expect.objectContaining({
        type: 'subscription_confirmed',
        leaseId: 'lease-123'
      }));
    });

    it('should reject lease subscription without access', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...UNAUTHORIZED' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        join: jest.fn(),
        on: jest.fn(),
        leave: jest.fn()
      };

      const subscriptionData = { leaseId: 'lease-123' };

      // Mock lease access validation (no access)
      mockDatabase.db.prepare().get.mockReturnValue(null);

      gateway.handleLeaseSubscription(mockSocket, subscriptionData);

      expect(mockSocket.join).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          code: 'UNAUTHORIZED_ACCESS'
        })
      }));
    });

    it('should reject lease subscription with missing leaseId', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...LESSOR' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        join: jest.fn(),
        on: jest.fn(),
        leave: jest.fn()
      };

      const subscriptionData = {}; // Missing leaseId

      gateway.handleLeaseSubscription(mockSocket, subscriptionData);

      expect(mockSocket.join).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          code: 'INVALID_PAYLOAD'
        })
      }));
    });

    it('should handle lease unsubscription', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...LESSOR' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        join: jest.fn(),
        on: jest.fn(),
        leave: jest.fn()
      };

      // First subscribe
      const subscriptionData = { leaseId: 'lease-123' };
      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...LESSOR',
        tenant_id: 'GBL...LESSEE'
      });
      gateway.handleLeaseSubscription(mockSocket, subscriptionData);

      // Then unsubscribe
      const unsubscriptionData = { leaseId: 'lease-123' };
      gateway.handleLeaseUnsubscription(mockSocket, unsubscriptionData);

      expect(mockSocket.leave).toHaveBeenCalledWith('lease:lease-123');
    });
  });

  describe('event broadcasting', () => {
    beforeEach(async () => {
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue()
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      await gateway.initialize(mockHttpServer);
    });

    it('should broadcast lease event to relevant parties', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        timestamp: new Date().toISOString(),
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE',
          depositAmount: '1000'
        }
      };

      // Mock lease data
      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...LESSOR',
        tenant_id: 'GBL...LESSEE'
      });

      await gateway.broadcastLeaseEvent(eventData);

      expect(gateway.io.to).toHaveBeenCalledWith('lease:lease-123');
      expect(gateway.io.to().emit).toHaveBeenCalledWith('lease_event', eventData);
      expect(gateway.metrics.messagesSent).toBe(2); // One for lease room, one for each user namespace
    });

    it('should handle broadcast for non-existent lease', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        leaseId: 'nonexistent-lease',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      // Mock lease not found
      mockDatabase.db.prepare().get.mockReturnValue(null);

      await gateway.broadcastLeaseEvent(eventData);

      expect(gateway.io.to).not.toHaveBeenCalled();
      expect(gateway.metrics.errors).toBe(1);
    });

    it('should validate event data before broadcasting', async () => {
      const invalidEventData = {
        eventType: 'InvalidEventType',
        leaseId: 'lease-123',
        transactionHash: 'invalid-hash'
      };

      // Mock validation failure
      const mockValidator = {
        validate: jest.fn().mockReturnValue({ valid: false, errors: ['Invalid event type'] })
      };
      gateway.eventValidator = mockValidator;

      await gateway.broadcastLeaseEvent(invalidEventData);

      expect(mockValidator.validate).toHaveBeenCalledWith('InvalidEventType', invalidEventData);
      expect(gateway.io.to).not.toHaveBeenCalled();
      expect(gateway.metrics.errors).toBe(1);
    });
  });

  describe('heartbeat mechanism', () => {
    beforeEach(async () => {
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue()
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      await gateway.initialize(mockHttpServer);
    });

    it('should start heartbeat for new connection', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        on: jest.fn(),
        join: jest.fn()
      };

      gateway.handleMainNamespaceConnection(mockSocket);

      expect(gateway.heartbeatIntervals.has('socket-123')).toBe(true);
      expect(mockSocket.on).toHaveBeenCalledWith('pong', expect.any(Function));
    });

    it('should handle ping messages', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        on: jest.fn(),
        join: jest.fn()
      };

      gateway.handleMainNamespaceConnection(mockSocket);
      gateway.handlePing(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('pong', expect.objectContaining({
        type: 'pong',
        clientId: 'socket-123'
      }));
    });

    it('should handle pong messages', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        on: jest.fn(),
        join: jest.fn()
      };

      gateway.handleMainNamespaceConnection(mockSocket);
      
      const pongData = {
        type: 'pong',
        timestamp: new Date().toISOString()
      };

      gateway.handlePong(mockSocket, pongData);

      const clientInfo = gateway.connectedClients.get('socket-123');
      expect(clientInfo.lastPongReceived).toBeDefined();
      expect(clientInfo.heartbeatMissed).toBe(0);
    });

    it('should detect zombie connections', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        on: jest.fn(),
        join: jest.fn(),
        disconnect: jest.fn()
      };

      // Track connection with old timestamp
      gateway.handleMainNamespaceConnection(mockSocket);
      const clientInfo = gateway.connectedClients.get('socket-123');
      clientInfo.lastActivity = new Date(Date.now() - 25 * 60 * 1000).toISOString(); // 25 minutes ago

      // Mock socket in the server
      gateway.io.sockets.sockets.set('socket-123', mockSocket);

      gateway.checkZombieConnections();

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('Soroban event handling', () => {
    beforeEach(async () => {
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue()
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      await gateway.initialize(mockHttpServer);
    });

    it('should handle valid Soroban event', () => {
      const sorobanEvent = {
        type: 'security_deposit_locked',
        leaseId: 'lease-123',
        timestamp: new Date().toISOString(),
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        lessorPubkey: 'GBL...LESSOR',
        lesseePubkey: 'GBL...LESSEE',
        data: {
          depositAmount: '1000'
        }
      };

      gateway.handleSorobanEvent(sorobanEvent);

      expect(gateway.io.to).toHaveBeenCalledWith('lease:lease-123');
      expect(gateway.io.to().emit).toHaveBeenCalled();
    });

    it('should ignore invalid Soroban event', () => {
      const invalidSorobanEvent = {
        type: 'invalid_type',
        leaseId: 'lease-123'
      };

      gateway.handleSorobanEvent(invalidSorobanEvent);

      expect(gateway.io.to).not.toHaveBeenCalled();
    });

    it('should transform Soroban event to lease event format', () => {
      const sorobanEvent = {
        type: 'security_deposit_locked',
        leaseId: 'lease-123',
        timestamp: new Date().toISOString(),
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        lessorPubkey: 'GBL...LESSOR',
        lesseePubkey: 'GBL...LESSEE',
        data: {
          depositAmount: '1000'
        }
      };

      const transformedEvent = gateway.transformSorobanEvent(sorobanEvent);

      expect(transformedEvent).toEqual({
        eventType: 'SecurityDepositLocked',
        timestamp: sorobanEvent.timestamp,
        leaseId: sorobanEvent.leaseId,
        transactionHash: sorobanEvent.transactionHash,
        network: 'testnet',
        data: {
          ...sorobanEvent.data,
          lessorPubkey: sorobanEvent.lessorPubkey,
          lesseePubkey: sorobanEvent.lesseePubkey
        }
      });
    });

    it('should return null for unmapped Soroban event type', () => {
      const unmappedEvent = {
        type: 'unmapped_type',
        leaseId: 'lease-123',
        timestamp: new Date().toISOString(),
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456'
      };

      const transformedEvent = gateway.transformSorobanEvent(unmappedEvent);

      expect(transformedEvent).toBeNull();
    });
  });

  describe('metrics and statistics', () => {
    beforeEach(async () => {
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue()
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      await gateway.initialize(mockHttpServer);
    });

    it('should return gateway statistics', () => {
      const stats = gateway.getStats();

      expect(stats).toHaveProperty('totalConnections');
      expect(stats).toHaveProperty('activeConnections');
      expect(stats).toHaveProperty('messagesSent');
      expect(stats).toHaveProperty('messagesReceived');
      expect(stats).toHaveProperty('errors');
      expect(stats).toHaveProperty('timestamp');
    });

    it('should return connected clients information', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        on: jest.fn(),
        join: jest.fn()
      };

      gateway.handleMainNamespaceConnection(mockSocket);

      const clients = gateway.getConnectedClients();

      expect(clients).toHaveLength(1);
      expect(clients[0]).toEqual(expect.objectContaining({
        id: 'socket-123',
        pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890',
        namespace: '/leases',
        type: 'main'
      }));
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue()
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      await gateway.initialize(mockHttpServer);
    });

    it('should shutdown gracefully', async () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        on: jest.fn(),
        join: jest.fn(),
        disconnect: jest.fn()
      };

      gateway.handleMainNamespaceConnection(mockSocket);
      expect(gateway.heartbeatIntervals.size).toBe(1);

      await gateway.shutdown();

      expect(gateway.heartbeatIntervals.size).toBe(0);
      expect(gateway.io.disconnectSockets).toHaveBeenCalledWith(true);
      expect(gateway.io.close).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue()
      };

      const mockCreateClient = jest.fn().mockReturnValue(mockRedisClient);
      require('redis').createClient = mockCreateClient;

      await gateway.initialize(mockHttpServer);
    });

    it('should handle socket errors', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        on: jest.fn(),
        join: jest.fn()
      };

      gateway.handleMainNamespaceConnection(mockSocket);

      const error = new Error('Socket error');
      gateway.handleSocketError(mockSocket, error);

      expect(gateway.metrics.errors).toBe(1);
    });

    it('should handle lease subscription errors', () => {
      const mockSocket = {
        id: 'socket-123',
        user: { pubkey: 'GBL...TEST123456789012345678901234567890123456789012345678901234567890' },
        nsp: { name: '/leases' },
        connected: true,
        emit: jest.fn(),
        join: jest.fn(),
        on: jest.fn(),
        leave: jest.fn()
      };

      const subscriptionData = { leaseId: 'lease-123' };

      // Mock database error
      mockDatabase.db.prepare().get.mockImplementation(() => {
        throw new Error('Database error');
      });

      gateway.handleLeaseSubscription(mockSocket, subscriptionData);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR'
        })
      }));
    });
  });
});
