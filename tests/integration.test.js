const request = require('supertest');
const { createApp } = require('../index');
const { AppDatabase } = require('../src/db/appDatabase');
const { RedisService } = require('../src/services/redisService');

describe('Integration Tests - Database Outage Simulation', () => {
  let app;
  let database;
  let redisService;

  beforeAll(async () => {
    // Setup test database
    database = new AppDatabase(':memory:');
    await database.initialize();
    
    // Setup mock Redis service
    redisService = new RedisService({
      redis: {
        host: 'localhost',
        port: 6379
      }
    });
    
    // Create test app
    app = createApp({ database, redisService });
  });

  afterAll(async () => {
    if (database) {
      database.close();
    }
  });

  describe('Database Outage Impact on Health Probes', () => {
    it('should return 503 for readiness probe during database outage', async () => {
      // Simulate database outage by closing connection
      database.close();
      
      const response = await request(app)
        .get('/health/readiness')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
      expect(response.body.ready).toBe(false);
      expect(response.body.checks.database.status).toBe('unhealthy');
    });

    it('should return 503 for liveness probe during database outage', async () => {
      // Database is already closed from previous test
      
      const response = await request(app)
        .get('/health/liveness')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
      expect(response.body.checks.process.status).toBe('down');
      expect(response.body.checks.database.status).toBe('disconnected');
    });

    it('should recover gracefully when database is restored', async () => {
      // Restore database connection
      database = new AppDatabase(':memory:');
      await database.initialize();
      
      // Create new app with restored database
      app = createApp({ database, redisService });
      
      const readinessResponse = await request(app)
        .get('/health/readiness')
        .expect(200);

      expect(readinessResponse.body.status).toBe('ok');
      expect(readinessResponse.body.ready).toBe(true);
      
      const livenessResponse = await request(app)
        .get('/health/liveness')
        .expect(200);

      expect(livenessResponse.body.status).toBe('ok');
    });
  });

  describe('Redis Outage Impact on Health Probes', () => {
    it('should return degraded status when Redis is unavailable', async () => {
      // Mock Redis service to simulate outage
      const mockRedisService = {
        getWorkingClient: jest.fn().mockRejectedValue(new Error('Redis connection failed')),
      };
      
      const testApp = createApp({ database, redisService: mockRedisService });
      
      const response = await request(testApp)
        .get('/health/readiness')
        .expect(503);

      expect(['degraded', 'unhealthy']).toContain(response.body.status);
      expect(response.body.checks.redis.status).toBe('unhealthy');
    });
  });

  describe('GraphQL During Database Outage', () => {
    it('should handle database errors gracefully in GraphQL queries', async () => {
      // Simulate database outage
      database.close();
      
      const query = `
        query {
          leases(limit: 10) {
            id
            status
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      // Should return errors but not crash
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should recover GraphQL operations when database is restored', async () => {
      // Restore database
      database = new AppDatabase(':memory:');
      await database.initialize();
      app = createApp({ database, redisService });
      
      const query = `
        query {
          __schema {
            types {
              name
            }
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.errors).toBeUndefined();
    });
  });

  describe('DataLoaders During Database Outage', () => {
    it('should handle batch loading errors gracefully', async () => {
      // Simulate database outage for dataloaders
      const mockDatabase = {
        db: {
          prepare: jest.fn().mockReturnValue({
            all: jest.fn().mockRejectedValue(new Error('Database connection failed')),
          }),
        },
      };

      const { DataLoaderFactory } = require('../src/graphql/dataloaders');
      const mockRlsService = {
        canAccessActor: jest.fn().mockReturnValue(true),
        canAccessAsset: jest.fn().mockReturnValue(true),
        canAccessLease: jest.fn().mockReturnValue(true),
      };

      const factory = new DataLoaderFactory(mockDatabase, mockRlsService);
      const loaders = factory.createLoaders();

      // Should handle errors gracefully
      await expect(loaders.asset.loadMany(['asset1', 'asset2'])).rejects.toThrow('Database connection failed');
    });
  });

  describe('Subscriptions During Database Outage', () => {
    it('should handle subscription manager initialization errors', async () => {
      const mockRedisService = {
        getWorkingClient: jest.fn().mockRejectedValue(new Error('Redis connection failed')),
      };

      const { SubscriptionManager } = require('../src/graphql/subscriptions');
      const subscriptionManager = new SubscriptionManager(mockRedisService, {});

      // Should handle initialization errors gracefully
      await expect(subscriptionManager.initialize()).rejects.toThrow('Redis connection failed');
    });
  });

  describe('Performance Under Load', () => {
    it('should handle concurrent health check requests efficiently', async () => {
      const promises = Array.from({ length: 100 }, () =>
        request(app).get('/health/liveness')
      );

      const responses = await Promise.all(promises);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
      });
    });

    it('should handle concurrent GraphQL requests efficiently', async () => {
      const query = `
        query {
          __schema {
            types {
              name
            }
          }
        }
      `;

      const promises = Array.from({ length: 50 }, () =>
        request(app).post('/graphql').send({ query })
      );

      const responses = await Promise.all(promises);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
      });
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory during repeated operations', async () => {
      const initialMemory = process.memoryUsage();
      
      // Perform many operations
      for (let i = 0; i < 1000; i++) {
        await request(app).get('/health/liveness');
        
        if (i % 100 === 0) {
          // Force garbage collection if available
          if (global.gc) {
            global.gc();
          }
        }
      }
      
      // Force garbage collection
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage();
      
      // Memory usage should not increase significantly
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
    });
  });

  describe('Error Recovery', () => {
    it('should recover from transient database errors', async () => {
      // Mock database that fails initially then succeeds
      let callCount = 0;
      const mockDatabase = {
        db: {
          prepare: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount <= 2) {
              return {
                all: jest.fn().mockRejectedValue(new Error('Transient error')),
              };
            }
            return {
              all: jest.fn().mockReturnValue([{ id: 'asset1', name: 'Asset 1' }]),
            };
          }),
        },
      };

      const { AssetLoader } = require('../src/graphql/dataloaders');
      const mockRlsService = {
        canAccessAsset: jest.fn().mockReturnValue(true),
      };

      const loader = new AssetLoader(mockDatabase, mockRlsService);
      
      // First two calls should fail
      await expect(loader.load('asset1')).rejects.toThrow('Transient error');
      await expect(loader.load('asset1')).rejects.toThrow('Transient error');
      
      // Third call should succeed
      const result = await loader.load('asset1');
      expect(result).toEqual({ id: 'asset1', name: 'Asset 1' });
    });
  });

  describe('Security Integration', () => {
    it('should enforce authentication across all endpoints', async () => {
      // Test health endpoints (should be public)
      await request(app).get('/health/liveness').expect(200);
      await request(app).get('/health/readiness').expect(200);
      
      // Test GraphQL endpoint (should handle auth internally)
      const query = `
        query {
          me {
            id
            publicKey
          }
        }
      `;
      
      const response = await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      // Should return null for unauthenticated user, not error
      expect(response.body.data.me).toBeNull();
    });

    it('should not leak sensitive information during errors', async () => {
      // Simulate database error
      database.close();
      
      const response = await request(app)
        .get('/health/readiness')
        .expect(503);

      // Should not contain sensitive system information
      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toMatch(/password|secret|key|token|internal/);
      expect(responseText).not.toMatch(/\/home\/|C:\\|\/usr\//);
      expect(responseText).not.toMatch(/Error:|at |\.js:/);
    });
  });
});

describe('Integration Tests - GraphQL Subscriptions', () => {
  let app;
  let database;
  let redisService;
  let subscriptionManager;

  beforeAll(async () => {
    database = new AppDatabase(':memory:');
    await database.initialize();
    
    redisService = new RedisService({
      redis: {
        host: 'localhost',
        port: 6379
      }
    });
    
    app = createApp({ database, redisService });
    
    // Initialize subscription manager
    const { SubscriptionManager } = require('../src/graphql/subscriptions');
    subscriptionManager = new SubscriptionManager(redisService, database);
  });

  afterAll(async () => {
    if (database) {
      database.close();
    }
    if (subscriptionManager) {
      await subscriptionManager.cleanup();
    }
  });

  describe('Subscription Event Flow', () => {
    it('should publish and filter subscription events correctly', async () => {
      const testEvent = {
        leaseId: 'test-lease-1',
        oldStatus: 'ACTIVE',
        newStatus: 'EXPIRED',
        lease: {
          id: 'test-lease-1',
          status: 'EXPIRED'
        },
        timestamp: new Date().toISOString()
      };

      // Test event filtering
      const filteredEvent = await subscriptionManager.filterSubscriptionData('lease_status_changed', testEvent);
      
      expect(filteredEvent.leaseId).toBe('test-lease-1');
      expect(filteredEvent.oldStatus).toBe('ACTIVE');
      expect(filteredEvent.newStatus).toBe('EXPIRED');
      expect(filteredEvent.lease).toBeDefined();
    });

    it('should remove sensitive information from subscription payloads', async () => {
      const sensitiveEvent = {
        leaseId: 'test-lease-1',
        internalNotes: 'Secret internal information',
        adminFlags: ['sensitive-flag'],
        publicData: 'Public information'
      };

      const filteredEvent = await subscriptionManager.filterSubscriptionData('lease_status_changed', sensitiveEvent);
      
      expect(filteredEvent.internalNotes).toBeUndefined();
      expect(filteredEvent.adminFlags).toBeUndefined();
      expect(filteredEvent.publicData).toBe('Public information');
      expect(filteredEvent.leaseId).toBe('test-lease-1');
    });
  });

  describe('Real-time Event Publishing', () => {
    it('should publish lease status change events', async () => {
      const mockRedis = {
        publish: jest.fn().mockResolvedValue(1),
      };
      redisService.getWorkingClient = jest.fn().mockResolvedValue(mockRedis);

      await subscriptionManager.publishEvent('lease_status_changed', {
        leaseId: 'test-lease-1',
        oldStatus: 'ACTIVE',
        newStatus: 'EXPIRED'
      });

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'lease_status_changed',
        expect.stringContaining('test-lease-1')
      );
    });

    it('should handle publish errors gracefully', async () => {
      const mockRedis = {
        publish: jest.fn().mockRejectedValue(new Error('Redis publish failed')),
      };
      redisService.getWorkingClient = jest.fn().mockResolvedValue(mockRedis);

      // Should not throw error
      await subscriptionManager.publishEvent('lease_status_changed', {
        leaseId: 'test-lease-1',
        oldStatus: 'ACTIVE',
        newStatus: 'EXPIRED'
      });
    });
  });
});

describe('Integration Tests - End-to-End Workflows', () => {
  let app;
  let database;
  let redisService;

  beforeAll(async () => {
    database = new AppDatabase(':memory:');
    await database.initialize();
    
    redisService = new RedisService({
      redis: {
        host: 'localhost',
        port: 6379
      }
    });
    
    app = createApp({ database, redisService });
  });

  afterAll(async () => {
    if (database) {
      database.close();
    }
  });

  describe('Complete Request Flow', () => {
    it('should handle health check -> GraphQL query -> response flow', async () => {
      // Step 1: Health check
      const healthResponse = await request(app).get('/health/liveness').expect(200);
      expect(healthResponse.body.status).toBe('ok');

      // Step 2: GraphQL schema query
      const schemaQuery = `
        query {
          __schema {
            types {
              name
            }
          }
        }
      `;

      const graphqlResponse = await request(app)
        .post('/graphql')
        .send({ query: schemaQuery })
        .expect(200);

      expect(graphqlResponse.body.data).toBeDefined();
      expect(graphqlResponse.body.data.__schema).toBeDefined();

      // Step 3: Final health check
      const finalHealthResponse = await request(app).get('/health/readiness').expect(200);
      expect(finalHealthResponse.body.status).toBe('ok');
    });

    it('should handle concurrent mixed requests efficiently', async () => {
      const healthPromises = Array.from({ length: 10 }, () =>
        request(app).get('/health/liveness')
      );

      const graphqlQuery = `
        query {
          __type(name: "Lease") {
            kind
            fields {
              name
            }
          }
        }
      `;

      const graphqlPromises = Array.from({ length: 10 }, () =>
        request(app).post('/graphql').send({ query: graphqlQuery })
      );

      const allPromises = [...healthPromises, ...graphqlPromises];
      const responses = await Promise.all(allPromises);

      // All health requests should succeed
      responses.slice(0, 10).forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
      });

      // All GraphQL requests should succeed
      responses.slice(10).forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
      });
    });
  });

  describe('System Resilience', () => {
    it('should maintain performance under sustained load', async () => {
      const query = `
        query {
          __schema {
            types {
              name
            }
          }
        }
      `;

      const durations = [];
      
      for (let i = 0; i < 50; i++) {
        const startTime = Date.now();
        
        await request(app).post('/graphql').send({ query });
        
        const duration = Date.now() - startTime;
        durations.push(duration);
      }

      const averageDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDuration = Math.max(...durations);

      // Should maintain reasonable performance
      expect(averageDuration).toBeLessThan(100); // Average under 100ms
      expect(maxDuration).toBeLessThan(500); // Max under 500ms
    });

    it('should recover from temporary service degradation', async () => {
      // Simulate temporary Redis degradation
      const originalGetWorkingClient = redisService.getWorkingClient;
      let callCount = 0;
      
      redisService.getWorkingClient = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          return Promise.reject(new Error('Redis temporarily unavailable'));
        }
        return originalGetWorkingClient.call(redisService);
      });

      // First few health checks should show degraded status
      for (let i = 0; i < 3; i++) {
        const response = await request(app).get('/health/readiness');
        expect(['degraded', 'unhealthy']).toContain(response.body.status);
      }

      // Should recover when Redis is available again
      const recoveryResponse = await request(app).get('/health/readiness');
      expect(recoveryResponse.body.status).toBe('ok');

      // Restore original method
      redisService.getWorkingClient = originalGetWorkingClient;
    });
  });
});
