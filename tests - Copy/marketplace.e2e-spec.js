const request = require('supertest');
const app = require('../index');

describe('Tenant Benefit Marketplace API', () => {
  it('GET /marketplace/deals returns deals for high-score tenant', async () => {
    const res = await request(app)
      .get('/marketplace/deals')
      .set('Authorization', 'Bearer highScoreTenantToken');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /marketplace/deals/:id returns deal if tenant qualifies', async () => {
    const res = await request(app)
      .get('/marketplace/deals/deal-123')
      .set('Authorization', 'Bearer highScoreTenantToken');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'deal-123');
  });

  it('GET /marketplace/deals/:id denies low-score tenant', async () => {
    const res = await request(app)
      .get('/marketplace/deals/deal-123')
      .set('Authorization', 'Bearer lowScoreTenantToken');
    expect(res.status).toBe(403);
  });
});
