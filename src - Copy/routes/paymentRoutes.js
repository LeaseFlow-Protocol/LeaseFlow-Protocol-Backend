/**
 * Payment history API routes.
 *
 * GET  /api/leases/:leaseId/payments          — full payment history for a lease
 * GET  /api/leases/:leaseId/payment-status    — current payment status for a lease
 * GET  /api/tenants/:tenantAccountId/payments — all payments for a Stellar account
 */

const express = require('express');

function isRentCycleReached(startDate, now = new Date()) {
  const cycleDay = new Date(startDate).getUTCDate();
  return now.getUTCDate() >= cycleDay;
}

/**
 * @param {import('../db/appDatabase').AppDatabase} database
 * @returns {import('express').Router}
 */
function createPaymentRoutes(database) {
  const router = express.Router();

  /**
   * POST /api/leases/:leaseId/utility-bills
   * Upload utility billing details and update upcoming payment total.
   */
  router.post('/leases/:leaseId/utility-bills', (req, res) => {
    const { leaseId } = req.params;
    const {
      landlordId,
      utilityType,
      totalAmount,
      tenantSharePercent,
      tenantShareAmount,
      billingPeriodStart,
      billingPeriodEnd,
      nextRentCycleDate,
    } = req.body || {};

    if (!leaseId || !leaseId.trim()) {
      return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    if (!landlordId || !String(landlordId).trim()) {
      return res.status(400).json({ success: false, error: 'landlordId is required' });
    }

    if (!utilityType || !String(utilityType).trim()) {
      return res.status(400).json({ success: false, error: 'utilityType is required' });
    }

    if (totalAmount == null || Number.isNaN(Number(totalAmount)) || Number(totalAmount) < 0) {
      return res.status(400).json({ success: false, error: 'totalAmount must be a non-negative number' });
    }

    if (!nextRentCycleDate || !String(nextRentCycleDate).trim()) {
      return res.status(400).json({ success: false, error: 'nextRentCycleDate is required' });
    }

    const hasShareAmount = tenantShareAmount != null;
    const hasSharePercent = tenantSharePercent != null;

    if (!hasShareAmount && !hasSharePercent) {
      return res.status(400).json({
        success: false,
        error: 'Provide either tenantShareAmount or tenantSharePercent',
      });
    }

    let computedTenantShareAmount;
    if (hasShareAmount) {
      const shareAmountNumber = Number(tenantShareAmount);
      if (Number.isNaN(shareAmountNumber) || shareAmountNumber < 0) {
        return res.status(400).json({ success: false, error: 'tenantShareAmount must be a non-negative number' });
      }
      computedTenantShareAmount = Math.round(shareAmountNumber);
    } else {
      const sharePercentNumber = Number(tenantSharePercent);
      if (Number.isNaN(sharePercentNumber) || sharePercentNumber < 0 || sharePercentNumber > 100) {
        return res.status(400).json({ success: false, error: 'tenantSharePercent must be a number between 0 and 100' });
      }
      computedTenantShareAmount = Math.round((Number(totalAmount) * sharePercentNumber) / 100);
    }

    try {
      const result = database.recordUtilityBillAndReconcileUpcomingPayment({
        leaseId: leaseId.trim(),
        landlordId: String(landlordId).trim(),
        utilityType: String(utilityType).trim(),
        totalAmount: Math.round(Number(totalAmount)),
        tenantShareAmount: computedTenantShareAmount,
        billingPeriodStart: billingPeriodStart || null,
        billingPeriodEnd: billingPeriodEnd || null,
        nextRentCycleDate: String(nextRentCycleDate).trim(),
      });

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err.message === 'Lease not found') {
        return res.status(404).json({ success: false, error: err.message });
      }

      if (err.message === 'Landlord is not authorized for this lease') {
        return res.status(403).json({ success: false, error: err.message });
      }

      console.error('[PaymentRoutes] Error reconciling utility bill:', err);
      return res.status(500).json({ success: false, error: 'Failed to reconcile utility bill' });
    }
  });

  /**
   * GET /api/tenants/:tenantId/upcoming-payment
   * Returns updated upcoming payment total for tenant approval once rent cycle is due.
   */
  router.get('/tenants/:tenantId/upcoming-payment', (req, res) => {
    const { tenantId } = req.params;
    const asOfDate = String(req.query.asOfDate || new Date().toISOString().slice(0, 10));

    if (!tenantId || !tenantId.trim()) {
      return res.status(400).json({ success: false, error: 'tenantId is required' });
    }

    try {
      const upcomingPayment = database.getUpcomingPaymentForTenantApproval(tenantId.trim(), asOfDate);
      if (!upcomingPayment) {
        return res.status(404).json({ success: false, error: 'No upcoming payment ready for approval' });
      }

      return res.status(200).json({ success: true, data: upcomingPayment });
    } catch (err) {
      console.error('[PaymentRoutes] Error fetching tenant upcoming payment:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch upcoming payment' });
    }
  });

  /**
   * GET /api/leases/:leaseId/payments
   * Returns the full recorded payment history for a specific lease.
   */
  router.get('/leases/:leaseId/payments', (req, res) => {
    const { leaseId } = req.params;

    if (!leaseId || !leaseId.trim()) {
      return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    try {
      const payments = database.listPaymentsByLeaseId(leaseId.trim());
      return res.status(200).json({
        success: true,
        lease_id: leaseId.trim(),
        count: payments.length,
        payments,
      });
    } catch (err) {
      console.error('[PaymentRoutes] Error listing payments:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch payment history' });
    }
  });

  /**
   * GET /api/leases/:leaseId/payment-status
   * Returns the current payment status and last payment timestamp for a lease.
   */
  router.get('/leases/:leaseId/payment-status', (req, res) => {
    const { leaseId } = req.params;

    if (!leaseId || !leaseId.trim()) {
      return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    try {
      const lease = database.getLeaseById(leaseId.trim());
      if (!lease) {
        return res.status(404).json({ success: false, error: 'Lease not found' });
      }

      return res.status(200).json({
        success: true,
        lease_id: lease.id,
        tenant_id: lease.tenantId,
        tenant_account_id: lease.tenantAccountId ?? null,
        payment_status: lease.paymentStatus ?? 'pending',
        last_payment_at: lease.lastPaymentAt ?? null,
      });
    } catch (err) {
      console.error('[PaymentRoutes] Error fetching payment status:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch payment status' });
    }
  });

  /**
   * GET /api/tenants/:tenantAccountId/payments
   * Returns all recorded payments for a specific Stellar account (tenant).
   */
  router.get('/tenants/:tenantAccountId/payments', (req, res) => {
    const { tenantAccountId } = req.params;

    if (!tenantAccountId || !tenantAccountId.trim()) {
      return res.status(400).json({ success: false, error: 'tenantAccountId is required' });
    }

    try {
      const payments = database.listPaymentsByTenantAccount(tenantAccountId.trim());
      return res.status(200).json({
        success: true,
        tenant_account_id: tenantAccountId.trim(),
        count: payments.length,
        payments,
      });
    } catch (err) {
      console.error('[PaymentRoutes] Error listing tenant payments:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch tenant payments' });
    }
  });

  /**
   * POST /api/leases/:leaseId/utility-bills
   * Landlord uploads utility bill details. Backend computes tenant share,
   * updates upcoming payment totals, and stores reconciliation data.
   */
  router.post('/leases/:leaseId/utility-bills', (req, res) => {
    const { leaseId } = req.params;
    const {
      landlord_id: landlordId,
      bill_amount: billAmount,
      tenant_share_ratio: tenantShareRatio,
      currency = 'USDC',
      billing_cycle: billingCycle,
    } = req.body || {};

    if (!leaseId || !leaseId.trim()) {
      return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    if (!landlordId || !String(landlordId).trim()) {
      return res.status(400).json({ success: false, error: 'landlord_id is required' });
    }

    if (!Number.isFinite(Number(billAmount)) || Number(billAmount) <= 0) {
      return res.status(400).json({ success: false, error: 'bill_amount must be a positive number' });
    }

    const ratio = Number(tenantShareRatio);
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      return res.status(400).json({ success: false, error: 'tenant_share_ratio must be between 0 and 1' });
    }

    if (!billingCycle || !String(billingCycle).trim()) {
      return res.status(400).json({ success: false, error: 'billing_cycle is required' });
    }

    try {
      const lease = database.getLeaseById(leaseId.trim());
      if (!lease) {
        return res.status(404).json({ success: false, error: 'Lease not found' });
      }

      if (lease.landlordId !== String(landlordId).trim()) {
        return res.status(403).json({ success: false, error: 'Only the lease landlord can upload utility bills' });
      }

      const tenantShareAmount = Number((Number(billAmount) * ratio).toFixed(2));

      const utilityBill = database.insertUtilityBill({
        leaseId: lease.id,
        landlordId: String(landlordId).trim(),
        billAmount: Number(billAmount),
        tenantShareAmount,
        currency,
        billingCycle: String(billingCycle).trim(),
      });

      const utilityShareTotal = database.getPendingUtilityShareTotalByLeaseId(lease.id);
      const upcoming = database.upsertUpcomingPaymentTotal({
        leaseId: lease.id,
        baseRentAmount: Number(lease.rentAmount),
        utilityShareTotal,
        approvalStatus: 'pending',
      });

      return res.status(201).json({
        success: true,
        lease_id: lease.id,
        utility_bill: utilityBill,
        upcoming_payment_total: upcoming.upcomingTotal,
      });
    } catch (err) {
      console.error('[PaymentRoutes] Error reconciling utility bill:', err);
      return res.status(500).json({ success: false, error: 'Failed to reconcile utility bill' });
    }
  });

  /**
   * GET /api/leases/:leaseId/upcoming-payment
   * Returns the upcoming payment total (rent + utility share) and whether
   * tenant approval is required for the current rent cycle.
   */
  router.get('/leases/:leaseId/upcoming-payment', (req, res) => {
    const { leaseId } = req.params;

    if (!leaseId || !leaseId.trim()) {
      return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    try {
      const lease = database.getLeaseById(leaseId.trim());
      if (!lease) {
        return res.status(404).json({ success: false, error: 'Lease not found' });
      }

      let upcoming = database.getUpcomingPaymentByLeaseId(lease.id);
      if (!upcoming) {
        const utilityShareTotal = database.getPendingUtilityShareTotalByLeaseId(lease.id);
        upcoming = database.upsertUpcomingPaymentTotal({
          leaseId: lease.id,
          baseRentAmount: Number(lease.rentAmount),
          utilityShareTotal,
          approvalStatus: 'pending',
        });
      }

      const rentCycleReached = isRentCycleReached(lease.startDate);
      const utilityShareTotal = Number(upcoming.utilityShareTotal || 0);
      const tenantApprovalRequired = rentCycleReached && utilityShareTotal > 0;

      return res.status(200).json({
        success: true,
        lease_id: lease.id,
        tenant_id: lease.tenantId,
        base_rent_amount: upcoming.baseRentAmount,
        utility_share_total: utilityShareTotal,
        upcoming_payment_total: upcoming.upcomingTotal,
        rent_cycle_reached: rentCycleReached,
        tenant_approval_required: tenantApprovalRequired,
        approval_status: upcoming.approvalStatus,
      });
    } catch (err) {
      console.error('[PaymentRoutes] Error fetching upcoming payment:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch upcoming payment' });
    }
  });

  return router;
}

module.exports = { createPaymentRoutes };
