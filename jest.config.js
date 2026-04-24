module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/services/**/*.js',
    'src/controllers/**/*.js',
    'src/jobs/**/*.js',
    '!src/tests/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.js'],
  testTimeout: 10000,
};
