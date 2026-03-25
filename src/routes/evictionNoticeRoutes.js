const express = require('express');
const EmergencyEvictionNoticeService = require('../services/emergencyEvictionNoticeService');
const DatabaseService = require('../services/databaseService');

const router = express.Router();

/**
 * Initialize services
 */
let evictionNoticeService;
let databaseService;

async function initializeServices() {
  if (!databaseService) {
    databaseService = new DatabaseService();
    await databaseService.initialize();
  }
  
  if (!evictionNoticeService) {
    evictionNoticeService = new EmergencyEvictionNoticeService(databaseService.pool);
    await evictionNoticeService.initialize();
  }
}

/**
 * Middleware to ensure services are initialized
 */
async function requireServices(req, res, next) {
  try {
    await initializeServices();
    next();
  } catch (error) {
    console.error('Service initialization error:', error);
    res.status(500).json({
      error: 'Service initialization failed',
      message: 'Unable to initialize required services'
    });
  }
}

/**
 * POST /api/eviction-notices/serve
 * Serve an eviction notice to a tenant
 */
router.post('/serve', requireServices, async (req, res) => {
  try {
    const {
      leaseId,
      landlordAddress,
      tenantAddress,
      tenantEmail,
      noticeType,
      breachDescription,
      noticeContent
    } = req.body;

    // Validate required fields
    if (!leaseId || !landlordAddress || !tenantAddress || !tenantEmail || !noticeType || !noticeContent) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['leaseId', 'landlordAddress', 'tenantAddress', 'tenantEmail', 'noticeType', 'noticeContent']
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(tenantEmail)) {
      return res.status(400).json({
        error: 'Invalid email format',
        field: 'tenantEmail'
      });
    }

    // Validate notice type
    const validNoticeTypes = ['breach', 'non_payment', 'property_damage', 'illegal_activity', 'lease_violation', 'other'];
    if (!validNoticeTypes.includes(noticeType)) {
      return res.status(400).json({
        error: 'Invalid notice type',
        validTypes: validNoticeTypes
      });
    }

    const result = await evictionNoticeService.serveNotice({
      leaseId,
      landlordAddress,
      tenantAddress,
      tenantEmail,
      noticeType,
      breachDescription,
      noticeContent
    });

    res.status(201).json({
      success: true,
      message: 'Eviction notice served successfully',
      data: result
    });

  } catch (error) {
    console.error('Error serving eviction notice:', error);
    res.status(500).json({
      error: 'Failed to serve eviction notice',
      message: error.message
    });
  }
});

/**
 * GET /api/eviction-notices/:noticeId
 * Get details of a specific eviction notice
 */
router.get('/:noticeId', requireServices, async (req, res) => {
  try {
    const { noticeId } = req.params;

    if (!noticeId || isNaN(parseInt(noticeId))) {
      return res.status(400).json({
        error: 'Invalid notice ID'
      });
    }

    const notice = await evictionNoticeService.getNotice(parseInt(noticeId));
    
    res.json({
      success: true,
      data: notice
    });

  } catch (error) {
    console.error('Error fetching eviction notice:', error);
    
    if (error.message === 'Notice not found') {
      return res.status(404).json({
        error: 'Eviction notice not found',
        noticeId: req.params.noticeId
      });
    }

    res.status(500).json({
      error: 'Failed to fetch eviction notice',
      message: error.message
    });
  }
});

/**
 * GET /api/eviction-notices/:noticeId/proofs
 * Get all cryptographic proofs for a notice
 */
router.get('/:noticeId/proofs', requireServices, async (req, res) => {
  try {
    const { noticeId } = req.params;

    if (!noticeId || isNaN(parseInt(noticeId))) {
      return res.status(400).json({
        error: 'Invalid notice ID'
      });
    }

    const proofs = await evictionNoticeService.getNoticeProofs(parseInt(noticeId));
    
    res.json({
      success: true,
      data: proofs
    });

  } catch (error) {
    console.error('Error fetching notice proofs:', error);
    res.status(500).json({
      error: 'Failed to fetch notice proofs',
      message: error.message
    });
  }
});

/**
 * GET /api/eviction-notices/:noticeId/verify
 * Verify the authenticity and integrity of an eviction notice
 */
router.get('/:noticeId/verify', requireServices, async (req, res) => {
  try {
    const { noticeId } = req.params;

    if (!noticeId || isNaN(parseInt(noticeId))) {
      return res.status(400).json({
        error: 'Invalid notice ID'
      });
    }

    const verification = await evictionNoticeService.verifyNotice(parseInt(noticeId));
    
    res.json({
      success: true,
      data: verification
    });

  } catch (error) {
    console.error('Error verifying eviction notice:', error);
    
    if (error.message === 'Notice not found') {
      return res.status(404).json({
        error: 'Eviction notice not found',
        noticeId: req.params.noticeId
      });
    }

    res.status(500).json({
      error: 'Failed to verify eviction notice',
      message: error.message
    });
  }
});

/**
 * GET /api/eviction-notices
 * Get eviction notices with optional filtering
 */
router.get('/', requireServices, async (req, res) => {
  try {
    const {
      leaseId,
      landlordAddress,
      tenantAddress,
      status,
      limit = 50,
      offset = 0
    } = req.query;

    // Build query conditions
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (leaseId) {
      conditions.push(`lease_id = $${paramIndex++}`);
      params.push(leaseId);
    }

    if (landlordAddress) {
      conditions.push(`landlord_address = $${paramIndex++}`);
      params.push(landlordAddress);
    }

    if (tenantAddress) {
      conditions.push(`tenant_address = $${paramIndex++}`);
      params.push(tenantAddress);
    }

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const query = `
      SELECT * FROM eviction_notices 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    
    params.push(parseInt(limit), parseInt(offset));

    const result = await evictionNoticeService.db.query(query, params);
    
    res.json({
      success: true,
      data: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length
      }
    });

  } catch (error) {
    console.error('Error fetching eviction notices:', error);
    res.status(500).json({
      error: 'Failed to fetch eviction notices',
      message: error.message
    });
  }
});

/**
 * POST /api/eviction-notices/:noticeId/resend
 * Resend an eviction notice email
 */
router.post('/:noticeId/resend', requireServices, async (req, res) => {
  try {
    const { noticeId } = req.params;
    const { tenantEmail } = req.body;

    if (!noticeId || isNaN(parseInt(noticeId))) {
      return res.status(400).json({
        error: 'Invalid notice ID'
      });
    }

    if (!tenantEmail) {
      return res.status(400).json({
        error: 'Tenant email is required'
      });
    }

    // Get the original notice
    const notice = await evictionNoticeService.getNotice(parseInt(noticeId));
    
    // Resend the email
    const emailResult = await evictionNoticeService.sendEmailNotice({
      leaseId: notice.lease_id,
      landlordAddress: notice.landlord_address,
      tenantAddress: notice.tenant_address,
      tenantEmail,
      noticeType: notice.notice_type,
      breachDescription: notice.breach_description,
      noticeContent: notice.notice_content
    }, parseInt(noticeId));

    // Update the notice with new email information
    await evictionNoticeService.db.query(`
      UPDATE eviction_notices 
      SET email_sent_at = $1, 
          email_message_id = $2, 
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [emailResult.sentAt, emailResult.messageId, parseInt(noticeId)]);

    res.json({
      success: true,
      message: 'Eviction notice resent successfully',
      data: emailResult
    });

  } catch (error) {
    console.error('Error resending eviction notice:', error);
    
    if (error.message === 'Notice not found') {
      return res.status(404).json({
        error: 'Eviction notice not found',
        noticeId: req.params.noticeId
      });
    }

    res.status(500).json({
      error: 'Failed to resend eviction notice',
      message: error.message
    });
  }
});

module.exports = router;
