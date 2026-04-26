FROM node:18-alpine

WORKDIR /app

# Install dependencies for database migrations
RUN apk add --no-cache postgresql-client

COPY package*.json ./

RUN npm install --production

# Copy application code
COPY . .

# Copy migration SQL files to a dedicated directory
RUN mkdir -p /migrations && \
    cp -r migrations/* /migrations/ 2>/dev/null || true

# Create migration tracking table schema
COPY scripts/migration-tracker.sql /migrations/migration-tracker.sql

# Copy migration runner script
COPY scripts/run-migrations.sh /usr/local/bin/run-migrations.sh
RUN chmod +x /usr/local/bin/run-migrations.sh

EXPOSE 3000

CMD ["npm", "start"]