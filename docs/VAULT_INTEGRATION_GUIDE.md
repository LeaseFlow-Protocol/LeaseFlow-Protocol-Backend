# Vault Integration Guide

This guide provides comprehensive instructions for integrating HashiCorp Vault with the LeaseFlow Protocol Backend to achieve institutional-grade cryptographic security for secrets management.

## Overview

The Vault integration removes all hardcoded secrets from the deployment pipeline and replaces Kubernetes Secrets (which are merely base64-encoded) with Vault's secure secret management. The integration includes:

- **Kubernetes Authentication**: Pods authenticate to Vault using ServiceAccount tokens
- **Dynamic Database Credentials**: Short-lived database credentials that rotate every 24 hours
- **Secret Injection**: Vault Agent Injector injects secrets directly into pod memory via temporary volumes
- **Least-Privilege Access**: Granular policies ensuring each service only accesses required secrets
- **Graceful Failure**: Application fails clearly if Vault is unreachable or access is denied

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Pod Spec                                 │  │
│  │                                                             │  │
│  │  ┌──────────────────┐    ┌──────────────────┐             │  │
│  │  │ Vault Agent      │    │ Main Application │             │  │
│  │  │ (Sidecar)        │    │ Container        │             │  │
│  │  │                  │    │                  │             │  │
│  │  │ - Auth to Vault  │    │ - Reads secrets  │             │  │
│  │  │ - Fetch secrets  │◄───┤ - Uses secrets   │             │  │
│  │  │ - Inject to vol  │    │                  │             │  │
│  │  └────────┬─────────┘    └──────────────────┘             │  │
│  │           │                                                │  │
│  │           ▼                                                │  │
│  │  ┌──────────────────┐                                       │  │
│  │  │ EmptyDir Volume  │                                       │  │
│  │  │ (in-memory)      │                                       │  │
│  │  │                  │                                       │  │
│  │  │ /vault/secrets/  │                                       │  │
│  │  │ - database.env   │                                       │  │
│  │  │ - jwt.env        │                                       │  │
│  │  │ - redis.env      │                                       │  │
│  │  └──────────────────┘                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                      │
│                           │ Kubernetes ServiceAccount Token     │
│                           ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  HashiCorp Vault                            │  │
│  │                                                             │  │
│  │  ┌──────────────────┐    ┌──────────────────┐             │  │
│  │  │ Kubernetes Auth   │    │ Database Secrets │             │  │
│  │  │ Method           │    │ Engine           │             │  │
│  │  │                  │    │                  │             │  │
│  │  │ - Validate SA    │    │ - Dynamic creds  │             │  │
│  │  │ - Issue token    │    │ - 24h rotation   │             │  │
│  │  └────────┬─────────┘    └────────┬─────────┘             │  │
│  │           │                        │                        │  │
│  │           └──────────┬───────────┘                        │  │
│  │                      ▼                                      │  │
│  │           ┌──────────────────┐                               │  │
│  │           │ KV Secrets Engine│                               │  │
│  │           │                  │                               │  │
│  │           │ - JWT secrets    │                               │  │
│  │           │ - API keys       │                               │  │
│  │           │ - Config data    │                               │  │
│  │           └──────────────────┘                               │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Kubernetes cluster (v1.20+)
- HashiCorp Vault (v1.15+)
- Vault Agent Injector installed in cluster
- PostgreSQL database with admin credentials
- kubectl configured with cluster access
- Vault CLI installed

## Installation Steps

### 1. Install Vault Agent Injector

```bash
# Add HashiCorp Helm repository
helm repo add hashicorp https://helm.releases.hashicorp.com
helm repo update

# Install Vault Agent Injector
helm install vault hashicorp/vault \
  --namespace vault \
  --create-namespace \
  --set "injector.enabled=true" \
  --set "server.dev.enabled=true" \
  --set "ui.enabled=true"

# Verify installation
kubectl get pods -n vault
kubectl get svc -n vault
```

### 2. Configure Vault Kubernetes Authentication

```bash
# Get Vault pod name
VAULT_POD=$(kubectl get pods -n vault -l app.kubernetes.io/name=vault -o jsonpath='{.items[0].metadata.name}')

# Port-forward to Vault
kubectl port-forward -n vault $VAULT_POD 8200:8200 &

# Set Vault address
export VAULT_ADDR='http://127.0.0.1:8200'

# Initialize Vault (if not already initialized)
vault operator init

# Unseal Vault (if sealed)
vault operator unseal <unseal-key-1>
vault operator unseal <unseal-key-2>
vault operator unseal <unseal-key-3>

# Login with root token
vault login <root-token>

# Enable Kubernetes auth method
vault auth enable kubernetes

# Get Kubernetes CA certificate and API server
K8S_CA_CERT=$(kubectl config view --raw --minify --flatten -o jsonpath='{.clusters[].cluster.certificate-authority-data}')
K8S_API_SERVER=$(kubectl config view --raw --minify --flatten -o jsonpath='{.clusters[].cluster.server}')

# Configure Kubernetes auth
vault write auth/kubernetes/config \
  kubernetes_host="$K8S_API_SERVER" \
  kubernetes_ca_cert="$K8S_CA_CERT"
```

### 3. Create Vault Policies

```bash
# Apply the policies from k8s/vault-policies.hcl
vault policy write leaseflow-backend k8s/vault-policies.hcl
vault policy write leaseflow-migration k8s/vault-policies.hcl
vault policy write leaseflow-worker k8s/vault-policies.hcl

# Verify policies
vault policy list
vault policy read leaseflow-backend
```

### 4. Create Kubernetes Auth Roles

```bash
# Create role for backend application
vault write auth/kubernetes/role/leaseflow-backend \
  bound_service_account_names=leaseflow-backend \
  bound_service_account_namespaces=leaseflow \
  policies=leaseflow-backend \
  ttl=24h \
  max_ttl=24h

# Create role for migrations
vault write auth/kubernetes/role/leaseflow-migration \
  bound_service_account_names=leaseflow-backend \
  bound_service_account_namespaces=leaseflow \
  policies=leaseflow-migration \
  ttl=2h \
  max_ttl=2h

# Create role for workers
vault write auth/kubernetes/role/leaseflow-worker \
  bound_service_account_names=leaseflow-backend \
  bound_service_account_namespaces=leaseflow \
  policies=leaseflow-worker \
  ttl=24h \
  max_ttl=24h

# Verify roles
vault list auth/kubernetes/role
vault read auth/kubernetes/role/leaseflow-backend
```

### 5. Configure Database Secrets Engine

```bash
# Enable database secrets engine
vault secrets enable database

# Configure PostgreSQL connection
vault write database/config/leaseflow-backend \
  plugin_name=postgresql-database-plugin \
  connection_url="postgresql://{{username}}:{{password}}@postgresql-service:5432/leaseflow?sslmode=disable" \
  allowed_roles="leaseflow-backend,leaseflow-migration,leaseflow-readonly" \
  username="postgres" \
  password="<postgres-admin-password>" \
  verify_connection=false

# Create role for application with 24-hour TTL
vault write database/roles/leaseflow-backend \
  db_name=leaseflow-backend \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO \"{{name}}\"; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"{{name}}\"; ALTER ROLE \"{{name}}\" IN DATABASE leaseflow SET search_path TO public;" \
  default_ttl="24h" \
  max_ttl="24h" \
  revocation_statements="REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM \"{{name}}\"; REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM \"{{name}}\"; DROP ROLE IF EXISTS \"{{name}}\";"

# Create role for migrations with elevated privileges
vault write database/roles/leaseflow-migration \
  db_name=leaseflow-backend \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"{{name}}\"; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO \"{{name}}\"; GRANT CREATE ON SCHEMA public TO \"{{name}}\"; ALTER ROLE \"{{name}}\" IN DATABASE leaseflow SET search_path TO public;" \
  default_ttl="1h" \
  max_ttl="2h" \
  revocation_statements="REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM \"{{name}}\"; REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM \"{{name}}\"; REVOKE CREATE ON SCHEMA public FROM \"{{name}}\"; DROP ROLE IF EXISTS \"{{name}}\";"

# Create role for read-only access
vault write database/roles/leaseflow-readonly \
  db_name=leaseflow-backend \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\"; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO \"{{name}}\"; ALTER ROLE \"{{name}}\" IN DATABASE leaseflow SET search_path TO public;" \
  default_ttl="24h" \
  max_ttl="24h" \
  revocation_statements="REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM \"{{name}}\"; REVOKE USAGE ON ALL SEQUENCES IN SCHEMA public FROM \"{{name}}\"; DROP ROLE IF EXISTS \"{{name}}\";"

# Test dynamic credentials
vault read database/creds/leaseflow-backend
```

### 6. Store Static Secrets in Vault

```bash
# Store JWT secret
vault kv put secret/data/leaseflow/jwt \
  secret="$(openssl rand -base64 32)" \
  issuer="leaseflow-backend" \
  audience="leaseflow-users"

# Store Redis credentials
vault kv put secret/data/leaseflow/redis \
  host="redis-service" \
  port="6379" \
  password="<redis-password>"

# Store Stellar/Soroban configuration
vault kv put secret/data/leaseflow/stellar \
  network_passphrase="Public Global Stellar Network ; September 2015" \
  soroban_url="https://soroban-testnet.stellar.org"

# Store Sentry DSN
vault kv put secret/data/leaseflow/sentry \
  dsn="https://your-sentry-dsn@sentry.io/your-project-id"

# Store IPFS credentials
vault kv put secret/data/leaseflow/ipfs \
  project_id="<infura-project-id>" \
  project_secret="<infura-project-secret>"

# Store SendGrid API key
vault kv put secret/data/leaseflow/sendgrid \
  api_key="<sendgrid-api-key>" \
  from_email="noreply@leaseflow.protocol"

# Store Twilio credentials
vault kv put secret/data/leaseflow/twilio \
  account_sid="<twilio-account-sid>" \
  auth_token="<twilio-auth-token>" \
  phone_number="+1234567890"

# Verify secrets
vault kv list secret/data/leaseflow
vault kv get secret/data/leaseflow/jwt
```

### 7. Deploy Kubernetes Resources

```bash
# Apply Kubernetes authentication configuration
kubectl apply -f k8s/vault-k8s-auth-config.yaml

# Apply Vault Agent Injector configuration
kubectl apply -f k8s/vault-sidecar-injector-config.yaml

# Apply dynamic database configuration
kubectl apply -f k8s/vault-dynamic-db-config.yaml

# Verify resources
kubectl get serviceaccount -n leaseflow
kubectl get role -n leaseflow
kubectl get rolebinding -n leaseflow
kubectl get configmap -n leaseflow
```

### 8. Deploy Application with Vault

```bash
# Deploy with Vault enabled
helm install leaseflow-backend ./k8s/charts/leaseflow-backend \
  --namespace leaseflow \
  --create-namespace \
  --set vault.enabled=true \
  --set vault.address=https://vault.vault.svc:8200 \
  --set vault.role=leaseflow-backend \
  --set secrets.enabled=false

# Verify deployment
kubectl get pods -n leaseflow
kubectl describe pod <pod-name> -n leaseflow

# Check Vault Agent Injector logs
kubectl logs <pod-name> -n leaseflow -c vault-agent-injector
```

## Verification

### 1. Verify Vault Agent Injection

```bash
# Check pod annotations
kubectl get pod <pod-name> -n leaseflow -o yaml | grep -A 10 annotations

# Check if Vault Agent sidecar is running
kubectl get pod <pod-name> -n leaseflow -o jsonpath='{.spec.containers[*].name}'

# Check Vault secrets volume
kubectl exec <pod-name> -n leaseflow -- ls -la /vault/secrets/

# Check injected secrets
kubectl exec <pod-name> -n leaseflow -- cat /vault/secrets/database.env
```

### 2. Verify Dynamic Credentials

```bash
# Get current database credentials from Vault
vault read database/creds/leaseflow-backend

# Check that credentials are being used by pod
kubectl exec <pod-name> -n leaseflow -- env | grep DB_

# Rotate credentials
vault write database/rotate-role/leaseflow-backend

# Verify new credentials
vault read database/creds/leaseflow-backend
```

### 3. Run Integration Tests

```bash
# Set environment variables
export VAULT_ADDR=https://vault.vault.svc:8200
export VAULT_TOKEN=<your-vault-token>
export KUBERNETES_NAMESPACE=leaseflow

# Run integration tests
npm test -- tests/vault-integration.test.js
```

## Troubleshooting

### Vault Agent Injector Not Injecting

**Symptoms:** Pod starts but no Vault Agent sidecar is present

**Solutions:**
```bash
# Check if Vault Agent Injector is running
kubectl get pods -n vault

# Check injector webhook
kubectl get mutatingwebhookconfigurations

# Check pod annotations
kubectl get pod <pod-name> -n leaseflow -o yaml | grep vault.hashicorp.com

# Check injector logs
kubectl logs -n vault -l app.kubernetes.io/name=vault-agent-injector
```

### Authentication Failure

**Symptoms:** Pod fails to authenticate to Vault

**Solutions:**
```bash
# Check ServiceAccount
kubectl get serviceaccount leaseflow-backend -n leaseflow

# Check Vault role configuration
vault read auth/kubernetes/role/leaseflow-backend

# Test authentication manually
kubectl run vault-test --rm -i --tty --image=hashicorp/vault:latest \
  --env="VAULT_ADDR=$VAULT_ADDR" \
  -- sh -c "vault write auth/kubernetes/login role=leaseflow-backend jwt=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)"
```

### Secrets Not Injected

**Symptoms:** Vault Agent runs but secrets are not in /vault/secrets

**Solutions:**
```bash
# Check Vault Agent logs
kubectl logs <pod-name> -n leaseflow -c vault-agent-injector

# Check if secrets exist in Vault
vault kv list secret/data/leaseflow
vault kv get secret/data/leaseflow/jwt

# Check Vault Agent configuration
kubectl get configmap vault-agent-config -n leaseflow -o yaml
```

### Database Connection Failure

**Symptoms:** Application cannot connect to database with dynamic credentials

**Solutions:**
```bash
# Test database credentials from Vault
vault read database/creds/leaseflow-backend

# Test connection manually
kubectl run db-test --rm -i --tty --image=postgres:15-alpine \
  --env="PGPASSWORD=<password-from-vault>" \
  -- sh -c "psql -h postgres-service -U <username-from-vault> -d leaseflow"

# Check database role exists
kubectl exec postgresql-service-0 -n postgres -- psql -U postgres -c "\du"
```

### Credential Rotation Issues

**Symptoms:** Application fails after credential rotation

**Solutions:**
```bash
# Check rotation status
vault read database/rotate-role/leaseflow-backend

# Manually rotate credentials
vault write database/rotate-role/leaseflow-backend

# Check if application supports credential renewal
# Ensure application re-reads credentials periodically
```

## Security Best Practices

### 1. Use Least-Privilege Policies

Ensure each service only has access to required secrets:

```hcl
# Good: Specific paths
path "database/creds/leaseflow-backend" {
  capabilities = ["read"]
}

# Bad: Wildcard access
path "*" {
  capabilities = ["read"]
}
```

### 2. Enable Audit Logging

```bash
# Enable audit logging in Vault
vault audit enable file file_path=/vault/logs/audit.log

# Check audit logs
vault audit list
tail -f /vault/logs/audit.log
```

### 3. Use Short TTLs

```bash
# Set appropriate TTLs for different use cases
# Application: 24h
# Migration: 2h
# One-time tasks: 1h
```

### 4. Enable Auto-Renewal

Configure applications to renew Vault tokens before expiration:

```javascript
// Example: Node.js token renewal
const { renewToken } = require('vault-client');

setInterval(async () => {
  await renewToken();
}, 12 * 60 * 60 * 1000); // Renew every 12 hours
```

### 5. Monitor Vault Health

Set up monitoring for Vault:

```yaml
# Prometheus alert for Vault unavailability
- alert: VaultDown
  expr: up{job="vault"} == 0
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Vault is down"
    description: "Vault has been down for more than 5 minutes"
```

## Migration from Kubernetes Secrets

### Step 1: Backup Existing Secrets

```bash
# Export existing Kubernetes secrets
kubectl get secret leaseflow-backend-secrets -n leaseflow -o yaml > secrets-backup.yaml
```

### Step 2: Migrate Secrets to Vault

```bash
# Read secrets from backup
# Store each secret in Vault
vault kv put secret/data/leaseflow/jwt secret=<jwt-secret>
vault kv put secret/data/leaseflow/redis password=<redis-password>
# ... repeat for all secrets
```

### Step 3: Update Deployment

```bash
# Enable Vault in values
helm upgrade leaseflow-backend ./k8s/charts/leaseflow-backend \
  --namespace leaseflow \
  --set vault.enabled=true \
  --set secrets.enabled=false
```

### Step 4: Verify and Delete Old Secrets

```bash
# Verify application works with Vault
kubectl logs <pod-name> -n leaseflow

# Delete old Kubernetes secrets
kubectl delete secret leaseflow-backend-secrets -n leaseflow
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy with Vault

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Configure Vault
        run: |
          vault login -method=github token=${{ secrets.VAULT_TOKEN }}
          vault kv put secret/data/leaseflow/jwt secret=${{ secrets.JWT_SECRET }}
      
      - name: Deploy to Kubernetes
        run: |
          helm upgrade leaseflow-backend ./k8s/charts/leaseflow-backend \
            --namespace leaseflow \
            --set vault.enabled=true \
            --set image.tag=${{ github.sha }}
```

## Cost Considerations

- **Vault Resources**: Allocate sufficient CPU/memory for Vault (typically 2 CPU, 4GB RAM)
- **Database Connections**: Dynamic credentials may increase connection pool size
- **Network Traffic**: Vault Agent adds minimal network overhead
- **Storage**: Audit logs and secret versioning consume storage

## Related Documentation

- [Vault Kubernetes Authentication](https://www.vaultproject.io/docs/auth/kubernetes)
- [Vault Database Secrets Engine](https://www.vaultproject.io/docs/secrets/databases)
- [Vault Agent Injector](https://www.vaultproject.io/docs/platform/k8s/injector)
- [Migration Failure Runbook](./MIGRATION_FAILURE_RUNBOOK.md)
- [HPA Configuration Guide](./HPA_CONFIGURATION.md)

## Support

For issues or questions:
- Create an issue in the GitHub repository
- Contact: devops@leaseflow.protocol
- Documentation: https://docs.leaseflow.protocol
