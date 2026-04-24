const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'LeaseFlow Protocol API',
      version: '1.0.0',
      description: 'API documentation for the LeaseFlow Protocol Backend service. Includes comprehensive API endpoints for lease management, rent payments, late fees, audit logging, and more.',
      contact: {
        name: 'LeaseFlow Support',
        url: 'https://leaseflow.io',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
      {
        url: 'https://api.leaseflow.io',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from authentication endpoint',
        },
      },
      schemas: {
        AuditLog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tableName: { type: 'string' },
            recordId: { type: 'string' },
            actionType: { type: 'string', enum: ['INSERT', 'UPDATE', 'DELETE'] },
            columnName: { type: 'string' },
            oldValue: { type: 'string', nullable: true },
            newValue: { type: 'string', nullable: true },
            adminId: { type: 'string' },
            adminEmail: { type: 'string', nullable: true },
            ipAddress: { type: 'string', nullable: true },
            userAgent: { type: 'string', nullable: true },
            changeReason: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        AuditStatistics: {
          type: 'object',
          properties: {
            totalChanges: { type: 'integer' },
            uniqueAdmins: { type: 'integer' },
            affectedTables: { type: 'integer' },
            inserts: { type: 'integer' },
            updates: { type: 'integer' },
            deletes: { type: 'integer' },
            period: {
              type: 'object',
              properties: {
                startDate: { type: 'string', format: 'date-time' },
                endDate: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
  },
  // Path to the API docs
  apis: [
    path.join(__dirname, 'routes', '*.js'),
    path.join(__dirname, '..', 'index.js') // In case there are annotations in index.js
  ],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
