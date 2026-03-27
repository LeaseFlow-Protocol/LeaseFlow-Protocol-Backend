const { UtilityMonitoringWorker } = require('../services/utilityMonitoringWorker');

class UtilityMonitoringController {
  constructor(monitoringWorker) {
    this.monitoringWorker = monitoringWorker;
  }

  // ==================== Meter Management ====================

  /**
   * Register utility meter
   */
  async registerMeter(req, res) {
    try {
      const meterData = req.body;
      
      if (!meterData.leaseId || !meterData.meterType || !meterData.meterId) {
        return res.status(400).json({
          success: false,
          error: 'Lease ID, meter type, and meter ID are required'
        });
      }

      const meter = this.monitoringWorker.registerMeter(meterData);
      
      res.status(201).json({
        success: true,
        message: 'Utility meter registered successfully',
        data: meter
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error registering meter:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to register meter',
        details: error.message
      });
    }
  }

  /**
   * Get meters for lease
   */
  async getLeaseMeters(req, res) {
    try {
      const { leaseId } = req.params;
      const meters = this.monitoringWorker.getMetersByLeaseId(leaseId);

      res.status(200).json({
        success: true,
        data: meters
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error fetching meters:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch meters',
        details: error.message
      });
    }
  }

  // ==================== Meter Readings ====================

  /**
   * Record meter reading
   */
  async recordReading(req, res) {
    try {
      const readingData = req.body;
      
      if (!readingData.utilityMeterId || !readingData.readingValue) {
        return res.status(400).json({
          success: false,
          error: 'Meter ID and reading value are required'
        });
      }

      const reading = this.monitoringWorker.recordReading(readingData);
      
      res.status(201).json({
        success: true,
        message: 'Reading recorded successfully',
        data: reading
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error recording reading:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to record reading',
        details: error.message
      });
    }
  }

  /**
   * Get readings for meter
   */
  async getMeterReadings(req, res) {
    try {
      const { meterId } = req.params;
      const { limit = 100 } = req.query;
      
      const readings = this.monitoringWorker.getRecentReadings(meterId, parseInt(limit));

      res.status(200).json({
        success: true,
        data: readings
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error fetching readings:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch readings',
        details: error.message
      });
    }
  }

  // ==================== Baselines & Analytics ====================

  /**
   * Calculate consumption baseline
   */
  async calculateBaseline(req, res) {
    try {
      const { meterId } = req.params;
      const { period = 'daily' } = req.query;

      const baseline = this.monitoringWorker.calculateBaseline(meterId, period);
      
      res.status(200).json({
        success: true,
        data: baseline
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error calculating baseline:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        details: error.message
      });
    }
  }

  /**
   * Trigger anomaly check
   */
  async triggerAnomalyCheck(req, res) {
    try {
      const { readingId } = req.params;
      const result = await this.monitoringWorker.checkForAnomalies(readingId);

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error checking anomaly:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check anomaly',
        details: error.message
      });
    }
  }

  // ==================== Alert Management ====================

  /**
   * Get active alerts
   */
  async getActiveAlerts(req, res) {
    try {
      const { leaseId } = req.query;
      const alerts = this.monitoringWorker.getActiveAlerts(leaseId);

      res.status(200).json({
        success: true,
        data: alerts
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error fetching alerts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch alerts',
        details: error.message
      });
    }
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(req, res) {
    try {
      const { alertId } = req.params;
      const { acknowledgedBy } = req.body;

      if (!acknowledgedBy) {
        return res.status(400).json({
          success: false,
          error: 'Acknowledged by is required'
        });
      }

      const alert = this.monitoringWorker.acknowledgeAlert(alertId, acknowledgedBy);
      
      res.status(200).json({
        success: true,
        message: 'Alert acknowledged',
        data: alert
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error acknowledging alert:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to acknowledge alert',
        details: error.message
      });
    }
  }

  /**
   * Resolve alert
   */
  async resolveAlert(req, res) {
    try {
      const { alertId } = req.params;
      const { resolvedBy, resolutionNotes } = req.body;

      if (!resolvedBy) {
        return res.status(400).json({
          success: false,
          error: 'Resolved by is required'
        });
      }

      const alert = this.monitoringWorker.resolveAlert(alertId, resolvedBy, resolutionNotes);
      
      res.status(200).json({
        success: true,
        message: 'Alert resolved',
        data: alert
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error resolving alert:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to resolve alert',
        details: error.message
      });
    }
  }

  // ==================== Alert Rules ====================

  /**
   * Create alert rule
   */
  async createAlertRule(req, res) {
    try {
      const ruleData = req.body;
      
      if (!ruleData.ruleType || !ruleData.ruleConfig) {
        return res.status(400).json({
          success: false,
          error: 'Rule type and configuration are required'
        });
      }

      const rule = this.monitoringWorker.createAlertRule(ruleData);
      
      res.status(201).json({
        success: true,
        message: 'Alert rule created successfully',
        data: rule
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error creating alert rule:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create alert rule',
        details: error.message
      });
    }
  }

  // ==================== Maintenance Jobs ====================

  /**
   * Check for no-data alerts
   */
  async checkNoDataAlerts(req, res) {
    try {
      const alerts = this.monitoringWorker.checkNoDataAlerts();
      
      res.status(200).json({
        success: true,
        message: `Checked for no-data alerts, found ${alerts.length} offline meters`,
        data: { count: alerts.length, alerts }
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error checking no-data alerts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check no-data alerts',
        details: error.message
      });
    }
  }

  /**
   * Recalculate baselines
   */
  async recalculateBaselines(req, res) {
    try {
      const results = this.monitoringWorker.recalculateBaselines();
      
      res.status(200).json({
        success: true,
        message: `Recalculated baselines for ${results.filter(r => r.success).length} meters`,
        data: { results }
      });
    } catch (error) {
      console.error('[UtilityMonitoringController] Error recalculating baselines:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to recalculate baselines',
        details: error.message
      });
    }
  }
}

module.exports = { UtilityMonitoringController };
