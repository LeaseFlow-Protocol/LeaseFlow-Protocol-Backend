const crypto = require('crypto');
const { AppDatabase } = require('../db/appDatabase');

/**
 * Referral Engine Service
 * Tracks referrals, manages conversions, and applies protocol fee waivers
 * Drives organic growth by incentivizing user referrals
 */
class ReferralService {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {object} sorobanLeaseService - Soroban service for on-chain operations
   */
  constructor(database, sorobanLeaseService = null) {
    this.db = database;
    this.sorobanService = sorobanLeaseService;
  }

  /**
   * Generate a unique referral code for a user
   * @param {string} userId - User identifier
   * @param {string} userType - 'landlord' or 'tenant'
   * @returns {string} Unique referral code
   */
  generateReferralCode(userId, userType = 'landlord') {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const code = `${userType.toUpperCase().substring(0, 3)}-${userId.substring(0, 6).toUpperCase()}-${random}`;
    return code;
  }

  /**
   * Create a new referral record
   * @param {object} referralData - Referral information
   * @returns {object} Created referral record
   */
  createReferral(referralData) {
    return this.db.transaction(() => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90); // 90 days expiry
      
      const referralCode = this.generateReferralCode(referralData.referrerId, referralData.referrerType);
      const referralLink = `https://leaseflow.io/join?ref=${referralCode}`;
      
      this.db.db.prepare(`
        INSERT INTO referrals (
          id, referrer_id, referrer_type, referee_id, referee_type,
          referral_code, referral_link, status, created_at, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(
        id,
        referralData.referrerId,
        referralData.referrerType || 'landlord',
        referralData.refereeId || null,
        referralData.refereeType || 'landlord',
        referralCode,
        referralLink,
        now,
        expiresAt.toISOString(),
        now
      );
      
      return this.getReferralById(id);
    });
  }

  /**
   * Get referral by code
   * @param {string} code - Referral code
   * @returns {object|null} Referral record
   */
  getReferralByCode(code) {
    try {
      const row = this.db.db.prepare(`
        SELECT * FROM referrals
        WHERE referral_code = ?
          AND status = 'pending'
          AND expires_at > datetime('now')
      `).get(code);
      
      return row ? this._normalizeReferral(row) : null;
    } catch (error) {
      console.error('[ReferralService] Error fetching referral by code:', error.message);
      return null;
    }
  }

  /**
   * Get referral by ID
   * @param {string} id - Referral ID
   * @returns {object|null} Referral record
   */
  getReferralById(id) {
    try {
      const row = this.db.db.prepare('SELECT * FROM referrals WHERE id = ?').get(id);
      return row ? this._normalizeReferral(row) : null;
    } catch (error) {
      console.error('[ReferralService] Error fetching referral:', error.message);
      return null;
    }
  }

  /**
   * Mark referral as converted (property listed)
   * @param {string} referralId - Referral ID
   * @param {string} propertyId - Listed property ID
   * @returns {object} Updated referral
   */
  markPropertyListed(referralId, propertyId) {
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      
      // Update referral status
      this.db.db.prepare(`
        UPDATE referrals
        SET status = 'converted',
            property_listed = 1,
            property_id = ?,
            converted_at = ?,
            updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(propertyId, now, now, referralId);
      
      const referral = this.getReferralById(referralId);
      
      if (referral) {
        // Calculate and apply fee waiver for referee
        this._applyFeeWaiver(referral.refereeId, 'referee', referral.id);
        
        // Create reward record for referrer
        this._createReferralReward(referral.referrerId, 'referrer', referral.id, 'fee_waiver');
      }
      
      return referral;
    });
  }

  /**
   * Mark referral as fully converted (lease signed)
   * @param {string} referralId - Referral ID
   * @param {string} leaseId - Signed lease ID
   * @returns {object} Updated referral
   */
  markLeaseSigned(referralId, leaseId) {
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      
      this.db.db.prepare(`
        UPDATE referrals
        SET lease_signed = 1,
            lease_id = ?,
            updated_at = ?
        WHERE id = ?
      `).run(leaseId, now, referralId);
      
      // Apply additional bonus for lease signing (if configured)
      const referral = this.getReferralById(referralId);
      
      if (referral && referral.fee_waiver_months < 2) {
        // Upgrade to 2 months fee waiver for successful lease
        this.db.db.prepare(`
          UPDATE referrals
          SET fee_waiver_months = 2,
              updated_at = ?
          WHERE id = ?
        `).run(now, referralId);
      }
      
      return referral;
    });
  }

  /**
   * Get user's referral statistics
   * @param {string} userId - User identifier
   * @returns {object} Referral statistics
   */
  getUserReferralStats(userId) {
    try {
      const stats = this.db.db.prepare(`
        SELECT 
          COUNT(*) as total_referrals,
          SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted_referrals,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_referrals,
          SUM(fee_waiver_amount) as total_waived_amount,
          SUM(referral_bonus_paid) as bonuses_paid
        FROM referrals
        WHERE referrer_id = ?
      `).get(userId);
      
      // Get active referral codes
      const activeCodes = this.db.db.prepare(`
        SELECT referral_code, referral_link, created_at, expires_at
        FROM referrals
        WHERE referrer_id = ? AND status = 'pending'
        ORDER BY created_at DESC
      `).all(userId);
      
      return {
        userId,
        totalReferrals: stats.total_referrals || 0,
        convertedReferrals: stats.converted_referrals || 0,
        pendingReferrals: stats.pending_referrals || 0,
        totalWaivedAmount: stats.total_waived_amount || 0,
        bonusesPaid: stats.bonuses_paid || 0,
        activeCodes: activeCodes.map(code => ({
          code: code.referral_code,
          link: code.referral_link,
          createdAt: code.created_at,
          expiresAt: code.expires_at
        })),
        successRate: stats.total_referrals > 0 
          ? ((stats.converted_referrals / stats.total_referrals) * 100).toFixed(2) 
          : 0
      };
    } catch (error) {
      console.error('[ReferralService] Error getting user stats:', error.message);
      return {
        userId,
        totalReferrals: 0,
        convertedReferrals: 0,
        pendingReferrals: 0,
        totalWaivedAmount: 0,
        bonusesPaid: 0,
        activeCodes: [],
        successRate: 0
      };
    }
  }

  /**
   * Check if user can create more referrals
   * @param {string} userId - User identifier
   * @returns {boolean} True if user can refer more
   */
  canUserRefer(userId) {
    try {
      const config = this._getProgramConfig();
      
      const count = this.db.db.prepare(`
        SELECT COUNT(*) as count
        FROM referrals
        WHERE referrer_id = ? AND status = 'pending'
      `).get(userId).count;
      
      return count < config.maxReferralsPerUser;
    } catch (error) {
      console.error('[ReferralService] Error checking referral limit:', error.message);
      return false;
    }
  }

  /**
   * Apply fee waiver to a user's account
   * @param {string} userId - User identifier
   * @param {string} userType - 'referrer' or 'referee'
   * @param {string} referralId - Associated referral ID
   * @returns {object} Applied waiver details
   */
  _applyFeeWaiver(userId, userType, referralId) {
    const config = this._getProgramConfig();
    const months = userType === 'referrer' ? config.referrerRewardMonths : config.refereeRewardMonths;
    
    // Calculate waiver amount (average monthly protocol fee * months)
    const averageMonthlyFee = 5000; // $50 USDC in cents (would be calculated from actual data)
    const waiverAmount = averageMonthlyFee * months;
    
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    this.db.db.prepare(`
      INSERT INTO referral_rewards (
        id, referral_id, recipient_id, recipient_type,
        reward_type, amount, currency, status, description,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'fee_waiver', ?, 'USDC', 'pending', ?, ?, ?)
    `).run(
      id,
      referralId,
      userId,
      userType,
      waiverAmount,
      `${months}-month protocol fee waiver for ${userType}`,
      now,
      now
    );
    
    // Update referral with waiver amount
    this.db.db.prepare(`
      UPDATE referrals
      SET fee_waiver_amount = fee_waiver_amount + ?,
          updated_at = ?
      WHERE id = ?
    `).run(waiverAmount, now, referralId);
    
    return {
      rewardId: id,
      userId,
      amount: waiverAmount,
      currency: 'USDC',
      months,
      status: 'pending'
    };
  }

  /**
   * Create referral reward record
   * @param {string} userId - Recipient ID
   * @param {string} userType - 'referrer' or 'referee'
   * @param {string} referralId - Associated referral ID
   * @param {string} rewardType - Type of reward
   */
  _createReferralReward(userId, userType, referralId, rewardType) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const config = this._getProgramConfig();
    
    const months = userType === 'referrer' ? config.referrerRewardMonths : config.refereeRewardMonths;
    const amount = 5000 * months; // $50 * months in cents
    
    this.db.db.prepare(`
      INSERT INTO referral_rewards (
        id, referral_id, recipient_id, recipient_type,
        reward_type, amount, currency, status, description,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'USDC', 'pending', ?, ?, ?)
    `).run(
      id,
      referralId,
      userId,
      userType,
      rewardType,
      amount,
      `${rewardType.replace('_', ' ')} for ${userType}`,
      now,
      now
    );
  }

  /**
   * Get referral program configuration
   * @returns {object} Program configuration
   */
  _getProgramConfig() {
    try {
      const row = this.db.db.prepare('SELECT * FROM referral_program_config WHERE id = ?').get('default');
      
      return {
        referrerRewardMonths: row?.referrer_reward_months || 1,
        refereeRewardMonths: row?.referee_reward_months || 1,
        maxReferralsPerUser: row?.max_referrals_per_user || 10,
        referralExpiryDays: row?.referral_expiry_days || 90,
        minPropertyValue: row?.min_property_value || 0,
        enabled: row?.enabled !== 0
      };
    } catch (error) {
      console.error('[ReferralService] Error getting config:', error.message);
      return {
        referrerRewardMonths: 1,
        refereeRewardMonths: 1,
        maxReferralsPerUser: 10,
        referralExpiryDays: 90,
        minPropertyValue: 0,
        enabled: true
      };
    }
  }

  /**
   * Normalize referral row from database
   * @param {object} row - Database row
   * @returns {object} Normalized referral object
   */
  _normalizeReferral(row) {
    return {
      id: row.id,
      referrerId: row.referrer_id,
      referrerType: row.referrer_type,
      refereeId: row.referee_id,
      refereeType: row.referee_type,
      referralCode: row.referral_code,
      referralLink: row.referral_link,
      status: row.status,
      propertyListed: row.property_listed,
      propertyId: row.property_id,
      leaseSigned: row.lease_signed,
      leaseId: row.lease_id,
      feeWaiverAmount: row.fee_waiver_amount,
      feeWaiverMonths: row.fee_waiver_months,
      referralBonusPaid: row.referral_bonus_paid,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      convertedAt: row.converted_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Communicate with Soroban contract to apply fee waiver on-chain
   * @param {string} userId - User wallet address
   * @param {number} amount - Waiver amount
   * @returns {string|null} Transaction hash or null if failed
   */
  async applyOnChainFeeWaiver(userId, amount) {
    if (!this.sorobanService) {
      console.warn('[ReferralService] Soroban service not available, skipping on-chain waiver');
      return null;
    }
    
    try {
      // This would call the Soroban contract to apply the fee waiver
      // Example: this.sorobanService.applyProtocolFeeWaiver(userId, amount);
      
      console.log(`[ReferralService] Applying on-chain fee waiver: ${amount} USDC to ${userId}`);
      
      // Mock implementation - replace with actual Soroban call
      const mockTxHash = `tx_${crypto.randomBytes(32).toString('hex')}`;
      
      // Update reward record with transaction hash
      this.db.db.prepare(`
        UPDATE referral_rewards
        SET soroban_transaction_hash = ?,
            status = 'applied',
            applied_at = datetime('now'),
            updated_at = datetime('now')
        WHERE recipient_id = ? AND status = 'pending'
        LIMIT 1
      `).run(mockTxHash, userId);
      
      return mockTxHash;
    } catch (error) {
      console.error('[ReferralService] On-chain waiver failed:', error.message);
      return null;
    }
  }
}

module.exports = { ReferralService };
