const { IdentityRouterService } = require('../src/services/identityRouterService');
const { SumSubAdapter } = require('../src/adapters/SumSubAdapter');
const { JumioAdapter } = require('../src/adapters/JumioAdapter');
const { VerificationResult } = require('../src/dtos/VerificationResult');

// Mock the adapters
jest.mock('../src/adapters/SumSubAdapter');
jest.mock('../src/adapters/JumioAdapter');

describe('Identity Router Service - Fallback Scenarios', () => {
  let identityRouter;
  let mockSumSubAdapter;
  let mockJumioAdapter;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock instances
    mockSumSubAdapter = {
      submitVerification: jest.fn(),
      checkStatus: jest.fn(),
      updateVerification: jest.fn(),
      getHealthStatus: jest.fn()
    };
    
    mockJumioAdapter = {
      submitVerification: jest.fn(),
      checkStatus: jest.fn(),
      updateVerification: jest.fn(),
      getHealthStatus: jest.fn()
    };

    // Mock constructors
    SumSubAdapter.mockImplementation(() => mockSumSubAdapter);
    JumioAdapter.mockImplementation(() => mockJumioAdapter);

    // Initialize router with test configuration
    identityRouter = new IdentityRouterService({
      providerPriority: ['sumsub', 'jumio'],
      fallbackTimeout: 1000,
      sumsub: {
        apiToken: 'test-sumsub-token',
        apiSecret: 'test-sumsub-secret'
      },
      jumio: {
        apiToken: 'test-jumio-token',
        apiSecret: 'test-jumio-secret'
      }
    });
  });

  describe('Primary Provider Success', () => {
    test('should successfully submit verification with primary provider', async () => {
      const kycData = {
        actorId: 'test-user-1',
        actorRole: 'tenant',
        stellarAccountId: 'GD5JGB56LYV43R2JEDCXJZ4WIF3FWJQYBVKT7HQPI2WDFNLYP3JUA4FK',
        personalInfo: { firstName: 'John', lastName: 'Doe' },
        addressInfo: { streetAddress: '123 Main St' },
        identificationInfo: { idType: 'passport' }
      };

      const expectedResult = VerificationResult.inProgress({
        verificationReference: 'sumsub-123',
        providerName: 'sumsub',
        responseTimeMs: 500
      });

      mockSumSubAdapter.submitVerification.mockResolvedValue(expectedResult);

      const result = await identityRouter.submitVerification(kycData);

      expect(result).toEqual(expectedResult);
      expect(result.isFallback).toBe(false);
      expect(mockSumSubAdapter.submitVerification).toHaveBeenCalledWith(kycData);
      expect(mockJumioAdapter.submitVerification).not.toHaveBeenCalled();
    });
  });

  describe('Primary Timeout - Fallback to Secondary', () => {
    test('should fallback to secondary provider when primary times out', async () => {
      const kycData = {
        actorId: 'test-user-2',
        actorRole: 'landlord',
        stellarAccountId: 'GD7YHEE5FQPEHGQLEJXKTG7YEHZP7I4UEVYRMEM5IP5MGBVXSQ2V6A7N',
        personalInfo: { firstName: 'Jane', lastName: 'Smith' },
        addressInfo: { streetAddress: '456 Oak Ave' },
        identificationInfo: { idType: 'driver_license' }
      };

      const fallbackResult = VerificationResult.inProgress({
        verificationReference: 'jumio-456',
        providerName: 'jumio',
        responseTimeMs: 800
      });

      // Primary provider times out
      mockSumSubAdapter.submitVerification.mockRejectedValue(new Error('Request timeout'));
      
      // Secondary provider succeeds
      mockJumioAdapter.submitVerification.mockResolvedValue(fallbackResult);

      const result = await identityRouter.submitVerification(kycData);

      expect(result).toEqual(fallbackResult);
      expect(result.isFallback).toBe(true);
      expect(mockSumSubAdapter.submitVerification).toHaveBeenCalledWith(kycData);
      expect(mockJumioAdapter.submitVerification).toHaveBeenCalledWith(kycData);
    });

    test('should fallback when primary returns 500 error', async () => {
      const kycData = {
        actorId: 'test-user-3',
        actorRole: 'tenant',
        stellarAccountId: 'GD5JGB56LYV43R2JEDCXJZ4WIF3FWJQYBVKT7HQPI2WDFNLYP3JUA4FK',
        personalInfo: { firstName: 'Bob', lastName: 'Wilson' },
        addressInfo: { streetAddress: '789 Pine St' },
        identificationInfo: { idType: 'passport' }
      };

      const fallbackResult = VerificationResult.inProgress({
        verificationReference: 'jumio-789',
        providerName: 'jumio',
        responseTimeMs: 600
      });

      // Primary provider returns server error
      const serverError = new Error('Internal Server Error');
      serverError.response = { status: 500 };
      mockSumSubAdapter.submitVerification.mockRejectedValue(serverError);
      
      // Secondary provider succeeds
      mockJumioAdapter.submitVerification.mockResolvedValue(fallbackResult);

      const result = await identityRouter.submitVerification(kycData);

      expect(result).toEqual(fallbackResult);
      expect(result.isFallback).toBe(true);
      expect(mockSumSubAdapter.submitVerification).toHaveBeenCalledWith(kycData);
      expect(mockJumioAdapter.submitVerification).toHaveBeenCalledWith(kycData);
    });

    test('should fallback when primary has network error', async () => {
      const kycData = {
        actorId: 'test-user-4',
        actorRole: 'landlord',
        stellarAccountId: 'GD7YHEE5FQPEHGQLEJXKTG7YEHZP7I4UEVYRMEM5IP5MGBVXSQ2V6A7N',
        personalInfo: { firstName: 'Alice', lastName: 'Brown' },
        addressInfo: { streetAddress: '321 Elm St' },
        identificationInfo: { idType: 'passport' }
      };

      const fallbackResult = VerificationResult.inProgress({
        verificationReference: 'jumio-321',
        providerName: 'jumio',
        responseTimeMs: 700
      });

      // Primary provider has network error
      const networkError = new Error('Connection refused');
      networkError.code = 'ECONNREFUSED';
      mockSumSubAdapter.submitVerification.mockRejectedValue(networkError);
      
      // Secondary provider succeeds
      mockJumioAdapter.submitVerification.mockResolvedValue(fallbackResult);

      const result = await identityRouter.submitVerification(kycData);

      expect(result).toEqual(fallbackResult);
      expect(result.isFallback).toBe(true);
      expect(mockSumSubAdapter.submitVerification).toHaveBeenCalledWith(kycData);
      expect(mockJumioAdapter.submitVerification).toHaveBeenCalledWith(kycData);
    });
  });

  describe('Both Providers Fail', () => {
    test('should return error when both providers fail', async () => {
      const kycData = {
        actorId: 'test-user-5',
        actorRole: 'tenant',
        stellarAccountId: 'GD5JGB56LYV43R2JEDCXJZ4WIF3FWJQYBVKT7HQPI2WDFNLYP3JUA4FK',
        personalInfo: { firstName: 'Charlie', lastName: 'Davis' },
        addressInfo: { streetAddress: '654 Maple Dr' },
        identificationInfo: { idType: 'passport' }
      };

      // Both providers fail
      mockSumSubAdapter.submitVerification.mockRejectedValue(new Error('Request timeout'));
      mockJumioAdapter.submitVerification.mockRejectedValue(new Error('Service unavailable'));

      const result = await identityRouter.submitVerification(kycData);

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.providerName).toBe('identity_router');
      expect(result.rejectionReason).toContain('All identity providers failed');
      expect(mockSumSubAdapter.submitVerification).toHaveBeenCalledWith(kycData);
      expect(mockJumioAdapter.submitVerification).toHaveBeenCalledWith(kycData);
    });
  });

  describe('Status Check Fallback', () => {
    test('should fallback for status check when primary fails', async () => {
      const verificationReference = 'sumsub-123';
      
      const fallbackResult = VerificationResult.success({
        verificationReference,
        providerName: 'jumio',
        responseTimeMs: 400
      });

      // Primary provider fails
      mockSumSubAdapter.checkStatus.mockRejectedValue(new Error('Request timeout'));
      
      // Secondary provider succeeds
      mockJumioAdapter.checkStatus.mockResolvedValue(fallbackResult);

      const result = await identityRouter.checkStatus(verificationReference);

      expect(result).toEqual(fallbackResult);
      expect(result.isFallback).toBe(true);
      expect(mockSumSubAdapter.checkStatus).toHaveBeenCalledWith(verificationReference);
      expect(mockJumioAdapter.checkStatus).toHaveBeenCalledWith(verificationReference);
    });

    test('should use original provider first for status check', async () => {
      const verificationReference = 'sumsub-123';
      const originalProvider = 'sumsub';
      
      const primaryResult = VerificationResult.success({
        verificationReference,
        providerName: 'sumsub',
        responseTimeMs: 300
      });

      // Original provider succeeds
      mockSumSubAdapter.checkStatus.mockResolvedValue(primaryResult);

      const result = await identityRouter.checkStatus(verificationReference, originalProvider);

      expect(result).toEqual(primaryResult);
      expect(result.isFallback).toBe(false);
      expect(mockSumSubAdapter.checkStatus).toHaveBeenCalledWith(verificationReference);
      expect(mockJumioAdapter.checkStatus).not.toHaveBeenCalled();
    });
  });

  describe('Update Verification Fallback', () => {
    test('should fallback for update when primary fails', async () => {
      const verificationReference = 'sumsub-123';
      const updatedData = { personalInfo: { firstName: 'Updated' } };
      
      const fallbackResult = VerificationResult.inProgress({
        verificationReference,
        providerName: 'jumio',
        responseTimeMs: 600
      });

      // Primary provider fails
      mockSumSubAdapter.updateVerification.mockRejectedValue(new Error('Service unavailable'));
      
      // Secondary provider succeeds
      mockJumioAdapter.updateVerification.mockResolvedValue(fallbackResult);

      const result = await identityRouter.updateVerification(verificationReference, updatedData);

      expect(result).toEqual(fallbackResult);
      expect(result.isFallback).toBe(true);
      expect(mockSumSubAdapter.updateVerification).toHaveBeenCalledWith(verificationReference, updatedData);
      expect(mockJumioAdapter.updateVerification).toHaveBeenCalledWith(verificationReference, updatedData);
    });
  });

  describe('Health Status Monitoring', () => {
    test('should return health status for all providers', async () => {
      mockSumSubAdapter.getHealthStatus.mockResolvedValue({
        adapter: 'sumsub',
        status: 'healthy',
        responseTimeMs: 200
      });

      mockJumioAdapter.getHealthStatus.mockResolvedValue({
        adapter: 'jumio',
        status: 'unhealthy',
        error: 'Connection timeout'
      });

      const healthStatus = await identityRouter.getHealthStatus();

      expect(healthStatus.overall.status).toBe('healthy'); // At least one provider is healthy
      expect(healthStatus.overall.healthyProviders).toBe(1);
      expect(healthStatus.overall.totalProviders).toBe(2);
      expect(healthStatus.providers.sumsub.status).toBe('healthy');
      expect(healthStatus.providers.jumio.status).toBe('unhealthy');
    });

    test('should handle health check failures gracefully', async () => {
      mockSumSubAdapter.getHealthStatus.mockRejectedValue(new Error('Health check failed'));
      mockJumioAdapter.getHealthStatus.mockRejectedValue(new Error('Health check failed'));

      const healthStatus = await identityRouter.getHealthStatus();

      expect(healthStatus.overall.status).toBe('unhealthy');
      expect(healthStatus.overall.healthyProviders).toBe(0);
      expect(healthStatus.providers.sumsub.status).toBe('unhealthy');
      expect(healthStatus.providers.jumio.status).toBe('unhealthy');
    });
  });

  describe('Metrics Collection', () => {
    test('should track fallback activations', async () => {
      const kycData = {
        actorId: 'test-user-6',
        actorRole: 'tenant',
        stellarAccountId: 'GD5JGB56LYV43R2JEDCXJZ4WIF3FWJQYBVKT7HQPI2WDFNLYP3JUA4FK',
        personalInfo: { firstName: 'Test', lastName: 'User' },
        addressInfo: { streetAddress: '123 Test St' },
        identificationInfo: { idType: 'passport' }
      };

      const fallbackResult = VerificationResult.inProgress({
        verificationReference: 'jumio-fallback',
        providerName: 'jumio',
        responseTimeMs: 800
      });

      // Primary fails, secondary succeeds
      mockSumSubAdapter.submitVerification.mockRejectedValue(new Error('Request timeout'));
      mockJumioAdapter.submitVerification.mockResolvedValue(fallbackResult);

      await identityRouter.submitVerification(kycData);

      const metrics = identityRouter.getMetrics();
      expect(metrics.fallbackActivations).toBe(1);
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(1);
    });

    test('should track provider errors', async () => {
      const kycData = {
        actorId: 'test-user-7',
        actorRole: 'landlord',
        stellarAccountId: 'GD7YHEE5FQPEHGQLEJXKTG7YEHZP7I4UEVYRMEM5IP5MGBVXSQ2V6A7N',
        personalInfo: { firstName: 'Error', lastName: 'Test' },
        addressInfo: { streetAddress: '456 Error St' },
        identificationInfo: { idType: 'passport' }
      };

      // Both providers fail
      mockSumSubAdapter.submitVerification.mockRejectedValue(new Error('Server error'));
      mockJumioAdapter.submitVerification.mockRejectedValue(new Error('Network error'));

      await identityRouter.submitVerification(kycData);

      const metrics = identityRouter.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(0);
      expect(metrics.providerErrors.sumsub).toBe(1);
      expect(metrics.providerErrors.jumio).toBe(1);
    });
  });

  describe('Provider Priority Management', () => {
    test('should update provider priority at runtime', () => {
      const newPriority = ['jumio', 'sumsub'];
      
      identityRouter.updateProviderPriority(newPriority);
      
      expect(identityRouter.getProviderPriority()).toEqual(newPriority);
    });

    test('should reject invalid provider priority', () => {
      const invalidPriority = ['nonexistent', 'sumsub'];
      
      expect(() => {
        identityRouter.updateProviderPriority(invalidPriority);
      }).toThrow('Provider nonexistent is not configured');
    });
  });

  describe('Prometheus Metrics Integration', () => {
    test('should have prometheus metrics instance', () => {
      const prometheusMetrics = identityRouter.getPrometheusMetrics();
      
      expect(prometheusMetrics).toBeDefined();
      expect(prometheusMetrics.recordVerificationRequest).toBeDefined();
      expect(prometheusMetrics.recordFallbackActivation).toBeDefined();
      expect(prometheusMetrics.recordProviderError).toBeDefined();
    });

    test('should record metrics during fallback', async () => {
      const kycData = {
        actorId: 'test-user-8',
        actorRole: 'tenant',
        stellarAccountId: 'GD5JGB56LYV43R2JEDCXJZ4WIF3FWJQYBVKT7HQPI2WDFNLYP3JUA4FK',
        personalInfo: { firstName: 'Metrics', lastName: 'Test' },
        addressInfo: { streetAddress: '789 Metrics St' },
        identificationInfo: { idType: 'passport' }
      };

      const fallbackResult = VerificationResult.inProgress({
        verificationReference: 'jumio-metrics',
        providerName: 'jumio',
        responseTimeMs: 750
      });

      // Mock prometheus metrics methods
      const prometheusMetrics = identityRouter.getPrometheusMetrics();
      jest.spyOn(prometheusMetrics, 'recordVerificationRequest');
      jest.spyOn(prometheusMetrics, 'recordFallbackActivation');
      jest.spyOn(prometheusMetrics, 'recordProviderError');

      // Primary fails, secondary succeeds
      mockSumSubAdapter.submitVerification.mockRejectedValue(new Error('Request timeout'));
      mockJumioAdapter.submitVerification.mockResolvedValue(fallbackResult);

      await identityRouter.submitVerification(kycData);

      // Verify metrics were recorded
      expect(prometheusMetrics.recordVerificationRequest).toHaveBeenCalledWith(
        'sumsub', 'submit', 'error', expect.any(Number)
      );
      expect(prometheusMetrics.recordVerificationRequest).toHaveBeenCalledWith(
        'jumio', 'submit', 'success', expect.any(Number)
      );
      expect(prometheusMetrics.recordFallbackActivation).toHaveBeenCalledWith(
        'sumsub', 'jumio', 'timeout'
      );
      expect(prometheusMetrics.recordProviderError).toHaveBeenCalledWith(
        'sumsub', 'timeout', undefined
      );
    });
  });
});

describe('Identity Router Service - Configuration', () => {
  test('should handle missing provider configuration gracefully', () => {
    const router = new IdentityRouterService({
      providerPriority: ['sumsub', 'nonexistent'],
      sumsub: {
        apiToken: 'test-token',
        apiSecret: 'test-secret'
      }
    });

    expect(router.getProviderPriority()).toEqual(['sumsub', 'nonexistent']);
    // Should not throw during initialization
  });

  test('should use default configuration when not provided', () => {
    const router = new IdentityRouterService({
      sumsub: {
        apiToken: 'test-token',
        apiSecret: 'test-secret'
      }
    });

    expect(router.getProviderPriority()).toEqual(['sumsub', 'jumio']);
    expect(router.fallbackTimeout).toBe(5000);
  });
});
