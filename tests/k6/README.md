# K6 Load Tests for HPA Verification

This directory contains K6 load test scripts to verify that the Kubernetes Horizontal Pod Autoscaler (HPA) correctly triggers and scales the LeaseFlow backend and worker deployments.

## Prerequisites

- K6 installed: `brew install k6` (macOS) or `choco install k6` (Windows)
- Access to the GraphQL API endpoint
- Kubernetes cluster with HPA configured
- Prometheus Adapter configured for external metrics

## Test Scripts

### 1. HPA Load Test (`hpa-load-test.js`)

Simulates a massive traffic spike (e.g., viral real-estate listing) to verify CPU-based autoscaling.

**Purpose:**
- Test CPU-based HPA scaling for the main backend deployment
- Verify scale-up behavior during traffic spikes
- Verify scale-down stabilization window (5 minutes)
- Confirm maxReplicas ceiling prevents over-scaling

**Usage:**
```bash
# Set the API URL (default: http://localhost:4000/graphql)
export API_URL=https://api.leaseflow.protocol/graphql

# Run the test
k6 run tests/k6/hpa-load-test.js

# Run with specific options
k6 run --out json=results.json tests/k6/hpa-load-test.js
```

**Test Stages:**
1. **Baseline (2m)**: 10 VUs - Normal traffic
2. **Ramp-up (3m)**: 10 → 50 VUs - Gradual increase
3. **Spike (2m)**: 50 → 200 VUs - Viral listing simulation
4. **Sustained (5m)**: 200 VUs - Keep HPA triggered
5. **Ramp-down (5m)**: 200 → 20 VUs - Verify scale-down stabilization
6. **Baseline (2m)**: 20 → 10 VUs - Return to normal

**Monitoring During Test:**
```bash
# Watch HPA status in real-time
watch -n 2 'kubectl get hpa leaseflow-backend'

# Watch pod scaling
watch -n 2 'kubectl get pods -l app=leaseflow-backend'

# Check CPU utilization
kubectl top pods -l app=leaseflow-backend
```

### 2. Worker Queue Load Test (`worker-queue-load-test.js`)

Simulates BullMQ/Redis queue backlog to verify external metrics-based autoscaling for workers.

**Purpose:**
- Test queue-based HPA scaling for worker deployments
- Verify external metrics integration (Redis queue length)
- Confirm workers scale when queue exceeds 1000 items
- Verify scale-down stabilization for workers

**Usage:**
```bash
# Set the API URL
export API_URL=https://api.leaseflow.protocol/graphql

# Run the test
k6 run tests/k6/worker-queue-load-test.js

# Run with specific options
k6 run --out json=worker-results.json tests/k6/worker-queue-load-test.js
```

**Test Stages:**
1. **Baseline (2m)**: 5 VUs - Normal queue activity
2. **Queue Buildup (3m)**: 5 → 50 VUs - Gradual queue increase
3. **Queue Spike (2m)**: 50 → 200 VUs - Ledger event flood (>1000 items)
4. **Sustained (5m)**: 200 VUs - Keep worker HPA triggered
5. **Queue Drain (5m)**: 200 → 20 VUs - Verify scale-down stabilization
6. **Baseline (2m)**: 20 → 5 VUs - Return to normal

**Monitoring During Test:**
```bash
# Watch worker HPA status
watch -n 2 'kubectl get hpa leaseflow-backend-worker'

# Watch worker pod scaling
watch -n 2 'kubectl get pods -l component=worker'

# Check Redis queue lengths
redis-cli --scan --pattern "*:wait" | xargs -L1 redis-cli LLEN

# Check external metrics
kubectl get --raw /apis/external.metrics.k8s.io/v1beta1/namespaces/default/bullmq_soroban_indexer_queue_length
```

## Expected Results

### Backend HPA (CPU-based)
- **Scale-up trigger**: When average CPU > 70%
- **Scale-up behavior**: Immediate (0s stabilization), max 100% increase or 2 pods per 30s
- **Scale-down trigger**: When average CPU < 70%
- **Scale-down behavior**: 5-minute stabilization window, max 50% decrease per 60s
- **Max replicas**: 10 (security ceiling to prevent DDoS cost escalation)

### Worker HPA (Queue-based)
- **Scale-up trigger**: When queue length > 1000 items
- **Scale-up behavior**: Immediate (0s stabilization), max 100% increase or 2 pods per 30s
- **Scale-down trigger**: When queue length < 1000 items
- **Scale-down behavior**: 5-minute stabilization window, max 50% decrease per 60s
- **Max replicas**: 8 (security ceiling to prevent DDoS cost escalation)

## Troubleshooting

### HPA Not Scaling
```bash
# Check HPA status
kubectl describe hpa leaseflow-backend

# Check metrics server
kubectl get apiservice | grep metrics

# Check if metrics are being reported
kubectl top pods
```

### External Metrics Not Available
```bash
# Check Prometheus Adapter
kubectl get pods -n monitoring -l app=prometheus-adapter

# Check APIService registration
kubectl get apiservice | grep external.metrics

# Check custom metrics
kubectl get --raw /apis/external.metrics.k8s.io/v1beta1/
```

### Queue Metrics Not Exposed
```bash
# Check Redis exporter
kubectl get pods -n monitoring -l app=redis-queue-exporter

# Check Prometheus targets
kubectl port-forward svc/prometheus-service 9090:9090
# Visit http://localhost:9090/targets
```

## Integration with CI/CD

Add to your CI/CD pipeline to verify HPA configuration before deployment:

```yaml
# Example GitHub Actions workflow
- name: Run HPA Load Test
  run: |
    k6 run --out json=hpa-results.json tests/k6/hpa-load-test.js
    
- name: Verify HPA Scaling
  run: |
    kubectl wait --for=condition=available --timeout=5m deployment/leaseflow-backend
    kubectl get hpa leaseflow-backend -o jsonpath='{.status.currentReplicas}'
```

## Performance Baselines

Establish performance baselines in your environment:

- **Normal load**: 3-5 backend pods, 2 worker pods
- **Moderate spike**: 5-8 backend pods, 3-5 worker pods
- **Massive spike**: 8-10 backend pods, 6-8 worker pods
- **Scale-down time**: 5+ minutes after load decreases (stabilization window)

## Security Considerations

- **Max replicas ceiling**: Prevents DDoS attacks from bankrupting infrastructure accounts
- **Scale-down stabilization**: Prevents thrashing and ensures cost control
- **External metrics validation**: Only scale based on verified Prometheus metrics
- **Resource limits**: Each pod has CPU/memory limits to prevent runaway costs

## Documentation

For detailed HPA configuration, see:
- [HPA Configuration Guide](../../docs/HPA_CONFIGURATION.md)
- [Kubernetes HPA Documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Prometheus Adapter Documentation](https://github.com/kubernetes-sigs/prometheus-adapter)
