const request = require('supertest');
const { createApp } = require('../index');
const { createConditionProofService } = require('../services/conditionProofService');

function createMemoryStore() {
  const proofs = [];

  return {
    async save(record) {
      proofs.push(record);
      return record;
    },
    async listByLeaseId(leaseId) {
      return proofs
        .filter((item) => item.lease_id === leaseId)
        .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
    },
  };
}

describe('Immutable proof of condition API', () => {
  function buildApp() {
    return createApp({
      conditionProofService: createConditionProofService({
        store: createMemoryStore(),
      }),
    });
  }

  it('records timestamped photos and note hashes within the first 24 hours', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/leases/LEASE-001/condition-proofs')
      .send({
        move_in_started_at: '2026-03-23T08:00:00.000Z',
        submitted_at: '2026-03-23T12:30:00.000Z',
        note: 'Living room wall already has a visible scratch near the balcony.',
        photos: [
          {
            filename: 'living-room.jpg',
            mime_type: 'image/jpeg',
            captured_at: '2026-03-23T12:00:00.000Z',
            data_base64: Buffer.from('living-room-photo').toString('base64'),
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body.lease_id).toBe('LEASE-001');
    expect(response.body.note_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body.proof_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body.photos).toHaveLength(1);
    expect(response.body.photos[0]).toMatchObject({
      filename: 'living-room.jpg',
      mime_type: 'image/jpeg',
      captured_at: '2026-03-23T12:00:00.000Z',
    });
    expect(response.body.photos[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks proof submission outside the first 24 hours after move-in', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/leases/LEASE-002/condition-proofs')
      .send({
        move_in_started_at: '2026-03-20T08:00:00.000Z',
        submitted_at: '2026-03-21T09:00:01.000Z',
        note: 'Late upload should be rejected.',
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('CONDITION_PROOF_WINDOW_CLOSED');
  });

  it('returns the immutable proof packet for Soroban arbitration', async () => {
    const app = buildApp();

    await request(app)
      .post('/leases/LEASE-003/condition-proofs')
      .send({
        move_in_started_at: '2026-03-23T08:00:00.000Z',
        submitted_at: '2026-03-23T08:30:00.000Z',
        note: 'Kitchen countertop has a pre-existing crack.',
      })
      .expect(201);

    const response = await request(app).get(
      '/leases/LEASE-003/condition-proofs/arbitration-hook',
    );

    expect(response.status).toBe(200);
    expect(response.body.lease_id).toBe('LEASE-003');
    expect(response.body.proof_count).toBe(1);
    expect(response.body.immutable_proof_root_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body.soroban_arbitration_hook).toEqual({
      hook: 'condition-proof-arbitration',
      lease_id: 'LEASE-003',
      immutable_proof_root_hash: response.body.immutable_proof_root_hash,
    });
  });
});
