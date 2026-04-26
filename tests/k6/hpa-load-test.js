import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics for HPA testing
const errorRate = new Rate('errors');

// Test configuration
export const options = {
  stages: [
    // Baseline phase - normal traffic
    { duration: '2m', target: 10 },
    // Ramp-up phase - gradually increasing traffic
    { duration: '3m', target: 50 },
    // Spike phase - simulate viral real-estate listing (massive traffic spike)
    { duration: '2m', target: 200 },
    // Sustained high load - keep HPA triggered
    { duration: '5m', target: 200 },
    // Gradual ramp-down - verify scale-down stabilization
    { duration: '5m', target: 20 },
    // Return to baseline
    { duration: '2m', target: 10 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests should complete within 2s
    http_req_failed: ['rate<0.05'],     // Error rate should be less than 5%
    errors: ['rate<0.05'],
  },
};

// GraphQL API endpoint
const API_URL = __ENV.API_URL || 'http://localhost:4000/graphql';

// GraphQL queries for testing
const queries = {
  // Query for property listings (simulates browsing)
  getPropertyListings: `
    query GetPropertyListings($first: Int, $after: String) {
      properties(first: $first, after: $after) {
        edges {
          node {
            id
            title
            price
            location
            status
          }
          cursor
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          endCursor
          startCursor
        }
        totalCount
      }
    }
  `,
  
  // Query for single property (simulates viewing a listing)
  getProperty: `
    query GetProperty($id: ID!) {
      property(id: $id) {
        id
        title
        description
        price
        location
        amenities
        images
        landlord {
          id
          name
          verified
        }
        leaseTerms {
          duration
          deposit
          monthlyRent
        }
      }
    }
  `,
  
  // Mutation for creating a lease application (simulates user action)
  createLeaseApplication: `
    mutation CreateLeaseApplication($input: LeaseApplicationInput!) {
      createLeaseApplication(input: $input) {
        id
        status
        createdAt
      }
    }
  `,
  
  // Health check query
  healthCheck: `
    query HealthCheck {
      __schema {
        types {
          name
        }
      }
    }
  `,
};

// Helper function to execute GraphQL query
function executeGraphQL(query, variables = {}) {
  const payload = JSON.stringify({
    query: query,
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

// Main test function
export default function () {
  // Randomly select a query type to simulate real user behavior
  const queryType = Math.random();
  
  if (queryType < 0.4) {
    // 40% - Browse property listings
    const response = executeGraphQL(queries.getPropertyListings, {
      first: 20,
    });
    
    check(response, {
      'property listings status is 200': (r) => r.status === 200,
      'property listings has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.properties;
        } catch (e) {
          return false;
        }
      },
    }) || errorRate.add(1);
    
  } else if (queryType < 0.7) {
    // 30% - View single property
    const propertyId = `property_${Math.floor(Math.random() * 100)}`;
    const response = executeGraphQL(queries.getProperty, {
      id: propertyId,
    });
    
    check(response, {
      'property detail status is 200': (r) => r.status === 200,
      'property detail has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.property;
        } catch (e) {
          return false;
        }
      },
    }) || errorRate.add(1);
    
  } else if (queryType < 0.9) {
    // 20% - Create lease application (write operation)
    const response = executeGraphQL(queries.createLeaseApplication, {
      input: {
        propertyId: `property_${Math.floor(Math.random() * 100)}`,
        tenantId: `tenant_${Math.floor(Math.random() * 50)}`,
        proposedStartDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        proposedDuration: 12,
      },
    });
    
    check(response, {
      'lease application status is 200': (r) => r.status === 200,
      'lease application has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.createLeaseApplication;
        } catch (e) {
          return false;
        }
      },
    }) || errorRate.add(1);
    
  } else {
    // 10% - Health check
    const response = executeGraphQL(queries.healthCheck);
    
    check(response, {
      'health check status is 200': (r) => r.status === 200,
      'health check has schema': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.__schema;
        } catch (e) {
          return false;
        }
      },
    }) || errorRate.add(1);
  }
  
  // Random sleep between requests to simulate realistic user behavior
  sleep(Math.random() * 2 + 1);
}

// Setup function to verify API is accessible
export function setup() {
  console.log('Starting HPA load test...');
  console.log(`Target API: ${API_URL}`);
  
  const response = executeGraphQL(queries.healthCheck);
  
  if (response.status !== 200) {
    console.error('API is not accessible. Aborting test.');
    throw new Error('API health check failed');
  }
  
  console.log('API health check passed. Starting load test...');
  return { startTime: new Date().toISOString() };
}

// Teardown function to log test results
export function teardown(data) {
  console.log('HPA load test completed.');
  console.log(`Test started at: ${data.startTime}`);
  console.log(`Test ended at: ${new Date().toISOString()}`);
  console.log('Check Kubernetes HPA status with: kubectl get hpa');
  console.log('Check pod scaling with: kubectl get pods -l app=leaseflow-backend');
}
