# Game Day Simulation Exercise Guide

## Overview

This document provides a comprehensive guide for conducting Game Day simulation exercises to test the multi-region Disaster Recovery (DR) architecture for LeaseFlow Protocol.

**Purpose:** Validate the DR architecture by simulating a complete region failure and measuring actual Recovery Time Objective (RTO) and Recovery Point Objective (RPO).

**Frequency:** Quarterly (January, April, July, October)
**Duration:** 4 hours
**Participants:** DevOps, DBA, Engineering, SRE teams

## Exercise Objectives

### Primary Objectives
1. Measure actual RTO (time to restore service after outage)
2. Measure actual RPO (maximum data loss)
3. Validate failover procedures
4. Identify gaps in documentation
5. Train team members on DR procedures

### Secondary Objectives
1. Test monitoring and alerting
2. Validate communication channels
3. Document lessons learned
4. Update runbooks based on findings
5. Calculate actual costs during failover

## Pre-Exercise Checklist

### 1. Planning (2 Weeks Before)
- [ ] Schedule exercise date and time
- [ ] Notify all stakeholders
- [ ] Review and update runbooks
- [ ] Prepare test data
- [ ] Set up monitoring dashboards
- [ ] Configure alert channels
- [ ] Prepare rollback plan
- [ ] Document success criteria

### 2. Communication (1 Week Before)
- [ ] Send calendar invites to all participants
- [ ] Create dedicated Slack channel (#gameday-dr)
- [ ] Notify customers about potential impact
- [ ] Update status page with maintenance notice
- [ ] Prepare incident response team

### 3. Preparation (1 Day Before)
- [ ] Verify all systems are healthy
- [ ] Take database snapshots
- [ ] Document current system state
- [ ] Prepare test scripts
- [ ] Set up recording/logging
- [ ] Verify backup connectivity

## Exercise Scenarios

### Scenario 1: Primary Region Total Failure (Primary)

**Description:** Simulate complete failure of us-east-1 region including database, application, and network.

**Trigger:** Manually stop primary database and scale down EKS cluster to 0 nodes.

**Expected RTO:** 6 minutes
**Expected RPO:** < 1 second

### Scenario 2: Database Corruption (Secondary)

**Description:** Simulate database corruption requiring restore from backup.

**Trigger:** Corrupt database tables on primary.

**Expected RTO:** 30-60 minutes
**Expected RPO:** 5 minutes (last backup)

### Scenario 3: Network Partition (Tertiary)

**Description:** Simulate network isolation between regions.

**Trigger:** Block VPC peering connection.

**Expected RTO:** 5-10 minutes
**Expected RPO:** 0 seconds (no data loss)

## Exercise Procedure

### Phase 1: Pre-Exercise Validation (30 minutes)

#### 1.1 System Health Check
```bash
# Run pre-exercise health check script
./scripts/pre-exercise-health-check.sh

# Expected output: All systems healthy
# If any system unhealthy, postpone exercise
```

#### 1.2 Baseline Metrics Collection
```bash
# Collect baseline metrics
./scripts/collect-baseline-metrics.sh

# Record:
# - Database connection count
# - Application response times
# - Current user count
# - Active lease count
# - S3 object count
```

#### 1.3 Database Snapshot
```bash
# Create pre-exercise database snapshot
aws rds create-db-snapshot \
  --db-instance-identifier leaseflow-primary-db \
  --db-snapshot-identifier leaseflow-gameday-pre-$(date +%Y%m%d-%H%M%S) \
  --region us-east-1

# Verify snapshot creation
aws rds describe-db-snapshots \
  --db-snapshot-identifier leaseflow-gameday-pre-$(date +%Y%m%d-%H%M%S) \
  --region us-east-1
```

#### 1.4 Document Current State
```bash
# Document current system state
./scripts/document-system-state.sh > gameday-pre-state-$(date +%Y%m%d).json

# Record:
# - EKS node count
# - Database instance size
# - Active connections
# - Queue lengths
# - Cache hit rates
```

### Phase 2: Simulate Failure (5 minutes)

#### 2.1 Stop Primary Database
```bash
# Stop primary database
aws rds stop-db-instance \
  --db-instance-identifier leaseflow-primary-db \
  --region us-east-1 \
  --no-snapshot

# Record failure time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Primary database stopped" >> gameday-timeline.log
```

#### 2.2 Scale Down Primary EKS Cluster
```bash
# Scale down primary EKS cluster to 0 nodes
aws eks update-nodegroup-config \
  --cluster-name leaseflow-primary \
  --nodegroup-name default \
  --scaling-config minSize=0,maxSize=0,desiredSize=0 \
  --region us-east-1

# Record scale down time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Primary EKS cluster scaled down" >> gameday-timeline.log
```

#### 2.3 Verify Health Check Failure
```bash
# Monitor health check status
watch -n 5 'aws route53 get-health-check-status \
  --health-check-id PRIMARY_HEALTH_CHECK_ID \
  --region us-east-1'

# Expected: Health check fails within 90 seconds
# Record failure time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Health check failed" >> gameday-timeline.log
```

### Phase 3: Automatic Failover (2-3 minutes)

#### 3.1 Monitor DNS Failover
```bash
# Monitor DNS resolution
watch -n 5 'dig api.leaseflow.protocol +short'

# Expected: DNS changes to secondary ALB within 60 seconds
# Record failover time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): DNS failover to secondary" >> gameday-timeline.log
```

#### 3.2 Verify Secondary Health Check
```bash
# Verify secondary health check passes
aws route53 get-health-check-status \
  --health-check-id SECONDARY_HEALTH_CHECK_ID \
  --region us-east-1

# Expected: Health check passes
# Record health check pass time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Secondary health check passed" >> gameday-timeline.log
```

#### 3.3 Monitor Alert Notifications
```bash
# Verify alerts were sent
# Check Slack channel for notifications
# Check PagerDuty for escalation
# Verify SNS topic received messages

# Record alert times
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Alerts received" >> gameday-timeline.log
```

### Phase 4: Manual Failover Actions (5-10 minutes)

#### 4.1 Promote Read Replica
```bash
# Promote read replica to standalone
aws rds promote-read-replica \
  --db-instance-identifier leaseflow-secondary-db \
  --region eu-west-1

# Monitor promotion status
aws rds describe-db-instances \
  --db-instance-identifier leaseflow-secondary-db \
  --region eu-west-1 \
  --query 'DBInstances[0].DBInstanceStatus'

# Expected: Status changes to 'available' within 5 minutes
# Record promotion time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Read replica promoted" >> gameday-timeline.log
```

#### 4.2 Scale Up Secondary EKS Cluster
```bash
# Scale up secondary EKS cluster
aws eks update-nodegroup-config \
  --cluster-name leaseflow-secondary \
  --nodegroup-name default \
  --scaling-config minSize=3,maxSize=10,desiredSize=3 \
  --region eu-west-1

# Monitor node group status
aws eks describe-nodegroup \
  --cluster-name leaseflow-secondary \
  --nodegroup-name default \
  --region eu-west-1 \
  --query 'nodegroup.status'

# Expected: Nodes become ready within 3 minutes
# Record scale up time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Secondary EKS cluster scaled up" >> gameday-timeline.log
```

#### 4.3 Update Application Configuration
```bash
# Update application to point to promoted database
kubectl patch configmap leaseflow-backend-config \
  -n leaseflow \
  --type=json \
  -p='[{"op": "replace", "path": "/data/DB_HOST", "value":"leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com"}]'

# Restart application pods
kubectl rollout restart deployment/leaseflow-backend -n leaseflow

# Monitor pod status
kubectl get pods -n leaseflow -w

# Expected: Pods become ready within 2 minutes
# Record application restart time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Application restarted" >> gameday-timeline.log
```

#### 4.4 Enable HPA
```bash
# Enable Horizontal Pod Autoscaler
kubectl apply -f k8s/charts/leaseflow-backend/templates/hpa.yaml

# Verify HPA status
kubectl get hpa -n leaseflow

# Record HPA enable time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): HPA enabled" >> gameday-timeline.log
```

### Phase 5: Validation (30 minutes)

#### 5.1 Health Check Validation
```bash
# Test application health endpoint
curl -k https://api.leaseflow.protocol/health

# Expected: {"status":"ok","database":"connected"}
# Record health check pass time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Application health check passed" >> gameday-timeline.log
```

#### 5.2 Database Write Test
```bash
# Test database write capability
psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "INSERT INTO gameday_test (test_time) VALUES (now());"

# Verify write succeeded
psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "SELECT * FROM gameday_test;"

# Expected: Write successful
# Record write test time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Database write test passed" >> gameday-timeline.log
```

#### 5.3 API Endpoint Testing
```bash
# Test critical API endpoints
./scripts/test-api-endpoints.sh

# Expected: All endpoints return 200
# Record API test time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): API endpoint tests passed" >> gameday-timeline.log
```

#### 5.4 Data Consistency Check
```bash
# Compare data counts
./scripts/check-data-consistency.sh

# Expected: No data loss detected
# Record consistency check time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Data consistency check passed" >> gameday-timeline.log
```

#### 5.5 Performance Validation
```bash
# Test application performance
./scripts/test-performance.sh

# Expected: Response times within acceptable range
# Record performance test time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Performance test passed" >> gameday-timeline.log
```

### Phase 6: Post-Exercise Validation (30 minutes)

#### 6.1 Calculate RTO
```bash
# Calculate Recovery Time Objective
START_TIME=$(grep "Primary database stopped" gameday-timeline.log | cut -d' ' -f1-2)
END_TIME=$(grep "Application health check passed" gameday-timeline.log | cut -d' ' -f1-2)

# Convert to seconds and calculate difference
# Record RTO
echo "RTO: X minutes Y seconds" >> gameday-results.log
```

#### 6.2 Calculate RPO
```bash
# Calculate Recovery Point Objective
# Check last transaction timestamp before failure
# Compare with first transaction after recovery

# Record RPO
echo "RPO: X seconds" >> gameday-results.log
```

#### 6.3 Cost Analysis
```bash
# Calculate costs during failover
./scripts/calculate-failover-costs.sh

# Record costs
echo "Failover costs: $X" >> gameday-results.log
```

#### 6.4 Document Issues
```bash
# Document any issues encountered
cat > gameday-issues.log << EOF
Issue 1: [Description]
Impact: [High/Medium/Low]
Resolution: [How it was resolved]
Prevention: [How to prevent in future]

Issue 2: [Description]
...
EOF
```

### Phase 7: Restoration (30 minutes)

#### 7.1 Restore Primary Region
```bash
# Start primary database
aws rds start-db-instance \
  --db-instance-identifier leaseflow-primary-db \
  --region us-east-1

# Wait for database to be available
aws rds describe-db-instances \
  --db-instance-identifier leaseflow-primary-db \
  --region us-east-1 \
  --query 'DBInstances[0].DBInstanceStatus'

# Record restore time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Primary database restored" >> gameday-timeline.log
```

#### 7.2 Scale Up Primary EKS Cluster
```bash
# Scale up primary EKS cluster
aws eks update-nodegroup-config \
  --cluster-name leaseflow-primary \
  --nodegroup-name default \
  --scaling-config minSize=3,maxSize=10,desiredSize=3 \
  --region us-east-1

# Record scale up time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Primary EKS cluster scaled up" >> gameday-timeline.log
```

#### 7.3 Re-establish Replication
```bash
# Create new read replica in secondary region
aws rds create-read-replica \
  --db-instance-identifier leaseflow-secondary-db-new \
  --source-db-instance-identifier leaseflow-primary-db \
  --region eu-west-1

# Monitor replication setup
# Record replication setup time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Replication re-established" >> gameday-timeline.log
```

#### 7.4 Failback to Primary
```bash
# Update DNS to point to primary
aws route53 change-resource-record-sets \
  --hosted-zone-id ZXXXXXXXXXX \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.leaseflow.protocol",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "ZXXXXXXXXXX",
          "DNSName": "leaseflow-primary-alb-xxxxx.us-east-1.elb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'

# Record failback time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Failed back to primary" >> gameday-timeline.log
```

#### 7.5 Clean Up Temporary Resources
```bash
# Delete temporary database instances
# Delete temporary test data
# Clean up test files

# Record cleanup time
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ): Cleanup completed" >> gameday-timeline.log
```

## Test Scripts

### Pre-Exercise Health Check Script
```bash
#!/bin/bash
# scripts/pre-exercise-health-check.sh

echo "=== Pre-Exercise Health Check ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Check primary database
echo "Checking primary database..."
PRIMARY_DB_STATUS=$(aws rds describe-db-instances \
  --db-instance-identifier leaseflow-primary-db \
  --region us-east-1 \
  --query 'DBInstances[0].DBInstanceStatus' \
  --output text)

if [ "$PRIMARY_DB_STATUS" = "available" ]; then
  echo "✓ Primary database: $PRIMARY_DB_STATUS"
else
  echo "✗ Primary database: $PRIMARY_DB_STATUS"
  exit 1
fi

# Check secondary database
echo "Checking secondary database..."
SECONDARY_DB_STATUS=$(aws rds describe-db-instances \
  --db-instance-identifier leaseflow-secondary-db \
  --region eu-west-1 \
  --query 'DBInstances[0].DBInstanceStatus' \
  --output text)

if [ "$SECONDARY_DB_STATUS" = "available" ]; then
  echo "✓ Secondary database: $SECONDARY_DB_STATUS"
else
  echo "✗ Secondary database: $SECONDARY_DB_STATUS"
  exit 1
fi

# Check primary EKS cluster
echo "Checking primary EKS cluster..."
PRIMARY_EKS_STATUS=$(aws eks describe-cluster \
  --name leaseflow-primary \
  --region us-east-1 \
  --query 'cluster.status' \
  --output text)

if [ "$PRIMARY_EKS_STATUS" = "ACTIVE" ]; then
  echo "✓ Primary EKS cluster: $PRIMARY_EKS_STATUS"
else
  echo "✗ Primary EKS cluster: $PRIMARY_EKS_STATUS"
  exit 1
fi

# Check secondary EKS cluster
echo "Checking secondary EKS cluster..."
SECONDARY_EKS_STATUS=$(aws eks describe-cluster \
  --name leaseflow-secondary \
  --region eu-west-1 \
  --query 'cluster.status' \
  --output text)

if [ "$SECONDARY_EKS_STATUS" = "ACTIVE" ]; then
  echo "✓ Secondary EKS cluster: $SECONDARY_EKS_STATUS"
else
  echo "✗ Secondary EKS cluster: $SECONDARY_EKS_STATUS"
  exit 1
fi

# Check replication lag
echo "Checking replication lag..."
REPLICATION_LAG=$(psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -t -c "SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int;")

if [ "$REPLICATION_LAG" -lt 5 ]; then
  echo "✓ Replication lag: ${REPLICATION_LAG}s"
else
  echo "✗ Replication lag: ${REPLICATION_LAG}s (too high)"
  exit 1
fi

echo "=== All health checks passed ==="
exit 0
```

### API Endpoint Test Script
```bash
#!/bin/bash
# scripts/test-api-endpoints.sh

echo "=== API Endpoint Testing ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

BASE_URL="https://api.leaseflow.protocol"

# Test health endpoint
echo "Testing /health endpoint..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $BASE_URL/health)
if [ "$HEALTH_RESPONSE" = "200" ]; then
  echo "✓ /health: $HEALTH_RESPONSE"
else
  echo "✗ /health: $HEALTH_RESPONSE"
fi

# Test GraphQL endpoint
echo "Testing /graphql endpoint..."
GRAPHQL_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $BASE_URL/graphql)
if [ "$GRAPHQL_RESPONSE" = "200" ]; then
  echo "✓ /graphql: $GRAPHQL_RESPONSE"
else
  echo "✗ /graphql: $GRAPHQL_RESPONSE"
fi

# Test lease creation
echo "Testing lease creation..."
LEASE_RESPONSE=$(curl -s -X POST $BASE_URL/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { createLease(input: {propertyId: \"test\", tenantId: \"test\", startDate: \"2026-01-01\", endDate: \"2026-12-31\"}) { id } }"}' \
  -o /dev/null -w "%{http_code}")

if [ "$LEASE_RESPONSE" = "200" ]; then
  echo "✓ Lease creation: $LEASE_RESPONSE"
else
  echo "✗ Lease creation: $LEASE_RESPONSE"
fi

echo "=== API endpoint testing completed ==="
```

### Data Consistency Check Script
```bash
#!/bin/bash
# scripts/check-data-consistency.sh

echo "=== Data Consistency Check ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Get lease count from primary (if available)
if psql -h leaseflow-primary-db.xxxx.us-east-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "SELECT 1" > /dev/null 2>&1; then
  
  PRIMARY_COUNT=$(psql -h leaseflow-primary-db.xxxx.us-east-1.rds.amazonaws.com \
    -U leaseflow \
    -d leaseflow \
    -t -c "SELECT COUNT(*) FROM leases;")
  
  echo "Primary lease count: $PRIMARY_COUNT"
fi

# Get lease count from secondary
SECONDARY_COUNT=$(psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -t -c "SELECT COUNT(*) FROM leases;")

echo "Secondary lease count: $SECONDARY_COUNT"

# Compare counts
if [ -n "$PRIMARY_COUNT" ]; then
  if [ "$PRIMARY_COUNT" = "$SECONDARY_COUNT" ]; then
    echo "✓ Data counts match"
  else
    DIFFERENCE=$((PRIMARY_COUNT - SECONDARY_COUNT))
    echo "✗ Data count difference: $DIFFERENCE"
  fi
else
  echo "⚠ Primary unavailable, skipping comparison"
fi

# Check for orphaned records
echo "Checking for orphaned records..."
ORPHANED=$(psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -t -c "SELECT COUNT(*) FROM leases WHERE tenant_id NOT IN (SELECT id FROM tenants);")

if [ "$ORPHANED" = "0" ]; then
  echo "✓ No orphaned records"
else
  echo "✗ Orphaned records: $ORPHANED"
fi

echo "=== Data consistency check completed ==="
```

### Performance Test Script
```bash
#!/bin/bash
# scripts/test-performance.sh

echo "=== Performance Testing ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

BASE_URL="https://api.leaseflow.protocol"

# Test health endpoint response time
echo "Testing /health response time..."
HEALTH_TIME=$(curl -s -o /dev/null -w "%{time_total}" $BASE_URL/health)
echo "Health response time: ${HEALTH_TIME}s"

if (( $(echo "$HEALTH_TIME < 0.5" | bc -l) )); then
  echo "✓ Health response time acceptable"
else
  echo "✗ Health response time too slow"
fi

# Test GraphQL endpoint response time
echo "Testing /graphql response time..."
GRAPHQL_TIME=$(curl -s -X POST $BASE_URL/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ leases { id } }"}' \
  -o /dev/null -w "%{time_total}")

echo "GraphQL response time: ${GRAPHQL_TIME}s"

if (( $(echo "$GRAPHQL_TIME < 1.0" | bc -l) )); then
  echo "✓ GraphQL response time acceptable"
else
  echo "✗ GraphQL response time too slow"
fi

# Test database query time
echo "Testing database query time..."
DB_QUERY_TIME=$(psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "timing on" \
  -t -c "SELECT COUNT(*) FROM leases;" 2>&1 | grep "Time" | awk '{print $2}')

echo "Database query time: ${DB_QUERY_TIME}ms"

if [ "$DB_QUERY_TIME" -lt 100 ]; then
  echo "✓ Database query time acceptable"
else
  echo "✗ Database query time too slow"
fi

echo "=== Performance testing completed ==="
```

## Success Criteria

### Must-Have Criteria
- [ ] RTO ≤ 6 minutes
- [ ] RPO ≤ 5 seconds
- [ ] No data loss
- [ ] All API endpoints functional
- [ ] Database writes successful
- [ ] Health checks pass
- [ ] No critical errors

### Should-Have Criteria
- [ ] RTO ≤ 4 minutes
- [ ] RPO ≤ 1 second
- [ ] Performance within 20% of baseline
- [ ] All monitoring alerts triggered correctly
- [ ] Documentation accurate
- [ ] Team members comfortable with procedures

### Nice-to-Have Criteria
- [ ] RTO ≤ 2 minutes
- [ ] RPO = 0 seconds
- [ ] Performance within 10% of baseline
- [ ] Automated rollback successful
- [ ] Cost within budget
- [ ] No user impact

## Post-Exercise Activities

### 1. Post-Mortem Meeting (1 hour)
- Schedule within 1 week of exercise
- Invite all participants
- Review timeline and metrics
- Discuss issues encountered
- Identify improvement opportunities

### 2. Documentation Updates (1 week)
- Update runbooks based on findings
- Correct any inaccuracies
- Add missing procedures
- Update contact information
- Revise success criteria

### 3. Improvement Implementation (1 month)
- Address critical issues immediately
- Prioritize improvements based on impact
- Assign owners to each improvement
- Track progress in project management tool
- Validate improvements in next exercise

### 4. Report Generation (1 week)
- Create executive summary
- Document metrics and findings
- Include cost analysis
- Provide recommendations
- Share with stakeholders

## Communication Plan

### Pre-Exercise
- **2 weeks before:** Email notification to all stakeholders
- **1 week before:** Calendar invites to participants
- **1 day before:** Slack announcement in #general
- **1 hour before:** Status page update

### During Exercise
- **Start:** Announcement in #gameday-dr
- **Every 15 minutes:** Status updates in #gameday-dr
- **Failover:** Alert to on-call team
- **Completion:** Announcement in #general

### Post-Exercise
- **Immediate:** Status page update
- **1 hour after:** Email summary to participants
- **1 day after:** Post-mortem meeting scheduled
- **1 week after:** Final report distributed

## Rollback Plan

### If Exercise Fails Midway
1. Immediately restore primary database
2. Scale up primary EKS cluster
3. Update DNS to point to primary
4. Verify application health
5. Notify stakeholders of failure
6. Document failure point
7. Schedule retry

### If Critical Issues Arise
1. Stop exercise immediately
2. Restore to pre-exercise state
3. Investigate root cause
4. Fix issue before retry
5. Update procedures
6. Communicate with stakeholders

## Appendix A: Exercise Timeline Template

```
Game Day Exercise Timeline
Date: YYYY-MM-DD
Exercise Lead: [Name]
Participants: [List]

00:00 - Exercise start
00:05 - Pre-exercise health check
00:10 - Baseline metrics collection
00:15 - Database snapshot
00:20 - System state documentation
00:25 - Begin failure simulation
00:30 - Primary database stopped
00:35 - Primary EKS cluster scaled down
00:40 - Health check failure detected
00:45 - DNS failover initiated
00:50 - DNS failover complete
00:55 - Secondary health check passes
01:00 - Read replica promotion started
01:05 - Read replica promotion complete
01:10 - Secondary EKS cluster scaled up
01:15 - Application configuration updated
01:20 - Application restarted
01:25 - HPA enabled
01:30 - Health check validation
01:35 - Database write test
01:40 - API endpoint testing
01:45 - Data consistency check
01:50 - Performance validation
01:55 - RTO/RPO calculation
02:00 - Restoration phase begins
02:05 - Primary database restored
02:10 - Primary EKS cluster scaled up
02:15 - Replication re-established
02:20 - Failback to primary
02:25 - Cleanup completed
02:30 - Exercise end
```

## Appendix B: Results Template

```
Game Day Exercise Results
Date: YYYY-MM-DD
Exercise Lead: [Name]

Metrics:
- RTO: X minutes Y seconds
- RPO: X seconds
- Data Loss: X records
- Cost: $X
- Participants: X

Success Criteria:
- [ ] RTO ≤ 6 minutes
- [ ] RPO ≤ 5 seconds
- [ ] No data loss
- [ ] All API endpoints functional
- [ ] Database writes successful
- [ ] Health checks pass
- [ ] No critical errors

Issues Encountered:
1. [Description]
   - Impact: [High/Medium/Low]
   - Resolution: [How resolved]
   - Prevention: [How to prevent]

Lessons Learned:
1. [Lesson]
2. [Lesson]
3. [Lesson]

Improvement Actions:
1. [Action] - [Owner] - [Due Date]
2. [Action] - [Owner] - [Due Date]
3. [Action] - [Owner] - [Due Date]

Next Exercise Date: YYYY-MM-DD
```

---

**Document Version:** 1.0
**Last Updated:** 2026-04-26
**Next Review:** 2026-07-26
