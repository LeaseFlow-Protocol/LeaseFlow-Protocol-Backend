const request = require('supertest');
const app = require('../index');
const axios = require('axios');
const { Horizon } = require('@stellar/stellar-sdk');

// Mock axios
jest.mock('axios');

// Mock Horizon server
jest.mock('@stellar/stellar-sdk', () => {
  const originalModule = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...originalModule,
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        strictReceivePaths: jest.fn().mockReturnValue({
          call: jest.fn().mockResolvedValue({
            records: [
              {
                source_amount: '10.5',
                path: [],
              },
            ],
          }),
        }),
      })),
    },
  };
});

describe('Price Feed API', () => {
  describe('GET /api/price-feed', () => {
    it('should return USDC to Fiat rates', async () => {
      const mockRates = {
        'usd-coin': {
          ngn: 1500,
          eur: 0.92,
          usd: 1,
        },
      };
      axios.get.mockResolvedValue({ data: mockRates });

      const response = await request(app).get('/api/price-feed?currencies=ngn,eur,usd');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.rates).toEqual(mockRates['usd-coin']);
      expect(response.body.base_currency).toBe('USDC');
    });

    it('should handle errors when fetching rates', async () => {
      axios.get.mockRejectedValue(new Error('API Error'));

      const response = await request(app).get('/api/price-feed');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Failed to fetch fiat exchange rates.');
    });
  });

  describe('GET /api/calculate-path-payment', () => {
    it('should return path details for XLM to USDC', async () => {
      const response = await request(app).get('/api/calculate-path-payment?amount=100');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.sourceAsset).toBe('XLM');
      expect(response.body.sourceAmount).toBe('10.5');
      expect(response.body.destinationAsset).toBe('USDC');
      expect(response.body.destinationAmount).toBe('100');
    });

    it('should return 400 if amount is missing', async () => {
      const response = await request(app).get('/api/calculate-path-payment');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Destination amount is required.');
    });
  });
});
