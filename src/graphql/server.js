const { ApolloServer } = require('apollo-server-express');
const { ApolloServerPluginLandingPageLocalDefault } = require('apollo-server-core');
const { createServer } = require('http');
const { SubscriptionServer } = require('subscriptions-transport-ws');
const { execute, subscribe } = require('graphql');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { resolvers } = require('./resolvers');
const { createGraphQLContext } = require('./context');
const { DataLoaderFactory } = require('./dataloaders');
const { SubscriptionManager, createSubscriptionPublishers } = require('./subscriptions');
const {
  ActorsDataSource,
  AssetsDataSource,
  LeasesDataSource,
  ConditionReportsDataSource,
  RenewalProposalsDataSource,
  PaymentsDataSource,
  YieldDataSource,
  MaintenanceDataSource,
  VendorsDataSource,
  UtilitiesDataSource,
  IoTDataSource,
  AuditDataSource
} = require('./dataSources');

// Import schema
const fs = require('fs');
const path = require('path');
const typeDefs = fs.readFileSync(path.join(__dirname, 'schema.graphql'), 'utf8');

/**
 * Create and configure Apollo GraphQL Server
 * @param {Object} app - Express app instance
 * @param {Object} dependencies - Application dependencies
 * @returns {Object} Apollo server instance
 */
function createApolloServer(app, dependencies) {
  const { database, redisService, config, rlsService } = dependencies;

  // Create executable schema
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  // Create data sources
  const dataSources = {
    actors: new ActorsDataSource(database, rlsService),
    assets: new AssetsDataSource(database, rlsService),
    leases: new LeasesDataSource(database, rlsService),
    conditionReports: new ConditionReportsDataSource(database, rlsService),
    renewalProposals: new RenewalProposalsDataSource(database, rlsService),
    payments: new PaymentsDataSource(database),
    yield: new YieldDataSource(database),
    maintenance: new MaintenanceDataSource(database),
    vendors: new VendorsDataSource(database),
    utilities: new UtilitiesDataSource(database),
    iot: new IoTDataSource(database),
    audit: new AuditDataSource(database),
  };

  // Create Redis pub/sub for subscriptions
  const pubSub = createRedisPubSub(redisService);

  // Create Subscription Manager for real-time events
  const subscriptionManager = new SubscriptionManager(redisService, database);
  
  // Create DataLoader factory
  const dataLoaderFactory = new DataLoaderFactory(database, rlsService);

  // Create Apollo Server
  const server = new ApolloServer({
    schema,
    context: ({ req, connection }) => {
      // Handle WebSocket connections for subscriptions
      if (connection) {
        return {
          ...connection.context,
          dataSources,
          pubSub,
          subscriptionManager,
        };
      }
      
      // Handle HTTP requests
      const dataLoaders = dataLoaderFactory.createLoaders();
      return createGraphQLContext(req, dataSources, pubSub, dataLoaders);
    },
    dataSources: () => dataSources,
    plugins: [
      // Enable GraphQL Playground in development
      process.env.NODE_ENV === 'development' && 
      ApolloServerPluginLandingPageLocalDefault({
        embed: {
          endpointIsEditable: true,
        },
      }),
      // Custom plugin for logging and monitoring
      {
        requestDidStart() {
          return {
            didResolveOperation(requestContext) {
              // Log operation for audit
              const { operation, variables } = requestContext.request;
              if (requestContext.context.user) {
                requestContext.context.logOperation(operation.name?.value || 'anonymous', variables);
              }
            },
            didEncounterErrors(requestContext) {
              // Log GraphQL errors
              console.error('[GraphQL] Operation errors:', {
                operation: requestContext.request.operationName,
                errors: requestContext.errors,
                user: requestContext.context.user?.id,
              });
            },
          };
        },
      },
    ],
    // Security configurations
    introspection: process.env.NODE_ENV === 'development',
    csrfPrevention: true,
    cache: 'bounded',
  });

  return { server, subscriptionManager, publishers: createSubscriptionPublishers(subscriptionManager) };
}

/**
 * Create Redis pub/sub for GraphQL subscriptions
 * @param {Object} redisService - Redis service instance
 * @returns {Object} PubSub interface
 */
function createRedisPubSub(redisService) {
  return {
    async publish(triggerName, payload) {
      try {
        const redis = await redisService.getWorkingClient();
        await redis.publish(triggerName, JSON.stringify(payload));
      } catch (error) {
        console.error('[GraphQL] PubSub publish error:', error);
      }
    },

    async subscribe(triggerName) {
      // This would be implemented with proper Redis subscription handling
      // For now, return an async iterator placeholder
      const asyncIterator = {
        async next() {
          // Implementation would listen to Redis channels
          return { value: null, done: true };
        },
        async return() {
          // Cleanup
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
      return asyncIterator;
    },

    asyncIterator(triggers) {
      // Handle multiple triggers
      return this.subscribe(triggers);
    },
  };
}

/**
 * Setup GraphQL subscriptions with WebSocket
 * @param {Object} server - HTTP server instance
 * @param {Object} apolloServer - Apollo server instance
 */
function setupGraphQLSubscriptions(server, apolloServer) {
  // Create subscription server
  const subscriptionServer = SubscriptionServer.create(
    {
      schema: apolloServer.schema,
      execute,
      subscribe,
      onConnect: (connectionParams, webSocket, context) => {
        // Handle WebSocket connection authentication
        // This would validate JWT tokens from connectionParams
        console.log('[GraphQL] Subscription connected');
        return { user: null }; // Would be populated with authenticated user
      },
      onDisconnect: (webSocket, context) => {
        console.log('[GraphQL] Subscription disconnected');
      },
    },
    {
      server,
      path: '/graphql',
    }
  );

  return subscriptionServer;
}

/**
 * Initialize GraphQL in the Express application
 * @param {Object} app - Express app instance
 * @param {Object} dependencies - Application dependencies
 * @returns {Promise<Object>} Apollo server and subscription server
 */
async function initializeGraphQL(app, dependencies) {
  // Create Apollo Server
  const apolloServer = createApolloServer(app, dependencies);
  
  // Start Apollo Server
  await apolloServer.start();
  
  // Apply middleware
  apolloServer.applyMiddleware({
    app,
    path: '/graphql',
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourdomain.com'] // Production origins
        : true, // Allow all origins in development
      credentials: true,
    },
  });

  // Setup subscriptions if WebSocket is enabled
  let subscriptionServer = null;
  if (dependencies.config.websocket?.enabled !== false) {
    const httpServer = require('http').createServer(app);
    subscriptionServer = setupGraphQLSubscriptions(httpServer, apolloServer);
  }

  console.log('[GraphQL] Server initialized at /graphql');
  
  return {
    apolloServer,
    subscriptionServer,
  };
}

module.exports = {
  createApolloServer,
  initializeGraphQL,
  setupGraphQLSubscriptions,
  createRedisPubSub,
};
