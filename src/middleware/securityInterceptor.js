/**
 * Security Interceptor Middleware
 * 
 * Actively scans all incoming request bodies, query parameters, and headers
 * for common SQL Injection and XSS payloads.
 */

// Common SQL Injection patterns
const SQL_INJECTION_PATTERNS = [
    /UNION\s+SELECT/i,
    /UNION\s+ALL\s+SELECT/i,
    /'\s+OR\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i,
    /--\s*$/i,
    /;\s*DROP\s+TABLE/i,
    /;\s*TRUNCATE\s+TABLE/i,
    /;\s*DELETE\s+FROM/i,
    /SLEEP\(\d+\)/i,
    /BENCHMARK\(\d+,\s*.*\)/i,
    /INFORMATION_SCHEMA/i,
    /@@version/i,
    /UTL_HTTP\.REQUEST/i
];

// Common XSS patterns
const XSS_PATTERNS = [
    /<script.*?>/i,
    /<\/script>/i,
    /javascript:/i,
    /on\w+\s*=\s*['"].*?['"]/i, // event handlers like onload="alert(1)"
    /expression\s*\(.*?\)/i, // CSS expressions
    /<iframe.*?>/i,
    /<object.*?>/i,
    /<embed.*?>/i,
    /data:text\/html/i
];

/**
 * Checks if a value contains any malicious patterns
 * @param {any} value - The value to scan
 * @returns {boolean} - True if malicious pattern found
 */
function isMalicious(value) {
    if (typeof value !== 'string') {
        if (value && typeof value === 'object') {
            return Object.values(value).some(v => isMalicious(v));
        }
        return false;
    }

    const hasSqlInjection = SQL_INJECTION_PATTERNS.some(pattern => pattern.test(value));
    const hasXss = XSS_PATTERNS.some(pattern => pattern.test(value));

    return hasSqlInjection || hasXss;
}

/**
 * Global Security Interceptor Middleware
 */
function securityInterceptor(req, res, next) {
    const { body, query, headers } = req;

    // Scan Body
    if (body && isMalicious(body)) {
        console.warn(`[Security] Blocked request from ${req.ip} - Malicious payload detected in body:`, JSON.stringify(body).slice(0, 200));
        return res.status(403).json({
            error: 'Security Violation',
            message: 'Malicious payload detected in request body.'
        });
    }

    // Scan Query Parameters
    if (query && isMalicious(query)) {
        console.warn(`[Security] Blocked request from ${req.ip} - Malicious payload detected in query:`, JSON.stringify(query).slice(0, 200));
        return res.status(403).json({
            error: 'Security Violation',
            message: 'Malicious payload detected in query parameters.'
        });
    }

    // Scan specific Headers (not all headers to avoid false positives with system headers)
    const sensitiveHeaders = ['user-agent', 'referer', 'x-forwarded-for', 'authorization'];
    for (const header of sensitiveHeaders) {
        const headerValue = req.headers[header];
        if (headerValue && isMalicious(headerValue)) {
            console.warn(`[Security] Blocked request from ${req.ip} - Malicious payload detected in header ${header}:`, headerValue.slice(0, 200));
            return res.status(403).json({
                error: 'Security Violation',
                message: `Malicious payload detected in header: ${header}.`
            });
        }
    }

    next();
}

module.exports = securityInterceptor;
