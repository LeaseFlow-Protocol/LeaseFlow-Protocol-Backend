require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const multer = require("multer");
const sharp = require("sharp");

// Swagger
const swaggerUi = require("swagger-ui-express");
const swaggerSpecs = require("./src/swagger");

// Services & Config
const { loadConfig } = require("./src/config");
const { AppDatabase } = require("./src/db/appDatabase");
const { ActorAuthService } = require("./src/services/actorAuthService");
const { NotificationService } = require("./src/services/notificationService");
const { SorobanLeaseService } = require("./src/services/sorobanLeaseService");
const { LeaseRenewalService } = require("./src/services/leaseRenewalService");
const {
  LeaseRenewalJob,
  startLeaseRenewalScheduler,
} = require("./src/jobs/leaseRenewalJob");
const {
  RentPaymentTrackerService,
} = require("./services/rentPaymentTrackerService");
const { startPaymentTrackerJob } = require("./src/jobs/paymentTrackerJob");
const { createPaymentRoutes } = require("./src/routes/paymentRoutes");
const { LateFeeJob, startLateFeeScheduler } = require("./src/jobs/lateFeeJob");
const { LateFeeService } = require("./src/services/lateFeeService");
const { LateFeeController } = require("./src/controllers/LateFeeController");
const { createLateFeeRoutes } = require("./src/routes/lateFeeRoutes");
const {
  getUSDCToFiatRates,
  getXLMToUSDCPath,
} = require("./services/priceFeedService");
const AvailabilityService = require("./services/availabilityService");
const AssetMetadataService = require("./services/assetMetadataService");
const AutoReclaimWorker = require("./services/autoReclaimWorker");
const {
  createConditionProofService,
} = require("./services/conditionProofService");
const {
  createFileConditionProofStore,
} = require("./services/conditionProofStore");
const {
  createSecurityDepositLockService,
  requireLockedSecurityDeposit,
} = require("./services/securityDepositLock");
const {
  TenantCreditScoreAggregator,
} = require("./tenantCreditScoreAggregator");

// Routes
const leaseRoutes = require("./src/routes/leaseRoutes");
const ownerRoutes = require("./src/routes/ownerRoutes");
const kycRoutes = require("./src/routes/kycRoutes");
const sanctionsRoutes = require("./src/routes/sanctionsRoutes");
const evictionNoticeRoutes = require("./src/routes/evictionNoticeRoutes");
const vendorRoutes = require("./src/routes/vendorRoutes");
const taxRoutes = require("./src/routes/taxRoutes");
const propertyRoutes = require("./src/routes/propertyRoutes");

const { LeaseCacheService } = require("./src/services/LeaseCacheService");

/**
 * Build authentication middleware for landlords and tenants.
 *
 * @param {ActorAuthService} actorAuthService Auth service.
 * @returns {import('express').RequestHandler}
 */
function requireActorAuth(actorAuthService) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ success: false, error: "Authentication required" });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    try {
      req.actor = actorAuthService.verifyToken(token);
      return next();
    } catch (error) {
      return res.status(401).json({ success: false, error: error.message });
    }
  };
}

/**
 * Create the Express app with injectable services for testing.
 */
function createApp(dependencies = {}) {
  const app = express();
  const config = dependencies.config || loadConfig();
  const database =
    dependencies.database || new AppDatabase(config.database.filename);

  // Dependencies & Services
  const actorAuthService =
    dependencies.actorAuthService || new ActorAuthService(config);
  const notificationService =
    dependencies.notificationService || new NotificationService(database);
  const sorobanLeaseService =
    dependencies.sorobanLeaseService || new SorobanLeaseService(config);
  const leaseRenewalService =
    dependencies.leaseRenewalService ||
    new LeaseRenewalService(
      database,
      notificationService,
      sorobanLeaseService,
      config,
    );
  const lateFeeService =
    dependencies.lateFeeService ||
    new LateFeeService(database, notificationService, sorobanLeaseService);
  const lateFeeController = new LateFeeController(lateFeeService);
  const availabilityService =
    dependencies.availabilityService || new AvailabilityService();
  const assetMetadataService =
    dependencies.assetMetadataService || new AssetMetadataService();
  const creditScoreAggregator =
    dependencies.creditScoreAggregator || new TenantCreditScoreAggregator();
  const proofService =
    dependencies.conditionProofService ||
    createConditionProofService({ store: createFileConditionProofStore() });
  const depositGatekeeper =
    dependencies.securityDepositService || createSecurityDepositLockService();
  const leaseCacheService = dependencies.leaseCacheService || new LeaseCacheService(database);

  // Inject for use in routes/controllers
  app.locals.database = database;
  app.locals.availabilityService = availabilityService;
  app.locals.assetMetadataService = assetMetadataService;
  app.locals.lateFeeService = lateFeeService;
  app.locals.leaseCacheService = leaseCacheService;

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Static Files
  const uploadDir = path.join(__dirname, "uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  app.use("/uploads", express.static(uploadDir));

  // Multer for image optimization
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
  });
  const upload = multer({ storage });

  // Swagger Documentation
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

  // --- Base Routes ---
  app.get("/", (req, res) => {
    res.json({
      project: "LeaseFlow Protocol",
      description: "Secure Lease Indexer and Storage Facilitator",
      status: "Active",
      version: "1.0.0",
      contract_id:
        config.contracts?.defaultContractId ||
        "CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4",
    });
  });

  // --- API Routes ---
  app.use('/api/leases', leaseRoutes);
  app.use('/api/owners', ownerRoutes);
  app.use('/api/kyc', kycRoutes);
  app.use('/api/sanctions', sanctionsRoutes);
  app.use('/api/eviction-notices', evictionNoticeRoutes);
  app.use('/api/vendors', vendorRoutes);
  app.use('/api/tax', taxRoutes);
  app.use('/api/properties', propertyRoutes);
  app.use('/api', createPaymentRoutes(database));

  // --- Lease Renewal Routes ---
  app.get(
    "/renewal-proposals/:proposalId",
    requireActorAuth(actorAuthService),
    (req, res) => {
      try {
        const proposal = leaseRenewalService.getProposalForActor({
          proposalId: req.params.proposalId,
          actorId: req.actor.id,
          actorRole: req.actor.role,
        });
        res.status(200).json({ success: true, data: proposal });
      } catch (error) {
        res
          .status(error.statusCode || 500)
          .json({ success: false, error: error.message });
      }
    },
  );

  app.post(
    "/renewal-proposals/:proposalId/accept",
    requireActorAuth(actorAuthService),
    (req, res) => {
      try {
        const result = leaseRenewalService.acceptProposal({
          proposalId: req.params.proposalId,
          actorId: req.actor.id,
          actorRole: req.actor.role,
        });
        res.status(200).json({
          success: true,
          data: result.proposal,
          warning: result.warning,
        });
      } catch (error) {
        res
          .status(error.statusCode || 500)
          .json({ success: false, error: error.message });
      }
    },
  );

  // --- Credit Score Routes ---
  app.post("/api/tenant-credit-score", (req, res) => {
    try {
      const { tenantId, metrics = {}, cacheTtlSeconds } = req.body || {};
      const result = creditScoreAggregator.getOrCompute(
        tenantId,
        metrics,
        cacheTtlSeconds,
      );
      res.status(200).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // --- Condition Proof Routes ---
  app.post("/leases/:leaseId/condition-proofs", async (req, res) => {
    try {
      const proof = await proofService.createProof({
        leaseId: req.params.leaseId,
        moveInStartedAt: req.body?.move_in_started_at,
        submittedAt: req.body?.submitted_at,
        note: req.body?.note,
        photos: req.body?.photos,
      });
      res.status(201).json(proof);
    } catch (error) {
      res.status(500).json({
        error: "CONDITION_PROOF_CREATE_FAILED",
        message: error.message,
      });
    }
  });

  // --- Security Deposit Routes ---
  app.post(
    "/move-in/generate-digital-key",
    requireLockedSecurityDeposit({
      action: "Generate Digital Key",
      service: depositGatekeeper,
    }),
    (req, res) => {
      res.status(200).json({
        success: true,
        message:
          "Security deposit verified. Digital key generation is authorized.",
        verification: req.securityDepositVerification,
      });
    },
  );

  // --- Price Feed Routes ---
  app.get("/api/price-feed", async (req, res) => {
    try {
      const { currencies } = req.query;
      const rates = await getUSDCToFiatRates(
        currencies ? currencies.split(",") : ["ngn", "eur", "usd"],
      );
      res.json({ success: true, rates, base_currency: "USDC" });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // --- Image Optimization ---
  app.post("/api/images/optimize", upload.single("image"), async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image file provided" });
      const { width = 300, height = 300 } = req.query;
      const outputPath = path.join(
        uploadDir,
        "optimized",
        `${Date.now()}_optimized.webp`,
      );
      if (!fs.existsSync(path.dirname(outputPath)))
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      await sharp(req.file.path)
        .resize(parseInt(width), parseInt(height), { fit: "cover" })
        .toFormat("webp", { quality: 80 })
        .toFile(outputPath);
      res.json({
        success: true,
        path: `/uploads/optimized/${path.basename(outputPath)}`,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Error Handler
  app.use((err, req, res, next) => {
    console.error("[App] Error:", err);
    res
      .status(500)
      .json({ error: "Internal server error.", details: err.message });
  });

  return app;
}

// Start Server if called directly
if (require.main === module) {
  const config = loadConfig();
  const app = createApp({ config });
  const port = config.port || 3000;

  // Initialize Background Services
  const database = app.locals.database;
  const availabilityService = app.locals.availabilityService;
  const assetMetadataService = app.locals.assetMetadataService;

  const initServices = async () => {
    try {
      await availabilityService.initialize();
    } catch (e) {
      console.warn("AvailabilityService failed to initialize:", e.message);
    }

    try {
      await assetMetadataService.initialize();
    } catch (e) {
      console.warn(
        "AssetMetadataService failed to initialize (Postgres might be down):",
        e.message,
      );
    }
  };

  initServices().finally(() => {
    app.listen(port, () => {
      console.log(`LeaseFlow Backend running at http://localhost:${port}`);

      // Background Jobs
      if (config.jobs?.renewalJobEnabled) {
        const notificationService = new NotificationService(database);
        const sorobanLeaseService = new SorobanLeaseService(config);
        const leaseRenewalService = new LeaseRenewalService(
          database,
          notificationService,
          sorobanLeaseService,
          config,
        );
        startLeaseRenewalScheduler(
          new LeaseRenewalJob(leaseRenewalService),
          config,
        );
        console.log("Lease renewal scheduler started");
      }

      if (config.jobs?.lateFeeJobEnabled) {
        const lateFeeService = app.locals.lateFeeService;
        startLateFeeScheduler(new LateFeeJob(lateFeeService), config);
        console.log("Late fee enforcement scheduler started");
      }

      const reclaimWorker = new AutoReclaimWorker();
      // Payment Tracker
      const paymentTrackerService = new RentPaymentTrackerService(database, {
        contractAccountId: config.contracts?.defaultContractId,
      });
      startPaymentTrackerJob(paymentTrackerService, {
        cronExpression: process.env.PAYMENT_TRACKER_CRON || "* * * * *",
      });
      console.log("Payment tracker job started");

      reclaimWorker
        .initialize()
        .then(() => {
          reclaimWorker.start();
        })
        .catch((err) => {
          console.warn("AutoReclaimWorker failed to initialize:", err.message);
        });
    });
  });
}

module.exports = { createApp };
