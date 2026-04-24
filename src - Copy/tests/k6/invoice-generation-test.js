/**
 * K6 Load Test - Invoice Generation Stress Test
 * 
 * Specifically tests the invoice generation endpoint under heavy load
 * This is critical for rent day when landlords generate invoices en masse
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const invoiceSuccessRate = new Rate('invoice_success');
const invoiceResponseTime = new Trend('invoice_response_time');

export const options = {
  scenarios: {
    // Constant load test for invoice generation
    invoice_generation: {
      executor: 'constant-arrival-rate',
      rate: 100, // 100 iterations per second
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 500,
      maxVUs: 2000,
    },
  },
  
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    invoice_success: ['rate>0.99'],
    invoice_response_time: ['p(95)<1500'],
  },
};

export default function () {
  const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${__ENV.LANDLORD_AUTH_TOKEN || 'mock_landlord_token'}`,
  };
  
  // Generate invoices for random month/year
  const payload = JSON.stringify({
    landlordId: `landlord_${Math.floor(Math.random() * 100)}`,
    month: Math.floor(Math.random() * 12) + 1,
    year: 2025,
  });
  
  const response = http.post(
    `${baseUrl}/api/payments/generate-invoices`,
    payload,
    { headers }
  );
  
  const success = check(response, {
    'invoice generation successful': (r) => r.status === 200,
    'valid response structure': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success && body.data;
      } catch (e) {
        return false;
      }
    },
    'no database errors': (r) => !r.body.includes('deadlock'),
  });
  
  invoiceSuccessRate.add(success);
  invoiceResponseTime.add(response.timings.duration);
  
  if (!success) {
    console.error(`Invoice generation failed: ${response.body}`);
  }
  
  sleep(0.1); // Small delay between requests
}
