/**
 * Graceful Shutdown SIGTERM Tests
 * 
 * Tests that validate:
 * - SIGTERM signal interception
 * - Active requests complete before shutdown
 * - 503 responses during shutdown
 * - Timeout boundary prevents hung processes
 * - Database connections close gracefully
 * - Redis Pub/Sub disconnects cleanly
 * - BullMQ queues pause and close
 */

const { GracefulShutdownService } = require('../src/services/gracefulShutdownService');
const { AppDatabase } = require('../src/db/appDatabase');
const { RedisService } = require('../src/services/redisService');
const http = require('http');
const express = require('express');

describe('GracefulShutdownService - SIGTERM Handling', () => {
  let gracefulShutdownService;
  let app;
  let server;
  let database;
  let redisService;

  beforeEach(() => {
    // Create Express app
    app = express();
    
    // Create in-memory database
    database = new AppDatabase(':memory:');
    
    // Create mock Redis service
    redisService = new RedisService({
      redis: {
        host: 'localhost',
        port: 6379,
        password: null
      }
    });
    
    // Create graceful shutdown service
    gracefulShutdownService = new GracefulShutdownService();
  });

  afterEach(async () => {
    // Cleanup
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    if (database) {
      await database.close();
    }
    if (redisService) {
      await redisService.disconnect();
    }
  });

  describe('SIGTERM Signal Interception', () => {
    test('should intercept SIGTERM signal', (done) => {
      server = http.createServer(app);
      server.listen(0);
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      // Mock process.exit to prevent actual exit
      const originalExit = process.exit;
      process.exit = jest.fn();
      
      // Send SIGTERM
      process.emit('SIGTERM');
      
      // Verify shutdown was triggered
      setTimeout(() => {
        expect(gracefulShutdownService.isShuttingDownInProgress()).toBe(true);
        process.exit = originalExit;
        done();
      }, 100);
    });

    test('should not trigger shutdown twice for same signal', (done) => {
      server = http.createServer(app);
      server.listen(0);
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      const originalExit = process.exit;
      process.exit = jest.fn();
      
      // Send SIGTERM twice
      process.emit('SIGTERM');
      setTimeout(() => {
        process.emit('SIGTERM');
        
        setTimeout(() => {
          // Should still be shutting down (not restarted)
          expect(gracefulShutdownService.isShuttingDownInProgress()).toBe(true);
          process.exit = originalExit;
          done();
        }, 100);
      }, 50);
    });
  });

  describe('503 Response During Shutdown', () => {
    test('should return 503 for new requests during shutdown', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      // Add a test route
      app.get('/test', (req, res) => {
        res.json({ status: 'ok' });
      });
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      // Trigger shutdown
      gracefulShutdownService.isShuttingDown = true;
      
      // Make request during shutdown
      const response = await fetch(`http://localhost:${server.address().port}/test`);
      
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.status).toBe('shutting_down');
    });

    test('should return 503 for health endpoint during shutdown', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      // Add health endpoint
      app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
      });
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      // Trigger shutdown
      gracefulShutdownService.isShuttingDown = true;
      
      // Make health request during shutdown
      const response = await fetch(`http://localhost:${server.address().port}/health`);
      
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.status).toBe('shutting_down');
    });
  });

  describe('Active Request Completion', () => {
    test('should allow active 5-second request to complete before shutdown', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      let requestCompleted = false;
      let requestStartTime;
      
      // Add a slow endpoint
      app.get('/slow', async (req, res) => {
        requestStartTime = Date.now();
        // Simulate 5-second operation
        await new Promise(resolve => setTimeout(resolve, 5000));
        requestCompleted = true;
        res.json({ status: 'completed' });
      });
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      // Start a slow request
      const requestPromise = fetch(`http://localhost:${server.address().port}/slow`);
      
      // Wait for request to start
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Trigger shutdown
      const shutdownStart = Date.now();
      gracefulShutdownService.isShuttingDown = true;
      
      // Wait for request to complete
      const response = await requestPromise;
      const requestDuration = Date.now() - requestStartTime;
      
      expect(requestCompleted).toBe(true);
      expect(response.status).toBe(200);
      expect(requestDuration).toBeGreaterThanOrEqual(5000);
    });

    test('should wait for active connections up to timeout', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      // Track connection count
      let connectionCount = 0;
      server.on('connection', () => {
        connectionCount++;
      });
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      // Simulate active connections
      const socket1 = { remoteAddress: '127.0.0.1', remotePort: 12345, destroy: jest.fn() };
      const socket2 = { remoteAddress: '127.0.0.1', remotePort: 12346, destroy: jest.fn() };
      
      gracefulShutdownService.activeConnections.add('127.0.0.1:12345:1234567890');
      gracefulShutdownService.activeConnections.add('127.0.0.1:12346:1234567891');
      
      // Start shutdown
      const waitForConnections = gracefulShutdownService.waitForActiveConnections();
      
      // Simulate connections closing
      setTimeout(() => {
        gracefulShutdownService.activeConnections.delete('127.0.0.1:12345:1234567890');
      }, 1000);
      
      setTimeout(() => {
        gracefulShutdownService.activeConnections.delete('127.0.0.1:12346:1234567891');
      }, 2000);
      
      await waitForConnections;
      
      expect(gracefulShutdownService.activeConnections.size).toBe(0);
    });

    test('should force close connections after timeout', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      // Add stubborn connection that won't close
      gracefulShutdownService.activeConnections.add('127.0.0.1:12345:1234567890');
      
      // Set short timeout for testing
      gracefulShutdownService.requestDrainTimeout = 1000;
      
      const startTime = Date.now();
      await gracefulShutdownService.waitForActiveConnections();
      const duration = Date.now() - startTime;
      
      // Should timeout and force close
      expect(duration).toBeLessThan(2000);
      expect(gracefulShutdownService.activeConnections.size).toBe(0);
    });
  });

  describe('Database Connection Closing', () => {
    test('should close database connection gracefully', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      // Verify database is open
      expect(database.db).toBeDefined();
      
      // Close database
      await gracefulShutdownService.closeDatabaseConnections();
      
      // Database should be closed (accessing it would throw)
      expect(() => database.db.prepare('SELECT 1')).toThrow();
    });

    test('should handle database close errors gracefully', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      // Mock database that throws on close
      const mockDatabase = {
        close: jest.fn().mockRejectedValue(new Error('Database close error'))
      };
      
      gracefulShutdownService.initialize(app, server, { database: mockDatabase, redisService });
      
      // Should not throw
      await expect(gracefulShutdownService.closeDatabaseConnections()).resolves.not.toThrow();
    });
  });

  describe('Redis Pub/Sub Disconnect', () => {
    test('should unsubscribe from all channels on disconnect', async () => {
      const mockSubscriber = {
        subscribe: jest.fn().mockResolvedValue(),
        unsubscribe: jest.fn().mockResolvedValue(),
        quit: jest.fn().mockResolvedValue(),
        on: jest.fn()
      };
      
      redisService.subscriber = mockSubscriber;
      redisService.subscriptions.set('channel1', jest.fn());
      redisService.subscriptions.set('channel2', jest.fn());
      
      await redisService.disconnect();
      
      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith('channel1', 'channel2');
      expect(mockSubscriber.quit).toHaveBeenCalled();
      expect(redisService.subscriptions.size).toBe(0);
    });

    test('should handle subscriber disconnect errors gracefully', async () => {
      const mockSubscriber = {
        unsubscribe: jest.fn().mockRejectedValue(new Error('Disconnect error')),
        quit: jest.fn().mockRejectedValue(new Error('Quit error'))
      };
      
      redisService.subscriber = mockSubscriber;
      redisService.subscriptions.set('channel1', jest.fn());
      
      // Should not throw
      await expect(redisService.disconnect()).resolves.not.toThrow();
    });
  });

  describe('BullMQ Queue Pausing', () => {
    test('should pause BullMQ queues on shutdown', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      const mockWorker = {
        pause: jest.fn().mockResolvedValue(),
        close: jest.fn().mockResolvedValue()
      };
      
      const mockQueue = {
        pause: jest.fn().mockResolvedValue(),
        close: jest.fn().mockResolvedValue()
      };
      
      gracefulShutdownService.registerBullMQQueue('test-queue', mockQueue, mockWorker);
      
      await gracefulShutdownService.pauseBullMQQueues();
      
      expect(mockWorker.pause).toHaveBeenCalled();
      expect(mockQueue.pause).toHaveBeenCalled();
    });

    test('should close BullMQ queues after pausing', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      const mockWorker = {
        pause: jest.fn().mockResolvedValue(),
        close: jest.fn().mockResolvedValue()
      };
      
      const mockQueue = {
        pause: jest.fn().mockResolvedValue(),
        close: jest.fn().mockResolvedValue()
      };
      
      gracefulShutdownService.registerBullMQQueue('test-queue', mockQueue, mockWorker);
      
      await gracefulShutdownService.closeBullMQQueues();
      
      expect(mockWorker.close).toHaveBeenCalled();
      expect(mockQueue.close).toHaveBeenCalled();
    });

    test('should handle BullMQ pause errors gracefully', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      const mockWorker = {
        pause: jest.fn().mockRejectedValue(new Error('Pause error'))
      };
      
      const mockQueue = {
        pause: jest.fn().mockResolvedValue()
      };
      
      gracefulShutdownService.registerBullMQQueue('test-queue', mockQueue, mockWorker);
      
      // Should not throw
      await expect(gracefulShutdownService.pauseBullMQQueues()).resolves.not.toThrow();
    });
  });

  describe('Timeout Boundary Security', () => {
    test('should enforce 30-second total shutdown timeout', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      // Mock slow operations
      gracefulShutdownService.stopAcceptingConnections = jest.fn().mockResolvedValue();
      gracefulShutdownService.pauseBullMQQueues = jest.fn().mockResolvedValue();
      gracefulShutdownService.waitForActiveConnections = jest.fn().mockImplementation(() => {
        return new Promise(resolve => setTimeout(resolve, 35000)); // Exceeds timeout
      });
      gracefulShutdownService.stopBackgroundJobs = jest.fn().mockResolvedValue();
      gracefulShutdownService.closeBullMQQueues = jest.fn().mockResolvedValue();
      gracefulShutdownService.closeDatabaseConnections = jest.fn().mockResolvedValue();
      gracefulShutdownService.closeRedisConnections = jest.fn().mockResolvedValue();
      gracefulShutdownService.stopGraphQLServer = jest.fn().mockResolvedValue();
      gracefulShutdownService.closeHttpServer = jest.fn().mockResolvedValue();
      
      const originalExit = process.exit;
      process.exit = jest.fn();
      
      const startTime = Date.now();
      await gracefulShutdownService.performGracefulShutdown();
      const duration = Date.now() - startTime;
      
      // Should complete within reasonable time (not hang indefinitely)
      expect(duration).toBeLessThan(40000);
      expect(process.exit).toHaveBeenCalledWith(1); // Should exit with error due to timeout
      
      process.exit = originalExit;
    });

    test('should enforce 25-second request drain timeout', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      // Add stubborn connections
      for (let i = 0; i < 5; i++) {
        gracefulShutdownService.activeConnections.add(`127.0.0.1:${12345 + i}:${Date.now()}`);
      }
      
      const startTime = Date.now();
      await gracefulShutdownService.waitForActiveConnections();
      const duration = Date.now() - startTime;
      
      // Should timeout within 25 seconds + small margin
      expect(duration).toBeLessThan(26000);
      expect(gracefulShutdownService.activeConnections.size).toBe(0);
    });
  });

  describe('Integration Test - Full Shutdown Flow', () => {
    test('should complete full shutdown flow within timeout', async () => {
      server = http.createServer(app);
      server.listen(0);
      
      // Add test route
      app.get('/test', (req, res) => {
        res.json({ status: 'ok' });
      });
      
      gracefulShutdownService.initialize(app, server, { database, redisService });
      
      // Start a request
      const requestPromise = fetch(`http://localhost:${server.address().port}/test`);
      
      // Wait for request to start
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Trigger shutdown
      const originalExit = process.exit;
      process.exit = jest.fn();
      
      const shutdownStart = Date.now();
      gracefulShutdownService.handleShutdown('SIGTERM');
      
      // Wait for request to complete
      const response = await requestPromise;
      
      // Wait for shutdown to complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const shutdownDuration = Date.now() - shutdownStart;
      
      expect(response.status).toBe(200);
      expect(gracefulShutdownService.isShuttingDownInProgress()).toBe(true);
      expect(shutdownDuration).toBeLessThan(5000); // Should complete quickly
      
      process.exit = originalExit;
    });
  });
});
