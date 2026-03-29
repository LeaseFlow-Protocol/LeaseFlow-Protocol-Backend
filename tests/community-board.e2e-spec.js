const request = require('supertest');
const app = require('../index');

describe('Community Message Board API', () => {
  it('POST /community/message allows tenant to post', async () => {
    const res = await request(app)
      .post('/community/message')
      .set('Authorization', 'Bearer tenantToken')
      .send({ buildingId: 'building-123', content: 'Elevator is broken' });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe('Elevator is broken');
  });

  it('GET /community/messages returns building feed', async () => {
    const res = await request(app)
      .get('/community/messages')
      .set('Authorization', 'Bearer tenantToken');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
