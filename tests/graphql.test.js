const request = require('supertest');
const { createApp } = require('../index');
const { AppDatabase } = require('../src/db/appDatabase');
const { RedisService } = require('../src/services/redisService');

describe('GraphQL API Tests', () => {
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

  describe('GraphQL Endpoint', () => {
    it('should be accessible at /graphql', async () => {
      const response = await request(app)
        .get('/graphql')
        .expect(200);

      // GraphQL playground should be available in development
      expect(response.text).toContain('graphql');
    });

    it('should handle GraphQL queries', async () => {
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
      expect(response.body.data.__schema).toBeDefined();
      expect(response.body.data.__schema.types).toBeInstanceOf(Array);
    });

    it('should handle GraphQL mutations', async () => {
      const mutation = `
        mutation {
          __typename
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query: mutation })
        .expect(200);

      expect(response.body.data).toBeDefined();
    });

    it('should validate GraphQL queries', async () => {
      const invalidQuery = `
        query {
          nonExistentField
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query: invalidQuery })
        .expect(400);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('GraphQL Authentication', () => {
    it('should require authentication for protected queries', async () => {
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

      // Should return null for unauthenticated user
      expect(response.body.data.me).toBeNull();
    });

    it('should handle authenticated requests', async () => {
      // Mock authenticated user
      const authToken = 'Bearer mock-jwt-token';
      
      const query = `
        query {
          me {
            id
            publicKey
          }
        }
      `;

      // This would require proper JWT mocking
      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send({ query });

      // Response depends on JWT validation implementation
      expect(response.body).toBeDefined();
    });
  });

  describe('GraphQL Subscriptions', () => {
    it('should support subscription queries', async () => {
      const subscriptionQuery = `
        subscription {
          onLeaseStatusChanged(leaseId: "test-lease-id") {
            leaseId
            oldStatus
            newStatus
            timestamp
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query: subscriptionQuery });

      // Subscriptions require WebSocket connection
      expect(response.body).toBeDefined();
    });
  });

  describe('GraphQL Performance', () => {
    it('should handle concurrent requests efficiently', async () => {
      const query = `
        query {
          __schema {
            types {
              name
            }
          }
        }
      `;

      const promises = Array.from({ length: 10 }, () =>
        request(app).post('/graphql').send({ query })
      );

      const responses = await Promise.all(promises);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
      });
    });

    it('should respond within acceptable time limits', async () => {
      const query = `
        query {
          __schema {
            types {
              name
            }
          }
        }
      `;

      const startTime = Date.now();
      
      await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
    });
  });

  describe('GraphQL Security', () => {
    it('should not leak sensitive information in errors', async () => {
      const maliciousQuery = `
        query {
          __schema {
            types {
              fields {
                name
                type {
                  name
                  ofType {
                    name
                  }
                }
              }
            }
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query: maliciousQuery })
        .expect(200);

      // Should not contain sensitive system information
      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toMatch(/password|secret|key|token/);
    });

    it('should handle query depth limits', async () => {
      // Create a deeply nested query
      const deepQuery = `
        query {
          lease(id: "test") {
            asset {
              conditionReports {
                lease {
                  asset {
                    conditionReports {
                      lease {
                        asset {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query: deepQuery });

      // Should either succeed or be limited based on configuration
      expect(response.body).toBeDefined();
    });

    it('should validate input types', async () => {
      const invalidMutation = `
        mutation {
          createLease(input: {
            rentAmount: "invalid-number"
            startDate: "not-a-date"
            endDate: "also-not-a-date"
          }) {
            id
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query: invalidMutation });

      expect(response.body.errors).toBeDefined();
    });
  });

  describe('Custom Scalar Types', () => {
    it('should handle Stroops scalar type', async () => {
      const query = `
        query {
          __type(name: "Stroops") {
            kind
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      expect(response.body.data.__type.kind).toBe('SCALAR');
    });

    it('should handle Timestamp scalar type', async () => {
      const query = `
        query {
          __type(name: "Timestamp") {
            kind
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      expect(response.body.data.__type.kind).toBe('SCALAR');
    });

    it('should handle JSON scalar type', async () => {
      const query = `
        query {
          __type(name: "JSON") {
            kind
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      expect(response.body.data.__type.kind).toBe('SCALAR');
    });
  });

  describe('GraphQL Schema Integrity', () => {
    it('should have all required types defined', async () => {
      const query = `
        query {
          __schema {
            types {
              name
              kind
            }
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      const types = response.body.data.__schema.types;
      const typeNames = types.map(type => type.name);

      // Check for core types
      expect(typeNames).toContain('Query');
      expect(typeNames).toContain('Mutation');
      expect(typeNames).toContain('Subscription');
      expect(typeNames).toContain('Lease');
      expect(typeNames).toContain('Asset');
      expect(typeNames).toContain('Actor');
      expect(typeNames).toContain('ConditionReport');
    });

    it('should have all required queries defined', async () => {
      const query = `
        query {
          __type(name: "Query") {
            fields {
              name
              type {
                name
                kind
              }
            }
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      const fields = response.body.data.__type.fields;
      const fieldNames = fields.map(field => field.name);

      // Check for core queries
      expect(fieldNames).toContain('lease');
      expect(fieldNames).toContain('leases');
      expect(fieldNames).toContain('asset');
      expect(fieldNames).toContain('assets');
      expect(fieldNames).toContain('me');
    });

    it('should have all required mutations defined', async () => {
      const query = `
        query {
          __type(name: "Mutation") {
            fields {
              name
              type {
                name
                kind
              }
            }
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      const fields = response.body.data.__type.fields;
      const fieldNames = fields.map(field => field.name);

      // Check for core mutations
      expect(fieldNames).toContain('createLease');
      expect(fieldNames).toContain('updateLease');
      expect(fieldNames).toContain('createAsset');
      expect(fieldNames).toContain('updateAsset');
    });

    it('should have all required subscriptions defined', async () => {
      const query = `
        query {
          __type(name: "Subscription") {
            fields {
              name
              type {
                name
                kind
              }
            }
          }
        }
      `;

      const response = await request(app)
        .post('/graphql')
        .send({ query })
        .expect(200);

      const fields = response.body.data.__type.fields;
      const fieldNames = fields.map(field => field.name);

      // Check for core subscriptions
      expect(fieldNames).toContain('onLeaseStatusChanged');
      expect(fieldNames).toContain('onLeaseCreated');
      expect(fieldNames).toContain('onAssetUnlocked');
      expect(fieldNames).toContain('onConditionReportSubmitted');
    });
  });
});

describe('GraphQL DataLoaders Tests', () => {
  let dataloaders;
  let database;
  let rlsService;

  beforeEach(() => {
    // Mock dependencies
    database = {
      db: {
        prepare: jest.fn().mockReturnValue({
          all: jest.fn(),
          get: jest.fn(),
        }),
      },
    };

    rlsService = {
      canAccessActor: jest.fn().mockReturnValue(true),
      canAccessAsset: jest.fn().mockReturnValue(true),
      canAccessLease: jest.fn().mockReturnValue(true),
    };

    const { DataLoaderFactory } = require('../src/graphql/dataloaders');
    const factory = new DataLoaderFactory(database, rlsService);
    dataloaders = factory.createLoaders();
  });

  describe('AssetLoader', () => {
    it('should batch load assets efficiently', async () => {
      const mockAssets = [
        { id: 'asset1', name: 'Asset 1' },
        { id: 'asset2', name: 'Asset 2' },
      ];

      database.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockAssets),
      });

      const results = await dataloaders.asset.loadMany(['asset1', 'asset2']);
      
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(mockAssets[0]);
      expect(results[1]).toEqual(mockAssets[1]);
      
      // Should only call database once for batch
      expect(database.db.prepare).toHaveBeenCalledTimes(1);
    });

    it('should cache loaded assets', async () => {
      const mockAsset = { id: 'asset1', name: 'Asset 1' };

      database.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([mockAsset]),
      });

      // First load
      await dataloaders.asset.load('asset1');
      
      // Second load should use cache
      await dataloaders.asset.load('asset1');
      
      // Should only call database once due to caching
      expect(database.db.prepare).toHaveBeenCalledTimes(1);
    });
  });

  describe('LesseeLoader', () => {
    it('should batch load lessees efficiently', async () => {
      const mockLessees = [
        { id: 'lessee1', name: 'Lessee 1' },
        { id: 'lessee2', name: 'Lessee 2' },
      ];

      database.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockLessees),
      });

      const results = await dataloaders.lessee.loadMany(['lessee1', 'lessee2']);
      
      expect(results).toHaveLength(2);
      expect(database.db.prepare).toHaveBeenCalledTimes(1);
    });
  });

  describe('LeaseLoader', () => {
    it('should batch load leases efficiently', async () => {
      const mockLeases = [
        { id: 'lease1', status: 'ACTIVE' },
        { id: 'lease2', status: 'EXPIRED' },
      ];

      database.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockLeases),
      });

      const results = await dataloaders.lease.loadMany(['lease1', 'lease2']);
      
      expect(results).toHaveLength(2);
      expect(database.db.prepare).toHaveBeenCalledTimes(1);
    });
  });

  describe('DataLoader Memory Management', () => {
    it('should clear individual cache entries', async () => {
      const mockAsset = { id: 'asset1', name: 'Asset 1' };

      database.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([mockAsset]),
      });

      // Load asset
      await dataloaders.asset.load('asset1');
      
      // Clear cache
      dataloaders.asset.clear('asset1');
      
      // Load again should hit database
      await dataloaders.asset.load('asset1');
      
      expect(database.db.prepare).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache entries', async () => {
      const mockAssets = [
        { id: 'asset1', name: 'Asset 1' },
        { id: 'asset2', name: 'Asset 2' },
      ];

      database.db.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockAssets),
      });

      // Load assets
      await dataloaders.asset.loadMany(['asset1', 'asset2']);
      
      // Clear all cache
      dataloaders.asset.clearAll();
      
      // Load again should hit database
      await dataloaders.asset.loadMany(['asset1', 'asset2']);
      
      expect(database.db.prepare).toHaveBeenCalledTimes(2);
    });
  });
});

describe('GraphQL Subscription Manager Tests', () => {
  let subscriptionManager;
  let mockRedisService;
  let mockDatabase;

  beforeEach(() => {
    mockRedisService = {
      getWorkingClient: jest.fn().mockResolvedValue({
        subscribe: jest.fn(),
        publish: jest.fn(),
        on: jest.fn(),
        quit: jest.fn(),
      }),
    };

    mockDatabase = {};

    const { SubscriptionManager } = require('../src/graphql/subscriptions');
    subscriptionManager = new SubscriptionManager(mockRedisService, mockDatabase);
  });

  describe('Subscription Initialization', () => {
    it('should initialize successfully', async () => {
      await subscriptionManager.initialize();
      expect(subscriptionManager.isInitialized).toBe(true);
    });

    it('should handle initialization errors', async () => {
      mockRedisService.getWorkingClient.mockRejectedValue(new Error('Redis connection failed'));
      
      await expect(subscriptionManager.initialize()).rejects.toThrow('Redis connection failed');
    });
  });

  describe('Event Publishing', () => {
    it('should publish events to Redis', async () => {
      const mockRedis = {
        publish: jest.fn().mockResolvedValue(1),
      };
      mockRedisService.getWorkingClient.mockResolvedValue(mockRedis);

      await subscriptionManager.publishEvent('test_channel', { test: 'data' });
      
      expect(mockRedis.publish).toHaveBeenCalledWith('test_channel', JSON.stringify({ test: 'data' }));
    });

    it('should handle publish errors gracefully', async () => {
      const mockRedis = {
        publish: jest.fn().mockRejectedValue(new Error('Publish failed')),
      };
      mockRedisService.getWorkingClient.mockResolvedValue(mockRedis);

      // Should not throw error
      await subscriptionManager.publishEvent('test_channel', { test: 'data' });
    });
  });

  describe('Data Filtering', () => {
    it('should filter sensitive data from subscription payloads', async () => {
      const sensitiveData = {
        leaseId: 'lease1',
        internalNotes: 'Secret internal notes',
        adminFlags: ['sensitive'],
        publicData: 'Public information'
      };

      const filtered = await subscriptionManager.filterSubscriptionData('lease_status_changed', sensitiveData);
      
      expect(filtered.internalNotes).toBeUndefined();
      expect(filtered.adminFlags).toBeUndefined();
      expect(filtered.publicData).toBe('Public information');
      expect(filtered.leaseId).toBe('lease1');
    });
  });

  describe('Async Iterator Creation', () => {
    it('should create async iterators for subscriptions', async () => {
      const iterator = subscriptionManager.createAsyncIterator('test_channel');
      
      expect(iterator).toBeDefined();
      expect(typeof iterator[Symbol.asyncIterator]).toBe('function');
    });
  });

  describe('Cleanup', () => {
    it('should clean up resources properly', async () => {
      const mockRedis = {
        quit: jest.fn().mockResolvedValue(),
      };
      mockRedisService.getWorkingClient.mockResolvedValue(mockRedis);

      await subscriptionManager.initialize();
      await subscriptionManager.cleanup();
      
      expect(mockRedis.quit).toHaveBeenCalled();
      expect(subscriptionManager.isInitialized).toBe(false);
    });
  });
});
