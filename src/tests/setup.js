// Test setup file for Jest
// This file runs before each test file

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.AUTH_JWT_SECRET = 'test-secret';
process.env.ABANDONED_ASSET_TRACKING_ENABLED = 'true';

// Mock ipfs-http-client to avoid dependency issues in tests
jest.mock('ipfs-http-client', () => {
  return {
    create: jest.fn(() => ({
      add: jest.fn(),
      cat: jest.fn(),
      pin: jest.fn(),
      ls: jest.fn(),
    })),
  };
}, { virtual: true });

// Mock @socket.io/redis-adapter to avoid dependency issues in tests
jest.mock('@socket.io/redis-adapter', () => {
  return {
    createAdapter: jest.fn(() => ({})),
  };
}, { virtual: true });

// Mock redis to avoid dependency issues in tests
jest.mock('redis', () => {
  return {
    createClient: jest.fn(() => ({
      connect: jest.fn(),
      on: jest.fn(),
      quit: jest.fn(),
    })),
  };
}, { virtual: true });

// Mock console methods to reduce test noise
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Add custom matchers if needed
expect.extend({
  toBeWithinRange(received, floor, ceiling) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () =>
          `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
});
