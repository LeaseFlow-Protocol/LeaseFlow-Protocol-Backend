const { loadConfig } = require('../src/config');
const { ActorAuthService } = require('../src/services/actorAuthService');

describe('LeaseFlow Core Modules', () => {
  test('loadConfig returns config object', () => {
    const config = loadConfig({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'test' });
    expect(config).toBeDefined();
    expect(config.auth).toBeDefined();
    expect(config.auth.jwtSecret).toBe('test');
  });

  test('ActorAuthService can issue and verify tokens', () => {
    const config = loadConfig({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'test-secret', AUTH_JWT_ISSUER: 'test', AUTH_JWT_AUDIENCE: 'test' });
    const auth = new ActorAuthService(config);
    const token = auth.issueToken({ actorId: 'test-user', role: 'landlord' });
    expect(token).toBeDefined();
    const decoded = auth.verifyToken(token);
    expect(decoded.id).toBe('test-user');
    expect(decoded.role).toBe('landlord');
  });

  test('AppDatabase initializes', () => {
    const { AppDatabase } = require('../src/db/appDatabase');
    const db = new AppDatabase(':memory:');
    expect(db).toBeDefined();
    db.close();
  });
});
