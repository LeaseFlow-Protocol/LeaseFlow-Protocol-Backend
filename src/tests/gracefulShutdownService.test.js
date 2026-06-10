const { GracefulShutdownService } = require('../services/gracefulShutdownService');
const EventEmitter = require('events');

describe('GracefulShutdownService', () => {
  let gracefulShutdownService;
  let mockApp;
  let mockServer;
  let mockDependencies;

  beforeEach(() => {
    // Mock Express app
    mockApp = {
      get: jest.fn(),
      use: jest.fn(),
    };

    // Mock HTTP server
    mockServer = new EventEmitter();
    mockServer.close = jest.fn().mockImplementation((callback) => {
      setTimeout(callback, 100); // Simulate async close
    });
    mockServer.on = jest.fn();

    // Mock dependencies
    mockDependencies = {
      database: {
        close: jest.fn().mockResolvedValue(),
      },
      redisService: {
        getWorkingClient: jest.fn().mockResolvedValue({
          quit: jest.fn().mockResolvedValue(),
        }),
      },
      apolloServer: {
        stop: jest.fn().mockResolvedValue(),
      },
      config: {},
    };

    gracefulShutdownService = new GracefulShutdownService();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize signal handlers', () => {
      const processOnSpy = jest.spyOn(process, 'on');
      
      gracefulShutdownService.initialize(mockApp, mockServer, mockDependencies);

      expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(processOnSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
      expect(processOnSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));

      processOnSpy.mockRestore();
    });

    it('should setup connection tracking', () => {
      gracefulShutdownService.initialize(mockApp, mockServer, mockDependencies);

      expect(mockServer.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });
  });

  describe('connection tracking', () => {
    it('should track active connections', () => {
      gracefulShutdownService.initialize(mockApp, mockServer, mockDependencies);

      const mockSocket = {
        remoteAddress: '127.0.0.1',
        remotePort: 12345,
        on: jest.fn(),
        destroy: jest.fn(),
        setTimeout: jest.fn(),
      };

      // Simulate connection event
      const connectionCallback = mockServer.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionCallback(mockSocket);

      expect(gracefulShutdownService.getActiveConnectionCount()).toBe(1);
      expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should remove connections when closed', () => {
      gracefulShutdownService.initialize(mockApp, mockServer, mockDependencies);

      const mockSocket = {
        remoteAddress: '127.0.0.1',
        remotePort: 12345,
        on: jest.fn(),
      };

      const connectionCallback = mockServer.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionCallback(mockSocket);

      expect(gracefulShutdownService.getActiveConnectionCount()).toBe(1);

      // Simulate socket close
      const closeCallback = mockSocket.on.mock.calls.find(call => call[0] === 'close')[1];
      closeCallback();

      expect(gracefulShutdownService.getActiveConnectionCount()).toBe(0);
    });
  });

  describe('background job registration', () => {
    it('should register background jobs', () => {
      const mockJob = {
        stop: jest.fn().mockResolvedValue(),
      };

      gracefulShutdownService.registerBackgroundJob('testJob', mockJob);

      // Simulate shutdown to test job stopping
      const handleShutdownSpy = jest.spyOn(gracefulShutdownService, 'handleShutdown');
      handleShutdownSpy.mockImplementation(async () => {
        await gracefulShutdownService.stopBackgroundJobs();
      });

      return gracefulShutdownService.handleShutdown('SIGTERM').then(() => {
        expect(mockJob.stop).toHaveBeenCalled();
      });
    });

    it('should handle jobs without stop method', () => {
      const mockJob = {}; // No stop method

      expect(() => {
        gracefulShutdownService.registerBackgroundJob('testJob', mockJob);
      }).not.toThrow();
    });
  });

  describe('shutdown sequence', () => {
    beforeEach(() => {
      gracefulShutdownService.initialize(mockApp, mockServer, mockDependencies);
    });

    it('should perform complete shutdown sequence', async () => {
      // Mock process.exit to prevent actual exit during tests
      const processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

      await gracefulShutdownService.handleShutdown('SIGTERM');

      // Verify shutdown steps
      expect(mockDependencies.database.close).toHaveBeenCalled();
      expect(mockDependencies.redisService.getWorkingClient).toHaveBeenCalled();
      expect(mockDependencies.apolloServer.stop).toHaveBeenCalled();
      expect(mockServer.close).toHaveBeenCalled();
      expect(mockApp.get).toHaveBeenCalledWith('/health', expect.any(Function));

      processExitSpy.mockRestore();
    });

    it('should handle errors during shutdown gracefully', async () => {
      const processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

      // Make database close fail
      mockDependencies.database.close.mockRejectedValue(new Error('Database error'));

      await gracefulShutdownService.handleShutdown('SIGTERM');

      expect(processExitSpy).toHaveBeenCalledWith(1);

      processExitSpy.mockRestore();
    });

    it('should wait for active connections but timeout if necessary', async () => {
      const processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

      // Add mock active connection
      const mockSocket = {
        remoteAddress: '127.0.0.1',
        remotePort: 12345,
        on: jest.fn(),
        setTimeout: jest.fn(),
        destroy: jest.fn(),
      };

      const connectionCallback = mockServer.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionCallback(mockSocket);

      // Mock timeout to speed up test
      const originalTimeout = gracefulShutdownService.shutdownTimeout;
      gracefulShutdownService.shutdownTimeout = 1000;

      await gracefulShutdownService.handleShutdown('SIGTERM');

      expect(gracefulShutdownService.getActiveConnectionCount()).toBe(0);

      gracefulShutdownService.shutdownTimeout = originalTimeout;
      processExitSpy.mockRestore();
    });
  });

  describe('health check during shutdown', () => {
    beforeEach(() => {
      gracefulShutdownService.initialize(mockApp, mockServer, mockDependencies);
    });

    it('should modify health endpoint during shutdown', () => {
      const processExitSpy = jest.spyOn(process, 'exit').mockImplementation();
      let healthCallback;

      mockApp.get.mockImplementation((path, callback) => {
        if (path === '/health') {
          healthCallback = callback;
        }
      });

      return gracefulShutdownService.handleShutdown('SIGTERM').then(() => {
        expect(mockApp.get).toHaveBeenCalledWith('/health', expect.any(Function));
        
        // Test the health callback
        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
        };

        healthCallback({}, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(503);
        expect(mockRes.json).toHaveBeenCalledWith({
          status: 'shutting_down',
          message: 'Server is shutting down',
          timestamp: expect.any(String)
        });

        processExitSpy.mockRestore();
      });
    });
  });

  describe('state management', () => {
    it('should track shutdown state', () => {
      expect(gracefulShutdownService.isShuttingDownInProgress()).toBe(false);

      const processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

      const shutdownPromise = gracefulShutdownService.handleShutdown('SIGTERM');
      
      expect(gracefulShutdownService.isShuttingDownInProgress()).toBe(true);

      return shutdownPromise.then(() => {
        processExitSpy.mockRestore();
      });
    });

    it('should ignore subsequent shutdown signals', () => {
      const processExitSpy = jest.spyOn(process, 'exit').mockImplementation();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const firstShutdown = gracefulShutdownService.handleShutdown('SIGTERM');
      const secondShutdown = gracefulShutdownService.handleShutdown('SIGTERM');

      return Promise.all([firstShutdown, secondShutdown]).then(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Shutdown already in progress')
        );

        processExitSpy.mockRestore();
        consoleSpy.mockRestore();
      });
    });
  });

  describe('Soroban indexer specific handling', () => {
    it('should pause indexer jobs during shutdown', async () => {
      const mockIndexerJob = {
        pause: jest.fn().mockResolvedValue(),
      };

      gracefulShutdownService.registerBackgroundJob('sorobanIndexer', mockIndexerJob);

      const processExitSpy = jest.spyOn(process, 'exit').mockImplementation();

      await gracefulShutdownService.handleShutdown('SIGTERM');

      expect(mockIndexerJob.pause).toHaveBeenCalled();

      processExitSpy.mockRestore();
    });
  });
});
