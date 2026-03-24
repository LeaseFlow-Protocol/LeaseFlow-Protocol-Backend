const crypto = require('crypto');

/**
 * Minimal signed bearer token service for landlord and tenant actors.
 */
class ActorAuthService {
  /**
   * @param {{auth: {jwtSecret: string, issuer: string, audience: string}}} config Runtime config.
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Issue a signed actor token.
   *
   * @param {{actorId: string, role: 'landlord'|'tenant', expiresInSeconds?: number}} input Token payload.
   * @returns {string}
   */
  issueToken(input) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.config.auth.issuer,
      aud: this.config.auth.audience,
      sub: input.actorId,
      role: input.role,
      iat: now,
      exp: now + (input.expiresInSeconds || 3600),
    };

    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const body = encodeJson(payload);
    const signature = sign(`${header}.${body}`, this.config.auth.jwtSecret);
    return `${header}.${body}.${signature}`;
  }

  /**
   * Verify an actor token and return the normalized identity.
   *
   * @param {string} token Bearer token.
   * @returns {{id: string, role: string}}
   */
  verifyToken(token) {
    const parts = token.split('.');

    if (parts.length !== 3) {
      throw new Error('Malformed actor token');
    }

    const [header, payload, signature] = parts;
    const expectedSignature = sign(`${header}.${payload}`, this.config.auth.jwtSecret);

    if (!safeCompare(signature, expectedSignature)) {
      throw new Error('Invalid actor token signature');
    }

    const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') {
      throw new Error('Unsupported actor token');
    }

    if (
      decodedPayload.iss !== this.config.auth.issuer ||
      decodedPayload.aud !== this.config.auth.audience
    ) {
      throw new Error('Invalid actor token audience');
    }

    if (!['landlord', 'tenant'].includes(decodedPayload.role)) {
      throw new Error('Invalid actor role');
    }

    if (!decodedPayload.sub) {
      throw new Error('Actor token missing subject');
    }

    if (decodedPayload.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error('Actor token expired');
    }

    return {
      id: decodedPayload.sub,
      role: decodedPayload.role,
    };
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  ActorAuthService,
};
