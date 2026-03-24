const crypto = require('crypto');

const DAY_IN_MS = 24 * 60 * 60 * 1000;

class ConditionProofError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'ConditionProofError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function toIsoTimestamp(value, fieldName) {
  if (!value) {
    throw new ConditionProofError(
      400,
      `MISSING_${fieldName.toUpperCase()}`,
      `${fieldName} is required.`,
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ConditionProofError(
      400,
      `INVALID_${fieldName.toUpperCase()}`,
      `${fieldName} must be a valid ISO timestamp.`,
    );
  }

  return date.toISOString();
}

function sha256(inputBuffer) {
  return crypto.createHash('sha256').update(inputBuffer).digest('hex');
}

function serializeProofForHash(proof) {
  return JSON.stringify({
    lease_id: proof.lease_id,
    move_in_started_at: proof.move_in_started_at,
    submitted_at: proof.submitted_at,
    note_hash: proof.note_hash,
    photos: proof.photos.map((photo) => ({
      captured_at: photo.captured_at,
      content_hash: photo.content_hash,
      filename: photo.filename,
      mime_type: photo.mime_type,
    })),
  });
}

function createConditionProofService({ store }) {
  if (!store) {
    throw new Error('A condition proof store is required.');
  }

  return {
    async createProof({
      leaseId,
      moveInStartedAt,
      submittedAt,
      note,
      photos,
    }) {
      if (!leaseId || !String(leaseId).trim()) {
        throw new ConditionProofError(
          400,
          'MISSING_LEASE_ID',
          'leaseId is required.',
        );
      }

      const normalizedLeaseId = String(leaseId).trim();
      const normalizedMoveInStartedAt = toIsoTimestamp(
        moveInStartedAt,
        'move_in_started_at',
      );
      const normalizedSubmittedAt = toIsoTimestamp(
        submittedAt || new Date().toISOString(),
        'submitted_at',
      );

      const moveInStart = new Date(normalizedMoveInStartedAt).getTime();
      const submitted = new Date(normalizedSubmittedAt).getTime();
      const windowExpiresAt = new Date(moveInStart + DAY_IN_MS).toISOString();

      if (submitted < moveInStart || submitted > moveInStart + DAY_IN_MS) {
        throw new ConditionProofError(
          403,
          'CONDITION_PROOF_WINDOW_CLOSED',
          'Condition proof submissions are only allowed within the first 24 hours after move-in.',
          {
            lease_id: normalizedLeaseId,
            move_in_started_at: normalizedMoveInStartedAt,
            submitted_at: normalizedSubmittedAt,
            window_expires_at: windowExpiresAt,
          },
        );
      }

      const normalizedNote = typeof note === 'string' ? note.trim() : '';
      const normalizedPhotos = Array.isArray(photos) ? photos : [];
      if (!normalizedNote && normalizedPhotos.length === 0) {
        throw new ConditionProofError(
          400,
          'EMPTY_CONDITION_PROOF',
          'At least one timestamped photo or a condition note is required.',
        );
      }

      const processedPhotos = normalizedPhotos.map((photo, index) => {
        if (!photo || typeof photo !== 'object') {
          throw new ConditionProofError(
            400,
            'INVALID_PHOTO_PAYLOAD',
            `photos[${index}] must be an object.`,
          );
        }

        const filename = String(photo.filename || '').trim();
        const mimeType = String(photo.mime_type || 'application/octet-stream').trim();
        const dataBase64 = String(photo.data_base64 || '').trim();
        const capturedAt = toIsoTimestamp(
          photo.captured_at || normalizedSubmittedAt,
          `photos[${index}].captured_at`,
        );

        if (!filename || !dataBase64) {
          throw new ConditionProofError(
            400,
            'INVALID_PHOTO_PAYLOAD',
            `photos[${index}] must include filename and data_base64.`,
          );
        }

        const capturedTime = new Date(capturedAt).getTime();
        if (capturedTime < moveInStart || capturedTime > moveInStart + DAY_IN_MS) {
          throw new ConditionProofError(
            403,
            'PHOTO_CAPTURE_OUTSIDE_ALLOWED_WINDOW',
            `photos[${index}] was captured outside the first 24 hours after move-in.`,
            {
              lease_id: normalizedLeaseId,
              captured_at: capturedAt,
              move_in_started_at: normalizedMoveInStartedAt,
              window_expires_at: windowExpiresAt,
            },
          );
        }

        let fileBuffer;
        try {
          fileBuffer = Buffer.from(dataBase64, 'base64');
        } catch (_error) {
          throw new ConditionProofError(
            400,
            'INVALID_PHOTO_ENCODING',
            `photos[${index}].data_base64 must be valid base64.`,
          );
        }

        if (!fileBuffer.length) {
          throw new ConditionProofError(
            400,
            'INVALID_PHOTO_ENCODING',
            `photos[${index}].data_base64 must decode to non-empty content.`,
          );
        }

        return {
          filename,
          mime_type: mimeType,
          captured_at: capturedAt,
          size_bytes: fileBuffer.length,
          content_hash: sha256(fileBuffer),
        };
      });

      const noteHash = normalizedNote
        ? sha256(
            Buffer.from(
              JSON.stringify({
                submitted_at: normalizedSubmittedAt,
                note: normalizedNote,
              }),
            ),
          )
        : null;

      const proof = {
        proof_id: crypto.randomUUID(),
        lease_id: normalizedLeaseId,
        move_in_started_at: normalizedMoveInStartedAt,
        submitted_at: normalizedSubmittedAt,
        window_expires_at: windowExpiresAt,
        note: normalizedNote,
        note_hash: noteHash,
        photos: processedPhotos,
      };

      proof.proof_hash = sha256(Buffer.from(serializeProofForHash(proof)));
      await store.save(proof);
      return proof;
    },

    async listProofs(leaseId) {
      if (!leaseId || !String(leaseId).trim()) {
        throw new ConditionProofError(
          400,
          'MISSING_LEASE_ID',
          'leaseId is required.',
        );
      }

      return store.listByLeaseId(String(leaseId).trim());
    },

    async getArbitrationPacket(leaseId) {
      const proofs = await this.listProofs(leaseId);
      if (proofs.length === 0) {
        throw new ConditionProofError(
          404,
          'CONDITION_PROOF_NOT_FOUND',
          'No immutable proof of condition was found for this lease.',
          { lease_id: String(leaseId).trim() },
        );
      }

      const immutableProofRootHash = sha256(
        Buffer.from(
          JSON.stringify(
            proofs.map((proof) => ({
              proof_id: proof.proof_id,
              proof_hash: proof.proof_hash,
            })),
          ),
        ),
      );

      return {
        lease_id: String(leaseId).trim(),
        proof_count: proofs.length,
        immutable_proof_root_hash: immutableProofRootHash,
        proofs,
        soroban_arbitration_hook: {
          hook: 'condition-proof-arbitration',
          lease_id: String(leaseId).trim(),
          immutable_proof_root_hash: immutableProofRootHash,
        },
      };
    },
  };
}

module.exports = {
  ConditionProofError,
  createConditionProofService,
};
