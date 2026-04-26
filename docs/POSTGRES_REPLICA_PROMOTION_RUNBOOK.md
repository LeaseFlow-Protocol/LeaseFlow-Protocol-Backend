# PostgreSQL Read Replica Promotion Runbook

## Overview

This runbook provides step-by-step instructions for promoting the PostgreSQL read replica in the secondary region (eu-west-1) to a writable primary database during a disaster recovery scenario.

**Prerequisites:**
- Primary database in us-east-1 is confirmed down or inaccessible
- Secondary read replica in eu-west-1 is healthy and replication lag is minimal
- AWS CLI and psql client are installed
- Appropriate IAM permissions are configured

**Estimated Time:** 5-10 minutes
**Risk Level:** High (data loss possible if not executed correctly)

## Pre-Promotion Checklist

### 1. Verify Primary Database Status
```bash
# Check primary database status
aws rds describe-db-instances \
  --db-instance-identifier leaseflow-primary-db \
  --region us-east-1

# Expected: Instance status should be 'stopped', 'inaccessible', or 'deleting'
```

### 2. Verify Read Replica Status
```bash
# Check read replica status
aws rds describe-db-instances \
  --db-instance-identifier leaseflow-secondary-db \
  --region eu-west-1

# Expected: Instance status should be 'available'
# Expected: Read replica source should point to primary
```

### 3. Check Replication Lag
```bash
# Connect to read replica and check replication lag
psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "SELECT * FROM pg_stat_replication;"

# Expected: Replication lag should be < 1 second
# Expected: WAL sender should be active
```

### 4. Verify Data Consistency
```bash
# Check last transaction timestamp
psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;"

# Expected: Replication lag should be minimal (< 5 seconds)
```

### 5. Notify Stakeholders
- Send notification to: devops@leaseflow.io, dba@leaseflow.io
- Include: Primary database status, replication lag, promotion start time
- Channel: Slack #dr-alerts, PagerDuty

## Promotion Procedure

### Step 1: Stop Application Writes to Primary (if still accessible)

If the primary database is still accessible but degraded, stop all application writes:

```bash
# Update application configuration to read-only mode
# This should be done via configuration management system

# Verify no active connections
psql -h leaseflow-primary-db.xxxx.us-east-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"
```

### Step 2: Promote Read Replica to Standalone

```bash
# Promote the read replica to a standalone instance
aws rds promote-read-replica \
  --db-instance-identifier leaseflow-secondary-db \
  --region eu-west-1

# This operation typically takes 2-5 minutes
# Monitor the status:
aws rds describe-db-instances \
  --db-instance-identifier leaseflow-secondary-db \
  --region eu-west-1 \
  --query 'DBInstances[0].DBInstanceStatus'
```

**Expected Output:**
- Status transitions: `available` → `modifying` → `available`
- Once `available`, the instance is now a standalone primary

### Step 3: Verify Promotion Success

```bash
# Verify the instance is no longer a read replica
aws rds describe-db-instances \
  --db-instance-identifier leaseflow-secondary-db \
  --region eu-west-1 \
  --query 'DBInstances[0].ReadReplicaSourceDBInstanceIdentifier'

# Expected: null (no source database)

# Verify write capability
psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "CREATE TABLE promotion_test (id serial PRIMARY KEY, test_time timestamp);"

# Expected: Table created successfully

# Clean up test table
psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "DROP TABLE promotion_test;"
```

### Step 4: Update Application Configuration

Update the application to point to the new primary database:

```bash
# Update environment variables or configuration management
# New database endpoint: leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com

# Example: Update Kubernetes ConfigMap
kubectl patch configmap leaseflow-backend-config \
  -n leaseflow \
  --type=json \
  -p='[{"op": "replace", "path": "/data/DB_HOST", "value":"leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com"}]'

# Update Secrets if needed
kubectl patch secret leaseflow-backend-secrets \
  -n leaseflow \
  --type=json \
  -p='[{"op": "replace", "path": "/data/DB_HOST", "value":"leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com"}]'

# Restart application pods
kubectl rollout restart deployment/leaseflow-backend -n leaseflow
```

### Step 5: Scale Secondary EKS Cluster

Scale up the secondary EKS cluster to handle production traffic:

```bash
# Scale node group from 1 to 3 nodes
aws eks update-nodegroup-config \
  --cluster-name leaseflow-secondary \
  --nodegroup-name default \
  --scaling-config minSize=3,maxSize=10,desiredSize=3 \
  --region eu-west-1

# Enable Horizontal Pod Autoscaler
kubectl apply -f k8s/charts/leaseflow-backend/templates/hpa.yaml

# Scale application replicas
kubectl scale deployment/leaseflow-backend --replicas=3 -n leaseflow
```

### Step 6: Verify Application Health

```bash
# Check application health endpoint
curl -k https://api.leaseflow.protocol/health

# Expected: {"status":"ok","database":"connected"}

# Check database connectivity from application
kubectl exec -it deployment/leaseflow-backend -n leaseflow -- \
  psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "SELECT 1;"

# Expected: Returns 1
```

### Step 7: Update DNS Configuration

Update Route53 to point to the secondary region:

```bash
# Update Route53 primary record to point to secondary ALB
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
          "DNSName": "leaseflow-secondary-alb-xxxxx.eu-west-1.elb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'

# Note: If using automatic failover, this step may be automatic
# Verify DNS propagation
dig api.leaseflow.protocol +short
```

### Step 8: Enable Multi-AZ for New Primary (Optional but Recommended)

For production resilience, enable Multi-AZ on the promoted database:

```bash
# Enable Multi-AZ (this will cause a brief downtime)
aws rds modify-db-instance \
  --db-instance-identifier leaseflow-secondary-db \
  --multi-az \
  --apply-immediately \
  --region eu-west-1

# Monitor the status
aws rds describe-db-instances \
  --db-instance-identifier leaseflow-secondary-db \
  --region eu-west-1 \
  --query 'DBInstances[0].DBInstanceStatus'

# This operation typically takes 10-15 minutes
```

### Step 9: Update Backup Configuration

```bash
# Update backup retention period to match production standards
aws rds modify-db-instance \
  --db-instance-identifier leaseflow-secondary-db \
  --backup-retention-period 30 \
  --apply-immediately \
  --region eu-west-1

# Enable Performance Insights if not already enabled
aws rds modify-db-instance \
  --db-instance-identifier leaseflow-secondary-db \
  --performance-insights-enabled \
  --apply-immediately \
  --region eu-west-1
```

### Step 10. Monitor and Validate

```bash
# Monitor database metrics for 30 minutes
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=leaseflow-secondary-db \
  --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average

# Monitor application error rates
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=LoadBalancer,Value=app/leaseflow-secondary-alb/xxxxx \
  --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum
```

## Post-Promotion Checklist

### 1. Verify Data Integrity
```bash
# Run data integrity checks
psql -h leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com \
  -U leaseflow \
  -d leaseflow \
  -c "SELECT COUNT(*) FROM leases;"

# Compare with expected count
# Verify critical tables have expected data
```

### 2. Test Critical Workflows
- Test lease creation
- Test rent payment processing
- Test tenant authentication
- Test PDF generation
- Test all API endpoints

### 3. Update Documentation
- Update architecture diagrams
- Update runbooks with new primary location
- Update monitoring dashboards
- Update alert thresholds

### 4. Notify Stakeholders
- Send completion notification
- Include: Promotion completion time, any issues encountered, validation results
- Channel: Slack #dr-alerts, email to management

### 5. Create Incident Report
Document the promotion event:
- Time of primary failure
- Time of promotion start
- Time of promotion completion
- Any data loss
- Lessons learned
- Improvement recommendations

## Failback Procedure (When Primary Region is Restored)

### 1. Create New Read Replica in Primary Region
```bash
# Create a new read replica in us-east-1 pointing to eu-west-1
aws rds create-read-replica \
  --db-instance-identifier leaseflow-primary-db-new \
  --source-db-instance-identifier leaseflow-secondary-db \
  --region us-east-1

# Wait for replication to establish
# Monitor replication lag
```

### 2. Wait for Replication Sync
```bash
# Monitor replication lag until minimal
# This may take several hours depending on data size
```

### 3. Schedule Maintenance Window
- Choose low-traffic period
- Notify all stakeholders
- Prepare rollback plan

### 4. Promote New Primary in us-east-1
```bash
# Promote the new read replica in us-east-1
aws rds promote-read-replica \
  --db-instance-identifier leaseflow-primary-db-new \
  --region us-east-1
```

### 5. Update Application Configuration
- Update application to point to us-east-1 database
- Restart application pods
- Verify connectivity

### 6. Update DNS
- Update Route53 to point to us-east-1 ALB
- Verify DNS propagation

### 7. Create Read Replica in eu-west-1
```bash
# Create a new read replica in eu-west-1 for future DR
aws rds create-read-replica \
  --db-instance-identifier leaseflow-secondary-db-new \
  --source-db-instance-identifier leaseflow-primary-db-new \
  --region eu-west-1
```

### 8. Clean Up Old Resources
- Delete old primary database (if unrecoverable)
- Delete old secondary database (after failback complete)
- Update Terraform state

## Rollback Procedure (If Promotion Fails)

### 1. Stop Promotion
```bash
# If promotion is still in progress, cancel it
# Note: Once promotion completes, it cannot be undone
```

### 2. Restore from Backup
```bash
# If promotion fails or data is corrupted, restore from backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier leaseflow-secondary-db-restored \
  --db-snapshot-identifier leaseflow-secondary-db-snapshot \
  --region eu-west-1
```

### 3. Re-establish Replication
```bash
# If primary is still available, re-establish replication
# This may require creating a new read replica from a snapshot
```

### 4. Notify Stakeholders
- Alert about promotion failure
- Provide estimated recovery time
- Escalate if critical

## Troubleshooting

### Issue: Promotion Fails with "InvalidDBInstanceState"
**Cause:** Database is not in a state that allows promotion
**Solution:**
```bash
# Check database status
aws rds describe-db-instances \
  --db-instance-identifier leaseflow-secondary-db \
  --region eu-west-1

# Wait for status to be 'available' before retrying
```

### Issue: High Replication Lag After Promotion
**Cause:** Large backlog of WAL logs
**Solution:**
```bash
# Monitor replication lag
# If lag is high, consider:
# 1. Increasing instance size
# 2. Optimizing database queries
# 3. Reducing write load during sync
```

### Issue: Application Cannot Connect
**Cause:** Security groups or network configuration
**Solution:**
```bash
# Check security group rules
aws ec2 describe-security-groups \
  --group-ids sg-xxxxxxxxx \
  --region eu-west-1

# Ensure application security group allows access to database
# Test connectivity from application pod
kubectl exec -it deployment/leaseflow-backend -n leaseflow -- \
  telnet leaseflow-secondary-db.xxxx.eu-west-1.rds.amazonaws.com 5432
```

### Issue: Data Inconsistency
**Cause:** Replication was not fully synced before promotion
**Solution:**
```bash
# Compare row counts between primary (if available) and promoted replica
# Identify missing data
# Restore from backup if necessary
# Re-sync from primary if available
```

## Contact Information

### Primary Contacts
- **DBA:** dba@leaseflow.io
- **DevOps Lead:** devops@leaseflow.io
- **On-Call Engineer:** oncall@leaseflow.io (PagerDuty)

### Escalation
- **Level 1:** DevOps team
- **Level 2:** Engineering management
- **Level 3:** CTO

## Appendix A: Useful Queries

### Check Replication Status
```sql
SELECT * FROM pg_stat_replication;
```

### Check Replication Lag
```sql
SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;
```

### Check Active Connections
```sql
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
```

### Check Database Size
```sql
SELECT pg_size_pretty(pg_database_size('leaseflow'));
```

### Check Table Sizes
```sql
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Appendix B: AWS CLI Reference

### Common RDS Commands
```bash
# Describe instance
aws rds describe-db-instances --db-instance-identifier <id> --region <region>

# Promote read replica
aws rds promote-read-replica --db-instance-identifier <id> --region <region>

# Modify instance
aws rds modify-db-instance --db-instance-identifier <id> --<parameter> --region <region>

# Create snapshot
aws rds create-db-snapshot --db-instance-identifier <id> --db-snapshot-identifier <snapshot-id> --region <region>

# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot --db-instance-identifier <new-id> --db-snapshot-identifier <snapshot-id> --region <region>
```

---

**Document Version:** 1.0
**Last Updated:** 2026-04-26
**Next Review:** 2026-07-26
