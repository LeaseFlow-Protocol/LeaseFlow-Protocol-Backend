# Database Migration Failure Runbook

This runbook provides step-by-step procedures for handling failed database migrations during automated deployments with Kubernetes initContainers.

## Overview

The LeaseFlow backend uses Kubernetes initContainers to execute database migrations automatically during deployment. If a migration fails, the initContainer crashes, and Kubernetes prevents the new API pods from starting, preserving the old version. This runbook outlines how to diagnose, fix, and recover from migration failures.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kubernetes Deployment                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Pod Spec                                 │  │
│  │                                                             │  │
│  │  ┌──────────────────┐    ┌──────────────────┐             │  │
│  │  │ wait-for-db      │    │ wait-for-redis   │             │  │
│  │  │ (initContainer)  │    │ (initContainer)  │             │  │
│  │  └────────┬─────────┘    └────────┬─────────┘             │  │
│  │           │                        │                        │  │
│  │           └──────────┬─────────────┘                        │  │
│  │                      ▼                                      │  │
│  │           ┌──────────────────┐                               │  │
│  │           │ run-migrations   │                               │  │
│  │           │ (initContainer)  │                               │  │
│  │           │                  │                               │  │
│  │           │ - Acquires lock  │                               │  │
│  │           │ - Runs SQL files │                               │  │
│  │           │ - Records status │                               │  │
│  │           │ - Releases lock  │                               │  │
│  │           └────────┬─────────┘                               │  │
│  │                    │                                         │  │
│  │                    ▼ (only if success)                       │  │
│  │           ┌──────────────────┐                               │  │
│  │           │ Main App Container│                              │  │
│  │           └──────────────────┘                               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Migration Failure → Pod Crash → Deployment Rollback            │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Access to Kubernetes cluster (kubectl configured)
- Database access with migration privileges
- Vault access (if Vault integration is enabled)
- Understanding of SQL and database schema changes

## Migration Failure Scenarios

### Scenario 1: SQL Syntax Error

**Symptoms:**
- Pod status: `Init:Error` or `Init:CrashLoopBackOff`
- InitContainer logs show SQL syntax error
- Deployment is stuck

**Diagnosis:**
```bash
# Check pod status
kubectl get pods -n leaseflow

# Check initContainer logs
kubectl logs <pod-name> -n leaseflow -c run-migrations

# Check migration status in database
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT version, name, success, error_message FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;"
```

**Recovery Steps:**

1. **Identify the failed migration:**
   ```bash
   kubectl logs <pod-name> -n leaseflow -c run-migrations | grep "ERROR"
   ```

2. **Fix the SQL file in the codebase:**
   - Locate the migration file in `migrations/` directory
   - Fix the syntax error
   - Test the SQL locally against a staging database

3. **Rebuild and redeploy:**
   ```bash
   # Build new image with fixed migration
   docker build -t leaseflow/backend:fixed .
   docker push leaseflow/backend:fixed
   
   # Update Helm chart with new image tag
   helm upgrade leaseflow-backend ./k8s/charts/leaseflow-backend \
     --set image.tag=fixed -n leaseflow
   ```

4. **Verify migration succeeded:**
   ```bash
   kubectl logs <new-pod-name> -n leaseflow -c run-migrations
   ```

### Scenario 2: Lock Timeout (Stuck Lock)

**Symptoms:**
- Pod status: `Init:Error`
- Logs show "Could not acquire lock for migration"
- Lock held by another pod that crashed

**Diagnosis:**
```bash
# Check lock status in database
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT version, locked_by, locked_at FROM schema_migrations WHERE locked_by IS NOT NULL;"

# Check for stuck pods
kubectl get pods -n leaseflow --field-selector=status.phase!=Running
```

**Recovery Steps:**

1. **Identify the stuck lock:**
   ```bash
   psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
     "SELECT version, locked_by, locked_at FROM schema_migrations WHERE locked_by IS NOT NULL;"
   ```

2. **Force release the lock:**
   ```bash
   # Option 1: Use the migration script
   kubectl run migration-recovery --rm -i --tty --image=leaseflow/backend:latest \
     --env="DB_HOST=$DB_HOST" \
     --env="DB_PORT=$DB_PORT" \
     --env="DB_NAME=$DB_NAME" \
     --env="DB_USER=$DB_USER" \
     --env="DB_PASSWORD=$DB_PASSWORD" \
     -- sh -c "/usr/local/bin/run-migrations.sh force-release <migration_version>"
   
   # Option 2: Direct SQL
   psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
     "SELECT pg_advisory_unlock(hashtext('migration_<migration_version>'));"
   
   psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
     "UPDATE schema_migrations SET locked_by = NULL, locked_at = NULL WHERE version = '<migration_version>';"
   ```

3. **Delete stuck pods:**
   ```bash
   kubectl delete pod <stuck-pod-name> -n leaseflow --force --grace-period=0
   ```

4. **Retry deployment:**
   ```bash
   kubectl rollout restart deployment/leaseflow-backend -n leaseflow
   ```

### Scenario 3: Data Integrity Violation

**Symptoms:**
- Pod status: `Init:Error`
- Logs show constraint violation or data type mismatch
- Migration conflicts with existing data

**Diagnosis:**
```bash
# Check migration logs
kubectl logs <pod-name> -n leaseflow -c run-migrations

# Check affected table data
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT COUNT(*) FROM <affected_table> WHERE <condition>;"

# Check constraints
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "\d <affected_table>"
```

**Recovery Steps:**

1. **Assess data impact:**
   ```bash
   # Identify conflicting data
   psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
     "SELECT * FROM <affected_table> WHERE <conflicting_condition> LIMIT 10;"
   ```

2. **Create a data fix migration:**
   - Create a new migration file to clean/transform data
   - Example: `017_fix_data_conflicts.sql`
   ```sql
   -- Clean conflicting data before schema change
   DELETE FROM <affected_table> WHERE <conflicting_condition>;
   
   -- Transform data to match new schema
   UPDATE <affected_table> SET <column> = <new_value> WHERE <condition>;
   ```

3. **Update the original migration:**
   - Make the original migration idempotent
   - Add data validation checks
   ```sql
   -- Check if data exists before constraint
   DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM <affected_table> WHERE <conflicting_condition>) THEN
       RAISE EXCEPTION 'Conflicting data exists. Run data fix migration first.';
     END IF;
   END $$;
   
   -- Apply schema change
   ALTER TABLE <affected_table> ADD CONSTRAINT <constraint_name>;
   ```

4. **Deploy data fix first:**
   ```bash
   # Add data fix migration to migrations directory
   # Rebuild and deploy
   docker build -t leaseflow/backend:data-fix .
   docker push leaseflow/backend:data-fix
   
   helm upgrade leaseflow-backend ./k8s/charts/leaseflow-backend \
     --set image.tag=data-fix -n leaseflow
   ```

5. **Deploy schema migration:**
   ```bash
   # After data fix succeeds, deploy schema migration
   helm upgrade leaseflow-backend ./k8s/charts/leaseflow-backend \
     --set image.tag=schema-fix -n leaseflow
   ```

### Scenario 4: Vault Authentication Failure

**Symptoms:**
- Pod status: `Init:Error`
- Logs show Vault authentication error
- Migration cannot fetch database credentials

**Diagnosis:**
```bash
# Check initContainer logs
kubectl logs <pod-name> -n leaseflow -c run-migrations

# Check Vault token secret
kubectl get secret vault-token -n leaseflow

# Test Vault connectivity
kubectl run vault-test --rm -i --tty --image=hashicorp/vault:latest \
   --env="VAULT_ADDR=$VAULT_ADDR" \
   --env="VAULT_TOKEN=$(kubectl get secret vault-token -n leaseflow -o jsonpath='{.data.token}' | base64 -d)" \
   -- sh -c "vault kv get secret/data/leaseflow/database"
```

**Recovery Steps:**

1. **Verify Vault configuration:**
   ```bash
   # Check Vault address is reachable
   kubectl run vault-test --rm -i --tty --image=busybox -- sh -c \
     "nc -zv vault.example.com 8200"
   
   # Check Vault token is valid
   VAULT_TOKEN=$(kubectl get secret vault-token -n leaseflow -o jsonpath='{.data.token}' | base64 -d)
   vault login -token-only $VAULT_TOKEN
   ```

2. **Renew or recreate Vault token:**
   ```bash
   # Renew existing token
   vault token renew
   
   # Or create new token
   vault token create -policy=leaseflow-migration -ttl=24h
   
   # Update Kubernetes secret
   kubectl create secret generic vault-token -n leaseflow \
     --from-literal=token=<new-token> --dry-run=client -o yaml | kubectl apply -f -
   ```

3. **Verify secret path exists:**
   ```bash
   vault kv get secret/data/leaseflow/database
   
   # If missing, create it
   vault kv put secret/data/leaseflow/database \
     password=<db_password> \
     username=<db_username>
   ```

4. **Retry deployment:**
   ```bash
   kubectl rollout restart deployment/leaseflow-backend -n leaseflow
   ```

### Scenario 5: Partial Migration (Rollback Required)

**Symptoms:**
- Migration partially applied before failure
- Database in inconsistent state
- Cannot proceed with new migrations

**Diagnosis:**
```bash
# Check migration status
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT version, name, success, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 10;"

# Check schema state
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "\d"

# Check for orphaned objects
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
```

**Recovery Steps:**

1. **Assess migration impact:**
   ```bash
   # Identify which tables/columns were created
   psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
     "SELECT table_name, column_name FROM information_schema.columns WHERE table_name LIKE '%<migration_pattern>%';"
   ```

2. **Create rollback migration:**
   - Create a new migration file to revert changes
   - Example: `017_rollback_failed_migration.sql`
   ```sql
   -- Drop tables created by failed migration
   DROP TABLE IF EXISTS <new_table>;
   
   -- Drop columns added by failed migration
   ALTER TABLE <existing_table> DROP COLUMN IF EXISTS <new_column>;
   
   -- Revert constraint changes
   ALTER TABLE <existing_table> DROP CONSTRAINT IF EXISTS <new_constraint>;
   
   -- Mark failed migration as not applied
   DELETE FROM schema_migrations WHERE version = '<failed_migration_version>';
   ```

3. **Deploy rollback migration:**
   ```bash
   # Add rollback migration to migrations directory
   # Rebuild and deploy
   docker build -t leaseflow/backend:rollback .
   docker push leaseflow/backend:rollback
   
   helm upgrade leaseflow-backend ./k8s/charts/leaseflow-backend \
     --set image.tag=rollback -n leaseflow
   ```

4. **Fix original migration:**
   - Fix the issue that caused the failure
   - Make migration idempotent
   - Test thoroughly

5. **Redeploy fixed migration:**
   ```bash
   helm upgrade leaseflow-backend ./k8s/charts/leaseflow-backend \
     --set image.tag=fixed -n leaseflow
   ```

## Emergency Procedures

### Emergency Rollback to Previous Version

If migration failure is critical and cannot be quickly resolved:

```bash
# Rollback to previous Helm release
helm rollback leaseflow-backend -n leaseflow

# Or rollback to specific revision
helm rollback leaseflow-backend <revision> -n leaseflow

# Verify rollback
kubectl get pods -n leaseflow
kubectl rollout status deployment/leaseflow-backend -n leaseflow
```

### Manual Migration Execution

If initContainer approach fails and manual intervention is required:

```bash
# 1. Disable migration in Helm values
helm upgrade leaseflow-backend ./k8s/charts/leaseflow-backend \
  --set migration.enabled=false -n leaseflow

# 2. Deploy application without migration
helm upgrade leaseflow-backend ./k8s/charts/leaseflow-backend \
  --set image.tag=latest -n leaseflow

# 3. Execute migrations manually
kubectl run manual-migration --rm -i --tty --image=leaseflow/backend:latest \
  --env="DB_HOST=$DB_HOST" \
  --env="DB_PORT=$DB_PORT" \
  --env="DB_NAME=$DB_NAME" \
  --env="DB_USER=$DB_USER" \
  --env="DB_PASSWORD=$DB_PASSWORD" \
  -- sh -c "/usr/local/bin/run-migrations.sh run"

# 4. Re-enable migration for future deployments
helm upgrade leaseflow-backend ./k8s/charts/leaseflow-backend \
  --set migration.enabled=true -n leaseflow
```

## Prevention Best Practices

### 1. Test Migrations in Staging

Always test migrations in a staging environment before production:

```bash
# Deploy to staging first
helm upgrade leaseflow-backend-staging ./k8s/charts/leaseflow-backend \
  --namespace staging --set image.tag=latest

# Verify migrations
kubectl logs <staging-pod> -n staging -c run-migrations

# Check database state
psql -h $STAGING_DB_HOST -U $DB_USER -d $DB_NAME -c "\d"
```

### 2. Make Migrations Idempotent

Ensure all migrations can be run multiple times safely:

```sql
-- Good: Idempotent
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Bad: Not idempotent
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL
);  -- Will fail on second run
```

### 3. Use Transaction Blocks

Wrap complex migrations in transactions:

```sql
BEGIN;

-- Multiple statements
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
CREATE INDEX idx_users_phone ON users(phone);
ALTER TABLE users ADD CONSTRAINT check_phone_format CHECK (phone ~ '^[0-9-]+$');

COMMIT;

-- If any statement fails, all are rolled back
```

### 4. Add Data Validation

Validate data before schema changes:

```sql
-- Check for conflicting data
DO $$
DECLARE
    conflict_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO conflict_count FROM users WHERE email IS NULL;
    
    IF conflict_count > 0 THEN
        RAISE EXCEPTION 'Found % users with NULL email. Cannot add NOT NULL constraint.', conflict_count;
    END IF;
END $$;

-- Now safe to add constraint
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
```

### 5. Monitor Migration Execution

Set up monitoring for migration failures:

```yaml
# Prometheus alert for migration failures
- alert: MigrationFailure
  expr: kube_pod_container_status_ready{container="run-migrations"} == 0
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Migration initContainer failed"
    description: "Pod {{ $labels.pod }} in namespace {{ $labels.namespace }} has failed migration"
```

## Troubleshooting Commands

### Quick Diagnosis

```bash
# Check all pods with migration issues
kubectl get pods -n leaseflow --field-selector=status.phase!=Running

# Check recent migration logs
kubectl logs -l app=leaseflow-backend -n leaseflow -c run-migrations --tail=50

# Check migration status in database
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT version, name, success, error_message FROM schema_migrations WHERE success = false;"

# Check for stuck locks
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT version, locked_by, locked_at FROM schema_migrations WHERE locked_by IS NOT NULL;"
```

### Lock Management

```bash
# View all locks
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT * FROM get_migration_lock_status('migration_<version>');"

# Force release specific lock
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT pg_advisory_unlock(hashtext('migration_<version>'));"

# Clear all migration locks
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "UPDATE schema_migrations SET locked_by = NULL, locked_at = NULL WHERE locked_by IS NOT NULL;"
```

### Migration Status

```bash
# List all applied migrations
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT version, name, applied_at, execution_time_ms FROM schema_migrations ORDER BY applied_at;"

# Check for failed migrations
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT version, name, error_message FROM schema_migrations WHERE success = false;"

# Get migration history
kubectl logs -l app=leaseflow-backend -n leaseflow -c run-migrations | grep -E "(SUCCESS|ERROR)"
```

## Contact and Escalation

- **Primary Contact**: DevOps Team (devops@leaseflow.protocol)
- **Database Team**: dba@leaseflow.protocol
- **On-Call**: Use PagerDuty for critical failures
- **Emergency**: #leaseflow-incident Slack channel

## Appendix: Migration Script Reference

### Migration Script Commands

```bash
# Run migrations
/usr/local/bin/run-migrations.sh run

# Check migration status
/usr/local/bin/run-migrations.sh status

# Force release a lock
/usr/local/bin/run-migrations.sh force-release <migration_version>
```

### Environment Variables

- `DB_HOST`: Database host
- `DB_PORT`: Database port (default: 5432)
- `DB_NAME`: Database name
- `DB_USER`: Database user
- `DB_PASSWORD`: Database password
- `MIGRATIONS_DIR`: Directory containing migration files (default: /migrations)
- `POD_ID`: Pod identifier for lock tracking (default: hostname)
- `LOCK_TIMEOUT`: Lock timeout in seconds (default: 300)

## Related Documentation

- [HPA Configuration Guide](./HPA_CONFIGURATION.md)
- [Deployment Guide](../DEPLOYMENT_GUIDE.md)
- [Kubernetes InitContainers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/)
- [PostgreSQL Advisory Locks](https://www.postgresql.org/docs/current/explicit-locking.html)
