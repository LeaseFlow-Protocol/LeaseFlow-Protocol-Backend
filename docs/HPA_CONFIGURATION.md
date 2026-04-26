# Horizontal Pod Autoscaler (HPA) Configuration Guide

This document describes the Kubernetes Horizontal Pod Autoscaler (HPA) configuration for the LeaseFlow Protocol Backend, including CPU-based scaling for the main API and queue-based scaling for background workers.

## Overview

The HPA configuration enables the backend to dynamically react to massive traffic spikes without manual DevOps intervention. It includes:

- **CPU-based scaling** for the main backend deployment (target: 70% utilization)
- **Queue-based scaling** for worker deployments using external metrics (threshold: 1000 items)
- **Scale-down stabilization windows** (5 minutes) to prevent thrashing
- **Security maxReplicas ceilings** to prevent DDoS attacks from bankrupting infrastructure accounts

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                          │
│                                                                  │
│  ┌──────────────────────┐         ┌──────────────────────┐      │
│  │  Backend Deployment  │         │  Worker Deployment  │      │
│  │  (GraphQL API)       │         │  (Soroban/Webhook)   │      │
│  │                      │         │                      │      │
│  │  minReplicas: 3      │         │  minReplicas: 2      │      │
│  │  maxReplicas: 10     │         │  maxReplicas: 8      │      │
│  └──────────┬───────────┘         └──────────┬───────────┘      │
│             │                                 │                  │
│             │ CPU > 70%                       │ Queue > 1000     │
│             ▼                                 ▼                  │
│  ┌──────────────────────┐         ┌──────────────────────┐      │
│  │  Backend HPA         │         │  Worker HPA          │      │
│  │  (Resource Metrics)  │         │  (External Metrics)  │      │
│  └──────────┬───────────┘         └──────────┬───────────┘      │
│             │                                 │                  │
│             └─────────────┬───────────────────┘                  │
│                           │                                      │
│                           ▼                                      │
│              ┌──────────────────────┐                           │
│              │  Metrics Server      │                           │
│              │  (CPU/Memory)        │                           │
│              └──────────┬───────────┘                           │
│                           │                                      │
│                           ▼                                      │
│              ┌──────────────────────┐                           │
│              │  Prometheus Adapter  │                           │
│              │  (External Metrics)  │                           │
│              └──────────┬───────────┘                           │
│                           │                                      │
│                           ▼                                      │
│              ┌──────────────────────┐                           │
│              │  Redis Queue Exporter│                           │
│              │  (BullMQ Metrics)    │                           │
│              └──────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration Files

### 1. Backend HPA Template

**File:** `k8s/charts/leaseflow-backend/templates/hpa.yaml`

**Key Features:**
- CPU-based scaling with 70% target utilization
- Memory-based scaling with 80% target utilization
- Scale-down stabilization window: 300 seconds (5 minutes)
- Scale-up: Immediate response (0s stabilization)
- Max replicas: 10 (security ceiling)

**Configuration:**
```yaml
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80
  scaleDownStabilizationSeconds: 300
  scaleDownPercent: 50
  scaleDownPeriodSeconds: 60
  scaleUpStabilizationSeconds: 0
  scaleUpPercent: 100
  scaleUpPods: 2
  scaleUpPeriodSeconds: 30
```

### 2. Worker Deployment Template

**File:** `k8s/charts/leaseflow-backend/templates/worker-deployment.yaml`

**Key Features:**
- Separate deployment for Soroban Indexer and Webhook workers
- Two containers per pod (one for each worker type)
- Redis init container to ensure connectivity
- Health checks for both worker types
- Resource limits to prevent runaway costs

**Configuration:**
```yaml
workers:
  enabled: true
  replicaCount: 2
  resources:
    limits:
      cpu: 500m
      memory: 1Gi
    requests:
      cpu: 250m
      memory: 512Mi
```

### 3. Worker HPA Template

**File:** `k8s/charts/leaseflow-backend/templates/worker-hpa.yaml`

**Key Features:**
- External metrics support for queue-based scaling
- CPU-based scaling as fallback
- Scale-down stabilization window: 300 seconds (5 minutes)
- Max replicas: 8 (security ceiling)
- Queue threshold: 1000 items

**Configuration:**
```yaml
workers:
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 8
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: 80
    scaleDownStabilizationSeconds: 300
    externalMetrics:
      - name: bullmq_soroban_indexer_queue_length
        selector:
          queue: soroban-indexer
        targetType: AverageValue
        targetValue: "1000"
      - name: bullmq_webhook_queue_length
        selector:
          queue: webhook
        targetType: AverageValue
        targetValue: "1000"
```

### 4. Prometheus Adapter Configuration

**File:** `k8s/prometheus-adapter-config.yaml`

**Key Features:**
- Exposes BullMQ queue length metrics to Kubernetes
- Configures external metrics API
- Redis queue exporter with Lua script
- RBAC configuration for metrics access

**Metrics Exposed:**
- `bullmq_soroban_indexer_queue_length` - Soroban Indexer queue size
- `bullmq_webhook_queue_length` - Webhook queue size
- Generic queue metrics for any BullMQ queue

## Deployment

### Prerequisites

1. **Kubernetes Metrics Server** (for CPU/memory metrics):
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

2. **Prometheus** (for external metrics):
```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install prometheus prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
```

3. **Prometheus Adapter** (for external metrics API):
```bash
kubectl apply -f k8s/prometheus-adapter-config.yaml
```

### Deploy the Helm Chart

```bash
# Deploy the backend with HPA enabled
helm install leaseflow-backend ./k8s/charts/leaseflow-backend \
  --namespace leaseflow \
  --create-namespace \
  --values k8s/charts/leaseflow-backend/values.yaml

# Verify HPA is created
kubectl get hpa -n leaseflow
```

### Verify Configuration

```bash
# Check HPA status
kubectl describe hpa leaseflow-backend -n leaseflow

# Check worker HPA status
kubectl describe hpa leaseflow-backend-worker -n leaseflow

# Verify external metrics are available
kubectl get --raw /apis/external.metrics.k8s.io/v1beta1/

# Check Prometheus Adapter
kubectl get pods -n monitoring -l app=prometheus-adapter

# Check Redis Queue Exporter
kubectl get pods -n monitoring -l app=redis-queue-exporter
```

## Scaling Behavior

### Backend Scaling (CPU-based)

**Scale-up Trigger:**
- Average CPU utilization across all pods > 70%
- Immediate response (0s stabilization window)
- Maximum: 100% increase or 2 pods per 30 seconds (whichever is greater)

**Scale-down Trigger:**
- Average CPU utilization across all pods < 70%
- 5-minute stabilization window to prevent thrashing
- Maximum: 50% decrease per 60 seconds

**Replica Range:**
- Minimum: 3 replicas
- Maximum: 10 replicas (security ceiling)

### Worker Scaling (Queue-based)

**Scale-up Trigger:**
- BullMQ queue length > 1000 items
- Immediate response (0s stabilization window)
- Maximum: 100% increase or 2 pods per 30 seconds (whichever is greater)

**Scale-down Trigger:**
- BullMQ queue length < 1000 items
- 5-minute stabilization window to prevent thrashing
- Maximum: 50% decrease per 60 seconds

**Replica Range:**
- Minimum: 2 replicas
- Maximum: 8 replicas (security ceiling)

## Monitoring

### Real-time Monitoring

```bash
# Watch HPA status
watch -n 2 'kubectl get hpa -n leaseflow'

# Watch pod scaling
watch -n 2 'kubectl get pods -n leaseflow'

# Check CPU utilization
kubectl top pods -n leaseflow

# Check Redis queue lengths
redis-cli --scan --pattern "*:wait" | xargs -L1 redis-cli LLEN

# Check external metrics
kubectl get --raw /apis/external.metrics.k8s.io/v1beta1/namespaces/leaseflow/bullmq_soroban_indexer_queue_length
```

### Prometheus Dashboard

Create a Grafana dashboard to visualize:

1. **HPA Metrics:**
   - Current replicas vs. desired replicas
   - CPU utilization percentage
   - Memory utilization percentage
   - Scale-up/scale-down events

2. **Worker Metrics:**
   - Queue length over time
   - Worker pod count
   - Queue processing rate
   - External metric values

3. **Alerts:**
   - HPA at max replicas (potential DDoS)
   - Queue length critical (>5000 items)
   - Scale-down thrashing detected

## Testing

### Load Testing with K6

See [K6 Load Tests](../tests/k6/README.md) for detailed testing procedures.

**Quick Start:**
```bash
# Test CPU-based scaling
export API_URL=https://api.leaseflow.protocol/graphql
k6 run tests/k6/hpa-load-test.js

# Test queue-based scaling
k6 run tests/k6/worker-queue-load-test.js
```

### Manual Testing

```bash
# Simulate CPU load
kubectl run stress-test --image=polinux/stress --cpu=2 --timeout=300s

# Simulate queue backlog
redis-cli LPUSH soroban-indexer:wait $(seq 1 1500)

# Monitor scaling
kubectl get hpa -w
kubectl get pods -w
```

## Troubleshooting

### HPA Not Scaling

**Symptoms:** HPA shows 0/0 replicas or doesn't scale up

**Solutions:**
```bash
# Check if metrics server is running
kubectl get pods -n kube-system | grep metrics-server

# Verify metrics are being reported
kubectl top pods

# Check HPA conditions
kubectl describe hpa leaseflow-backend

# Check resource requests are set
kubectl describe deployment leaseflow-backend | grep -A 5 Resources
```

### External Metrics Not Available

**Symptoms:** Worker HPA shows "unable to get external metrics"

**Solutions:**
```bash
# Check Prometheus Adapter
kubectl get pods -n monitoring -l app=prometheus-adapter
kubectl logs -n monitoring -l app=prometheus-adapter

# Check APIService registration
kubectl get apiservice | grep external.metrics

# Verify Prometheus is scraping Redis exporter
kubectl port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090
# Visit http://localhost:9090/targets

# Check Redis exporter
kubectl get pods -n monitoring -l app=redis-queue-exporter
kubectl logs -n monitoring -l app=redis-queue-exporter
```

### Scale-down Thrashing

**Symptoms:** Pods scale up and down rapidly

**Solutions:**
```bash
# Increase stabilization window
kubectl patch hpa leaseflow-backend -p '{"spec":{"behavior":{"scaleDown":{"stabilizationWindowSeconds":600}}}}'

# Check current stabilization window
kubectl get hpa leaseflow-backend -o yaml | grep -A 10 behavior
```

### Max Replicas Reached

**Symptoms:** HPA shows "unable to scale" due to max replicas

**Solutions:**
```bash
# Check if it's a legitimate spike or DDoS
kubectl top pods
kubectl logs -l app=leaseflow-backend --tail=100

# If legitimate, increase max replicas temporarily
kubectl patch hpa leaseflow-backend -p '{"spec":{"maxReplicas":15}}'

# If DDoS, enable rate limiting at ingress level
kubectl annotate ingress leaseflow-backend nginx.ingress.kubernetes.io/rate-limit="50"
```

## Security Considerations

### Max Replicas Ceiling

The `maxReplicas` setting serves as a security ceiling to prevent DDoS attacks from bankrupting infrastructure accounts:

- **Backend:** maxReplicas: 10 (prevents runaway costs from API DDoS)
- **Workers:** maxReplicas: 8 (prevents runaway costs from queue flooding)

### Resource Limits

Each pod has strict resource limits:

- **Backend:** 1000m CPU, 2Gi memory per pod
- **Workers:** 500m CPU, 1Gi memory per pod

**Maximum cost scenario:**
- Backend: 10 pods × 1000m CPU × 2Gi memory
- Workers: 8 pods × 500m CPU × 1Gi memory

### Rate Limiting

Ingress-level rate limiting provides an additional layer of protection:

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/rate-limit-window: "1m"
```

## Best Practices

1. **Monitor costs closely** during traffic spikes
2. **Set up alerts** for max replicas reached
3. **Test HPA regularly** with load testing
4. **Review stabilization windows** based on traffic patterns
5. **Use Pod Disruption Budgets** to ensure availability during scaling
6. **Configure resource requests** accurately for predictable scaling
7. **Monitor queue depths** to prevent backlog accumulation
8. **Test external metrics** before relying on them for production

## Cost Optimization

### Right-sizing Resources

Monitor actual resource usage and adjust requests/limits:

```bash
# Monitor resource usage over time
kubectl top pods -n leaseflow --containers

# Adjust values.yaml based on actual usage
resources:
  limits:
    cpu: 800m  # Reduced from 1000m
    memory: 1.5Gi  # Reduced from 2Gi
```

### Cluster Autoscaler

Combine HPA with Cluster Autoscaler for node-level scaling:

```yaml
# Enable cluster autoscaler on your cloud provider
# AWS: Auto Scaling Groups
# GCP: Cluster Autoscaler
# Azure: Cluster Autoscaler
```

### Spot Instances

Use spot/preemptible instances for worker pods:

```yaml
workers:
  nodeSelector:
    cloud.google.com/gke-preemptible: "true"
  tolerations:
    - key: cloud.google.com/gke-preemptible
      operator: Equal
      value: "true"
      effect: NoSchedule
```

## References

- [Kubernetes HPA Documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Prometheus Adapter Documentation](https://github.com/kubernetes-sigs/prometheus-adapter)
- [Kubernetes Metrics Server](https://github.com/kubernetes-sigs/metrics-server)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [K6 Load Testing](https://k6.io/docs/)

## Support

For issues or questions:
- Create an issue in the GitHub repository
- Contact: dev@leaseflow.protocol
- Documentation: https://docs.leaseflow.protocol
