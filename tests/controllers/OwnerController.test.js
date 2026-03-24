const request = require('supertest');
const app = require('../../index');

describe('OwnerController', () => {
    describe('GET /api/owners/top', () => {
        it('should return 200 and a list of top-rated owners', async () => {
            const response = await request(app).get('/api/owners/top');
            
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('success');
            expect(Array.isArray(response.body.data)).toBe(true);
            
            // Check sorting (descending)
            const owners = response.body.data;
            if (owners.length >= 2) {
                expect(owners[0].successful_rentals).toBeGreaterThanOrEqual(owners[1].successful_rentals);
            }

            // Check specific mock data from OwnerService (Alice should be top with 3)
            const alice = owners.find(o => o.name === 'Alice Estate');
            expect(alice).toBeDefined();
            expect(alice.successful_rentals).toBe(3);
        });

        it('should respect the limit query parameter', async () => {
            const response = await request(app).get('/api/owners/top?limit=2');
            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeLessThanOrEqual(2);
        });
    });
});
