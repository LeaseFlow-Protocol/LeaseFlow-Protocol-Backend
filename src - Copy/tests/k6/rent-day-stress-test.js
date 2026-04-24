/**
 * K6 Load Testing Suite - Rent Day Stress Test
 * 
 * Simulates "Rent Day" scenario where 90% of users log in simultaneously
 * Tests backend ability to handle 10,000 concurrent "Pay Rent" requests
 * and invoice generation without database deadlock or crash
 * 
 * Usage:
 *   k6 run --vus 10000 --duration 30s src/tests/k6/rent-day-stress-test.js
 *   
 *   Or with gradual ramp-up:
 *   k6 run --stages=duration:5m,vus:10000 --stages=duration:30m,vus:10000 src/tests/k6/rent-day-stress-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// Custom metrics for tracking rent day performance
const rentPaymentSuccessRate = new Rate('rent_payment_success');
const invoiceGenerationSuccessRate = new Rate('invoice_generation_success');
const paymentResponseTime = new Trend('payment_response_time_ms');
const invoiceResponseTime = new Trend('invoice_response_time_ms');
const databaseDeadlocks = new Counter('database_deadlocks');
const concurrentUsers = new Gauge('concurrent_users');

// Test configuration
export const options = {
  scenarios: {
    // Gradual ramp-up to simulate rent day buildup
    rent_day_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 1000 },   // Initial surge (first 5 minutes)
        { duration: '10m', target: 5000 },  // Rapid growth (next 10 minutes)
        { duration: '15m', target: 10000 }, // Peak rent day (15 minutes at max load)
        { duration: '10m', target: 10000 }, // Sustain peak load
        { duration: '10m', target: 0 },     // Gradual cooldown
      ],
      gracefulRampDown: '30s',
      exec: 'rentDayStressTest',
    },
    
    // Spike test for sudden load
    spike_test: {
      executor: 'spike',
      preAllocatedVUs: 2000,
      maxVUs: 10000,
      stages: [
        { duration: '2m', target: 2000 },   // Normal load
        { duration: '10s', target: 10000 }, // SUDDEN SPIKE to 10k users
        { duration: '5m', target: 10000 },  // Sustain spike
        { duration: '2m', target: 2000 },   // Return to normal
      ],
      exec: 'rentDayStressTest',
      startTime: '45m', // Run after main scenario
    },
  },
  
  thresholds: {
    // Critical thresholds for production readiness
    http_req_duration: ['p(95)<3000'], // 95% of requests should complete within 3s
    http_req_failed: ['rate<0.01'],    // Less than 1% failures
    rent_payment_success: ['rate>0.99'], // 99% success rate required
    invoice_generation_success: ['rate>0.99'],
    payment_response_time_ms: ['p(95)<2000', 'p(99)<5000'],
    invoice_response_time_ms: ['p(95)<1500', 'p(99)<3000'],
    database_deadlocks: ['count==0'], // Zero deadlocks tolerated
    checks: ['rate>0.98'],
  },
  
  // Performance tuning
  noConnectionReuse: false,
  userDefinedVariables: {
    baseUrl: __ENV.BASE_URL || 'http://localhost:3000',
    tenantToken: __ENV.TENANT_AUTH_TOKEN || 'test_token',
    landlordToken: __ENV.LANDLORD_AUTH_TOKEN || 'test_token',
  },
};

/**
 * Main rent day stress test scenario
 * Simulates tenants paying rent and landlords generating invoices
 */
export function rentDayStressTest() {
  const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
  
  // Track concurrent users
  concurrentUsers.add(1);
  
  // Randomly assign role: 90% tenants (paying rent), 10% landlords (generating invoices)
  const isTenant = Math.random() < 0.9;
  
  if (isTenant) {
    executeTenantFlow(baseUrl);
  } else {
    executeLandlordFlow(baseUrl);
  }
  
  // Simulate realistic user behavior with think time
  sleep(Math.random() * 2 + 1); // 1-3 seconds between actions
  
  concurrentUsers.add(-1);
}

/**
 * Tenant flow: Login -> Check upcoming payment -> Pay rent
 */
function executeTenantFlow(baseUrl) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${__ENV.TENANT_AUTH_TOKEN || 'mock_tenant_token'}`,
  };
  
  // Step 1: Get upcoming payment details
  const upcomingPaymentRes = http.get(
    `${baseUrl}/api/payments/upcoming`,
    { headers }
  );
  
  const invoiceSuccess = check(upcomingPaymentRes, {
    'upcoming payment retrieved': (r) => r.status === 200,
    'payment data structure valid': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success && body.data && body.data.upcomingPaymentTotal;
      } catch (e) {
        return false;
      }
    },
  });
  
  invoiceGenerationSuccessRate.add(invoiceSuccess);
  invoiceResponseTime.add(upcomingPaymentRes.timings.duration);
  
  if (!invoiceSuccess) {
    databaseDeadlocks.add(1);
    return;
  }
  
  sleep(Math.random() * 1); // Brief pause before payment
  
  // Step 2: Execute rent payment (CRITICAL OPERATION)
  const paymentPayload = JSON.stringify({
    leaseId: `lease_${Math.floor(Math.random() * 1000)}`,
    amount: Math.floor(Math.random() * 5000) + 500, // Random rent amount
    currency: 'USDC',
    paymentMethod: 'stellar',
    timestamp: new Date().toISOString(),
  });
  
  const paymentRes = http.post(
    `${baseUrl}/api/payments/rent`,
    paymentPayload,
    { headers }
  );
  
  const paymentSuccess = check(paymentRes, {
    'payment processed': (r) => r.status === 200 || r.status === 201,
    'payment response valid': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success && body.data && body.data.transactionHash;
      } catch (e) {
        return false;
      }
    },
    'no database errors': (r) => {
      const body = r.body.toLowerCase();
      return !body.includes('deadlock') && !body.includes('timeout');
    },
  });
  
  rentPaymentSuccessRate.add(paymentSuccess);
  paymentResponseTime.add(paymentRes.timings.duration);
  
  if (!paymentSuccess) {
    console.error(`Payment failed: ${paymentRes.status} - ${paymentRes.body}`);
    databaseDeadlocks.add(1);
  }
}

/**
 * Landlord flow: Login -> Generate invoices -> View payments
 */
function executeLandlordFlow(baseUrl) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${__ENV.LANDLORD_AUTH_TOKEN || 'mock_landlord_token'}`,
  };
  
  // Step 1: Generate rent invoices for all properties
  const generateInvoiceRes = http.post(
    `${baseUrl}/api/payments/generate-invoices`,
    JSON.stringify({
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    }),
    { headers }
  );
  
  const invoiceSuccess = check(generateInvoiceRes, {
    'invoices generated': (r) => r.status === 200,
    'invoice batch valid': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success && Array.isArray(body.data.invoices);
      } catch (e) {
        return false;
      }
    },
  });
  
  invoiceGenerationSuccessRate.add(invoiceSuccess);
  invoiceResponseTime.add(generateInvoiceRes.timings.duration);
  
  sleep(Math.random() * 2);
  
  // Step 2: View received payments dashboard
  const paymentsDashboardRes = http.get(
    `${baseUrl}/api/payments/dashboard`,
    { headers }
  );
  
  check(paymentsDashboardRes, {
    'dashboard loaded': (r) => r.status === 200,
  });
}

/**
 * Summary output for test results
 */
export function summary(data) {
  const summary = textSummary(data, { indent: ' ', enableColors: true });
  
  console.log('\n========== RENT DAY STRESS TEST RESULTS ==========');
  console.log(summary);
  
  // Additional custom metrics summary
  console.log('\n--- Custom Metrics ---');
  console.log(`Rent Payment Success Rate: ${(data.metrics.rent_payment_success?.values?.rate || 0) * 100}%`);
  console.log(`Invoice Generation Success Rate: ${(data.metrics.invoice_generation_success?.values?.rate || 0) * 100}%`);
  console.log(`Payment Response Time (p95): ${data.metrics.payment_response_time_ms?.values?.['p(95)']?.toFixed(0)}ms`);
  console.log(`Invoice Response Time (p95): ${data.metrics.invoice_response_time_ms?.values?.['p(95)']?.toFixed(0)}ms`);
  console.log(`Database Deadlocks: ${data.metrics.database_deadlocks?.values?.count || 0}`);
  console.log('================================================\n');
  
  return data;
}
