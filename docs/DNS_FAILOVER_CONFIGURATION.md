# DNS-Level Failover Configuration for LeaseFlow Protocol

## Overview
This document describes the "Warm Standby" failover infrastructure for LeaseFlow Protocol, ensuring continuous rent payment processing even if the primary AWS infrastructure goes down.

## Architecture

### Primary Infrastructure (AWS)
- **Region**: us-east-1
- **Load Balancer**: Application Load Balancer (ALB)
- **EC2 Instances**: Auto-scaling group (min: 2, max: 10)
- **Database**: Amazon RDS for PostgreSQL
- **Health Check Endpoint**: `GET /health`

### Secondary Infrastructure (DigitalOcean/GCP)
- **Provider**: DigitalOcean or Google Cloud Platform
- **Droplets/VMs**: Minimum 2 instances in different availability zones
- **Database**: Managed PostgreSQL with read replica
- **Warm Standby**: Application deployed but minimal resources until failover

### DNS Failover (Cloudflare)
- **Service**: Cloudflare Load Balancing
- **Health Check Interval**: 60 seconds
- **Failover Threshold**: 3 consecutive failures
- **TTL**: 60 seconds (for fast failover)

## Cloudflare Configuration

### 1. Create Health Checks

#### Primary Health Check (AWS)
```json
{
  "name": "leaseflow-primary-health",
  "description": "Health check for primary AWS infrastructure",
  "expected_codes": "200",
  "method": "GET",
  "timeout": 5,
  "retries": 3,
  "interval": 60,
  "path": "/health",
  "port": 443,
  "host": "api.leaseflow.io",
  "region": "us-east-1",
  "check_regions": ["us-east", "us-west", "eu-west"]
}
```

#### Secondary Health Check (DigitalOcean/GCP)
```json
{
  "name": "leaseflow-secondary-health",
  "description": "Health check for secondary infrastructure",
  "expected_codes": "200",
  "method": "GET",
  "timeout": 5,
  "retries": 3,
  "interval": 60,
  "path": "/health",
  "port": 443,
  "host": "backup-api.leaseflow.io",
  "region": "us-central",
  "check_regions": ["us-east", "us-west"]
}
```

### 2. Create Pools

#### Primary Pool (AWS)
```json
{
  "name": "leaseflow-primary-pool",
  "description": "Primary AWS infrastructure pool",
  "enabled": true,
  "minimum_origins": 1,
  "healthcheck": "leaseflow-primary-health",
  "origins": [
    {
      "name": "aws-alb-primary",
      "address": "primary-alb-123456789.us-east-1.elb.amazonaws.com",
      "enabled": true,
      "weight": 1
    }
  ]
}
```

#### Secondary Pool (DigitalOcean/GCP)
```json
{
  "name": "leaseflow-secondary-pool",
  "description": "Secondary backup pool",
  "enabled": true,
  "minimum_origins": 1,
  "healthcheck": "leaseflow-secondary-health",
  "origins": [
    {
      "name": "do-backup-1",
      "address": "backup-1.leaseflow.io",
      "enabled": true,
      "weight": 1
    },
    {
      "name": "do-backup-2",
      "address": "backup-2.leaseflow.io",
      "enabled": true,
      "weight": 1
    }
  ]
}
```

### 3. Create Load Balancer with Failover

```json
{
  "name": "leaseflow-api-lb",
  "description": "DNS-level load balancer with automatic failover",
  "enabled": true,
  "fallback_pool": "leaseflow-secondary-pool",
  "default_pools": ["leaseflow-primary-pool"],
  "steering_policy": "geo",
  "ttl": 60,
  "session_affinity": "cookie",
  "session_affinity_ttl": 3600
}
```

## Implementation Steps

### Step 1: Deploy Warm Standby Infrastructure

#### DigitalOcean Deployment
```bash
# Create backup droplet
doctl compute droplet create leaseflow-backup \
  --size s-2vcpu-4gb \
  --region nyc3 \
  --image ubuntu-22-04-x64 \
  --enable-monitoring \
  --tag-names leaseflow,backup

# Install Docker and dependencies
ssh root@leaseflow-backup << 'EOF'
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
systemctl enable docker
systemctl start docker
EOF
```

#### Google Cloud Deployment
```bash
# Create backup instance
gcloud compute instances create leaseflow-backup \
  --machine-type=e2-medium \
  --zone=us-central1-a \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=http-server,https-server \
  --metadata=startup-script='sudo apt update && sudo apt install -y docker.io'
```

### Step 2: Configure Database Replication

#### Primary Database (AWS RDS)
```sql
-- Enable logical replication
ALTER SYSTEM SET wal_level = logical;
ALTER SYSTEM SET max_replication_slots = 10;
ALTER SYSTEM SET max_wal_senders = 10;

-- Create replication user
CREATE ROLE replication_user WITH REPLICATION LOGIN PASSWORD 'secure_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO replication_user;
```

#### Secondary Database (DigitalOcean/GCP)
```sql
-- Create subscription to primary
CREATE SUBSCRIPTION leaseflow_subscription
CONNECTION 'host=primary-rds.amazonaws.com dbname=leaseflow_db user=replication_user password=secure_password'
PUBLICATION leaseflow_publication
WITH (copy_data = true);
```

### Step 3: Set Up Cloudflare Load Balancing

```bash
# Using Cloudflare API
CLOUDFLARE_API_TOKEN="your_api_token"
ZONE_ID="your_zone_id"

# Create health checks
curl -X POST "https://api.cloudflare.com/v4/zones/${ZONE_ID}/load_balancers/healthchecks" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @primary-health-check.json

curl -X POST "https://api.cloudflare.com/v4/zones/${ZONE_ID}/load_balancers/healthchecks" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @secondary-health-check.json

# Create pools
curl -X POST "https://api.cloudflare.com/v4/zones/${ZONE_ID}/load_balancers/pools" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @primary-pool.json

curl -X POST "https://api.cloudflare.com/v4/zones/${ZONE_ID}/load_balancers/pools" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @secondary-pool.json

# Create load balancer
curl -X POST "https://api.cloudflare.com/v4/zones/${ZONE_ID}/load_balancers" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @load-balancer.json
```

### Step 4: Health Check Endpoint Implementation

Add this endpoint to your Express app (already implemented in index.js):

```javascript
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
  };

  // Check database connectivity
  try {
    req.locals.database.db.prepare('SELECT 1').get();
    health.database = 'connected';
  } catch (error) {
    health.database = 'disconnected';
    health.status = 'degraded';
  }

  // Check critical services
  if (process.env.SENTRY_DSN) {
    health.monitoring = 'enabled';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

## Monitoring and Alerts

### Cloudflare Analytics Dashboard
Monitor these metrics in Cloudflare Dashboard:
- **Health Check Status**: Real-time status of primary and secondary pools
- **DNS Query Volume**: Traffic distribution between pools
- **Failover Events**: Number of automatic failovers triggered
- **Response Time**: Latency from different regions

### Alert Configuration
Set up alerts for:
1. **Primary Pool Degraded**: Email + Slack notification
2. **Failover Triggered**: SMS + PagerDuty escalation
3. **Both Pools Down**: Critical alert - immediate response required

### Cloudflare LogPush
Enable LogPush to send DNS query logs to your SIEM:

```json
{
  "name": "leaseflow-dns-logs",
  "enabled": true,
  "logpull_options": "fields=ClientIP,QueryType,QueryName,DNSResponseCode,DNSAnswerData&timestamps=rfc3339",
  "destination_conf": "s3://your-bucket/cloudflare/logs/{DATE}",
  "frequency": "high"
}
```

## Testing Failover

### Manual Failover Test
```bash
# Simulate primary failure by disabling primary pool
curl -X PUT "https://api.cloudflare.com/v4/zones/${ZONE_ID}/load_balancers/pools/${PRIMARY_POOL_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"enabled": false}'

# Verify DNS resolution now points to secondary
dig api.leaseflow.io +short
# Should return secondary IP addresses

# Re-enable primary after testing
curl -X PUT "https://api.cloudflare.com/v4/zones/${ZONE_ID}/load_balancers/pools/${PRIMARY_POOL_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"enabled": true}'
```

### Automated Failover Testing
Run monthly automated tests:
1. Schedule maintenance window
2. Disable primary pool
3. Verify all endpoints work on secondary
4. Verify database writes replicate correctly
5. Re-enable primary pool
6. Document any issues

## Cost Estimation

### Cloudflare Load Balancing
- **Load Balancer**: $5/month per pool
- **Health Checks**: $0.01 per 10,000 queries
- **Estimated Monthly**: ~$15-20

### Secondary Infrastructure (Warm Standby)
- **DigitalOcean**: 2x Droplets (2 vCPU, 4GB RAM) = $48/month
- **Managed PostgreSQL**: $30/month
- **Total**: ~$78/month

### Total Monthly Cost
- **Cloudflare**: $20
- **Backup Infrastructure**: $78
- **Total**: ~$98/month

## Disaster Recovery Runbook

### Scenario: AWS Outage
1. **Detection**: Cloudflare health checks fail (60s interval)
2. **Automatic Failover**: DNS redirects to secondary after 3 failures (~3 min)
3. **Scale Up**: Manually scale up secondary infrastructure if needed
4. **Monitor**: Watch for database replication lag
5. **Communication**: Notify users of degraded performance
6. **Resolution**: Restore primary, verify sync, fail back during maintenance window

### Scenario: Database Corruption
1. **Stop Replication**: Prevent corruption spread to secondary
2. **Assess**: Determine corruption scope
3. **Restore**: Use latest clean backup
4. **Resume Replication**: Re-establish from primary to secondary
5. **Audit**: Review audit logs for unauthorized changes

## Compliance Notes

This failover configuration supports:
- **SOC 2 Type II**: High availability requirements
- **GDPR**: Data residency controls via geo-steering
- **PCI DSS**: Secure payment processing continuity
- **Financial Audits**: Complete audit trail maintained across failover

## Support Contacts

- **Cloudflare Support**: support.cloudflare.com
- **DigitalOcean Support**: support.digitalocean.com
- **Google Cloud Support**: cloud.google.com/support
- **Internal DevOps**: devops@leaseflow.io
