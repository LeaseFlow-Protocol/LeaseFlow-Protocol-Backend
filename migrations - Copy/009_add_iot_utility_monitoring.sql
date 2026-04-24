/**
 * Migration to add IoT utility monitoring tables
 */

exports.up = function(db) {
  return db.runSql(`
    -- Utility meters (water, electricity, gas) linked to properties
    CREATE TABLE IF NOT EXISTS utility_meters (
      id TEXT PRIMARY KEY,
      lease_id TEXT NOT NULL,
      meter_type TEXT NOT NULL CHECK (meter_type IN ('water', 'electricity', 'gas', 'internet', 'other')),
      meter_id TEXT NOT NULL UNIQUE, -- Physical meter ID or IoT device ID
      meter_name TEXT,
      provider TEXT, -- Utility provider name
      unit_of_measurement TEXT NOT NULL DEFAULT 'units' CHECK (unit_of_measurement IN ('gallons', 'kwh', 'therms', 'mbps', 'units')),
      location_description TEXT, -- Where meter is located
      installation_date TEXT,
      last_reading_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lease_id) REFERENCES leases(id)
    );

    -- Utility meter readings (time-series data)
    CREATE TABLE IF NOT EXISTS meter_readings (
      id TEXT PRIMARY KEY,
      utility_meter_id TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      reading_value REAL NOT NULL, -- Actual meter reading (cumulative)
      consumption_value REAL, -- Calculated consumption since last reading
      reading_timestamp TEXT NOT NULL, -- When the reading was taken
      reading_source TEXT NOT NULL CHECK (reading_source IN ('iot_auto', 'manual_entry', 'estimated')),
      quality_score REAL, -- Data quality score (0-1)
      is_anomaly INTEGER DEFAULT 0, -- Boolean: flagged as anomaly
      anomaly_reason TEXT,
      metadata TEXT, -- Additional sensor data (temperature, pressure, etc.)
      created_at TEXT NOT NULL,
      FOREIGN KEY (utility_meter_id) REFERENCES utility_meters(id),
      FOREIGN KEY (lease_id) REFERENCES leases(id)
    );

    -- Anomaly detection alerts
    CREATE TABLE IF NOT EXISTS utility_alerts (
      id TEXT PRIMARY KEY,
      utility_meter_id TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      alert_type TEXT NOT NULL CHECK (alert_type IN ('high_consumption', 'leak_detected', 'no_data', 'meter_offline', 'spike_detected')),
      severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      trigger_value REAL, -- The value that triggered the alert
      threshold_value REAL, -- The threshold that was exceeded
      standard_deviations REAL, -- Number of std devs from mean (for statistical alerts)
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved', 'false_positive')),
      acknowledged_by TEXT,
      acknowledged_at TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      resolution_notes TEXT,
      notifications_sent TEXT, -- JSON array of notification records
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (utility_meter_id) REFERENCES utility_meters(id),
      FOREIGN KEY (lease_id) REFERENCES leases(id)
    );

    -- Statistical baselines for anomaly detection
    CREATE TABLE IF NOT EXISTS consumption_baselines (
      id TEXT PRIMARY KEY,
      utility_meter_id TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      baseline_period TEXT NOT NULL CHECK (baseline_period IN ('daily', 'weekly', 'monthly', 'seasonal')),
      avg_consumption REAL NOT NULL, -- Average consumption for period
      std_deviation REAL NOT NULL, -- Standard deviation
      min_consumption REAL, -- Minimum observed
      max_consumption REAL, -- Maximum observed
      sample_size INTEGER, -- Number of readings used
      calculation_method TEXT DEFAULT 'rolling_average',
      last_calculated_at TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (utility_meter_id) REFERENCES utility_meters(id),
      FOREIGN KEY (lease_id) REFERENCES leases(id)
    );

    -- Alert configuration rules
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      lease_id TEXT,
      utility_meter_id TEXT,
      rule_type TEXT NOT NULL CHECK (rule_type IN ('std_deviation_threshold', 'absolute_threshold', 'percentage_change', 'no_data_timeout')),
      rule_config TEXT NOT NULL, -- JSON with rule-specific settings
      enabled INTEGER NOT NULL DEFAULT 1,
      notification_channels TEXT, -- JSON array: ['email', 'sms', 'push']
      notify_tenant INTEGER DEFAULT 1,
      notify_landlord INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lease_id) REFERENCES leases(id),
      FOREIGN KEY (utility_meter_id) REFERENCES utility_meters(id)
    );

    -- Indexes for performance (critical for time-series data)
    CREATE INDEX IF NOT EXISTS idx_utility_meters_lease_id ON utility_meters(lease_id);
    CREATE INDEX IF NOT EXISTS idx_utility_meters_meter_type ON utility_meters(meter_type);
    CREATE INDEX IF NOT EXISTS idx_meter_readings_meter_id ON meter_readings(utility_meter_id);
    CREATE INDEX IF NOT EXISTS idx_meter_readings_lease_id ON meter_readings(lease_id);
    CREATE INDEX IF NOT EXISTS idx_meter_readings_timestamp ON meter_readings(reading_timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_meter_readings_is_anomaly ON meter_readings(is_anomaly);
    CREATE INDEX IF NOT EXISTS idx_utility_alerts_meter_id ON utility_alerts(utility_meter_id);
    CREATE INDEX IF NOT EXISTS idx_utility_alerts_lease_id ON utility_alerts(lease_id);
    CREATE INDEX IF NOT EXISTS idx_utility_alerts_status ON utility_alerts(status);
    CREATE INDEX IF NOT EXISTS idx_utility_alerts_created_at ON utility_alerts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_consumption_baselines_meter_id ON consumption_baselines(utility_meter_id);
    CREATE INDEX IF NOT EXISTS idx_alert_rules_lease_id ON alert_rules(lease_id);
    CREATE INDEX IF NOT EXISTS idx_alert_rules_meter_id ON alert_rules(utility_meter_id);
  `);
};

exports.down = function(db) {
  return db.runSql(`
    DROP INDEX IF EXISTS idx_utility_meters_lease_id;
    DROP INDEX IF EXISTS idx_utility_meters_meter_type;
    DROP INDEX IF EXISTS idx_meter_readings_meter_id;
    DROP INDEX IF EXISTS idx_meter_readings_lease_id;
    DROP INDEX IF EXISTS idx_meter_readings_timestamp;
    DROP INDEX IF EXISTS idx_meter_readings_is_anomaly;
    DROP INDEX IF EXISTS idx_utility_alerts_meter_id;
    DROP INDEX IF EXISTS idx_utility_alerts_lease_id;
    DROP INDEX IF EXISTS idx_utility_alerts_status;
    DROP INDEX IF EXISTS idx_utility_alerts_created_at;
    DROP INDEX IF EXISTS idx_consumption_baselines_meter_id;
    DROP INDEX IF EXISTS idx_alert_rules_lease_id;
    DROP INDEX IF EXISTS idx_alert_rules_meter_id;
    
    DROP TABLE IF EXISTS alert_rules;
    DROP TABLE IF EXISTS consumption_baselines;
    DROP TABLE IF EXISTS utility_alerts;
    DROP TABLE IF EXISTS meter_readings;
    DROP TABLE IF EXISTS utility_meters;
  `);
};
