import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics for worker queue testing
const errorRate = new Rate('errors');

// Test configuration for queue-based scaling
export const options = {
  stages: [
    // Baseline phase - normal queue activity
    { duration: '2m', target: 5 },
    // Queue buildup phase - simulate ledger event spike
    { duration: '3m', target: 50 },
    // Massive queue spike - simulate Soroban ledger event flood (>1000 items)
    { duration: '2m', target: 200 },
    // Sustained high queue - verify worker HPA triggers
    { duration: '5m', target: 200 },
    // Gradual queue drain - verify scale-down stabilization
    { duration: '5m', target: 20 },
    // Return to baseline
    { duration: '2m', target: 5 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% of requests should complete within 3s
    http_req_failed: ['rate<0.05'],     // Error rate should be less than 5%
    errors: ['rate<0.05'],
  },
};

// GraphQL API endpoint
const API_URL = __ENV.API_URL || 'http://localhost:4000/graphql';

// GraphQL mutations for queue testing
const mutations = {
  // Simulate Soroban ledger event ingestion
  ingestLedgerEvent: `
    mutation IngestLedgerEvent($input: LedgerEventInput!) {
      ingestLedgerEvent(input: $input) {
        id
        status
        queuedAt
      }
    }
  `,
  
  // Simulate webhook event trigger
  triggerWebhook: `
    mutation TriggerWebhook($input: WebhookInput!) {
      triggerWebhook(input: $input) {
        id
        status
        queuedAt
      }
    }
  `,
  
  // Health check
  healthCheck: `
    query HealthCheck {
      __typename
    }
  `,
};

// Helper function to execute GraphQL mutation
function executeGraphQL(mutation, variables = {}) {
  const payload = JSON.stringify({
    query: mutation,
    variables: variables,
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };
  
  return http.post(API_URL, payload, params);
}

// Generate random Soroban ledger event
function generateLedgerEvent() {
  return {
    ledgerSequence: Math.floor(Math.random() * 1000000),
    transactionHash: `tx_${Math.random().toString(36).substring(7)}`,
    operationType: ['payment', 'create_account', 'manage_offer', 'path_payment'][Math.floor(Math.random() * 4)],
    sourceAccount: `G${Math.random().toString(36).substring(2, 56)}`,
    timestamp: new Date().toISOString(),
    metadata: {
      network: 'public',
      success: Math.random() > 0.1,
    },
  };
}

// Generate random webhook event
function generateWebhookEvent() {
  return {
    eventType: ['property_created', 'lease_approved', 'payment_received', 'tenant_verified'][Math.floor(Math.random() * 4)],
    resourceId: `resource_${Math.floor(Math.random() * 1000)}`,
    payload: {
      timestamp: new Date().toISOString(),
      userId: `user_${Math.floor(Math.random() * 100)}`,
    },
    retryCount: 0,
  };
}

// Main test function
export default function () {
  // Randomly select event type to simulate mixed queue workload
  const eventType = Math.random();
  
  if (eventType < 0.6) {
    // 60% - Ingest Soroban ledger events (tests soroban-indexer queue)
    const event = generateLedgerEvent();
    const response = executeGraphQL(mutations.ingestLedgerEvent, {
      input: event,
    });
    
    check(response, {
      'ledger event ingestion status is 200': (r) => r.status === 200,
      'ledger event queued successfully': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.ingestLedgerEvent && body.data.ingestLedgerEvent.status === 'queued';
        } catch (e) {
          return false;
        }
      },
    }) || errorRate.add(1);
    
  } else if (eventType < 0.9) {
    // 30% - Trigger webhook events (tests webhook queue)
    const event = generateWebhookEvent();
    const response = executeGraphQL(mutations.triggerWebhook, {
      input: event,
    });
    
    check(response, {
      'webhook trigger status is 200': (r) => r.status === 200,
      'webhook queued successfully': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.triggerWebhook && body.data.triggerWebhook.status === 'queued';
        } catch (e) {
          return false;
        }
      },
    }) || errorRate.add(1);
    
  } else {
    // 10% - Health check
    const response = executeGraphQL(mutations.healthCheck);
    
    check(response, {
      'health check status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  }
  
  // Minimal sleep to allow queue processing
  sleep(Math.random() * 0.5 + 0.1);
}

// Setup function to verify API is accessible
export function setup() {
  console.log('Starting worker queue load test...');
  console.log(`Target API: ${API_URL}`);
  console.log('This test will trigger queue-based HPA scaling for workers.');
  
  const response = executeGraphQL(mutations.healthCheck);
  
  if (response.status !== 200) {
    console.error('API is not accessible. Aborting test.');
    throw new Error('API health check failed');
  }
  
  console.log('API health check passed. Starting queue load test...');
  console.log('Monitor queue length with: redis-cli LLEN soroban-indexer:wait');
  console.log('Monitor worker HPA with: kubectl get hpa -l component=worker');
  return { startTime: new Date().toISOString() };
}

// Teardown function to log test results
export function teardown(data) {
  console.log('Worker queue load test completed.');
  console.log(`Test started at: ${data.startTime}`);
  console.log(`Test ended at: ${new Date().toISOString()}`);
  console.log('Check worker HPA status with: kubectl get hpa leaseflow-backend-worker');
  console.log('Check worker pod scaling with: kubectl get pods -l component=worker');
  console.log('Check queue length with: redis-cli --scan --pattern "*:wait" | xargs -L1 redis-cli LLEN');
}
