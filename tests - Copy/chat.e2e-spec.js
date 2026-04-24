const request = require('supertest');
const app = require('../index');

describe('Direct-to-Landlord Chat API', () => {
  it('POST /chat/message archives and hashes message', async () => {
    const res = await request(app)
      .post('/chat/message')
      .set('Authorization', 'Bearer tenantToken')
      .send({ receiverId: 'landlord-123', content: 'Hello landlord' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('hash');
  });

  it('GET /chat/messages/:id returns full conversation', async () => {
    const res = await request(app)
      .get('/chat/messages/landlord-123')
      .set('Authorization', 'Bearer tenantToken');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
