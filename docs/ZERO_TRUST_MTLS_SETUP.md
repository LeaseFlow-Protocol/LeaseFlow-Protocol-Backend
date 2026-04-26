# Zero-Trust Architecture with Istio mTLS

This document describes the implementation of a Zero-Trust security model using Istio service mesh with mutual TLS (mTLS) authentication for the LeaseFlow Protocol Backend.

## Overview

The Zero-Trust architecture ensures that:
- All pod-to-pod communication is encrypted and mutually authenticated
- Network policies block all unencrypted traffic
- Database connections enforce strict TLS with certificate verification
- Lateral movement by attackers is structurally blocked

## Architecture Components

### 1. Istio Service Mesh

Istio provides the foundational infrastructure for Zero-Trust:
- **Sidecar Proxies**: Automatically injected into all pods to handle mTLS
- **Control Plane**: Manages certificate issuance and rotation
- **Ingress/Egress Gateways**: Secure entry/exit points for cluster traffic

### 2. Mutual TLS (mTLS)

All internal communication uses mTLS:
- **Strict Mode**: All services require mTLS (no plaintext fallback)
- **Automatic Certificate Management**: Istio handles cert issuance and rotation
- **Service Identity**: Each service has a unique identity based on Kubernetes ServiceAccount

### 3. Network Policies

Kubernetes Network Policies enforce network-level restrictions:
- **Default Deny**: All traffic is blocked by default
- **Explicit Allow**: Only specific service-to-service paths are permitted
- **Istio Sidecar Enforcement**: Traffic must flow through Istio sidecars

### 4. Database Security

PostgreSQL connections enforce strict TLS:
- **sslmode=verify-full**: Requires valid client certificates
- **Certificate Validation**: Pods must present valid certs to connect
- **Encrypted Transport**: All database traffic is encrypted

## Installation Steps

### Prerequisites

- Kubernetes cluster (v1.24+)
- kubectl configured for cluster access
- Helm 3.x installed
- Cluster admin permissions

### Step 1: Install Istio

```bash
# Download Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-*

# Install Istio with custom configuration
istioctl install -f k8s/istio-installation.yaml

# Verify installation
istioctl verify-install
```

### Step 2: Enable Istio Injection

The default namespace is already labeled for injection in the manifest:

```bash
kubectl get namespace default -o yaml
# Should show: istio-injection: enabled
```

### Step 3: Apply mTLS Policies

```bash
# Apply PeerAuthentication resources (strict mTLS)
kubectl apply -f k8s/istio-mtls-policies.yaml

# Apply DestinationRules for mTLS routing
kubectl apply -f k8s/istio-mtls-policies.yaml
```

### Step 4: Apply Network Policies

```bash
# Apply strict network policies
kubectl apply -f k8s/network-policies.yaml
```

### Step 5: Apply Authorization Policies

```bash
# Apply service-to-service authorization rules
kubectl apply -f k8s/istio-authorization-policies.yaml
```

### Step 6: Update Application Configuration

Update your Helm chart values or ConfigMaps to include database TLS configuration:

```yaml
# In values.yaml or ConfigMap
database:
  postgresql:
    sslmode: "verify-full"
    ssl: "true"
    sslca: "/etc/ssl/certs/ca.crt"
    sslcert: "/etc/ssl/certs/client.crt"
    sslkey: "/etc/ssl/certs/client.key"
```

### Step 7: Deploy Services

```bash
# Deploy the application
helm install leaseflow-backend ./k8s/charts/leaseflow-backend

# Verify sidecar injection
kubectl get pods -n default
# Each pod should have 2/2 containers (app + istio-proxy)
```

## Verification

### Verify mTLS Status

```bash
# Check mesh-wide mTLS policy
kubectl get peerauthentication -n istio-system

# Check service-specific mTLS policies
kubectl get peerauthentication -n default

# Verify DestinationRules
kubectl get destinationrule -n default
```

### Verify Network Policies

```bash
# List network policies
kubectl get networkpolicy -n default

# Describe a specific policy
kubectl describe networkpolicy leaseflow-backend-netpol -n default
```

### Verify Authorization Policies

```bash
# List authorization policies
kubectl get authorizationpolicy -n default

# Check policy details
kubectl describe authorizationpolicy backend-to-postgresql -n default
```

### Verify Sidecar Injection

```bash
# Check pod containers
kubectl get pods -n default -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].name}{"\n"}{end}'

# Each pod should show both application container and istio-proxy
```

### Test mTLS Communication

```bash
# Exec into a pod
kubectl exec -it <pod-name> -n default -- /bin/sh

# Test connection to another service (should use mTLS)
curl -v http://leaseflow-backend-service:4000/health

# Check Istio proxy logs
kubectl logs <pod-name> -n default -c istio-proxy
```

### Verify Database TLS

```bash
# Check database connection logs
kubectl logs <backend-pod> -n default | grep -i ssl

# Test connection with TLS verification
kubectl exec -it <backend-pod> -n default -- psql "postgresql://user:pass@postgresql-service:5432/leaseflow?sslmode=verify-full"
```

## Troubleshooting

### Sidecar Not Injected

**Symptom**: Pod has only 1 container instead of 2

**Solution**:
```bash
# Verify namespace label
kubectl label namespace default istio-injection=enabled --overwrite

# Restart pods
kubectl rollout restart deployment/<deployment-name>
```

### mTLS Connection Errors

**Symptom**: 503 Service Unavailable or connection refused

**Solution**:
```bash
# Check PeerAuthentication policies
kubectl get peerauthentication -n default

# Verify DestinationRules are applied
kubectl get destinationrule -n default

# Check Istio proxy logs
kubectl logs <pod-name> -n default -c istio-proxy
```

### Network Policy Blocking Traffic

**Symptom**: Connection timeout or ECONNREFUSED

**Solution**:
```bash
# Describe network policy
kubectl describe networkpolicy <policy-name> -n default

# Check pod labels match policy selectors
kubectl get pods -n default --show-labels

# Temporarily disable for debugging
kubectl patch networkpolicy <policy-name> -n default -p '{"spec":{"policyTypes":["Ingress","Egress"]}}'
```

### Database TLS Verification Failed

**Symptom**: Connection refused or certificate verification error

**Solution**:
```bash
# Verify certificate mounts
kubectl describe pod <pod-name> -n default | grep -A 10 VolumeMounts

# Check certificate paths in ConfigMap
kubectl get configmap leaseflow-backend-config -n default -o yaml

# Verify sslmode setting
kubectl get configmap leaseflow-backend-config -n default -o yaml | grep sslmode
```

## Security Best Practices

### 1. Certificate Rotation

Istio automatically rotates certificates every 90 days. Monitor:

```bash
# Check certificate expiration
kubectl exec -it <pod-name> -n default -- /bin/sh
istioctl proxy-config secret <pod-name>.default -o json
```

### 2. Policy Auditing

Regularly audit security policies:

```bash
# Export all policies for review
kubectl get peerauthentication,authorizationpolicy,networkpolicy -n default -o yaml > security-policies.yaml
```

### 3. Monitoring

Enable Istio telemetry for security monitoring:

```bash
# Enable Prometheus metrics
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.19/samples/addons/prometheus.yaml

# Enable Grafana dashboards
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.19/samples/addons/grafana.yaml
```

### 4. Incident Response

If a breach is detected:

```bash
# Immediately revoke compromised service identity
kubectl delete serviceaccount <compromised-sa>

# Restart affected pods to force new certificates
kubectl rollout restart deployment/<deployment-name>

# Review and tighten authorization policies
kubectl edit authorizationpolicy <policy-name> -n default
```

## Acceptance Criteria Verification

### Acceptance 1: Zero-Trust Architectural Model

**Verification**:
```bash
# Verify strict mTLS is enabled
kubectl get peerauthentication -n istio-system -o yaml | grep mode: STRICT

# Verify default-deny network policy exists
kubectl get networkpolicy default-deny-all -n default

# Verify all pods have sidecars
kubectl get pods -n default -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].name}{"\n"}{end}' | grep istio-proxy
```

### Acceptance 2: Encrypted and Authenticated Communication

**Verification**:
```bash
# Check mTLS status between services
istioctl authn tls-check <pod-name> -n default

# Verify all services have PeerAuthentication
kubectl get peerauthentication -n default

# Verify DestinationRules enforce ISTIO_MUTUAL
kubectl get destinationrule -n default -o yaml | grep mode: ISTIO_MUTUAL
```

### Acceptance 3: Lateral Movement Blocked

**Verification**:
```bash
# Verify network policies restrict traffic
kubectl get networkpolicy -n default

# Verify authorization policies enforce service-to-service access
kubectl get authorizationpolicy -n default

# Test unauthorized access (should fail)
kubectl run test-pod --image=curlimages/curl -i --rm --restart=Never -- curl http://redis-service:6379
```

## References

- [Istio Security Overview](https://istio.io/latest/docs/concepts/security/)
- [Istio mTLS](https://istio.io/latest/docs/concepts/security/#mutual-tls-authentication)
- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [PostgreSQL SSL Connection](https://www.postgresql.org/docs/current/libpq-ssl.html)

## Support

For issues or questions:
1. Check Istio logs: `kubectl logs -n istio-system deployment/istiod`
2. Check pod logs: `kubectl logs <pod-name> -n default -c istio-proxy`
3. Review Istio dashboard: `istioctl dashboard`
