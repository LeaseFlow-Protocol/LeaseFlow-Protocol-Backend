const express = require('express');
const router = express.Router();
const { UtilityMonitoringController } = require('../controllers/UtilityMonitoringController');
const { UtilityMonitoringWorker } = require('../services/utilityMonitoringWorker');
const { AppDatabase } = require('../db/appDatabase');

// Initialize services
const database = new AppDatabase(process.env.DATABASE_FILENAME || './data/leaseflow-protocol.sqlite');
const monitoringWorker = new UtilityMonitoringWorker(database, {
  stdDeviationThreshold: parseFloat(process.env.UTILITY_STD_DEVIATION_THRESHOLD) || 3,
  minReadingsForBaseline: parseInt(process.env.UTILITY_MIN_READINGS) || 10,
  noDataTimeoutHours: parseInt(process.env.UTILITY_NO_DATA_TIMEOUT) || 24
});
const controller = new UtilityMonitoringController(monitoringWorker);

// Meter Management
router.post('/meters/register', (req, res) => controller.registerMeter(req, res));
router.get('/meters/lease/:leaseId', (req, res) => controller.getLeaseMeters(req, res));

// Meter Readings
router.post('/readings/record', (req, res) => controller.recordReading(req, res));
router.get('/readings/meter/:meterId', (req, res) => controller.getMeterReadings(req, res));

// Analytics & Baselines
router.post('/baselines/calculate/:meterId', (req, res) => controller.calculateBaseline(req, res));
router.post('/anomaly/check/:readingId', (req, res) => controller.triggerAnomalyCheck(req, res));

// Alert Management
router.get('/alerts/active', (req, res) => controller.getActiveAlerts(req, res));
router.post('/alerts/:alertId/acknowledge', (req, res) => controller.acknowledgeAlert(req, res));
router.post('/alerts/:alertId/resolve', (req, res) => controller.resolveAlert(req, res));

// Alert Rules
router.post('/rules/create', (req, res) => controller.createAlertRule(req, res));

// Maintenance Jobs
router.post('/maintenance/check-no-data', (req, res) => controller.checkNoDataAlerts(req, res));
router.post('/maintenance/recalculate-baselines', (req, res) => controller.recalculateBaselines(req, res));

module.exports = router;
