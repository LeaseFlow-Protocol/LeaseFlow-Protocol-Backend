const request = require('supertest');
const app = require('../index');

describe('Lease Badge Minting API', () => {
  it('POST /badges/mint mints badge for eligible lease', async () => {
    const res = await request(app)
      .post('/badges/mint')
      .set('Authorization', 'Bearer tenantToken')
      .send({ leaseId: 'lease-123' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('assetCode');
  });

  it('GET /badges lists tenant badges', async () => {
    const res = await request(app)
      .get('/badges')
      .set('Authorization', 'Bearer tenantToken');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
