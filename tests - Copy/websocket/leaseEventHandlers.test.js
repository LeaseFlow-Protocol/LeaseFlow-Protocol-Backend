const LeaseEventHandlers = require('../../src/websocket/handlers/leaseEventHandlers');
const LeaseEventValidator = require('../../src/websocket/schemas/leaseEventSchemas');

// Mock dependencies
jest.mock('../../src/websocket/schemas/leaseEventSchemas');

describe('LeaseEventHandlers', () => {
  let eventHandlers;
  let mockDatabase;
  let mockWebSocketGateway;
  let mockConfig;

  beforeEach(() => {
    // Mock database
    mockDatabase = {
      db: {
        prepare: jest.fn().mockReturnValue({
          get: jest.fn(),
          run: jest.fn()
        })
      }
    };

    // Mock WebSocket gateway
    mockWebSocketGateway = {
      broadcastToUserNamespace: jest.fn(),
      io: {
        to: jest.fn().mockReturnValue({
          emit: jest.fn()
        })
      },
      emit: jest.fn()
    };

    // Mock config
    mockConfig = {
      websocket: {
        dataLeakageProtection: true,
        rateLimitWindow: 60000,
        rateLimitMax: 100
      }
    };

    eventHandlers = new LeaseEventHandlers(mockDatabase, mockWebSocketGateway, mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processLeaseEvent', () => {
    it('should process valid event successfully', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        timestamp: new Date().toISOString(),
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE',
          depositAmount: '1000',
          depositAsset: 'USDC'
        }
      };

      // Mock successful validation
      const mockValidator = {
        validate: jest.fn().mockReturnValue({ valid: true })
      };
      eventHandlers.eventValidator = mockValidator;

      // Mock lease data
      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...LESSOR',
        tenant_id: 'GBL...LESSEE',
        status: 'active'
      });

      const result = await eventHandlers.processLeaseEvent(eventData);

      expect(result).toBe(true);
      expect(mockValidator.validate).toHaveBeenCalledWith('SecurityDepositLocked', eventData);
      expect(mockWebSocketGateway.broadcastToUserNamespace).toHaveBeenCalled();
    });

    it('should reject invalid event structure', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        // Missing required fields
      };

      // Mock failed validation
      const mockValidator = {
        validate: jest.fn().mockReturnValue({ 
          valid: false, 
          errors: ['Missing required field: leaseId'] 
        })
      };
      eventHandlers.eventValidator = mockValidator;

      const result = await eventHandlers.processLeaseEvent(eventData);

      expect(result).toBe(false);
      expect(mockValidator.validate).toHaveBeenCalled();
      expect(mockWebSocketGateway.broadcastToUserNamespace).not.toHaveBeenCalled();
    });

    it('should handle events with no recipients gracefully', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        timestamp: new Date().toISOString(),
        leaseId: 'nonexistent-lease',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      // Mock successful validation
      const mockValidator = {
        validate: jest.fn().mockReturnValue({ valid: true })
      };
      eventHandlers.eventValidator = mockValidator;

      // Mock lease not found
      mockDatabase.db.prepare().get.mockReturnValue(null);

      const result = await eventHandlers.processLeaseEvent(eventData);

      expect(result).toBe(true); // Not an error, just no recipients
      expect(mockWebSocketGateway.broadcastToUserNamespace).not.toHaveBeenCalled();
    });
  });

  describe('applySecurityControls', () => {
    it('should allow valid events', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        timestamp: new Date().toISOString(),
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      const result = await eventHandlers.applySecurityControls(eventData);

      expect(result.allowed).toBe(true);
    });

    it('should block events with invalid transaction hash', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        timestamp: new Date().toISOString(),
        leaseId: 'lease-123',
        transactionHash: 'invalid-hash',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      const result = await eventHandlers.applySecurityControls(eventData);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Event integrity validation failed');
    });

    it('should block events with future timestamps', async () => {
      const futureTime = new Date(Date.now() + 60000).toISOString();
      const eventData = {
        eventType: 'SecurityDepositLocked',
        timestamp: futureTime,
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      const result = await eventHandlers.applySecurityControls(eventData);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Event integrity validation failed');
    });

    it('should apply rate limiting', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        timestamp: new Date().toISOString(),
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      // Exceed rate limit
      for (let i = 0; i < 101; i++) {
        await eventHandlers.applySecurityControls(eventData);
      }

      const result = await eventHandlers.applySecurityControls(eventData);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Rate limit exceeded');
    });

    it('should block unauthorized lease access', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        timestamp: new Date().toISOString(),
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...IMPOSTOR', // Different from actual lessor
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      // Mock lease data
      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...LESSOR',
        tenant_id: 'GBL...LESSEE',
        status: 'active'
      });

      const result = await eventHandlers.applySecurityControls(eventData);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Unauthorized lease access');
    });
  });

  describe('checkDataLeakage', () => {
    it('should detect cross-lease data leakage', () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE',
          otherLeaseId: 'lease-456' // This should be detected
        }
      };

      const result = eventHandlers.checkDataLeakage(eventData);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Potential cross-lease data detected');
    });

    it('should detect sensitive data exposure', () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE',
          apiKey: 'secret-key-123' // This should be detected
        }
      };

      const result = eventHandlers.checkDataLeakage(eventData);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Sensitive data exposure detected');
    });

    it('should allow clean events', () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE',
          depositAmount: '1000'
        }
      };

      const result = eventHandlers.checkDataLeakage(eventData);

      expect(result.allowed).toBe(true);
    });
  });

  describe('getEventRecipients', () => {
    it('should return lease participants', async () => {
      const eventData = {
        leaseId: 'lease-123'
      };

      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...LESSOR',
        tenant_id: 'GBL...LESSEE'
      });

      const recipients = await eventHandlers.getEventRecipients(eventData);

      expect(recipients).toEqual(['GBL...LESSOR', 'GBL...LESSEE']);
    });

    it('should return empty array for non-existent lease', async () => {
      const eventData = {
        leaseId: 'nonexistent-lease'
      };

      mockDatabase.db.prepare().get.mockReturnValue(null);

      const recipients = await eventHandlers.getEventRecipients(eventData);

      expect(recipients).toEqual([]);
    });

    it('should handle duplicate participants', async () => {
      const eventData = {
        leaseId: 'lease-123'
      };

      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...SAME',
        tenant_id: 'GBL...SAME' // Same person is both landlord and tenant
      });

      const recipients = await eventHandlers.getEventRecipients(eventData);

      expect(recipients).toEqual(['GBL...SAME']);
    });
  });

  describe('deliverEvent', () => {
    it('should deliver event to all recipients', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      const recipients = ['GBL...LESSOR', 'GBL...LESSEE'];

      await eventHandlers.deliverEvent(eventData, recipients);

      expect(mockWebSocketGateway.broadcastToUserNamespace).toHaveBeenCalledTimes(2);
      expect(mockWebSocketGateway.broadcastToUserNamespace).toHaveBeenCalledWith('GBL...LESSOR', expect.any(Object));
      expect(mockWebSocketGateway.broadcastToUserNamespace).toHaveBeenCalledWith('GBL...LESSEE', expect.any(Object));
      expect(mockWebSocketGateway.io.to).toHaveBeenCalledWith('lease:lease-123');
    });
  });

  describe('sanitizeEventForRecipient', () => {
    it('should add recipient information', () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        leaseId: 'lease-123',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      const recipientPubkey = 'GBL...LESSOR';
      const sanitized = eventHandlers.sanitizeEventForRecipient(eventData, recipientPubkey);

      expect(sanitized.recipient).toBe(recipientPubkey);
      expect(sanitized.deliveredAt).toBeDefined();
      expect(sanitized.eventType).toBe(eventData.eventType);
    });
  });

  describe('handleSecurityDepositLocked', () => {
    it('should process SecurityDepositLocked event', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      // Mock processLeaseEvent
      jest.spyOn(eventHandlers, 'processLeaseEvent').mockResolvedValue(true);

      await eventHandlers.handleSecurityDepositLocked(eventData);

      expect(eventHandlers.processLeaseEvent).toHaveBeenCalledWith(eventData);
    });
  });

  describe('handleLeaseRenewed', () => {
    it('should update lease end date and process event', async () => {
      const eventData = {
        eventType: 'LeaseRenewed',
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE',
          newEndDate: '2025-01-01T00:00:00Z'
        }
      };

      // Mock processLeaseEvent
      jest.spyOn(eventHandlers, 'processLeaseEvent').mockResolvedValue(true);

      await eventHandlers.handleLeaseRenewed(eventData);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE leases'),
        '2025-01-01T00:00:00Z',
        expect.any(String),
        'lease-123'
      );
      expect(eventHandlers.processLeaseEvent).toHaveBeenCalledWith(eventData);
    });
  });

  describe('handleLeaseTerminated', () => {
    it('should update lease status and process event', async () => {
      const eventData = {
        eventType: 'LeaseTerminated',
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE',
          terminationReason: 'mutual_agreement'
        }
      };

      // Mock processLeaseEvent
      jest.spyOn(eventHandlers, 'processLeaseEvent').mockResolvedValue(true);

      await eventHandlers.handleLeaseTerminated(eventData);

      expect(mockDatabase.db.prepare().run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE leases'),
        expect.any(String),
        expect.any(String),
        'lease-123'
      );
      expect(eventHandlers.processLeaseEvent).toHaveBeenCalledWith(eventData);
    });
  });

  describe('metrics', () => {
    it('should return processing metrics', () => {
      eventHandlers.metrics.eventsProcessed = 10;
      eventHandlers.metrics.processingTime = 1000;

      const metrics = eventHandlers.getProcessingMetrics();

      expect(metrics.eventsProcessed).toBe(10);
      expect(metrics.avgProcessingTime).toBe(100);
    });

    it('should return security metrics', () => {
      eventHandlers.dataLeakageProtection.blockedAttempts = 5;
      eventHandlers.rateLimits.set('lease-123', { count: 10, resetTime: Date.now() + 60000 });

      const metrics = eventHandlers.getSecurityMetrics();

      expect(metrics.blockedAttempts).toBe(5);
      expect(metrics.totalRateLimits).toBe(1);
    });

    it('should reset metrics', () => {
      eventHandlers.metrics.eventsProcessed = 10;
      eventHandlers.dataLeakageProtection.blockedAttempts = 5;

      eventHandlers.resetMetrics();

      expect(eventHandlers.metrics.eventsProcessed).toBe(0);
      expect(eventHandlers.dataLeakageProtection.blockedAttempts).toBe(0);
    });
  });

  describe('cross-tenant data leakage protection', () => {
    it('should block events containing other lease IDs', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE',
          relatedLeases: ['lease-456', 'lease-789'] // This should be blocked
        }
      };

      // Mock successful validation
      const mockValidator = {
        validate: jest.fn().mockReturnValue({ valid: true })
      };
      eventHandlers.eventValidator = mockValidator;

      // Mock lease data
      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...LESSOR',
        tenant_id: 'GBL...LESSEE',
        status: 'active'
      });

      const result = await eventHandlers.processLeaseEvent(eventData);

      expect(result).toBe(false);
      expect(eventHandlers.metrics.eventsBlocked).toBe(1);
    });

    it('should allow events with only current lease ID', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE',
          currentLeaseId: 'lease-123' // Same as event lease ID
        }
      };

      // Mock successful validation
      const mockValidator = {
        validate: jest.fn().mockReturnValue({ valid: true })
      };
      eventHandlers.eventValidator = mockValidator;

      // Mock lease data
      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...LESSOR',
        tenant_id: 'GBL...LESSEE',
        status: 'active'
      });

      const result = await eventHandlers.processLeaseEvent(eventData);

      expect(result).toBe(true);
      expect(eventHandlers.metrics.eventsBlocked).toBe(0);
    });

    it('should prevent users from receiving events for leases they are not part of', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      // Mock successful validation
      const mockValidator = {
        validate: jest.fn().mockReturnValue({ valid: true })
      };
      eventHandlers.eventValidator = mockValidator;

      // Mock lease data for different user
      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...OTHER_LESSOR',
        tenant_id: 'GBL...OTHER_TENANT',
        status: 'active'
      });

      const result = await eventHandlers.processLeaseEvent(eventData);

      expect(result).toBe(false);
      expect(eventHandlers.metrics.eventsBlocked).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        timestamp: new Date().toISOString(),
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      // Mock successful validation
      const mockValidator = {
        validate: jest.fn().mockReturnValue({ valid: true })
      };
      eventHandlers.eventValidator = mockValidator;

      // Mock database error
      mockDatabase.db.prepare().get.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await eventHandlers.processLeaseEvent(eventData);

      expect(result).toBe(false);
      expect(eventHandlers.metrics.eventsFailed).toBe(1);
    });

    it('should handle WebSocket gateway errors gracefully', async () => {
      const eventData = {
        eventType: 'SecurityDepositLocked',
        timestamp: new Date().toISOString(),
        leaseId: 'lease-123',
        transactionHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        data: {
          lessorPubkey: 'GBL...LESSOR',
          lesseePubkey: 'GBL...LESSEE'
        }
      };

      // Mock successful validation
      const mockValidator = {
        validate: jest.fn().mockReturnValue({ valid: true })
      };
      eventHandlers.eventValidator = mockValidator;

      // Mock lease data
      mockDatabase.db.prepare().get.mockReturnValue({
        landlord_id: 'GBL...LESSOR',
        tenant_id: 'GBL...LESSEE',
        status: 'active'
      });

      // Mock WebSocket gateway error
      mockWebSocketGateway.broadcastToUserNamespace.mockImplementation(() => {
        throw new Error('WebSocket error');
      });

      const result = await eventHandlers.processLeaseEvent(eventData);

      expect(result).toBe(true); // Event processed, but delivery failed
      expect(eventHandlers.metrics.eventsFailed).toBe(1);
    });
  });
});
