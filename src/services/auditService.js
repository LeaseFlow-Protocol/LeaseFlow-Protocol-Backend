const crypto = require('crypto');

/**
 * Audit Service - Manages audit log queries and tracking
 * Task 4: Security & Compliance - Audit Trail for Financial Changes
 */
class AuditService {
  /**
   * @param {AppDatabase} database - Database instance
   */
  constructor(database) {
    this.db = database;
  }

  /**
   * Log a financial change manually (for programmatic use)
   * @param {Object} params - Audit log parameters
   * @returns {Object} Created audit log entry
   */
  logChange(params) {
    const {
      tableName,
      recordId,
      actionType,
      columnName,
      oldValue,
      newValue,
      adminId,
      adminEmail,
      ipAddress,
      userAgent,
      changeReason,
    } = params;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO audit_log (
          id, table_name, record_id, action_type, column_name,
          old_value, new_value, admin_id, admin_email, ip_address, user_agent,
          change_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        tableName,
        recordId,
        actionType,
        columnName,
        oldValue !== null && oldValue !== undefined ? String(oldValue) : null,
        newValue !== null && newValue !== undefined ? String(newValue) : null,
        adminId,
        adminEmail || null,
        ipAddress || null,
        userAgent || null,
        changeReason || null,
        now
      );

    return this.getAuditLogById(id);
  }

  /**
   * Get audit log entry by ID
   * @param {string} auditId - Audit log ID
   * @returns {Object|null}
   */
  getAuditLogById(auditId) {
    const row = this.db
      .prepare(
        `SELECT 
          id,
          table_name AS tableName,
          record_id AS recordId,
          action_type AS actionType,
          column_name AS columnName,
          old_value AS oldValue,
          new_value AS newValue,
          admin_id AS adminId,
          admin_email AS adminEmail,
          ip_address AS ipAddress,
          user_agent AS userAgent,
          change_reason AS changeReason,
          created_at AS createdAt
        FROM audit_log
        WHERE id = ?`
      )
      .get(auditId);

    return row || null;
  }

  /**
   * Get audit trail for a specific record
   * @param {string} tableName - Table name (e.g., 'leases', 'rent_payments')
   * @param {string} recordId - Record ID
   * @param {Object} options - Query options
   * @returns {Array<Object>}
   */
  getAuditTrailForRecord(tableName, recordId, options = {}) {
    const { limit = 100, offset = 0, startDate, endDate } = options;

    let query = `
      SELECT 
        id,
        table_name AS tableName,
        record_id AS recordId,
        action_type AS actionType,
        column_name AS columnName,
        old_value AS oldValue,
        new_value AS newValue,
        admin_id AS adminId,
        admin_email AS adminEmail,
        ip_address AS ipAddress,
        user_agent AS userAgent,
        change_reason AS changeReason,
        created_at AS createdAt
      FROM audit_log
      WHERE table_name = ? AND record_id = ?
    `;

    const params = [tableName, recordId];

    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.prepare(query).all(...params);
  }

  /**
   * Get all changes made by a specific admin
   * @param {string} adminId - Admin ID
   * @param {Object} options - Query options
   * @returns {Array<Object>}
   */
  getChangesByAdmin(adminId, options = {}) {
    const { limit = 100, offset = 0, startDate, endDate, tableName } = options;

    let query = `
      SELECT 
        id,
        table_name AS tableName,
        record_id AS recordId,
        action_type AS actionType,
        column_name AS columnName,
        old_value AS oldValue,
        new_value AS newValue,
        admin_id AS adminId,
        admin_email AS adminEmail,
        ip_address AS ipAddress,
        user_agent AS userAgent,
        change_reason AS changeReason,
        created_at AS createdAt
      FROM audit_log
      WHERE admin_id = ?
    `;

    const params = [adminId];

    if (tableName) {
      query += ' AND table_name = ?';
      params.push(tableName);
    }

    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.prepare(query).all(...params);
  }

  /**
   * Get recent audit logs across the system
   * @param {Object} options - Query options
   * @returns {Array<Object>}
   */
  getRecentAuditLogs(options = {}) {
    const { limit = 50, offset = 0, tableName, actionType, adminId } = options;

    let query = `
      SELECT 
        id,
        table_name AS tableName,
        record_id AS recordId,
        action_type AS actionType,
        column_name AS columnName,
        old_value AS oldValue,
        new_value AS newValue,
        admin_id AS adminId,
        admin_email AS adminEmail,
        ip_address AS ipAddress,
        user_agent AS userAgent,
        change_reason AS changeReason,
        created_at AS createdAt
      FROM audit_log
      WHERE 1=1
    `;

    const params = [];

    if (tableName) {
      query += ' AND table_name = ?';
      params.push(tableName);
    }

    if (actionType) {
      query += ' AND action_type = ?';
      params.push(actionType);
    }

    if (adminId) {
      query += ' AND admin_id = ?';
      params.push(adminId);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.prepare(query).all(...params);
  }

  /**
   * Get audit statistics for a time period
   * @param {string} startDate - Start date (ISO format)
   * @param {string} endDate - End date (ISO format)
   * @returns {Object}
   */
  getAuditStatistics(startDate, endDate) {
    const stats = this.db
      .prepare(
        `SELECT 
          COUNT(*) as totalChanges,
          COUNT(DISTINCT admin_id) as uniqueAdmins,
          COUNT(DISTINCT table_name) as affectedTables,
          SUM(CASE WHEN action_type = 'INSERT' THEN 1 ELSE 0 END) as inserts,
          SUM(CASE WHEN action_type = 'UPDATE' THEN 1 ELSE 0 END) as updates,
          SUM(CASE WHEN action_type = 'DELETE' THEN 1 ELSE 0 END) as deletes
        FROM audit_log
        WHERE created_at BETWEEN ? AND ?`
      )
      .get(startDate, endDate);

    return {
      totalChanges: stats.totalChanges || 0,
      uniqueAdmins: stats.uniqueAdmins || 0,
      affectedTables: stats.affectedTables || 0,
      inserts: stats.inserts || 0,
      updates: stats.updates || 0,
      deletes: stats.deletes || 0,
      period: { startDate, endDate },
    };
  }

  /**
   * Search audit logs by value change
   * @param {string} searchTerm - Value to search for
   * @param {Object} options - Search options
   * @returns {Array<Object>}
   */
  searchAuditLogs(searchTerm, options = {}) {
    const { limit = 100, tableName } = options;

    let query = `
      SELECT 
        id,
        table_name AS tableName,
        record_id AS recordId,
        action_type AS actionType,
        column_name AS columnName,
        old_value AS oldValue,
        new_value AS newValue,
        admin_id AS adminId,
        admin_email AS adminEmail,
        ip_address AS ipAddress,
        user_agent AS userAgent,
        change_reason AS changeReason,
        created_at AS createdAt
      FROM audit_log
      WHERE (old_value LIKE ? OR new_value LIKE ?)
    `;

    const params = [`%${searchTerm}%`, `%${searchTerm}%`];

    if (tableName) {
      query += ' AND table_name = ?';
      params.push(tableName);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(query).all(...params);
  }
}

module.exports = { AuditService };
