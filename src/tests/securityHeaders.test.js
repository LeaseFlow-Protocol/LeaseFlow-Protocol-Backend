const request = require('supertest');
const express = require('express');
const helmet = require('helmet');

describe('Security Headers Tests', () => {
  let app;

  beforeEach(() => {
    app = express();

    // Apply the same helmet configuration as in index.js
    app.use(
      helmet({
        // Content Security Policy - restricts scripts to verified Leaseflow domains
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
              "'self'",
              "*.leaseflow.io",
              "*.leaseflow.com",
              "https://cdn.jsdelivr.net",
            ],
            styleSrc: ["'self'", "'unsafe-inline'", "*.leaseflow.io", "*.leaseflow.com"],
            imgSrc: ["'self'", "data:", "https:", "*.leaseflow.io", "*.leaseflow.com"],
            connectSrc: ["'self'", "*.leaseflow.io", "*.leaseflow.com"],
            fontSrc: ["'self'", "*.leaseflow.io", "*.leaseflow.com"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
          },
        },
        // Strict Transport Security - force HTTPS for 2 years
        hsts: {
          maxAge: 63072000, // 2 years in seconds
          includeSubDomains: true,
          preload: true,
        },
        // Prevent clickjacking
        frameguard: {
          action: "deny",
        },
        // Prevent MIME-sniffing
        noSniff: true,
        // Strip X-Powered-By header
        hidePoweredBy: true,
        // Referrer Policy
        referrerPolicy: {
          policy: "strict-origin-when-cross-origin",
        },
        // X-XSS-Protection
        xssFilter: true,
      })
    );

    // Add a simple test route
    app.get('/', (req, res) => {
      res.json({ status: 'ok' });
    });

    app.get('/health', (req, res) => {
      res.json({ status: 'healthy' });
    });

    app.get('/api/test', (req, res) => {
      res.json({ message: 'test' });
    });
  });

  describe('OWASP Security Headers', () => {
    it('should set Content-Security-Policy header with correct directives', async () => {
      const response = await request(app).get('/');

      expect(response.headers['content-security-policy']).toBeDefined();
      const csp = response.headers['content-security-policy'];

      // Verify script-src includes Leaseflow domains
      expect(csp).toContain("script-src");
      expect(csp).toContain("'self'");
      expect(csp).toContain("*.leaseflow.io");
      expect(csp).toContain("*.leaseflow.com");
      expect(csp).toContain("https://cdn.jsdelivr.net");

      // Verify default-src is set to 'self'
      expect(csp).toContain("default-src 'self'");

      // Verify object-src is 'none' to prevent plugin execution
      expect(csp).toContain("object-src 'none'");

      // Verify frame-src is 'none' to prevent clickjacking
      expect(csp).toContain("frame-src 'none'");
    });

    it('should set Strict-Transport-Security header with 2-year max-age', async () => {
      const response = await request(app).get('/');

      expect(response.headers['strict-transport-security']).toBeDefined();
      const hsts = response.headers['strict-transport-security'];

      // Verify max-age is 2 years (63072000 seconds)
      expect(hsts).toContain('max-age=63072000');

      // Verify includeSubDomains is set
      expect(hsts).toContain('includeSubDomains');

      // Verify preload is set for HSTS preload list
      expect(hsts).toContain('preload');
    });

    it('should set X-Frame-Options to DENY to prevent clickjacking', async () => {
      const response = await request(app).get('/');

      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('should set X-Content-Type-Options to nosniff to prevent MIME-sniffing', async () => {
      const response = await request(app).get('/');

      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should strip X-Powered-By header to obfuscate technology stack', async () => {
      const response = await request(app).get('/');

      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should set Referrer-Policy to strict-origin-when-cross-origin', async () => {
      const response = await request(app).get('/');

      expect(response.headers['referrer-policy']).toBeDefined();
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('should set X-XSS-Protection header', async () => {
      const response = await request(app).get('/');

      expect(response.headers['x-xss-protection']).toBeDefined();
      // Modern helmet sets this to 0 as modern browsers have better XSS protection
      expect(response.headers['x-xss-protection']).toBe('0');
    });

    it('should set X-Download-Options header for IE', async () => {
      const response = await request(app).get('/');

      expect(response.headers['x-download-options']).toBeDefined();
      expect(response.headers['x-download-options']).toBe('noopen');
    });
  });

  describe('Security Headers on API Endpoints', () => {
    it('should apply security headers to health endpoint', async () => {
      const response = await request(app).get('/health');

      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should apply security headers to API routes', async () => {
      const response = await request(app).get('/api/leases');

      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CSP Directives Verification', () => {
    it('should allow scripts from trusted Leaseflow domains only', async () => {
      const response = await request(app).get('/');
      const csp = response.headers['content-security-policy'];

      // Verify trusted domains are present
      expect(csp).toContain('*.leaseflow.io');
      expect(csp).toContain('*.leaseflow.com');

      // Verify inline scripts are not allowed (except for styles)
      const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
      if (scriptSrcMatch) {
        const scriptSrc = scriptSrcMatch[1];
        expect(scriptSrc).not.toContain("'unsafe-inline'");
      }
    });

    it('should restrict style-src to trusted sources with unsafe-inline for CSS', async () => {
      const response = await request(app).get('/');
      const csp = response.headers['content-security-policy'];

      expect(csp).toContain("style-src");
      expect(csp).toContain("'unsafe-inline'");
      expect(csp).toContain("*.leaseflow.io");
      expect(csp).toContain("*.leaseflow.com");
    });

    it('should restrict img-src to data:, https:, and trusted domains', async () => {
      const response = await request(app).get('/');
      const csp = response.headers['content-security-policy'];

      expect(csp).toContain("img-src");
      expect(csp).toContain("data:");
      expect(csp).toContain("https:");
      expect(csp).toContain("*.leaseflow.io");
      expect(csp).toContain("*.leaseflow.com");
    });

    it('should restrict connect-src to self and trusted domains', async () => {
      const response = await request(app).get('/');
      const csp = response.headers['content-security-policy'];

      expect(csp).toContain("connect-src");
      expect(csp).toContain("'self'");
      expect(csp).toContain("*.leaseflow.io");
      expect(csp).toContain("*.leaseflow.com");
    });

    it('should restrict font-src to self and trusted domains', async () => {
      const response = await request(app).get('/');
      const csp = response.headers['content-security-policy'];

      expect(csp).toContain("font-src");
      expect(csp).toContain("'self'");
      expect(csp).toContain("*.leaseflow.io");
      expect(csp).toContain("*.leaseflow.com");
    });
  });

  describe('Technology Stack Obfuscation', () => {
    it('should not leak Express version information', async () => {
      const response = await request(app).get('/');

      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should not leak server information', async () => {
      const response = await request(app).get('/');

      // Helmet typically sets Server header minimally
      // Verify it doesn't contain detailed version info
      if (response.headers['server']) {
        expect(response.headers['server']).not.toMatch(/\d+\.\d+\.\d+/);
      }
    });
  });
});
