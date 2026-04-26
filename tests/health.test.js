const request = require('supertest');
const { createApp } = require('../index');
const { AppDatabase } = require('../src/db/appDatabase');
const { RedisService } = require('../src/services/redisService');

describe('Health Probes Tests', () => {
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

  describe('GET /health/liveness', () => {
    it('should return 200 when application is alive', async () => {
      const response = await request(app)
        .get('/health/liveness')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        checks: {
          process: { status: 'up' },
          database: { status: 'connected' }
        }
      });
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeDefined();
    });

    it('should return 503 when database is disconnected', async () => {
      // Close database connection
      database.close();
      
      const response = await request(app)
        .get('/health/liveness')
        .expect(503);

      expect(response.body).toMatchObject({
        status: 'unhealthy',
        checks: {
          process: { status: 'down' },
          database: { status: 'disconnected' }
        }
      });
      
      // Reopen database for other tests
      database = new AppDatabase(':memory:');
      await database.initialize();
      app = createApp({ database, redisService });
    });
  });

  describe('GET /health/readiness', () => {
    it('should return 200 when application is ready', async () => {
      const response = await request(app)
        .get('/health/readiness')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        ready: true
      });
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.checks).toBeDefined();
    });

    it('should return 503 when Redis is unavailable', async () => {
      // Mock Redis service to simulate failure
      const mockRedisService = {
        getWorkingClient: jest.fn().mockRejectedValue(new Error('Redis connection failed'))
      };
      
      const testApp = createApp({ database, redisService: mockRedisService });
      
      const response = await request(testApp)
        .get('/health/readiness')
        .expect(503);

      expect(response.body).toMatchObject({
        status: 'unhealthy',
        ready: false
      });
      expect(response.body.checks.redis.status).toBe('unhealthy');
    });
  });

  describe('GET /health/startup', () => {
    it('should return 200 when application has started successfully', async () => {
      const response = await request(app)
        .get('/health/startup')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        message: 'Application startup complete'
      });
      expect(response.body.initializationTime).toBeDefined();
      expect(response.body.checks).toBeDefined();
    });

    it('should return 503 during startup initialization', async () => {
      // Create a new app instance to simulate startup
      const freshApp = createApp({ database, redisService });
      
      const response = await request(freshApp)
        .get('/health/startup')
        .expect(503);

      expect(['starting', 'ok']).toContain(response.body.status);
    });
  });

  describe('GET /health', () => {
    it('should return comprehensive health information', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        liveness: expect.objectContaining({
          status: 'ok'
        }),
        readiness: expect.objectContaining({
          status: 'ok'
        }),
        startup: expect.objectContaining({
          status: 'ok'
        }),
        version: '1.0.0'
      });
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeDefined();
    });
  });

  describe('POST /health/shutdown', () => {
    it('should mark application for graceful shutdown', async () => {
      const response = await request(app)
        .post('/health/shutdown')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'shutting_down',
        message: 'Application marked for graceful shutdown'
      });
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('Database Outage Simulation', () => {
    it('should handle database connectivity loss gracefully', async () => {
      // Simulate database outage
      database.close();
      
      const response = await request(app)
        .get('/health/readiness')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
      expect(response.body.ready).toBe(false);
      expect(response.body.checks.database.status).toBe('unhealthy');
      
      // Verify liveness also fails
      const livenessResponse = await request(app)
        .get('/health/liveness')
        .expect(503);

      expect(livenessResponse.body.status).toBe('unhealthy');
      
      // Restore database
      database = new AppDatabase(':memory:');
      await database.initialize();
      app = createApp({ database, redisService });
    });
  });

  describe('Performance Tests', () => {
    it('should respond to health checks quickly', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/health/liveness')
        .expect(200);
      
      const livenessTime = Date.now() - startTime;
      expect(livenessTime).toBeLessThan(100); // Should respond within 100ms
      
      const readinessStartTime = Date.now();
      await request(app)
        .get('/health/readiness')
        .expect(200);
      
      const readinessTime = Date.now() - readinessStartTime;
      expect(readinessTime).toBeLessThan(200); // Should respond within 200ms
    });
  });

  describe('Security Tests', () => {
    it('should not leak sensitive information in health responses', async () => {
      const response = await request(app)
        .get('/health/liveness')
        .expect(200);

      // Should not contain database connection strings
      expect(JSON.stringify(response.body)).not.toMatch(/password|secret|key/);
      
      // Should not contain stack traces
      expect(JSON.stringify(response.body)).not.toMatch(/Error:|at |\.js:/);
      
      // Should not contain internal paths
      expect(JSON.stringify(response.body)).not.toMatch(/\/home\/|C:\\|\/usr\//);
    });

    it('should handle malformed requests gracefully', async () => {
      // Test with invalid method
      await request(app)
        .patch('/health/liveness')
        .expect(404);
      
      // Test with invalid path
      await request(app)
        .get('/health/invalid')
        .expect(404);
    });
  });
});

describe('Health Service Unit Tests', () => {
  let healthService;
  let mockDatabase;
  let mockRedisService;

  beforeEach(() => {
    mockDatabase = {
      db: {
        prepare: jest.fn().mockReturnValue({
          get: jest.fn()
        })
      }
    };
    
    mockRedisService = {
      getWorkingClient: jest.fn().mockResolvedValue({
        ping: jest.fn().mockResolvedValue('PONG'),
        setex: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue('test_value'),
        del: jest.fn().mockResolvedValue(1),
        info: jest.fn().mockResolvedValue('used_memory:1000000\r\nused_memory_human:1M\r\n')
      })
    };
    
    const config = {
      startup: {
        timeoutMs: 120000
      }
    };
    
    const { HealthService } = require('../src/services/healthService');
    healthService = new HealthService(mockDatabase, mockRedisService, config);
  });

  describe('checkLiveness', () => {
    it('should return healthy status when database is connected', async () => {
      const result = await healthService.checkLiveness();
      
      expect(result.status).toBe('ok');
      expect(result.checks.process.status).toBe('up');
      expect(result.checks.database.status).toBe('connected');
    });

    it('should return unhealthy status when database fails', async () => {
      mockDatabase.db.prepare.mockReturnValue({
        get: jest.fn().mockImplementation(() => {
          throw new Error('Database connection failed');
        })
      });
      
      const result = await healthService.checkLiveness();
      
      expect(result.status).toBe('unhealthy');
      expect(result.checks.process.status).toBe('down');
      expect(result.checks.database.status).toBe('disconnected');
    });
  });

  describe('checkReadiness', () => {
    it('should return ready status when all services are healthy', async () => {
      const result = await healthService.checkReadiness();
      
      expect(result.status).toBe('ok');
      expect(result.ready).toBe(true);
      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.redis.status).toBe('healthy');
    });

    it('should return degraded status when Redis is unhealthy', async () => {
      mockRedisService.getWorkingClient.mockRejectedValue(new Error('Redis connection failed'));
      
      const result = await healthService.checkReadiness();
      
      expect(['degraded', 'unhealthy']).toContain(result.status);
      expect(result.ready).toBe(false);
      expect(result.checks.redis.status).toBe('unhealthy');
    });
  });

  describe('checkStartup', () => {
    it('should return ok status when startup is complete', async () => {
      const result = await healthService.checkStartup();
      
      expect(result.status).toBe('ok');
      expect(result.message).toBe('Application startup complete');
    });

    it('should return failed status when startup timeout is exceeded', async () => {
      // Simulate startup timeout
      healthService.startupTime = Date.now() - 130000; // 130 seconds ago
      
      const result = await healthService.checkStartup();
      
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Startup timeout exceeded');
    });
  });
});
