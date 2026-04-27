const request = require('supertest');
const express = require('express');
const securityInterceptor = require('../middleware/securityInterceptor');

describe('Security Interceptor Middleware', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(securityInterceptor);
        
        // Mock route for testing
        app.post('/test', (req, res) => {
            res.status(200).json({ success: true, data: req.body });
        });

        app.get('/test', (req, res) => {
            res.status(200).json({ success: true, query: req.query });
        });
    });

    describe('SQL Injection Protection', () => {
        it('should block UNION SELECT in body', async () => {
            const response = await request(app)
                .post('/test')
                .send({ username: 'admin', bio: 'I like UNION SELECT * FROM users' });
            
            expect(response.status).toBe(403);
            expect(response.body.error).toBe('Security Violation');
        });

        it('should block OR 1=1 in body', async () => {
            const response = await request(app)
                .post('/test')
                .send({ username: "' OR 1=1--" });
            
            expect(response.status).toBe(403);
        });

        it('should block DROP TABLE in query parameters', async () => {
            const response = await request(app)
                .get('/test?search=something; DROP TABLE leases');
            
            expect(response.status).toBe(403);
        });

        it('should block SLEEP in query parameters', async () => {
            const response = await request(app)
                .get('/test?id=1 AND SLEEP(5)');
            
            expect(response.status).toBe(403);
        });

        it('should block SQLi in nested objects', async () => {
            const response = await request(app)
                .post('/test')
                .send({ 
                    user: { 
                        profile: { 
                            comment: "Check this out: '; DELETE FROM users; --" 
                        } 
                    } 
                });
            
            expect(response.status).toBe(403);
        });
    });

    describe('XSS Protection', () => {
        it('should block <script> tags in body', async () => {
            const response = await request(app)
                .post('/test')
                .send({ content: '<script>alert("XSS")</script>' });
            
            expect(response.status).toBe(403);
        });

        it('should block javascript: pseudo-protocol', async () => {
            const response = await request(app)
                .post('/test')
                .send({ url: 'javascript:alert(1)' });
            
            expect(response.status).toBe(403);
        });

        it('should block event handlers like onload', async () => {
            const response = await request(app)
                .post('/test')
                .send({ html: '<img src=x onerror="alert(1)">' });
            
            expect(response.status).toBe(403);
        });

        it('should block XSS in headers', async () => {
            const response = await request(app)
                .get('/test')
                .set('User-Agent', '<script>alert(1)</script>');
            
            expect(response.status).toBe(403);
        });
    });

    describe('False Positive Prevention', () => {
        it('should allow legitimate "union" word in text', async () => {
            const response = await request(app)
                .post('/test')
                .send({ bio: 'I work for the trade union and I enjoy my job' });
            
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('should allow valid query parameters', async () => {
            const response = await request(app)
                .get('/test?search=blockchain&limit=10');
            
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('should allow normal headers', async () => {
            const response = await request(app)
                .get('/test')
                .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
            
            expect(response.status).toBe(200);
        });
    });
});
