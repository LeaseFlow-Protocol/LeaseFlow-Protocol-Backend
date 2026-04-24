const request = require('supertest');
const app = require('../index');

describe('LeaseFlow Listings API', () => {
  beforeEach(() => {
    // Mock fetch for Discord webhook
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    );
    process.env.DISCORD_WEBHOOK_URL = 'http://mock-webhook.com';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create a listing and NOT notify Discord if price is below threshold', async () => {
    const response = await request(app)
      .post('/listings')
      .send({
        title: 'Bored Ape #1234',
        price: 5,
        currency: 'XLM'
      });

    expect(response.status).toBe(201);
    expect(response.body.message).toBe('Listing created successfully');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should create a listing and NOT notify Discord if currency is not XLM', async () => {
    const response = await request(app)
      .post('/listings')
      .send({
        title: 'Bored Ape #1234',
        price: 20,
        currency: 'ETH'
      });

    expect(response.status).toBe(201);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should create a listing and notify Discord if price is high-value (>=10 XLM)', async () => {
    const response = await request(app)
      .post('/listings')
      .send({
        title: 'Bored Ape #1234',
        price: 10,
        currency: 'XLM'
      });

    expect(response.status).toBe(201);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://mock-webhook.com',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('🚀 New Listing: **Bored Ape #1234** - **10 XLM/hr**')
      })
    );
  });
});
