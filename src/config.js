const path = require("path");

const DEFAULT_CONTRACT_ID =
  "CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4";


 /**
  *  Load runtime configuration from environment variables.
 */
function loadConfig(env = process.env) {
  // --- 1. Validation Logic ---
  // In a professional setup, we check for critical keys early.
  if (env.NODE_ENV === 'production' && !env.SOROBAN_CONTRACT_ID) {
    console.warn(' WARNING: SOROBAN_CONTRACT_ID is not set. Using fallback DEFAULT_CONTRACT_ID.');
  }

  return {
    port: Number(env.PORT || 3000),
    auth: {
      jwtSecret: env.AUTH_JWT_SECRET || "development-only-leaseflow-secret",
      issuer: env.AUTH_JWT_ISSUER || "leaseflow-backend",
      audience: env.AUTH_JWT_AUDIENCE || "leaseflow-users",
    },
    database: {
      filename:
        env.DATABASE_FILENAME ||
        (env.NODE_ENV === "test"
          ? ":memory:"
          : path.join(process.cwd(), "data", "leaseflow-protocol.sqlite")),
    },
    // --- Redis Configuration ---
    redis: {
      host: env.REDIS_HOST || '127.0.0.1',
      port: Number(env.REDIS_PORT || 6379),
      password: env.REDIS_PASSWORD || null,
    },
    // --- 2. Added for Issue #9: Observability ---
    logging: {
      level: env.LOG_LEVEL || 'info',
      logToFile: env.LOG_TO_FILE === 'true' || true,
    },
    jobs: {
      renewalJobEnabled: env.LEASE_RENEWAL_JOB_ENABLED === "true",
      intervalMs: Number(
        env.LEASE_RENEWAL_JOB_INTERVAL_MS || 24 * 60 * 60 * 1000,
      ),
      scanWindowDays: Number(env.LEASE_RENEWAL_SCAN_WINDOW_DAYS || 0),
      // Added monitoring interval for the new Transaction Monitor
      monitorIntervalMs: Number(env.MONITOR_INTERVAL_MS || 10 * 1000),
      healthMonitorEnabled: env.HEALTH_MONITOR_ENABLED !== "false",
      archivalJobEnabled: env.LEASE_ARCHIVAL_JOB_ENABLED === "true",
      abandonedAssetTrackingEnabled: env.ABANDONED_ASSET_TRACKING_ENABLED !== "false",
    },
    contracts: {
      defaultContractId: env.SOROBAN_CONTRACT_ID || DEFAULT_CONTRACT_ID,
      rpcUrl: env.RPC_URL || 'https://soroban-testnet.stellar.org',
    },
    // --- Sentry Error Tracking (Task 2) ---
    sentry: {
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV || 'development',
      tracesSampleRate: parseFloat(env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
      sampleRate: parseFloat(env.SENTRY_SAMPLE_RATE) || 1.0,
    },
  };
}

module.exports = {
  DEFAULT_CONTRACT_ID,
  loadConfig,
};