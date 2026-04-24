const STELLAR_DECIMALS = 7;
const DECIMAL_AMOUNT_PATTERN = /^\d+(?:\.\d{1,7})?$/;

class SecurityDepositError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'SecurityDepositError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function invalidAmountError(fieldName) {
  return new SecurityDepositError(
    400,
    `INVALID_${fieldName.toUpperCase()}`,
    `${fieldName} must be a non-negative amount with up to ${STELLAR_DECIMALS} decimal places.`,
  );
}

function parseAmountToUnits(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new SecurityDepositError(
      400,
      `MISSING_${fieldName.toUpperCase()}`,
      `${fieldName} is required.`,
    );
  }

  const normalized = String(value).trim();
  if (!DECIMAL_AMOUNT_PATTERN.test(normalized)) {
    throw invalidAmountError(fieldName);
  }

  const [wholePart, fractionalPart = ''] = normalized.split('.');
  return BigInt(`${wholePart}${fractionalPart.padEnd(STELLAR_DECIMALS, '0')}`);
}

function formatUnits(units) {
  const negative = units < 0n;
  const absoluteUnits = negative ? -units : units;
  const raw = absoluteUnits
    .toString()
    .padStart(STELLAR_DECIMALS + 1, '0');
  const wholePart = raw.slice(0, -STELLAR_DECIMALS);
  const fractionalPart = raw
    .slice(-STELLAR_DECIMALS)
    .replace(/0+$/, '');

  return `${negative ? '-' : ''}${wholePart}${fractionalPart ? `.${fractionalPart}` : ''}`;
}

function evaluateSecurityDepositLock({ depositAmount, escrowBalance }) {
  const depositUnits = parseAmountToUnits(depositAmount, 'deposit_amount');
  const escrowUnits = parseAmountToUnits(escrowBalance, 'escrow_balance');
  const missingUnits = depositUnits > escrowUnits ? depositUnits - escrowUnits : 0n;

  return {
    allowed: missingUnits === 0n,
    deposit_amount: formatUnits(depositUnits),
    escrow_balance: formatUnits(escrowUnits),
    missing_amount: formatUnits(missingUnits),
  };
}

async function fetchEscrowBalanceFromSoroban({
  leaseId,
  escrowContractId,
  action,
  balanceUrl = process.env.LEASEFLOW_ESCROW_BALANCE_URL,
  defaultContractId = process.env.LEASEFLOW_ESCROW_CONTRACT_ID,
  fetchImpl = global.fetch,
} = {}) {
  if (!balanceUrl) {
    throw new SecurityDepositError(
      503,
      'ESCROW_BALANCE_PROVIDER_NOT_CONFIGURED',
      'Escrow balance provider is not configured.',
    );
  }

  if (typeof fetchImpl !== 'function') {
    throw new SecurityDepositError(
      503,
      'ESCROW_BALANCE_PROVIDER_UNAVAILABLE',
      'Global fetch is not available to query the Soroban escrow balance provider.',
    );
  }

  const url = new URL(balanceUrl);
  if (leaseId !== undefined && leaseId !== null && leaseId !== '') {
    url.searchParams.set('lease_id', String(leaseId));
  }

  const resolvedContractId = escrowContractId || defaultContractId;
  if (resolvedContractId) {
    url.searchParams.set('escrow_contract_id', String(resolvedContractId));
  }

  if (action) {
    url.searchParams.set('action', action);
  }

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new SecurityDepositError(
      503,
      'ESCROW_BALANCE_PROVIDER_UNAVAILABLE',
      'Unable to reach the Soroban escrow balance provider.',
      { reason: error instanceof Error ? error.message : 'Unknown error' },
    );
  }

  if (!response.ok) {
    throw new SecurityDepositError(
      503,
      'ESCROW_BALANCE_PROVIDER_UNAVAILABLE',
      'The Soroban escrow balance provider returned an error.',
      { status: response.status },
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (_error) {
    throw new SecurityDepositError(
      503,
      'ESCROW_BALANCE_PROVIDER_INVALID_RESPONSE',
      'The Soroban escrow balance provider returned invalid JSON.',
    );
  }

  const balance =
    payload.escrow_balance ??
    payload.balance ??
    payload.amount ??
    payload.available_balance;

  if (balance === undefined || balance === null || String(balance).trim() === '') {
    throw new SecurityDepositError(
      503,
      'ESCROW_BALANCE_PROVIDER_INVALID_RESPONSE',
      'The Soroban escrow balance provider did not return an escrow balance.',
    );
  }

  return String(balance).trim();
}

function createSecurityDepositLockService({
  getEscrowBalance = fetchEscrowBalanceFromSoroban,
} = {}) {
  return {
    async verify({ action, leaseId, depositAmount, escrowContractId } = {}) {
      parseAmountToUnits(depositAmount, 'deposit_amount');

      const escrowBalance = await getEscrowBalance({
        action,
        leaseId,
        escrowContractId,
      });

      const evaluation = evaluateSecurityDepositLock({
        depositAmount,
        escrowBalance,
      });

      if (!evaluation.allowed) {
        throw new SecurityDepositError(
          412,
          'SECURITY_DEPOSIT_NOT_LOCKED',
          `${action} is blocked until the full security deposit is locked in Soroban escrow.`,
          {
            lease_id: leaseId ?? null,
            escrow_contract_id: escrowContractId ?? null,
            ...evaluation,
          },
        );
      }

      return {
        action,
        lease_id: leaseId ?? null,
        escrow_contract_id: escrowContractId ?? null,
        ...evaluation,
      };
    },
  };
}

function requireLockedSecurityDeposit({ action, service }) {
  return async (req, res, next) => {
    try {
      const verification = await service.verify({
        action,
        leaseId: req.body?.lease_id,
        depositAmount: req.body?.deposit_amount,
        escrowContractId: req.body?.escrow_contract_id,
      });

      req.securityDepositVerification = verification;
      next();
    } catch (error) {
      if (error instanceof SecurityDepositError) {
        return res.status(error.statusCode).json({
          error: error.code,
          message: error.message,
          details: error.details,
        });
      }

      return res.status(500).json({
        error: 'SECURITY_DEPOSIT_VERIFICATION_FAILED',
        message: 'Unable to verify the security deposit lock.',
        details: { action },
      });
    }
  };
}

module.exports = {
  SecurityDepositError,
  createSecurityDepositLockService,
  evaluateSecurityDepositLock,
  fetchEscrowBalanceFromSoroban,
  requireLockedSecurityDeposit,
};
