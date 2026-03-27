const { AppDatabase } = require("../src/db/appDatabase");
const {
  LateFeeService,
  calculateFee,
} = require("../src/services/lateFeeService");
const { NotificationService } = require("../src/services/notificationService");
const { SorobanLeaseService } = require("../src/services/sorobanLeaseService");

function createTestDatabase() {
  return new AppDatabase(":memory:");
}

function seedActiveLease(db, overrides = {}) {
  const lease = {
    id: "lease-1",
    landlordId: "landlord-1",
    tenantId: "tenant-1",
    status: "active",
    rentAmount: 100000,
    currency: "USDC",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    ...overrides,
  };
  db.seedLease(lease);
  return lease;
}

function seedLateFeeTerms(db, overrides = {}) {
  const terms = {
    leaseId: "lease-1",
    dailyRate: 1000,
    gracePeriodDays: 5,
    maxFeePerPeriod: null,
    enabled: true,
    ...overrides,
  };
  db.seedLateFeeTerms(terms);
  return terms;
}

function seedOverduePayment(db, overrides = {}) {
  return db.insertRentPayment({
    leaseId: "lease-1",
    period: "2026-03",
    dueDate: "2026-03-05",
    amountDue: 100000,
    amountPaid: 0,
    status: "pending",
    ...overrides,
  });
}

function createService(db) {
  const notificationService = new NotificationService(db);
  const sorobanLeaseService = new SorobanLeaseService({});
  return new LateFeeService(db, notificationService, sorobanLeaseService);
}

describe("calculateFee", () => {
  test("calculates fee as daysLate * dailyRate", () => {
    expect(calculateFee(3, 1000, null)).toBe(3000);
    expect(calculateFee(10, 500, null)).toBe(5000);
  });

  test("caps fee at maxFeePerPeriod when set", () => {
    expect(calculateFee(100, 1000, 5000)).toBe(5000);
  });

  test("returns uncapped fee if below max", () => {
    expect(calculateFee(3, 1000, 5000)).toBe(3000);
  });
});

describe("LateFeeService", () => {
  let db;
  let service;

  beforeEach(() => {
    db = createTestDatabase();
    service = createService(db);
  });

  describe("assessLateFees", () => {
    test("assesses a fee for an overdue payment", () => {
      seedActiveLease(db);
      seedLateFeeTerms(db);
      seedOverduePayment(db);

      const result = service.assessLateFees({ asOfDate: "2026-03-08" });
      expect(result.assessed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      const fees = db.listLateFeesByLeaseId("lease-1");
      expect(fees).toHaveLength(1);
      expect(fees[0].daysLate).toBe(3);
      expect(fees[0].feeAmount).toBe(3000);
    });

    test("skips leases without late fee terms", () => {
      seedActiveLease(db);
      seedOverduePayment(db);

      const result = service.assessLateFees({ asOfDate: "2026-03-08" });
      expect(result.assessed).toBe(0);
      expect(result.skipped).toBe(1);
    });

    test("skips leases with disabled late fee terms", () => {
      seedActiveLease(db);
      seedLateFeeTerms(db, { enabled: false });
      seedOverduePayment(db);

      const result = service.assessLateFees({ asOfDate: "2026-03-08" });
      expect(result.assessed).toBe(0);
      expect(result.skipped).toBe(1);
    });

    test("skips payments that are not yet overdue", () => {
      seedActiveLease(db);
      seedLateFeeTerms(db);
      seedOverduePayment(db, { dueDate: "2026-03-10" });

      const result = service.assessLateFees({ asOfDate: "2026-03-08" });
      // The payment's due date is in the future, so listOverdueRentPayments should not return it
      expect(result.assessed).toBe(0);
    });

    test("does not duplicate fees for the same day count", () => {
      seedActiveLease(db);
      seedLateFeeTerms(db);
      seedOverduePayment(db);

      service.assessLateFees({ asOfDate: "2026-03-08" });
      const result = service.assessLateFees({ asOfDate: "2026-03-08" });
      expect(result.assessed).toBe(0);
      expect(result.skipped).toBe(1);

      const fees = db.listLateFeesByLeaseId("lease-1");
      expect(fees).toHaveLength(1);
    });

    test("accumulates fees across multiple days", () => {
      seedActiveLease(db);
      seedLateFeeTerms(db);
      seedOverduePayment(db);

      service.assessLateFees({ asOfDate: "2026-03-08" });
      service.assessLateFees({ asOfDate: "2026-03-10" });

      const fees = db.listLateFeesByLeaseId("lease-1");
      expect(fees).toHaveLength(2);

      // Most recent first (ORDER BY assessed_at DESC)
      expect(fees[0].daysLate).toBe(5);
      expect(fees[0].feeAmount).toBe(5000);
      expect(fees[1].daysLate).toBe(3);
      expect(fees[1].feeAmount).toBe(3000);
    });

    test("respects maxFeePerPeriod cap", () => {
      seedActiveLease(db);
      seedLateFeeTerms(db, { maxFeePerPeriod: 4000 });
      seedOverduePayment(db);

      service.assessLateFees({ asOfDate: "2026-03-08" });
      service.assessLateFees({ asOfDate: "2026-03-20" });

      const fees = db.listLateFeesByLeaseId("lease-1");
      // Second entry should hit the cap—incremental fee is 0, so it's skipped
      expect(fees).toHaveLength(2);
      expect(fees[0].feeAmount).toBe(4000);
    });
  });

  describe("getLeaseLateFees", () => {
    test("returns empty summary for a lease with no fees", () => {
      seedActiveLease(db);
      const summary = service.getLeaseLateFees("lease-1");
      expect(summary.totalPendingDebt).toBe(0);
      expect(summary.entries).toHaveLength(0);
    });

    test("returns fee summary after assessment", () => {
      seedActiveLease(db);
      seedLateFeeTerms(db);
      seedOverduePayment(db);

      service.assessLateFees({ asOfDate: "2026-03-10" });

      const summary = service.getLeaseLateFees("lease-1");
      expect(summary.leaseId).toBe("lease-1");
      expect(summary.totalPendingDebt).toBeGreaterThan(0);
      expect(summary.entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Soroban integration", () => {
    test("records Soroban tx hash on successful update", () => {
      seedActiveLease(db);
      seedLateFeeTerms(db);
      seedOverduePayment(db);

      service.assessLateFees({ asOfDate: "2026-03-08" });

      const fees = db.listLateFeesByLeaseId("lease-1");
      expect(fees[0].sorobanTxStatus).toBe("confirmed");
      expect(fees[0].sorobanTxHash).toMatch(/^tx_debt_/);
    });

    test("marks tx as failed when Soroban service throws", () => {
      seedActiveLease(db);
      seedLateFeeTerms(db);
      seedOverduePayment(db);

      // Replace updatePendingDebt with a throwing implementation
      service.sorobanLeaseService.updatePendingDebt = () => {
        throw new Error("Soroban network error");
      };

      service.assessLateFees({ asOfDate: "2026-03-08" });

      const fees = db.listLateFeesByLeaseId("lease-1");
      expect(fees[0].sorobanTxStatus).toBe("failed");
      expect(fees[0].sorobanTxHash).toBeNull();
    });
  });

  describe("notifications", () => {
    test("creates notifications for tenant and landlord on late fee", () => {
      seedActiveLease(db);
      seedLateFeeTerms(db);
      const payment = seedOverduePayment(db);

      service.assessLateFees({ asOfDate: "2026-03-08" });

      const notifications = db.listNotificationsByProposalId(payment.id);
      expect(notifications.length).toBe(2);
      expect(notifications.some((n) => n.recipientRole === "tenant")).toBe(
        true,
      );
      expect(notifications.some((n) => n.recipientRole === "landlord")).toBe(
        true,
      );
      expect(notifications[0].type).toBe("late_fee_assessed");
    });
  });
});

describe("Database late fee operations", () => {
  let db;

  beforeEach(() => {
    db = createTestDatabase();
    seedActiveLease(db);
  });

  test("seedLateFeeTerms and getLateFeeTermsByLeaseId", () => {
    seedLateFeeTerms(db);
    const terms = db.getLateFeeTermsByLeaseId("lease-1");
    expect(terms).not.toBeNull();
    expect(terms.dailyRate).toBe(1000);
    expect(terms.gracePeriodDays).toBe(5);
    expect(terms.enabled).toBe(true);
  });

  test("insertRentPayment and getRentPaymentByLeasePeriod", () => {
    const payment = seedOverduePayment(db);
    expect(payment.id).toBeDefined();
    const retrieved = db.getRentPaymentByLeasePeriod("lease-1", "2026-03");
    expect(retrieved).not.toBeNull();
    expect(retrieved.amountDue).toBe(100000);
  });

  test("listOverdueRentPayments filters correctly", () => {
    seedOverduePayment(db, { dueDate: "2026-03-05" });
    seedOverduePayment(db, { period: "2026-04", dueDate: "2026-04-05" });

    const overdue = db.listOverdueRentPayments("2026-03-10");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].period).toBe("2026-03");
  });

  test("updateRentPaymentStatus marks as paid", () => {
    const payment = seedOverduePayment(db);
    const updated = db.updateRentPaymentStatus(payment.id, {
      amountPaid: 100000,
      datePaid: "2026-03-08",
      status: "paid",
    });
    expect(updated.status).toBe("paid");
    expect(updated.datePaid).toBe("2026-03-08");
  });

  test("getTotalPendingDebtForLease sums correctly", () => {
    const payment = seedOverduePayment(db);
    db.insertLateFeeEntry({
      leaseId: "lease-1",
      rentPaymentId: payment.id,
      period: "2026-03",
      daysLate: 3,
      dailyRate: 1000,
      feeAmount: 3000,
      pendingDebtTotal: 3000,
      assessedAt: "2026-03-08",
    });
    db.insertLateFeeEntry({
      leaseId: "lease-1",
      rentPaymentId: payment.id,
      period: "2026-03",
      daysLate: 5,
      dailyRate: 1000,
      feeAmount: 5000,
      pendingDebtTotal: 8000,
      assessedAt: "2026-03-10",
    });

    const total = db.getTotalPendingDebtForLease("lease-1");
    expect(total).toBe(8000);
  });
});
