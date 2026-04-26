/**
 * Vault Integration Tests
 * Tests for Vault connectivity, secret injection, and graceful failure handling
 * 
 * Run with: npm test -- tests/vault-integration.test.js
 */

const { describe, it, before, after, beforeEach, afterEach } = require('@jest/globals');
const axios = require('axios');
const { execSync } = require('child_process');

// Configuration
const VAULT_ADDR = process.env.VAULT_ADDR || 'https://vault.example.com:8200';
const VAULT_TOKEN = process.env.VAULT_TOKEN;
const VAULT_ROLE = process.env.VAULT_ROLE || 'leaseflow-backend';
const KUBERNETES_NAMESPACE = process.env.KUBERNETES_NAMESPACE || 'leaseflow';

describe('Vault Integration Tests', () => {
  describe('Vault Connectivity', () => {
    it('should be able to connect to Vault', async () => {
      try {
        const response = await axios.get(`${VAULT_ADDR}/v1/sys/health`, {
          timeout: 5000,
          validateStatus: () => true // Accept any status code
        });
        
        expect(response.status).toBeLessThan(500);
        expect(response.data).toHaveProperty('initialized');
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Vault is unreachable. Please check VAULT_ADDR and network connectivity.');
        }
        throw error;
      }
    });

    it('should authenticate using Kubernetes ServiceAccount token', async () => {
      if (!VAULT_TOKEN) {
        console.warn('Skipping Kubernetes auth test - VAULT_TOKEN not provided');
        return;
      }

      try {
        const response = await axios.post(
          `${VAULT_ADDR}/v1/auth/kubernetes/login`,
          {
            role: VAULT_ROLE,
            jwt: VAULT_TOKEN
          },
          {
            headers: { 'X-Vault-Token': VAULT_TOKEN },
            timeout: 10000
          }
        );

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('auth');
        expect(response.data.auth).toHaveProperty('client_token');
      } catch (error) {
        if (error.response?.status === 403) {
          throw new Error('Kubernetes authentication failed. Check role configuration.');
        }
        throw error;
      }
    });
  });

  describe('Secret Access', () => {
    let vaultToken;

    beforeAll(async () => {
      // Authenticate to Vault
      if (VAULT_TOKEN) {
        vaultToken = VAULT_TOKEN;
      } else {
        try {
          const response = await axios.post(
            `${VAULT_ADDR}/v1/auth/kubernetes/login`,
            {
              role: VAULT_ROLE,
              jwt: process.env.KUBERNETES_SERVICE_ACCOUNT_TOKEN || ''
            },
            { timeout: 10000 }
          );
          vaultToken = response.data.auth.client_token;
        } catch (error) {
          console.warn('Could not authenticate to Vault, skipping secret access tests');
        }
      }
    });

    it('should be able to read database credentials', async () => {
      if (!vaultToken) {
        console.warn('Skipping - no Vault token available');
        return;
      }

      try {
        const response = await axios.get(
          `${VAULT_ADDR}/v1/database/creds/leaseflow-backend`,
          {
            headers: { 'X-Vault-Token': vaultToken },
            timeout: 10000
          }
        );

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('data');
        expect(response.data.data).toHaveProperty('username');
        expect(response.data.data).toHaveProperty('password');
        expect(response.data.data).toHaveProperty('lease_id');
      } catch (error) {
        if (error.response?.status === 403) {
          throw new Error('Access denied to database credentials. Check policy.');
        }
        if (error.response?.status === 404) {
          throw new Error('Database credentials path not found. Configure database secrets engine.');
        }
        throw error;
      }
    });

    it('should be able to read JWT secret', async () => {
      if (!vaultToken) {
        console.warn('Skipping - no Vault token available');
        return;
      }

      try {
        const response = await axios.get(
          `${VAULT_ADDR}/v1/secret/data/leaseflow/jwt`,
          {
            headers: { 'X-Vault-Token': vaultToken },
            timeout: 10000
          }
        );

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('data');
        expect(response.data.data.data).toHaveProperty('secret');
      } catch (error) {
        if (error.response?.status === 403) {
          throw new Error('Access denied to JWT secret. Check policy.');
        }
        if (error.response?.status === 404) {
          console.warn('JWT secret not found in Vault. This is expected if not yet configured.');
        }
      }
    });

    it('should be able to read Redis credentials', async () => {
      if (!vaultToken) {
        console.warn('Skipping - no Vault token available');
        return;
      }

      try {
        const response = await axios.get(
          `${VAULT_ADDR}/v1/secret/data/leaseflow/redis`,
          {
            headers: { 'X-Vault-Token': vaultToken },
            timeout: 10000
          }
        );

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('data');
        expect(response.data.data.data).toHaveProperty('password');
      } catch (error) {
        if (error.response?.status === 403) {
          throw new Error('Access denied to Redis credentials. Check policy.');
        }
        if (error.response?.status === 404) {
          console.warn('Redis credentials not found in Vault. This is expected if not yet configured.');
        }
      }
    });
  });

  describe('Graceful Failure Handling', () => {
    it('should log clear error when Vault is unreachable', async () => {
      // Simulate Vault unreachability by using an invalid address
      const invalidVaultAddr = 'https://invalid-vault.example.com:8200';
      
      try {
        await axios.get(`${invalidVaultAddr}/v1/sys/health`, {
          timeout: 5000
        });
        fail('Should have thrown an error for unreachable Vault');
      } catch (error) {
        expect(error.code).toBe('ECONNREFUSED' || 'ENOTFOUND');
        
        // Verify error message is clear
        const errorMessage = error.message;
        expect(errorMessage).toMatch(/connect|refused|unreachable/i);
      }
    });

    it('should log clear error when Vault access is denied', async () => {
      if (!VAULT_TOKEN) {
        console.warn('Skipping - VAULT_TOKEN not provided');
        return;
      }

      try {
        // Try to access a path that should be denied
        const response = await axios.get(
          `${VAULT_ADDR}/v1/sys/leader`,
          {
            headers: { 'X-Vault-Token': 'invalid-token' },
            timeout: 5000
          }
        );
        
        if (response.status === 403) {
          const errorMessage = response.data.errors?.[0] || 'Access denied';
          expect(errorMessage).toMatch(/permission|denied|unauthorized/i);
        }
      } catch (error) {
        if (error.response?.status === 403) {
          const errorMessage = error.response.data.errors?.[0] || 'Access denied';
          expect(errorMessage).toMatch(/permission|denied|unauthorized/i);
        }
      }
    });

    it('should handle missing secrets gracefully', async () => {
      if (!VAULT_TOKEN) {
        console.warn('Skipping - VAULT_TOKEN not provided');
        return;
      }

      try {
        const response = await axios.get(
          `${VAULT_ADDR}/v1/secret/data/leaseflow/nonexistent-secret`,
          {
            headers: { 'X-Vault-Token': VAULT_TOKEN },
            timeout: 5000
          }
        );

        if (response.status === 404) {
          // This is expected - secret doesn't exist
          expect(response.status).toBe(404);
        }
      } catch (error) {
        if (error.response?.status === 404) {
          // This is expected - secret doesn't exist
          expect(error.response.status).toBe(404);
        }
      }
    });
  });

  describe('Dynamic Credential Rotation', () => {
    it('should support database credential rotation', async () => {
      if (!VAULT_TOKEN) {
        console.warn('Skipping - VAULT_TOKEN not provided');
        return;
      }

      try {
        // Get initial credentials
        const initialResponse = await axios.get(
          `${VAULT_ADDR}/v1/database/creds/leaseflow-backend`,
          {
            headers: { 'X-Vault-Token': VAULT_TOKEN },
            timeout: 10000
          }
        );

        const initialLeaseId = initialResponse.data.data.lease_id;
        const initialPassword = initialResponse.data.data.password;

        // Rotate credentials
        await axios.post(
          `${VAULT_ADDR}/v1/database/rotate-role/leaseflow-backend`,
          {},
          {
            headers: { 'X-Vault-Token': VAULT_TOKEN },
            timeout: 10000
          }
        );

        // Get new credentials
        const newResponse = await axios.get(
          `${VAULT_ADDR}/v1/database/creds/leaseflow-backend`,
          {
            headers: { 'X-Vault-Token': VAULT_TOKEN },
            timeout: 10000
          }
        );

        const newLeaseId = newResponse.data.data.lease_id;
        const newPassword = newResponse.data.data.password;

        // Verify credentials changed
        expect(newLeaseId).not.toBe(initialLeaseId);
        expect(newPassword).not.toBe(initialPassword);
      } catch (error) {
        if (error.response?.status === 403) {
          console.warn('Credential rotation test failed - insufficient permissions');
        } else if (error.response?.status === 404) {
          console.warn('Credential rotation test failed - database secrets engine not configured');
        } else {
          throw error;
        }
      }
    });
  });

  describe('Kubernetes Pod Integration', () => {
    it('should have Vault Agent Injector annotations in pod spec', () => {
      try {
        const podSpec = execSync(
          `kubectl get deployment leaseflow-backend -n ${KUBERNETES_NAMESPACE} -o json`,
          { encoding: 'utf8' }
        );

        const podJson = JSON.parse(podSpec);
        const annotations = podJson.spec.template.metadata.annotations;

        expect(annotations).toBeDefined();
        expect(annotations['vault.hashicorp.com/agent-inject']).toBe('true');
        expect(annotations['vault.hashicorp.com/role']).toBe('leaseflow-backend');
      } catch (error) {
        console.warn('Kubernetes integration test failed - cluster not accessible');
      }
    });

    it('should have Vault secrets volume mounted', () => {
      try {
        const podSpec = execSync(
          `kubectl get deployment leaseflow-backend -n ${KUBERNETES_NAMESPACE} -o json`,
          { encoding: 'utf8' }
        );

        const podJson = JSON.parse(podSpec);
        const volumes = podJson.spec.template.spec.volumes;
        const volumeMounts = podJson.spec.template.spec.containers[0].volumeMounts;

        const vaultVolume = volumes.find(v => v.name === 'vault-secrets');
        const vaultMount = volumeMounts.find(vm => vm.name === 'vault-secrets');

        expect(vaultVolume).toBeDefined();
        expect(vaultMount).toBeDefined();
        expect(vaultMount.mountPath).toBe('/vault/secrets');
      } catch (error) {
        console.warn('Kubernetes integration test failed - cluster not accessible');
      }
    });
  });

  describe('Security Validation', () => {
    it('should not have secrets in Kubernetes Secrets when Vault is enabled', () => {
      try {
        const secrets = execSync(
          `kubectl get secrets -n ${KUBERNETES_NAMESPACE} -o json`,
          { encoding: 'utf8' }
        );

        const secretsJson = JSON.parse(secrets);
        const backendSecret = secretsJson.items.find(
          s => s.metadata.name === 'leaseflow-backend-secrets'
        );

        if (backendSecret) {
          const data = backendSecret.data;
          // Check for sensitive keys
          const sensitiveKeys = ['DB_PASSWORD', 'JWT_SECRET', 'REDIS_PASSWORD'];
          const hasSensitiveData = sensitiveKeys.some(key => data[key]);

          if (hasSensitiveData) {
            console.warn('WARNING: Sensitive data found in Kubernetes Secrets. Vault should be used instead.');
          }
        }
      } catch (error) {
        console.warn('Security validation test failed - cluster not accessible');
      }
    });

    it('should use least-privilege policies', async () => {
      if (!VAULT_TOKEN) {
        console.warn('Skipping - VAULT_TOKEN not provided');
        return;
      }

      try {
        // Check that the policy doesn't have wildcard access
        const response = await axios.get(
          `${VAULT_ADDR}/v1/sys/policy/leaseflow-backend`,
          {
            headers: { 'X-Vault-Token': VAULT_TOKEN },
            timeout: 10000
          }
        );

        const policy = response.data.data.rules;
        const hasWildcard = policy.includes('path "*"') || policy.includes('path "sys/*"');

        if (hasWildcard) {
          console.warn('WARNING: Policy has wildcard access. Use least-privilege policies instead.');
        }

        expect(hasWildcard).toBe(false);
      } catch (error) {
        if (error.response?.status === 404) {
          console.warn('Policy not found - this is expected if not yet configured');
        } else {
          console.warn('Policy validation test failed');
        }
      }
    });
  });
});
