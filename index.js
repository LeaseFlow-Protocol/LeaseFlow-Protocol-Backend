require('dotenv').config();

const cors = require('cors');
const express = require('express');

const { loadConfig } = require('./src/config');
const { AppDatabase } = require('./src/db/appDatabase');
const { ActorAuthService } = require('./src/services/actorAuthService');
const { NotificationService } = require('./src/services/notificationService');
const { SorobanLeaseService } = require('./src/services/sorobanLeaseService');
const { LeaseRenewalService } = require('./src/services/leaseRenewalService');
const { LeaseRenewalJob, startLeaseRenewalScheduler } = require('./src/jobs/leaseRenewalJob');

/**
 * Create the Express app with injectable services for testing.
 *
 * @param {object} [dependencies={}] Optional dependency overrides.
 * @returns {import('express').Express}
 */
function createApp(dependencies = {}) {
  const app = express();
  const config = dependencies.config || loadConfig();
  const database = dependencies.database || new AppDatabase(config.database.filename);
  const actorAuthService = dependencies.actorAuthService || new ActorAuthService(config);
  const notificationService = dependencies.notificationService || new NotificationService(database);
  const sorobanLeaseService =
    dependencies.sorobanLeaseService || new SorobanLeaseService(config);
  const leaseRenewalService =
    dependencies.leaseRenewalService ||
    new LeaseRenewalService(database, notificationService, sorobanLeaseService, config);

  app.use(cors());
  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({
      project: 'LeaseFlow Protocol',
      status: 'Active',
      contract_id: config.contracts.defaultContractId,
    });
  });

  app.get('/renewal-proposals/:proposalId', requireActorAuth(actorAuthService), (req, res) => {
    try {
      const proposal = leaseRenewalService.getProposalForActor({
        proposalId: req.params.proposalId,
        actorId: req.actor.id,
        actorRole: req.actor.role,
      });

      return res.status(200).json({ success: true, data: proposal });
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.post(
    '/renewal-proposals/:proposalId/accept',
    requireActorAuth(actorAuthService),
    (req, res) => {
      try {
        const result = leaseRenewalService.acceptProposal({
          proposalId: req.params.proposalId,
          actorId: req.actor.id,
          actorRole: req.actor.role,
        });

        return res.status(200).json({ success: true, data: result.proposal, warning: result.warning });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  app.post(
    '/renewal-proposals/:proposalId/reject',
    requireActorAuth(actorAuthService),
    (req, res) => {
      try {
        const proposal = leaseRenewalService.rejectProposal({
          proposalId: req.params.proposalId,
          actorId: req.actor.id,
          actorRole: req.actor.role,
        });

        return res.status(200).json({ success: true, data: proposal });
      } catch (error) {
        return handleError(res, error);
      }
    },
  );

  app.use((req, res) => res.status(404).json({ success: false, error: 'Not found' }));

  return app;
}

/**
 * Build authentication middleware for landlords and tenants.
 *
 * @param {ActorAuthService} actorAuthService Auth service.
 * @returns {import('express').RequestHandler}
 */
function requireActorAuth(actorAuthService) {
  return (req, res, next) => {
    const token = extractBearerToken(req);

    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    try {
      req.actor = actorAuthService.verifyToken(token);
      return next();
    } catch (error) {
      return res.status(401).json({ success: false, error: error.message });
    }
  };
}

/**
 * Extract a bearer token from the incoming request.
 *
 * @param {import('express').Request} req Request object.
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim();
}

/**
 * Send a consistent JSON error response.
 *
 * @param {import('express').Response} res Response object.
 * @param {Error & {statusCode?: number}} error Error instance.
 * @returns {import('express').Response}
 */
function handleError(res, error) {
  return res
    .status(error.statusCode || 500)
    .json({ success: false, error: error.message || 'Request failed' });
}

const config = loadConfig();
const app = createApp({ config });
const port = config.port;

if (require.main === module) {
  let scheduler;

  if (config.jobs.renewalJobEnabled) {
    const database = new AppDatabase(config.database.filename);
    const notificationService = new NotificationService(database);
    const sorobanLeaseService = new SorobanLeaseService(config);
    const leaseRenewalService = new LeaseRenewalService(
      database,
      notificationService,
      sorobanLeaseService,
      config,
    );
    scheduler = startLeaseRenewalScheduler(new LeaseRenewalJob(leaseRenewalService), config);
  }

  app.listen(port, () => {
    console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
    if (scheduler) {
      console.log(`Lease renewal scheduler running every ${config.jobs.intervalMs}ms`);
    }
  });
}

module.exports = app;
module.exports.createApp = createApp;
