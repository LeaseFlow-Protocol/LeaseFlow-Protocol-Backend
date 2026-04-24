/**
 * JSON schemas for real-time WebSocket lease event emissions
 * Ensures type safety and data consistency across all socket communications
 */

/**
 * Base schema for all lease events
 */
const BaseLeaseEventSchema = {
  type: 'object',
  required: ['eventType', 'timestamp', 'leaseId', 'transactionHash'],
  properties: {
    eventType: {
      type: 'string',
      enum: [
        'SecurityDepositLocked',
        'LeaseRenewed',
        'LeaseTerminated',
        'LeaseCreated',
        'LeaseCancelled',
        'RentPaymentReceived',
        'RentPaymentLate',
        'LeaseExpired',
        'SecurityDepositRefunded',
        'LeaseModified'
      ]
    },
    timestamp: {
      type: 'string',
      format: 'date-time'
    },
    leaseId: {
      type: 'string',
      pattern: '^[a-zA-Z0-9_-]+$'
    },
    transactionHash: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{64}$'
    },
    network: {
      type: 'string',
      enum: ['testnet', 'public']
    },
    metadata: {
      type: 'object',
      additionalProperties: true
    }
  }
};

/**
 * Schema for SecurityDepositLocked event
 */
const SecurityDepositLockedSchema = {
  ...BaseLeaseEventSchema,
  allOf: [
    {
      type: 'object',
      properties: {
        eventType: { const: 'SecurityDepositLocked' },
        data: {
          type: 'object',
          required: ['lessorPubkey', 'lesseePubkey', 'depositAmount', 'depositAsset'],
          properties: {
            lessorPubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            lesseePubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            depositAmount: {
              type: 'string',
              pattern: '^[0-9]+(\\.[0-9]+)?$'
            },
            depositAsset: {
              type: 'string',
              pattern: '^[A-Z0-9]{3,12}$'
            },
            lockTimestamp: {
              type: 'string',
              format: 'date-time'
            },
            escrowContract: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            }
          }
        }
      }
    }
  ]
};

/**
 * Schema for LeaseRenewed event
 */
const LeaseRenewedSchema = {
  ...BaseLeaseEventSchema,
  allOf: [
    {
      type: 'object',
      properties: {
        eventType: { const: 'LeaseRenewed' },
        data: {
          type: 'object',
          required: ['lessorPubkey', 'lesseePubkey', 'newEndDate', 'renewalTerms'],
          properties: {
            lessorPubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            lesseePubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            newEndDate: {
              type: 'string',
              format: 'date-time'
            },
            renewalTerms: {
              type: 'object',
              properties: {
                newRentAmount: {
                  type: 'string',
                  pattern: '^[0-9]+(\\.[0-9]+)?$'
                },
                rentCurrency: {
                  type: 'string',
                  pattern: '^[A-Z0-9]{3,12}$'
                },
                renewalDuration: {
                  type: 'integer',
                  minimum: 1
                },
                renewalUnit: {
                  type: 'string',
                  enum: ['days', 'weeks', 'months', 'years']
                }
              }
            },
            renewalTimestamp: {
              type: 'string',
              format: 'date-time'
            }
          }
        }
      }
    }
  ]
};

/**
 * Schema for LeaseTerminated event
 */
const LeaseTerminatedSchema = {
  ...BaseLeaseEventSchema,
  allOf: [
    {
      type: 'object',
      properties: {
        eventType: { const: 'LeaseTerminated' },
        data: {
          type: 'object',
          required: ['lessorPubkey', 'lesseePubkey', 'terminationReason'],
          properties: {
            lessorPubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            lesseePubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            terminationReason: {
              type: 'string',
              enum: [
                'mutual_agreement',
                'breach_of_contract',
                'non_payment',
                'property_violation',
                'early_termination',
                'force_majeure',
                'other'
              ]
            },
            terminationDate: {
              type: 'string',
              format: 'date-time'
            },
            securityDepositRefunded: {
              type: 'boolean'
            },
            refundAmount: {
              type: 'string',
              pattern: '^[0-9]+(\\.[0-9]+)?$'
            },
            penalties: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['early_termination_fee', 'damage_penalty', 'other']
                  },
                  amount: {
                    type: 'string',
                    pattern: '^[0-9]+(\\.[0-9]+)?$'
                  },
                  description: {
                    type: 'string'
                  }
                }
              }
            }
          }
        }
      }
    }
  ]
};

/**
 * Schema for LeaseCreated event
 */
const LeaseCreatedSchema = {
  ...BaseLeaseEventSchema,
  allOf: [
    {
      type: 'object',
      properties: {
        eventType: { const: 'LeaseCreated' },
        data: {
          type: 'object',
          required: ['lessorPubkey', 'lesseePubkey', 'leaseTerms'],
          properties: {
            lessorPubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            lesseePubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            leaseTerms: {
              type: 'object',
              required: ['startDate', 'endDate', 'rentAmount', 'rentCurrency'],
              properties: {
                startDate: {
                  type: 'string',
                  format: 'date-time'
                },
                endDate: {
                  type: 'string',
                  format: 'date-time'
                },
                rentAmount: {
                  type: 'string',
                  pattern: '^[0-9]+(\\.[0-9]+)?$'
                },
                rentCurrency: {
                  type: 'string',
                  pattern: '^[A-Z0-9]{3,12}$'
                },
                securityDepositRequired: {
                  type: 'boolean'
                },
                securityDepositAmount: {
                  type: 'string',
                  pattern: '^[0-9]+(\\.[0-9]+)?$'
                },
                propertyDetails: {
                  type: 'object',
                  properties: {
                    propertyId: {
                      type: 'string'
                    },
                    propertyType: {
                      type: 'string',
                      enum: ['residential', 'commercial', 'industrial', 'mixed_use']
                    },
                    address: {
                      type: 'string'
                    },
                    squareFootage: {
                      type: 'integer',
                      minimum: 1
                    },
                    bedrooms: {
                      type: 'integer',
                      minimum: 0
                    },
                    bathrooms: {
                      type: 'integer',
                      minimum: 0
                    }
                  }
                }
              }
            },
            creationTimestamp: {
              type: 'string',
              format: 'date-time'
            }
          }
        }
      }
    }
  ]
};

/**
 * Schema for RentPaymentReceived event
 */
const RentPaymentReceivedSchema = {
  ...BaseLeaseEventSchema,
  allOf: [
    {
      type: 'object',
      properties: {
        eventType: { const: 'RentPaymentReceived' },
        data: {
          type: 'object',
          required: ['lessorPubkey', 'lesseePubkey', 'paymentAmount', 'paymentAsset'],
          properties: {
            lessorPubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            lesseePubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            paymentAmount: {
              type: 'string',
              pattern: '^[0-9]+(\\.[0-9]+)?$'
            },
            paymentAsset: {
              type: 'string',
              pattern: '^[A-Z0-9]{3,12}$'
            },
            paymentPeriod: {
              type: 'object',
              properties: {
                startDate: {
                  type: 'string',
                  format: 'date-time'
                },
                endDate: {
                  type: 'string',
                  format: 'date-time'
                },
                dueDate: {
                  type: 'string',
                  format: 'date-time'
                }
              }
            },
            paymentTimestamp: {
              type: 'string',
              format: 'date-time'
            },
            transactionId: {
              type: 'string',
              pattern: '^[a-fA-F0-9]{64}$'
            },
            isLatePayment: {
              type: 'boolean'
            },
            lateFees: {
              type: 'string',
              pattern: '^[0-9]+(\\.[0-9]+)?$'
            }
          }
        }
      }
    }
  ]
};

/**
 * Schema for RentPaymentLate event
 */
const RentPaymentLateSchema = {
  ...BaseLeaseEventSchema,
  allOf: [
    {
      type: 'object',
      properties: {
        eventType: { const: 'RentPaymentLate' },
        data: {
          type: 'object',
          required: ['lessorPubkey', 'lesseePubkey', 'dueDate', 'daysLate'],
          properties: {
            lessorPubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            lesseePubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            dueDate: {
              type: 'string',
              format: 'date-time'
            },
            daysLate: {
              type: 'integer',
              minimum: 1
            },
            overdueAmount: {
              type: 'string',
              pattern: '^[0-9]+(\\.[0-9]+)?$'
            },
            lateFees: {
              type: 'string',
              pattern: '^[0-9]+(\\.[0-9]+)?$'
            },
            gracePeriodExpired: {
              type: 'boolean'
            },
            notificationSent: {
              type: 'boolean'
            },
            lateTimestamp: {
              type: 'string',
              format: 'date-time'
            }
          }
        }
      }
    }
  ]
};

/**
 * Schema for SecurityDepositRefunded event
 */
const SecurityDepositRefundedSchema = {
  ...BaseLeaseEventSchema,
  allOf: [
    {
      type: 'object',
      properties: {
        eventType: { const: 'SecurityDepositRefunded' },
        data: {
          type: 'object',
          required: ['lessorPubkey', 'lesseePubkey', 'refundAmount'],
          properties: {
            lessorPubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            lesseePubkey: {
              type: 'string',
              pattern: '^G[A-Z0-9]{55}$'
            },
            refundAmount: {
              type: 'string',
              pattern: '^[0-9]+(\\.[0-9]+)?$'
            },
            refundAsset: {
              type: 'string',
              pattern: '^[A-Z0-9]{3,12}$'
            },
            refundReason: {
              type: 'string',
              enum: [
                'lease_completion',
                'early_termination',
                'mutual_agreement',
                'partial_refund',
                'full_refund'
              ]
            },
            deductions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['damage', 'unpaid_rent', 'cleaning', 'other']
                  },
                  amount: {
                    type: 'string',
                    pattern: '^[0-9]+(\\.[0-9]+)?$'
                  },
                  description: {
                    type: 'string'
                  }
                }
              }
            },
            refundTimestamp: {
              type: 'string',
              format: 'date-time'
            },
            transactionId: {
              type: 'string',
              pattern: '^[a-fA-F0-9]{64}$'
            }
          }
        }
      }
    }
  ]
};

/**
 * Schema for heartbeat ping/pong messages
 */
const HeartbeatSchema = {
  type: 'object',
  required: ['type', 'timestamp'],
  properties: {
    type: {
      type: 'string',
      enum: ['ping', 'pong']
    },
    timestamp: {
      type: 'string',
      format: 'date-time'
    },
    clientId: {
      type: 'string'
    }
  }
};

/**
 * Schema for connection acknowledgment
 */
const ConnectionAckSchema = {
  type: 'object',
  required: ['type', 'status', 'timestamp'],
  properties: {
    type: {
      type: 'string',
      const: 'connection_ack'
    },
    status: {
      type: 'string',
      enum: ['connected', 'authenticated', 'error']
    },
    message: {
      type: 'string'
    },
    timestamp: {
      type: 'string',
      format: 'date-time'
    },
    clientId: {
      type: 'string'
    },
    pubkey: {
      type: 'string',
      pattern: '^G[A-Z0-9]{55}$'
    }
  }
};

/**
 * Schema for error messages
 */
const ErrorSchema = {
  type: 'object',
  required: ['type', 'error', 'timestamp'],
  properties: {
    type: {
      type: 'string',
      const: 'error'
    },
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          enum: [
            'AUTHENTICATION_FAILED',
            'UNAUTHORIZED_ACCESS',
            'INVALID_PAYLOAD',
            'RATE_LIMIT_EXCEEDED',
            'INTERNAL_ERROR',
            'CONNECTION_TIMEOUT'
          ]
        },
        message: {
          type: 'string'
        },
        details: {
          type: 'object',
          additionalProperties: true
        }
      }
    },
    timestamp: {
      type: 'string',
      format: 'date-time'
    },
    eventId: {
      type: 'string'
    }
  }
};

/**
 * Schema validator for lease events
 */
class LeaseEventValidator {
  constructor() {
    this.schemas = {
      SecurityDepositLocked: SecurityDepositLockedSchema,
      LeaseRenewed: LeaseRenewedSchema,
      LeaseTerminated: LeaseTerminatedSchema,
      LeaseCreated: LeaseCreatedSchema,
      RentPaymentReceived: RentPaymentReceivedSchema,
      RentPaymentLate: RentPaymentLateSchema,
      SecurityDepositRefunded: SecurityDepositRefundedSchema,
      heartbeat: HeartbeatSchema,
      connection_ack: ConnectionAckSchema,
      error: ErrorSchema
    };
  }

  /**
   * Validate an event against its schema
   * @param {string} eventType - The type of event
   * @param {object} data - The event data to validate
   * @returns {object} Validation result
   */
  validate(eventType, data) {
    const schema = this.schemas[eventType];
    if (!schema) {
      return {
        valid: false,
        errors: [`Unknown event type: ${eventType}`]
      };
    }

    // Simple validation (in production, use a proper JSON schema validator)
    const errors = this.validateAgainstSchema(schema, data);
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate data against a schema (simplified implementation)
   * @param {object} schema - JSON schema
   * @param {object} data - Data to validate
   * @returns {Array} Array of error messages
   */
  validateAgainstSchema(schema, data) {
    const errors = [];
    
    // This is a simplified validation - in production, use a proper JSON schema validator like ajv
    if (schema.required) {
      for (const requiredField of schema.required) {
        if (!(requiredField in data)) {
          errors.push(`Missing required field: ${requiredField}`);
        }
      }
    }

    // Validate Stellar public key format
    if (data.lessorPubkey && !/^G[A-Z0-9]{55}$/.test(data.lessorPubkey)) {
      errors.push('Invalid lessor public key format');
    }

    if (data.lesseePubkey && !/^G[A-Z0-9]{55}$/.test(data.lesseePubkey)) {
      errors.push('Invalid lessee public key format');
    }

    // Validate transaction hash format
    if (data.transactionHash && !/^[a-fA-F0-9]{64}$/.test(data.transactionHash)) {
      errors.push('Invalid transaction hash format');
    }

    // Validate timestamp format
    if (data.timestamp && !this.isValidDateTime(data.timestamp)) {
      errors.push('Invalid timestamp format');
    }

    return errors;
  }

  /**
   * Check if a string is a valid ISO datetime
   * @param {string} dateTime - Date string to validate
   * @returns {boolean} True if valid
   */
  isValidDateTime(dateTime) {
    const date = new Date(dateTime);
    return date instanceof Date && !isNaN(date);
  }

  /**
   * Get schema for an event type
   * @param {string} eventType - Event type
   * @returns {object} Schema object
   */
  getSchema(eventType) {
    return this.schemas[eventType];
  }

  /**
   * Get all available event types
   * @returns {Array} Array of event type names
   */
  getEventTypes() {
    return Object.keys(this.schemas);
  }
}

module.exports = {
  BaseLeaseEventSchema,
  SecurityDepositLockedSchema,
  LeaseRenewedSchema,
  LeaseTerminatedSchema,
  LeaseCreatedSchema,
  RentPaymentReceivedSchema,
  RentPaymentLateSchema,
  SecurityDepositRefundedSchema,
  HeartbeatSchema,
  ConnectionAckSchema,
  ErrorSchema,
  LeaseEventValidator
};
