const { ReferralService } = require('../services/referralService');
const { AppDatabase } = require('../db/appDatabase');

/**
 * Referral Engine Controller
 * Handles HTTP requests for referral program operations
 */
class ReferralController {
  constructor(database, sorobanLeaseService = null) {
    this.service = new ReferralService(database, sorobanLeaseService);
  }

  /**
   * Generate referral code for user
   * POST /api/referrals/generate
   */
  async generateReferralCode(req, res) {
    try {
      const { userId, userType = 'landlord' } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required'
        });
      }
      
      // Check if user can refer more
      if (!this.service.canUserRefer(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Maximum referral limit reached',
          data: {
            message: 'You have reached the maximum number of active referrals (10). Wait for pending referrals to convert or expire.'
          }
        });
      }
      
      const referral = this.service.createReferral({
        referrerId: userId,
        referrerType: userType
      });
      
      res.status(201).json({
        success: true,
        data: {
          referralCode: referral.referralCode,
          referralLink: referral.referralLink,
          expiresAt: referral.expiresAt,
          message: 'Share your referral link to earn a 1-month protocol fee waiver!'
        }
      });
    } catch (error) {
      console.error('Error generating referral code:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate referral code',
        message: error.message
      });
    }
  }

  /**
   * Validate referral code
   * GET /api/referrals/validate/:code
   */
  validateReferralCode(req, res) {
    try {
      const { code } = req.params;
      
      const referral = this.service.getReferralByCode(code);
      
      if (!referral) {
        return res.status(404).json({
          success: false,
          error: 'Invalid or expired referral code'
        });
      }
      
      res.json({
        success: true,
        data: {
          valid: true,
          referrerType: referral.referrerType,
          benefits: {
            referee: 'Get 1-month protocol fee waiver when you list a property',
            referrer: 'Referrer earns 1-month protocol fee waiver'
          },
          expiresAt: referral.expiresAt
        }
      });
    } catch (error) {
      console.error('Error validating referral code:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to validate referral code',
        message: error.message
      });
    }
  }

  /**
   * Get user's referral statistics
   * GET /api/referrals/stats/:userId
   */
  getUserStats(req, res) {
    try {
      const { userId } = req.params;
      
      const stats = this.service.getUserReferralStats(userId);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error fetching referral stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch referral statistics',
        message: error.message
      });
    }
  }

  /**
   * Mark property as listed (convert referral)
   * POST /api/referrals/property-listed
   */
  markPropertyListed(req, res) {
    try {
      const { referralCode, propertyId, refereeId } = req.body;
      
      if (!referralCode || !propertyId || !refereeId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: referralCode, propertyId, refereeId'
        });
      }
      
      const referral = this.service.getReferralByCode(referralCode);
      
      if (!referral) {
        return res.status(404).json({
          success: false,
          error: 'Invalid or expired referral code'
        });
      }
      
      const updatedReferral = this.service.markPropertyListed(referral.id, propertyId);
      
      res.json({
        success: true,
        data: {
          message: 'Congratulations! Your referral has been converted.',
          referral: updatedReferral,
          rewards: {
            referee: '1-month protocol fee waiver applied to your account',
            referrer: 'Referrer will receive 1-month protocol fee waiver'
          }
        }
      });
    } catch (error) {
      console.error('Error marking property listed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process referral conversion',
        message: error.message
      });
    }
  }

  /**
   * Mark lease as signed (upgrade referral)
   * POST /api/referrals/lease-signed
   */
  markLeaseSigned(req, res) {
    try {
      const { referralCode, leaseId } = req.body;
      
      if (!referralCode || !leaseId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: referralCode, leaseId'
        });
      }
      
      const referral = this.service.getReferralByCode(referralCode);
      
      if (!referral) {
        return res.status(404).json({
          success: false,
          error: 'Invalid or expired referral code'
        });
      }
      
      const updatedReferral = this.service.markLeaseSigned(referral.id, leaseId);
      
      res.json({
        success: true,
        data: {
          message: 'Lease signed! Referral bonus upgraded to 2-month fee waiver.',
          referral: updatedReferral
        }
      });
    } catch (error) {
      console.error('Error marking lease signed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process lease signing',
        message: error.message
      });
    }
  }

  /**
   * Apply fee waiver on-chain via Soroban
   * POST /api/referrals/apply-waiver
   */
  async applyFeeWaiver(req, res) {
    try {
      const { userId, amount } = req.body;
      
      if (!userId || !amount) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: userId, amount'
        });
      }
      
      const txHash = await this.service.applyOnChainFeeWaiver(userId, amount);
      
      if (!txHash) {
        return res.status(500).json({
          success: false,
          error: 'Failed to apply on-chain fee waiver'
        });
      }
      
      res.json({
        success: true,
        data: {
          transactionHash: txHash,
          message: 'Protocol fee waiver successfully applied on-chain'
        }
      });
    } catch (error) {
      console.error('Error applying fee waiver:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to apply fee waiver',
        message: error.message
      });
    }
  }

  /**
   * Get referral program details
   * GET /api/referrals/program-info
   */
  getProgramInfo(req, res) {
    res.json({
      success: true,
      data: {
        name: 'LeaseFlow Referral Program',
        description: 'Earn protocol fee waivers by referring landlords and tenants',
        howItWorks: [
          'Generate your unique referral code from your dashboard',
          'Share the code with landlords or tenants',
          'When they list a property using your code, you both earn rewards',
          'Fee waivers are automatically applied to your account'
        ],
        rewards: {
          referrer: {
            amount: '1-month protocol fee waiver',
            description: 'Earned when your referral lists a property'
          },
          referee: {
            amount: '1-month protocol fee waiver',
            description: 'Applied when you list your first property'
          },
          leaseBonus: {
            amount: 'Upgrade to 2-month fee waiver',
            description: 'When a lease is successfully signed'
          }
        },
        limits: {
          maxReferrals: 10,
          expiryDays: 90,
          minPropertyValue: 'No minimum'
        },
        termsUrl: 'https://leaseflow.io/referral-terms'
      }
    });
  }
}

module.exports = { ReferralController };
