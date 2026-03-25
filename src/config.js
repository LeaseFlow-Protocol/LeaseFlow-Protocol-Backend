const path = require("path");

const DEFAULT_CONTRACT_ID =
  "CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4";

/**
 * Load runtime configuration from environment variables.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env] Environment values.
 * @returns {object}
 */
function loadConfig(env = process.env) {
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
    jobs: {
      renewalJobEnabled: env.LEASE_RENEWAL_JOB_ENABLED === "true",
      intervalMs: Number(
        env.LEASE_RENEWAL_JOB_INTERVAL_MS || 24 * 60 * 60 * 1000,
      ),
      scanWindowDays: Number(env.LEASE_RENEWAL_SCAN_WINDOW_DAYS || 0),
      lateFeeJobEnabled: env.LATE_FEE_JOB_ENABLED === "true",
      lateFeeCron: env.LATE_FEE_CRON || "0 0 * * *",
    },
    contracts: {
      defaultContractId: env.SOROBAN_CONTRACT_ID || DEFAULT_CONTRACT_ID,
    },
  };
}

module.exports = {
  DEFAULT_CONTRACT_ID,
  loadConfig,
};
