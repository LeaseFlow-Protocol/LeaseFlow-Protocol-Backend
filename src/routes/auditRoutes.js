const express = require('express');
const { AuditService } = require('../services/auditService');

/**
 * Create audit log routes
 * @param {AppDatabase} database - Database instance
 * @returns {Router} Express router
 */
function createAuditRoutes(database) {
  const router = express.Router();
  const auditService = new AuditService(database);

  /**
   * @swagger
   * /api/audit/logs:
   *   get:
   *     tags: [Audit]
   *     summary: Get recent audit logs
   *     description: Retrieve recent audit log entries across the system
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *         description: Number of records to return
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   *         description: Pagination offset
   *       - in: query
   *         name: tableName
   *         schema:
   *           type: string
   *         description: Filter by table name (e.g., 'leases', 'rent_payments')
   *       - in: query
   *         name: actionType
   *         schema:
   *           type: string
   *           enum: [INSERT, UPDATE, DELETE]
   *         description: Filter by action type
   *       - in: query
   *         name: adminId
   *         schema:
   *           type: string
   *         description: Filter by admin ID
   *     responses:
   *       200:
   *         description: Successful response
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/AuditLog'
   */
  router.get('/logs', (req, res) => {
    try {
      const { limit, offset, tableName, actionType, adminId } = req.query;
      const logs = auditService.getRecentAuditLogs({
        limit: parseInt(limit, 10) || 50,
        offset: parseInt(offset, 10) || 0,
        tableName,
        actionType,
        adminId,
      });
      res.status(200).json({ success: true, data: logs });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * @swagger
   * /api/audit/logs/{auditId}:
   *   get:
   *     tags: [Audit]
   *     summary: Get specific audit log entry
   *     description: Retrieve a single audit log entry by ID
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: auditId
   *         required: true
   *         schema:
   *           type: string
   *         description: Audit log ID
   *     responses:
   *       200:
   *         description: Successful response
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   $ref: '#/components/schemas/AuditLog'
   */
  router.get('/logs/:auditId', (req, res) => {
    try {
      const log = auditService.getAuditLogById(req.params.auditId);
      if (!log) {
        return res.status(404).json({ success: false, error: 'Audit log not found' });
      }
      res.status(200).json({ success: true, data: log });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * @swagger
   * /api/audit/trail/{tableName}/{recordId}:
   *   get:
   *     tags: [Audit]
   *     summary: Get audit trail for a record
   *     description: Retrieve complete audit history for a specific record
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: tableName
   *         required: true
   *         schema:
   *           type: string
   *         description: Table name (e.g., 'leases', 'rent_payments')
   *       - in: path
   *         name: recordId
   *         required: true
   *         schema:
   *           type: string
   *         description: Record ID
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 100
   *         description: Number of records to return
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Filter by start date
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Filter by end date
   *     responses:
   *       200:
   *         description: Successful response
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/AuditLog'
   */
  router.get('/trail/:tableName/:recordId', (req, res) => {
    try {
      const { tableName, recordId } = req.params;
      const { limit, startDate, endDate } = req.query;
      const trail = auditService.getAuditTrailForRecord(tableName, recordId, {
        limit: parseInt(limit, 10) || 100,
        startDate,
        endDate,
      });
      res.status(200).json({ success: true, data: trail });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * @swagger
   * /api/audit/admin/{adminId}:
   *   get:
   *     tags: [Audit]
   *     summary: Get changes by admin
   *     description: Retrieve all changes made by a specific admin
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: adminId
   *         required: true
   *         schema:
   *           type: string
   *         description: Admin ID
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 100
   *         description: Number of records to return
   *       - in: query
   *         name: tableName
   *         schema:
   *           type: string
   *         description: Filter by table name
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Filter by start date
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Filter by end date
   *     responses:
   *       200:
   *         description: Successful response
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/AuditLog'
   */
  router.get('/admin/:adminId', (req, res) => {
    try {
      const { adminId } = req.params;
      const { limit, tableName, startDate, endDate } = req.query;
      const changes = auditService.getChangesByAdmin(adminId, {
        limit: parseInt(limit, 10) || 100,
        tableName,
        startDate,
        endDate,
      });
      res.status(200).json({ success: true, data: changes });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * @swagger
   * /api/audit/statistics:
   *   get:
   *     tags: [Audit]
   *     summary: Get audit statistics
   *     description: Retrieve audit statistics for a time period
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: startDate
   *         required: true
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Start date for statistics
   *       - in: query
   *         name: endDate
   *         required: true
   *         schema:
   *           type: string
   *           format: date-time
   *         description: End date for statistics
   *     responses:
   *       200:
   *         description: Successful response
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   $ref: '#/components/schemas/AuditStatistics'
   */
  router.get('/statistics', (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ 
          success: false, 
          error: 'startDate and endDate are required' 
        });
      }
      const stats = auditService.getAuditStatistics(startDate, endDate);
      res.status(200).json({ success: true, data: stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * @swagger
   * /api/audit/search:
   *   get:
   *     tags: [Audit]
   *     summary: Search audit logs
   *     description: Search audit logs by value change
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: q
   *         required: true
   *         schema:
   *           type: string
   *         description: Search term
   *       - in: query
   *         name: tableName
   *         schema:
   *           type: string
   *         description: Filter by table name
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 100
   *         description: Number of records to return
   *     responses:
   *       200:
   *         description: Successful response
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/AuditLog'
   */
  router.get('/search', (req, res) => {
    try {
      const { q, tableName, limit } = req.query;
      if (!q) {
        return res.status(400).json({ 
          success: false, 
          error: 'Search query (q) is required' 
        });
      }
      const results = auditService.searchAuditLogs(q, {
        tableName,
        limit: parseInt(limit, 10) || 100,
      });
      res.status(200).json({ success: true, data: results });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = { createAuditRoutes };
