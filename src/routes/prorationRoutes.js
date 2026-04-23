const express = require('express');
const rateLimit = require('express-rate-limit');
const ProrationController = require('../controllers/ProrationController');

const router = express.Router();

/**
 * Rate limiting configuration for proration calculator
 * - Heavy mathematical execution
 * - Database joins
 * - External API calls for price data
 * - Prevent abuse while maintaining usability
 */
const prorationRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // Limit each IP to 10 requests per minute
  message: {
    success: false,
    error: 'Too many proration calculations requested. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 60
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: (req) => {
    // Use IP address as key, but could be enhanced to use user ID if auth is implemented
    return req.ip || req.connection.remoteAddress;
  },
  skip: (req) => {
    // Skip rate limiting for health checks and test endpoints
    return req.path.includes('/health') || req.path.includes('/fuzz-tests');
  }
});

/**
 * Stricter rate limiting for production environments
 */
const productionRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 5, // Stricter limit for production
  message: {
    success: false,
    error: 'Production rate limit exceeded. Please try again later.',
    code: 'PRODUCTION_RATE_LIMIT_EXCEEDED',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * @openapi
 * /api/v1/leases/{leaseId}/proration-preview:
 *   get:
 *     summary: Calculate lease termination proration preview
 *     description: |
 *       Provides accurate fiat estimates for mid-cycle lease terminations.
 *       Replicates exact 128-bit fixed-point math from Soroban smart contract.
 *       Calculates elapsed seconds, rent deduction, and security deposit refund.
 *       Converts stroop values to localized fiat using Redis price cache.
 *       
 *       **Example Usage:**
 *       ```
 *       GET /api/v1/leases/lease-123/proration-preview?termination_timestamp=1735689600&target_currency=USD
 *       ```
 *       
 *       **Response Format:**
 *       ```
 *       {
 *         "success": true,
 *         "data": {
 *           "calculation": {
 *             "elapsedDays": 45,
 *             "totalLeaseDays": 365,
 *             "usagePercentage": 12.3
 *           },
 *           "amounts": {
 *             "totalRefund": {
 *               "stroops": "8500000000",
 *               "xlm": "850.0000000"
 *             }
 *           },
 *           "fiat": {
 *             "formatted": "USD 85.00"
 *           }
 *         }
 *       }
 *       ```
 *     tags: [Proration Calculator]
 *     parameters:
 *       - in: path
 *         name: leaseId
 *         required: true
 *         schema:
 *           type: string
 *         description: Lease identifier
 *       - in: query
 *         name: termination_timestamp
 *         required: true
 *         schema:
 *           type: integer
 *         description: Unix timestamp for target termination
 *       - in: query
 *         name: target_currency
 *         required: false
 *         schema:
 *           type: string
 *           enum: [USD, EUR, NGN, GBP, JPY]
 *           default: USD
 *         description: Target fiat currency for conversion
 *     responses:
 *       200:
 *         description: Proration calculation successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: Complete proration calculation with raw and formatted data
 *                 meta:
 *                   type: object
 *                   properties:
 *                     calculationTimeMs:
 *                       type: number
 *                       example: 245
 *                     endpoint:
 *                       type: string
 *                       example: "/api/v1/leases/:id/proration-preview"
 *                     version:
 *                       type: string
 *                       example: "1.0.0"
 *       400:
 *         description: Bad request - invalid parameters or lease state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Lease not found"
 *                 code:
 *                   type: string
 *                   example: "LEASE_NOT_FOUND"
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Too many proration calculations requested"
 *                 code:
 *                   type: string
 *                   example: "RATE_LIMIT_EXCEEDED"
 *                 retryAfter:
 *                   type: integer
 *                   example: 60
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Internal server error during proration calculation"
 *                 code:
 *                   type: string
 *                   example: "INTERNAL_ERROR"
 */
router.get('/leases/:leaseId/proration-preview', 
  process.env.NODE_ENV === 'production' ? productionRateLimit : prorationRateLimit,
  ProrationController.getProrationPreview
);

/**
 * @openapi
 * /api/v1/proration/health:
 *   get:
 *     summary: Health check for proration calculator service
 *     description: Returns service health status including database and Redis connectivity
 *     tags: [Proration Calculator]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 services:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: string
 *                       example: "connected"
 *                     redis:
 *                       type: string
 *                       example: "connected"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *       503:
 *         description: Service is unhealthy
 */
router.get('/proration/health', ProrationController.getHealthStatus);

/**
 * @openapi
 * /api/v1/proration/fuzz-tests:
 *   get:
 *     summary: Generate fuzz test cases for proration calculator
 *     description: |
 *       Generates test cases for fuzz testing against smart contract output.
 *       Creates random lease scenarios with varying parameters.
 *       
 *       **Usage:**
 *       ```
 *       GET /api/v1/proration/fuzz-tests?count=50
 *       ```
 *     tags: [Proration Calculator]
 *     parameters:
 *       - in: query
 *         name: count
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of test cases to generate (max 100)
 *     responses:
 *       200:
 *         description: Test cases generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *                       example: 10
 *                     testCases:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           leaseId:
 *                             type: string
 *                           startDate:
 *                             type: string
 *                           endDate:
 *                             type: string
 *                           rentAmount:
 *                             type: string
 *                           terminationTimestamp:
 *                             type: integer
 *                           currency:
 *                             type: string
 */
router.get('/proration/fuzz-tests', ProrationController.generateFuzzTests);

module.exports = router;
