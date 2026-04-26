# Vault Policies for Least-Privilege Access
# These policies define what secrets each service can access
# Apply with: vault policy write leaseflow-backend - < vault-policies.hcl

---
# Policy for LeaseFlow Backend Application
# This policy grants access to all secrets needed by the main application
path "database/creds/leaseflow-backend" {
  capabilities = ["read"]
}

path "database/creds/leaseflow-backend" {
  capabilities = ["update"]
  lease_renewal = true
}

path "secret/data/leaseflow/jwt" {
  capabilities = ["read"]
}

path "secret/data/leaseflow/redis" {
  capabilities = ["read"]
}

path "secret/data/leaseflow/stellar" {
  capabilities = ["read"]
}

path "secret/data/leaseflow/sentry" {
  capabilities = ["read"]
}

path "secret/data/leaseflow/ipfs" {
  capabilities = ["read"]
}

path "secret/data/leaseflow/sendgrid" {
  capabilities = ["read"]
}

path "secret/data/leaseflow/twilio" {
  capabilities = ["read"]
}

---
# Policy for Database Migrations
# This policy grants elevated database privileges for schema changes
path "database/creds/leaseflow-migration" {
  capabilities = ["read"]
}

path "database/creds/leaseflow-migration" {
  capabilities = ["update"]
  lease_renewal = true
}

path "secret/data/leaseflow/database" {
  capabilities = ["read"]
}

---
# Policy for Read-Only Database Access
# This policy grants read-only access for reporting/analytics
path "database/creds/leaseflow-readonly" {
  capabilities = ["read"]
}

path "database/creds/leaseflow-readonly" {
  capabilities = ["update"]
  lease_renewal = true
}

---
# Policy for Background Workers
# This policy grants access to secrets needed by worker pods
path "database/creds/leaseflow-backend" {
  capabilities = ["read"]
}

path "database/creds/leaseflow-backend" {
  capabilities = ["update"]
  lease_renewal = true
}

path "secret/data/leaseflow/redis" {
  capabilities = ["read"]
}

path "secret/data/leaseflow/stellar" {
  capabilities = ["read"]
}

---
# Policy for Vault Administration
# This policy grants administrative access for managing Vault
# Only grant this to trusted administrators
path "sys/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

path "database/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

path "secret/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

path "auth/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

---
# Policy for Credential Rotation
# This policy grants access to rotate database credentials
path "database/rotate-role/leaseflow-backend" {
  capabilities = ["update"]
}

path "database/rotate-role/leaseflow-migration" {
  capabilities = ["update"]
}

path "database/rotate-role/leaseflow-readonly" {
  capabilities = ["update"]
}

---
# Kubernetes RBAC Mapping Configuration
# This maps Kubernetes ServiceAccounts to Vault policies
# Run these commands in Vault to set up the mapping

# Create the leaseflow-backend policy
# vault policy write leaseflow-backend - <<EOF
# path "database/creds/leaseflow-backend" {
#   capabilities = ["read"]
# }
# path "database/creds/leaseflow-backend" {
#   capabilities = ["update"]
#   lease_renewal = true
# }
# path "secret/data/leaseflow/jwt" {
#   capabilities = ["read"]
# }
# path "secret/data/leaseflow/redis" {
#   capabilities = ["read"]
# }
# path "secret/data/leaseflow/stellar" {
#   capabilities = ["read"]
# }
# path "secret/data/leaseflow/sentry" {
#   capabilities = ["read"]
# }
# path "secret/data/leaseflow/ipfs" {
#   capabilities = ["read"]
# }
# path "secret/data/leaseflow/sendgrid" {
#   capabilities = ["read"]
# }
# path "secret/data/leaseflow/twilio" {
#   capabilities = ["read"]
# }
# EOF

# Create the leaseflow-migration policy
# vault policy write leaseflow-migration - <<EOF
# path "database/creds/leaseflow-migration" {
#   capabilities = ["read"]
# }
# path "database/creds/leaseflow-migration" {
#   capabilities = ["update"]
#   lease_renewal = true
# }
# path "secret/data/leaseflow/database" {
#   capabilities = ["read"]
# }
# EOF

# Create the leaseflow-worker policy
# vault policy write leaseflow-worker - <<EOF
# path "database/creds/leaseflow-backend" {
#   capabilities = ["read"]
# }
# path "database/creds/leaseflow-backend" {
#   capabilities = ["update"]
#   lease_renewal = true
# }
# path "secret/data/leaseflow/redis" {
#   capabilities = ["read"]
# }
# path "secret/data/leaseflow/stellar" {
#   capabilities = ["read"]
# }
# EOF

# Create Kubernetes auth roles
# vault write auth/kubernetes/role/leaseflow-backend \
#   bound_service_account_names=leaseflow-backend \
#   bound_service_account_namespaces=leaseflow \
#   policies=leaseflow-backend \
#   ttl=24h \
#   max_ttl=24h

# vault write auth/kubernetes/role/leaseflow-migration \
#   bound_service_account_names=leaseflow-backend \
#   bound_service_account_namespaces=leaseflow \
#   policies=leaseflow-migration \
#   ttl=2h \
#   max_ttl=2h

# vault write auth/kubernetes/role/leaseflow-worker \
#   bound_service_account_names=leaseflow-backend \
#   bound_service_account_namespaces=leaseflow \
#   policies=leaseflow-worker \
#   ttl=24h \
#   max_ttl=24h
