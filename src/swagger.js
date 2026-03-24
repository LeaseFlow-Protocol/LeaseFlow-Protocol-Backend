const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'LeaseFlow Protocol API',
      version: '1.0.0',
      description: 'API documentation for the LeaseFlow Protocol Backend service.',
      contact: {
        name: 'LeaseFlow Support',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
  },
  // Path to the API docs
  apis: [
    path.join(__dirname, 'routes', '*.js'),
    path.join(__dirname, '..', 'index.js') // In case there are annotations in index.js
  ],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
