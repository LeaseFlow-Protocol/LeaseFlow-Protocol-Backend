const { randomUUID } = require('crypto');

/**
 * Analytics worker for monitoring IoT utility meters
 * Detects anomalies using statistical analysis (3-sigma rule)
 * Sends proactive alerts to tenants and landlords
 */
class UtilityMonitoringWorker {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {object} config - Configuration object
   */
  constructor(database, config) {
    this.db = database;
    this.config = config || {};
    
    // Default thresholds
    this.stdDeviationThreshold = config.stdDeviationThreshold || 3; // 3 standard deviations
    this.minReadingsForBaseline = config.minReadingsForBaseline || 10;
    this.noDataTimeoutHours = config.noDataTimeoutHours || 24;
    
    // Alert notification service (inject your notification service)
    this.notificationService = config.notificationService;
  }

  // ==================== Utility Meter Management ====================

  /**
   * Register a new utility meter
   */
  registerMeter(meterData) {
    const id = meterData.id || randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO utility_meters (
        id, lease_id, meter_type, meter_id, meter_name,
        provider, unit_of_measurement, location_description, installation_date,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      meterData.leaseId,
      meterData.meterType,
      meterData.meterId,
      meterData.meterName || null,
      meterData.provider || null,
      meterData.unitOfMeasurement || 'units',
      meterData.locationDescription || null,
      meterData.installationDate || null,
      now,
      now
    );

    return this.getMeterById(id);
  }

  /**
   * Get meter by ID
   */
  getMeterById(meterId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        meter_type AS meterType,
        meter_id AS meterId,
        meter_name AS meterName,
        provider,
        unit_of_measurement AS unitOfMeasurement,
        location_description AS locationDescription,
        installation_date AS installationDate,
        last_reading_date AS lastReadingDate,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM utility_meters
      WHERE id = ?
    `);

    return stmt.get(meterId);
  }

  /**
   * Get meters by lease ID
   */
  getMetersByLeaseId(leaseId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        meter_type AS meterType,
        meter_id AS meterId,
        meter_name AS meterName,
        provider,
        unit_of_measurement AS unitOfMeasurement,
        location_description AS locationDescription,
        installation_date AS installationDate,
        last_reading_date AS lastReadingDate,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM utility_meters
      WHERE lease_id = ?
    `);

    return stmt.all(leaseId);
  }

  // ==================== Meter Reading Ingestion ====================

  /**
   * Record a meter reading (from IoT device or manual entry)
   */
  recordReading(readingData) {
    const id = readingData.id || randomUUID();
    const now = new Date().toISOString();

    // Get previous reading to calculate consumption
    const previousReading = this.getPreviousReading(readingData.utilityMeterId);
    
    let consumptionValue = null;
    if (previousReading) {
      consumptionValue = readingData.readingValue - previousReading.readingValue;
      if (consumptionValue < 0) {
        // Meter reset or replacement
        consumptionValue = null;
      }
    }

    const stmt = this.db.db.prepare(`
      INSERT INTO meter_readings (
        id, utility_meter_id, lease_id, reading_value, consumption_value,
        reading_timestamp, reading_source, quality_score, is_anomaly, anomaly_reason,
        metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      readingData.utilityMeterId,
      readingData.leaseId,
      readingData.readingValue,
      consumptionValue,
      readingData.readingTimestamp || now,
      readingData.readingSource || 'iot_auto',
      readingData.qualityScore || 1.0,
      0, // Not flagged as anomaly initially
      null,
      readingData.metadata ? JSON.stringify(readingData.metadata) : null,
      now
    );

    // Update meter's last reading date
    this.db.db.prepare(`
      UPDATE utility_meters SET last_reading_date = ?, updated_at = ? WHERE id = ?
    `).run(readingData.readingTimestamp || now, now, readingData.utilityMeterId);

    // Check for anomalies asynchronously
    setImmediate(() => {
      this.checkForAnomalies(id).catch(err => {
        console.error('[UtilityMonitoringWorker] Anomaly check failed:', err);
      });
    });

    return this.getReadingById(id);
  }

  /**
   * Get reading by ID
   */
  getReadingById(readingId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        utility_meter_id AS utilityMeterId,
        lease_id AS leaseId,
        reading_value AS readingValue,
        consumption_value AS consumptionValue,
        reading_timestamp AS readingTimestamp,
        reading_source AS readingSource,
        quality_score AS qualityScore,
        is_anomaly AS isAnomaly,
        anomaly_reason AS anomalyReason,
        metadata,
        created_at AS createdAt
      FROM meter_readings
      WHERE id = ?
    `);

    const row = stmt.get(readingId);
    if (!row) return null;

    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    };
  }

  /**
   * Get previous reading for a meter
   */
  getPreviousReading(meterId) {
    const stmt = this.db.db.prepare(`
      SELECT reading_value, reading_timestamp
      FROM meter_readings
      WHERE utility_meter_id = ?
      ORDER BY reading_timestamp DESC
      LIMIT 1
    `);

    return stmt.get(meterId);
  }

  /**
   * Get recent readings for baseline calculation
   */
  getRecentReadings(meterId, limit = 100) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        utility_meter_id AS utilityMeterId,
        lease_id AS leaseId,
        reading_value AS readingValue,
        consumption_value AS consumptionValue,
        reading_timestamp AS readingTimestamp,
        reading_source AS readingSource,
        quality_score AS qualityScore,
        is_anomaly AS isAnomaly
      FROM meter_readings
      WHERE utility_meter_id = ? AND is_anomaly = 0 AND consumption_value IS NOT NULL
      ORDER BY reading_timestamp DESC
      LIMIT ?
    `);

    return stmt.all(meterId, limit);
  }

  // ==================== Statistical Anomaly Detection ====================

  /**
   * Check if a reading is anomalous using z-score (3-sigma rule)
   */
  async checkForAnomalies(readingId) {
    const reading = this.getReadingById(readingId);
    if (!reading || !reading.consumptionValue) return null;

    const meterId = reading.utilityMeterId;
    const recentReadings = this.getRecentReadings(meterId, 50);

    // Need minimum readings for statistical analysis
    if (recentReadings.length < this.minReadingsForBaseline) {
      return { isAnomaly: false, reason: 'Insufficient data for baseline' };
    }

    // Calculate statistics
    const consumptions = recentReadings.map(r => r.consumptionValue);
    const stats = this.calculateStatistics(consumptions);

    // Calculate z-score
    const zScore = Math.abs((reading.consumptionValue - stats.mean) / stats.stdDeviation);

    // Check if exceeds threshold (3-sigma rule)
    if (zScore > this.stdDeviationThreshold) {
      // Flag as anomaly
      this.db.db.prepare(`
        UPDATE meter_readings 
        SET is_anomaly = 1, anomaly_reason = ?
        WHERE id = ?
      `).run(`Z-score ${zScore.toFixed(2)} exceeds threshold of ${this.stdDeviationThreshold}`, readingId);

      // Create alert
      const alert = await this.createAlert({
        utilityMeterId: meterId,
        leaseId: reading.leaseId,
        alertType: 'spike_detected',
        severity: this.calculateSeverity(zScore),
        title: `Unusual ${reading.meterType || 'utility'} consumption detected`,
        description: `Consumption of ${reading.consumptionValue} ${reading.unitOfMeasurement || 'units'} is ${zScore.toFixed(2)} standard deviations above normal`,
        triggerValue: reading.consumptionValue,
        thresholdValue: stats.mean + (this.stdDeviationThreshold * stats.stdDeviation),
        standardDeviations: zScore
      });

      // Send notifications
      await this.sendAlertNotifications(alert);

      return {
        isAnomaly: true,
        zScore,
        alert,
        reason: `Statistical outlier: ${zScore.toFixed(2)} std devs from mean`
      };
    }

    return { isAnomaly: false, zScore };
  }

  /**
   * Calculate mean and standard deviation
   */
  calculateStatistics(values) {
    const n = values.length;
    const mean = values.reduce((sum, val) => sum + val, 0) / n;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1);
    const stdDeviation = Math.sqrt(variance);

    return {
      mean,
      stdDeviation,
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }

  /**
   * Calculate alert severity based on z-score
   */
  calculateSeverity(zScore) {
    if (zScore >= 5) return 'critical';
    if (zScore >= 4) return 'high';
    if (zScore >= 3) return 'medium';
    return 'low';
  }

  // ==================== Baseline Calculation ====================

  /**
   * Calculate consumption baseline for a meter
   */
  calculateBaseline(meterId, period = 'daily') {
    const recentReadings = this.getRecentReadings(meterId, 100);
    
    if (recentReadings.length < this.minReadingsForBaseline) {
      throw new Error(`Insufficient readings for baseline calculation (need ${this.minReadingsForBaseline})`);
    }

    const consumptions = recentReadings.map(r => r.consumptionValue);
    const stats = this.calculateStatistics(consumptions);
    const now = new Date().toISOString();

    // Upsert baseline
    const existingBaseline = this.getBaselineForMeter(meterId, period);
    
    if (existingBaseline) {
      const stmt = this.db.db.prepare(`
        UPDATE consumption_baselines
        SET avg_consumption = ?, std_deviation = ?, min_consumption = ?, max_consumption = ?,
            sample_size = ?, last_calculated_at = ?, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(
        stats.mean,
        stats.stdDeviation,
        stats.min,
        stats.max,
        consumptions.length,
        now,
        now,
        existingBaseline.id
      );

      return this.getBaselineById(existingBaseline.id);
    } else {
      const id = randomUUID();
      const leaseId = recentReadings[0]?.leaseId;
      
      const stmt = this.db.db.prepare(`
        INSERT INTO consumption_baselines (
          id, utility_meter_id, lease_id, baseline_period,
          avg_consumption, std_deviation, min_consumption, max_consumption,
          sample_size, last_calculated_at, valid_from, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        meterId,
        leaseId,
        period,
        stats.mean,
        stats.stdDeviation,
        stats.min,
        stats.max,
        consumptions.length,
        now,
        now,
        now,
        now
      );

      return this.getBaselineById(id);
    }
  }

  /**
   * Get baseline by ID
   */
  getBaselineById(baselineId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        utility_meter_id AS utilityMeterId,
        lease_id AS leaseId,
        baseline_period AS baselinePeriod,
        avg_consumption AS avgConsumption,
        std_deviation AS stdDeviation,
        min_consumption AS minConsumption,
        max_consumption AS maxConsumption,
        sample_size AS sampleSize,
        calculation_method AS calculationMethod,
        last_calculated_at AS lastCalculatedAt,
        valid_from AS validFrom,
        valid_until AS validUntil,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM consumption_baselines
      WHERE id = ?
    `);

    return stmt.get(baselineId);
  }

  /**
   * Get baseline for meter
   */
  getBaselineForMeter(meterId, period = 'daily') {
    const stmt = this.db.db.prepare(`
      SELECT id FROM consumption_baselines
      WHERE utility_meter_id = ? AND baseline_period = ?
      ORDER BY last_calculated_at DESC
      LIMIT 1
    `);

    const row = stmt.get(meterId, period);
    if (!row) return null;

    return this.getBaselineById(row.id);
  }

  // ==================== Alert Management ====================

  /**
   * Create an alert
   */
  async createAlert(alertData) {
    const id = alertData.id || randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO utility_alerts (
        id, utility_meter_id, lease_id, alert_type, severity,
        title, description, trigger_value, threshold_value, standard_deviations,
        status, notifications_sent, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      alertData.utilityMeterId,
      alertData.leaseId,
      alertData.alertType,
      alertData.severity || 'medium',
      alertData.title,
      alertData.description,
      alertData.triggerValue || null,
      alertData.thresholdValue || null,
      alertData.standardDeviations || null,
      'active',
      JSON.stringify([]),
      now,
      now
    );

    return this.getAlertById(id);
  }

  /**
   * Get alert by ID
   */
  getAlertById(alertId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        utility_meter_id AS utilityMeterId,
        lease_id AS leaseId,
        alert_type AS alertType,
        severity,
        title,
        description,
        trigger_value AS triggerValue,
        threshold_value AS thresholdValue,
        standard_deviations AS standardDeviations,
        status,
        acknowledged_by AS acknowledgedBy,
        acknowledged_at AS acknowledgedAt,
        resolved_by AS resolvedBy,
        resolved_at AS resolvedAt,
        resolution_notes AS resolutionNotes,
        notifications_sent AS notificationsSent,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM utility_alerts
      WHERE id = ?
    `);

    const row = stmt.get(alertId);
    if (!row) return null;

    return {
      ...row,
      notificationsSent: JSON.parse(row.notificationsSent || '[]')
    };
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId, acknowledgedBy) {
    const now = new Date().toISOString();
    const stmt = this.db.db.prepare(`
      UPDATE utility_alerts
      SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(acknowledgedBy, now, now, alertId);
    return this.getAlertById(alertId);
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId, resolvedBy, resolutionNotes) {
    const now = new Date().toISOString();
    const stmt = this.db.db.prepare(`
      UPDATE utility_alerts
      SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_notes = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(resolvedBy, now, resolutionNotes, now, alertId);
    return this.getAlertById(alertId);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(leaseId = null) {
    let sql = `
      SELECT 
        id,
        utility_meter_id AS utilityMeterId,
        lease_id AS leaseId,
        alert_type AS alertType,
        severity,
        title,
        description,
        trigger_value AS triggerValue,
        threshold_value AS thresholdValue,
        standard_deviations AS standardDeviations,
        status,
        created_at AS createdAt
      FROM utility_alerts
      WHERE status = 'active'
    `;

    const params = [];
    if (leaseId) {
      sql += ' AND lease_id = ?';
      params.push(leaseId);
    }

    sql += ' ORDER BY created_at DESC';

    const stmt = this.db.db.prepare(sql);
    return stmt.all(...params);
  }

  // ==================== Notification System ====================

  /**
   * Send alert notifications to tenant and landlord
   */
  async sendAlertNotifications(alert) {
    const lease = this.db.db.prepare(`
      SELECT tenant_id AS tenantId, landlord_id AS landlordId, 
             tenant_stellar_address AS tenantAddress, landlord_stellar_address AS landlordAddress
      FROM leases WHERE id = ?
    `).get(alert.leaseId);

    if (!lease) return;

    const notificationsSent = [];

    // Get alert rules for notification preferences
    const alertRules = this.getAlertRulesForMeter(alert.utilityMeterId);
    const rule = alertRules.find(r => r.enabled);

    try {
      // Notify tenant
      if (!rule || rule.notifyTenant !== 0) {
        await this.sendNotification({
          recipientId: lease.tenantId,
          recipientRole: 'tenant',
          type: 'utility_alert',
          leaseId: alert.leaseId,
          message: `${alert.title}: ${alert.description}`,
          metadata: {
            alertId: alert.id,
            alertType: alert.alertType,
            severity: alert.severity
          }
        });
        notificationsSent.push({ role: 'tenant', timestamp: new Date().toISOString() });
      }

      // Notify landlord
      if (!rule || rule.notifyLandlord !== 0) {
        await this.sendNotification({
          recipientId: lease.landlordId,
          recipientRole: 'landlord',
          type: 'utility_alert',
          leaseId: alert.leaseId,
          message: `${alert.title}: ${alert.description}`,
          metadata: {
            alertId: alert.id,
            alertType: alert.alertType,
            severity: alert.severity
          }
        });
        notificationsSent.push({ role: 'landlord', timestamp: new Date().toISOString() });
      }

      // Update alert with notifications sent
      this.db.db.prepare(`
        UPDATE utility_alerts SET notifications_sent = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(notificationsSent), new Date().toISOString(), alert.id);

    } catch (error) {
      console.error('[UtilityMonitoringWorker] Failed to send notifications:', error);
    }
  }

  /**
   * Send notification (uses injected notification service)
   */
  async sendNotification(notificationData) {
    if (this.notificationService) {
      return await this.notificationService.send(notificationData);
    }
    
    // Fallback: log notification
    console.log('[UtilityMonitoringWorker] Notification:', notificationData);
    return { success: true };
  }

  // ==================== Alert Rules ====================

  /**
   * Create alert rule
   */
  createAlertRule(ruleData) {
    const id = ruleData.id || randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      INSERT INTO alert_rules (
        id, lease_id, utility_meter_id, rule_type, rule_config,
        enabled, notification_channels, notify_tenant, notify_landlord,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      ruleData.leaseId || null,
      ruleData.utilityMeterId || null,
      ruleData.ruleType,
      JSON.stringify(ruleData.ruleConfig),
      ruleData.enabled !== undefined ? (ruleData.enabled ? 1 : 0) : 1,
      JSON.stringify(ruleData.notificationChannels || ['email']),
      ruleData.notifyTenant !== undefined ? (ruleData.notifyTenant ? 1 : 0) : 1,
      ruleData.notifyLandlord !== undefined ? (ruleData.notifyLandlord ? 1 : 0) : 1,
      now,
      now
    );

    return this.getAlertRuleById(id);
  }

  /**
   * Get alert rule by ID
   */
  getAlertRuleById(ruleId) {
    const stmt = this.db.db.prepare(`
      SELECT 
        id,
        lease_id AS leaseId,
        utility_meter_id AS utilityMeterId,
        rule_type AS ruleType,
        rule_config AS ruleConfig,
        enabled,
        notification_channels AS notificationChannels,
        notify_tenant AS notifyTenant,
        notify_landlord AS notifyLandlord,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM alert_rules
      WHERE id = ?
    `);

    const row = stmt.get(ruleId);
    if (!row) return null;

    return {
      ...row,
      ruleConfig: JSON.parse(row.ruleConfig || '{}'),
      notificationChannels: JSON.parse(row.notificationChannels || '[]')
    };
  }

  /**
   * Get alert rules for meter
   */
  getAlertRulesForMeter(meterId) {
    const stmt = this.db.db.prepare(`
      SELECT id FROM alert_rules
      WHERE (utility_meter_id = ? OR lease_id IN (SELECT lease_id FROM utility_meters WHERE id = ?))
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(meterId, meterId);
    return rows.map(row => this.getAlertRuleById(row.id));
  }

  // ==================== Background Monitoring Jobs ====================

  /**
   * Check for no-data alerts (meters that haven't reported)
   */
  checkNoDataAlerts() {
    const cutoffTime = new Date(Date.now() - (this.noDataTimeoutHours * 60 * 60 * 1000)).toISOString();
    const now = new Date().toISOString();

    const stmt = this.db.db.prepare(`
      SELECT id, lease_id AS leaseId, meter_type AS meterType, meter_id AS meterId
      FROM utility_meters
      WHERE last_reading_date < ?
    `);

    const offlineMeters = stmt.all(cutoffTime);
    const alerts = [];

    for (const meter of offlineMeters) {
      // Check if there's already an active no_data alert
      const existingAlert = this.db.db.prepare(`
        SELECT id FROM utility_alerts
        WHERE utility_meter_id = ? AND alert_type = 'no_data' AND status = 'active'
      `).get(meter.id);

      if (!existingAlert) {
        const alert = this.createAlert({
          utilityMeterId: meter.id,
          leaseId: meter.leaseId,
          alertType: 'no_data',
          severity: 'medium',
          title: `Meter offline: ${meter.meterType}`,
          description: `Meter ${meter.meterId} has not reported data in ${this.noDataTimeoutHours} hours`,
          triggerValue: null,
          thresholdValue: this.noDataTimeoutHours
        });
        alerts.push(alert);
      }
    }

    return alerts;
  }

  /**
   * Recalculate baselines periodically
   */
  recalculateBaselines() {
    const meters = this.db.db.prepare(`
      SELECT id FROM utility_meters
    `).all();

    const results = [];

    for (const meter of meters) {
      try {
        const baseline = this.calculateBaseline(meter.id, 'daily');
        results.push({ meterId: meter.id, baseline, success: true });
      } catch (error) {
        results.push({ meterId: meter.id, error: error.message, success: false });
      }
    }

    return results;
  }
}

module.exports = { UtilityMonitoringWorker };
