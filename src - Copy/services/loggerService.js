const winston = require('winston');
const { loadConfig } = require('../config');

// Initialize config
const config = loadConfig();
const CONTRACT_ID = config.contracts.defaultContractId;

/**
 * Custom filter to only allow logs matching our specific LeaseFlow contract
 */
const leaseFlowFilter = winston.format((info) => {
  if (info.contractAddress && info.contractAddress !== CONTRACT_ID) {
    return false; 
  }
  return info;
});

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    leaseFlowFilter(), // Apply the filter based on config
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'logs/lease-events.log' })
  ]
});

module.exports = logger;