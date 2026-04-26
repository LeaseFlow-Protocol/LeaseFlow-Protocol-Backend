# Multi-Region Disaster Recovery Architecture for LeaseFlow Protocol

## Executive Summary

This document defines a comprehensive multi-region Disaster Recovery (DR) architecture designed to ensure the LeaseFlow Protocol can survive the total physical destruction of a primary AWS data center region. The architecture implements an active-passive failover model with automated DNS routing, database replication, and data synchronization across regions.

**Recovery Time Objective (RTO):** 60 seconds (DNS failover) + 5 minutes (database promotion) = **6 minutes total**
**Recovery Point Objective (RPO):** < 1 second (synchronous replication for critical data) / 5 minutes (async replication for PDFs)

## Architecture Overview

### Primary Region (Active)
- **Region:** AWS us-east-1 (N. Virginia)
- **Components:**
  - EKS Kubernetes Cluster (3 nodes, m5.large)
  - Amazon RDS PostgreSQL (Multi-AZ, db.r5.xlarge)
  - Application Load Balancer (ALB)
  - S3 Bucket for PDF lease agreements
  - Redis ElastiCache Cluster

### Secondary Region (Passive Standby)
- **Region:** AWS eu-west-1 (Ireland)
- **Components:**
  - EKS Kubernetes Cluster (1 node, m5.large - scaled down)
  - Amazon RDS PostgreSQL Read Replica (db.r5.large)
  - Application Load Balancer (ALB - passive)
  - S3 Bucket with Cross-Region Replication (CRR)
  - Redis ElastiCache (standalone, cache.t3.medium)

### DNS Layer
- **Primary DNS:** AWS Route53 with Health Checks
- **Secondary DNS:** Cloudflare Load Balancing (for global distribution)
- **Failover Mechanism:** Automatic health-check based routing

## Component Architecture

### 1. Database Layer

#### Primary Database (us-east-1)
```hcl
# Amazon RDS PostgreSQL Multi-AZ
- Instance Class: db.r5.xlarge (4 vCPU, 32 GB RAM)
- Storage: 500 GB gp3 SSD
- Multi-AZ: Enabled (us-east-1a, us-east-1b)
- Backup Retention: 30 days
- Automated Backups: Enabled
- Performance Insights: Enabled
```

#### Secondary Database (eu-west-1)
```hcl
# Amazon RDS PostgreSQL Read Replica
- Instance Class: db.r5.large (2 vCPU, 16 GB RAM)
- Storage: 500 GB gp3 SSD (mirrored from primary)
- Replication: Asynchronous
- Promotion Time: ~5 minutes
- Backup Retention: 7 days (standalone after promotion)
```

**Replication Configuration:**
- **WAL Level:** logical
- **Max Replication Slots:** 10
- **Max WAL Senders:** 10
- **Replication Lag Monitoring:** < 100ms target

### 2. Application Layer

#### Primary EKS Cluster (us-east-1)
```yaml
Node Group:
  - Instance Type: m5.large
  - Node Count: 3 (auto-scaling 3-10)
  - Capacity Type: ON_DEMAND
  
Deployment:
  - Replicas: 3 (per service)
  - HPA: Enabled (min 3, max 10)
  - PDB: minAvailable: 2
```

#### Secondary EKS Cluster (eu-west-1)
```yaml
Node Group:
  - Instance Type: m5.large
  - Node Count: 1 (manual scaling during failover)
  - Capacity Type: ON_DEMAND
  
Deployment:
  - Replicas: 1 (per service - warm standby)
  - HPA: Disabled (manual scaling)
  - PDB: Not configured (single node)
```

**Failover Scaling:**
- Manual node group scaling: 1 → 3 nodes
- Horizontal Pod Autoscaler activation
- Expected scaling time: 2-3 minutes

### 3. Storage Layer

#### Primary S3 Bucket (us-east-1)
```yaml
Bucket: leaseflow-lease-agreements-primary
- Versioning: Enabled
- Encryption: AES-256
- Lifecycle: Transition to Glacier after 90 days
- Access: Private (via signed URLs)
```

#### Secondary S3 Bucket (eu-west-1)
```yaml
Bucket: leaseflow-lease-agreements-secondary
- Versioning: Enabled
- Encryption: AES-256
- Replication: CRR from primary
- Replication Time: ~15 minutes
```

**Cross-Region Replication Rules:**
- **Replication Source:** us-east-1 bucket
- **Replication Destination:** eu-west-1 bucket
- **Storage Class:** Same as source
- **Replication Time:** Async (within 15 minutes SLA)
- **Replication Status:** Monitored via CloudWatch

### 4. DNS and Routing Layer

#### AWS Route53 Configuration
```yaml
Primary Record Set:
  - Name: api.leaseflow.protocol
  - Type: A
  - Routing Policy: Failover
  - Primary Endpoint: us-east-1 ALB
  - Secondary Endpoint: eu-west-1 ALB
  - Health Check: /health endpoint
  - Health Check Interval: 30 seconds
  - Failover Threshold: 3 consecutive failures
```

#### Cloudflare Load Balancing (Optional Enhancement)
```yaml
Load Balancer:
  - Name: leaseflow-api-lb
  - Primary Pool: us-east-1 ALB
  - Fallback Pool: eu-west-1 ALB
  - Steering Policy: Geo
  - TTL: 60 seconds
  - Health Check Interval: 60 seconds
```

**Failover Logic:**
1. Health check fails 3 times (90 seconds)
2. Route53 automatically switches to secondary
3. DNS TTL ensures propagation within 60 seconds
4. Total failover time: ~150 seconds (2.5 minutes)

## Network Architecture

### VPC Configuration

#### Primary VPC (us-east-1)
```
CIDR: 10.0.0.0/16
- Public Subnets: 10.0.1.0/24, 10.0.2.0/24
- Private Subnets: 10.0.10.0/24, 10.0.11.0/24
- Database Subnets: 10.0.20.0/24, 10.0.21.0/24
```

#### Secondary VPC (eu-west-1)
```
CIDR: 10.1.0.0/16
- Public Subnets: 10.1.1.0/24, 10.1.2.0/24
- Private Subnets: 10.1.10.0/24, 10.1.11.0/24
- Database Subnets: 10.1.20.0/24, 10.1.21.0/24
```

### Inter-Region Connectivity
- **VPC Peering:** Enabled between us-east-1 and eu-west-1
- **Transit Gateway:** Optional for multi-region expansion
- **VPN:** Backup connectivity option
- **Route Tables:** Configured for cross-region communication

## Security Architecture

### IAM Roles and Policies
- **Cross-Region Role:** Role for secondary region to access primary resources
- **Database Replication Role:** RDS replication role with minimal permissions
- **S3 Replication Role:** Role for CRR with bucket-specific permissions
- **EKS Node Role:** Standard node role with regional restrictions

### Encryption
- **At Rest:**
  - RDS: AWS KMS (CMK per region)
  - EBS: AWS KMS (default key)
  - S3: AES-256 (server-side encryption)
- **In Transit:**
  - TLS 1.3 for all inter-service communication
  - Certificate managed by AWS Certificate Manager
  - Private subnets for database communication

### Network Security
- **Security Groups:**
  - Restrictive inbound rules
  - Specific IP ranges for replication
  - VPC-only database access
- **NACLs:**
  - Stateful rules for known traffic
  - Deny-all default for unknown traffic
- **WAF:**
  - AWS WAF on ALB
  - Rate limiting rules
  - SQL injection protection

## Monitoring and Alerting

### CloudWatch Metrics
- **Database:**
  - Replication lag (CloudWatch metric)
  - CPU utilization
  - Connection count
  - Storage usage
- **Application:**
  - Health check status
  - Error rates
  - Latency metrics
  - Request counts
- **Infrastructure:**
  - Node health
  - Pod status
  - ALB health

### Alarms
```yaml
Critical Alarms:
  - Primary database down: SMS + PagerDuty
  - Replication lag > 5 seconds: Email + Slack
  - Health check failure (3 consecutive): Email + Slack
  - S3 replication failure: Email + Slack

Warning Alarms:
  - High CPU utilization (>80%): Email
  - High memory usage (>85%): Email
  - Disk space low (<20%): Email
```

### Dashboards
- **DR Status Dashboard:** Real-time view of all DR components
- **Replication Lag Dashboard:** Database replication metrics
- **Failover Test Dashboard:** Historical failover test results

## Disaster Recovery Runbooks

### Scenario 1: Primary Region Outage (Total Failure)

**Detection:**
- Route53 health checks fail (3 consecutive failures)
- CloudWatch alarms trigger
- PagerDuty escalation to on-call engineer

**Automated Actions:**
1. DNS automatically fails over to secondary region (90 seconds)
2. Traffic redirects to eu-west-1 ALB
3. Secondary cluster receives traffic

**Manual Actions (within 5 minutes):**
1. Promote PostgreSQL read replica to primary
2. Scale secondary EKS node group (1 → 3 nodes)
3. Enable HPA on secondary cluster
4. Update application configuration to point to promoted database
5. Verify all services are healthy
6. Monitor for any data inconsistencies

**Verification:**
- Health checks pass on secondary
- Database writes successful
- API endpoints responding
- S3 bucket accessible

**Estimated Total RTO:** 6 minutes

### Scenario 2: Database Corruption

**Detection:**
- Database health checks fail
- Corruption detected in WAL logs
- Application errors on database queries

**Actions:**
1. Stop replication to prevent corruption spread
2. Assess scope of corruption
3. Restore from latest clean backup (point-in-time recovery)
4. Re-establish replication from restored primary
5. Verify data integrity
6. Resume normal operations

**Estimated RTO:** 30-60 minutes (depending on backup size)

### Scenario 3: Network Partition

**Detection:**
- Health checks fail intermittently
- Network latency spikes
- Partial connectivity loss

**Actions:**
1. Determine if primary or secondary is isolated
2. If primary isolated, initiate failover
3. If secondary isolated, continue on primary
4. Once connectivity restored, re-sync data
5. Verify replication consistency

**Estimated RTO:** 5-10 minutes

## Cost Estimation

### Primary Region (us-east-1) - Monthly
```
EKS Cluster: $73/month (cluster fee)
- Nodes (3x m5.large): $216/month
- ALB: $18/month + $0.008/GB
- RDS Multi-AZ (db.r5.xlarge): $520/month
- RDS Storage (500 GB gp3): $50/month
- S3 Storage (1 TB): $23/month
- ElastiCache (cache.m5.large): $145/month
- Data Transfer: $50/month (estimated)
Total: ~$1,095/month
```

### Secondary Region (eu-west-1) - Monthly
```
EKS Cluster: $73/month (cluster fee)
- Nodes (1x m5.large): $72/month
- ALB: $18/month + $0.008/GB
- RDS Read Replica (db.r5.large): $260/month
- RDS Storage (500 GB gp3): $50/month
- S3 Storage (1 TB): $23/month
- ElastiCache (cache.t3.medium): $45/month
- Data Transfer: $30/month (estimated)
- VPC Peering: $0.01/GB + $0.01/hr
Total: ~$571/month
```

### Total Monthly Cost
```
Primary Region: $1,095/month
Secondary Region: $571/month
Route53: $0.50/month (hosted zone)
CloudWatch: $10/month (estimated)
Total: ~$1,677/month
```

**Annual Cost:** ~$20,124/year

## Testing and Validation

### Monthly Failover Tests
- Schedule: First Sunday of each month
- Duration: 1 hour maintenance window
- Scope: Full failover to secondary region
- Validation: All services functional on secondary

### Quarterly Game Day Exercises
- Schedule: Quarterly (Jan, Apr, Jul, Oct)
- Duration: 4 hours
- Scope: Simulated region-wide outage
- Validation: Measure actual RTO and RPO

### Annual DR Audit
- Schedule: Annually (December)
- Scope: Full DR plan review and update
- Validation: Third-party audit (optional)

## Compliance Considerations

### Data Residency
- Primary data stored in us-east-1 (US)
- Secondary data stored in eu-west-1 (EU)
- GDPR compliance via EU secondary region
- Data classification and tagging

### Audit Trail
- All failover events logged to CloudTrail
- Database replication logs retained for 90 days
- S3 access logs enabled and archived
- Application audit logs centralized

### Backup Requirements
- Database backups: 30-day retention
- S3 versioning: Enabled
- EBS snapshots: Weekly, 30-day retention
- Configuration backups: Terraform state in S3

## Implementation Timeline

### Phase 1: Foundation (Weeks 1-2)
- Create secondary VPC and networking
- Set up VPC peering between regions
- Configure IAM roles and policies
- Set up monitoring and alerting

### Phase 2: Database Replication (Weeks 3-4)
- Create RDS read replica in eu-west-1
- Configure replication settings
- Test replication lag
- Document promotion procedure

### Phase 3: Application Standby (Weeks 5-6)
- Deploy EKS cluster in eu-west-1
- Deploy application in warm standby mode
- Configure ALB in secondary region
- Test application connectivity

### Phase 4: Storage Replication (Week 7)
- Create secondary S3 bucket
- Configure CRR rules
- Test replication latency
- Verify data integrity

### Phase 5: DNS Failover (Week 8)
- Configure Route53 health checks
- Set up failover routing policy
- Test DNS failover
- Configure Cloudflare (optional)

### Phase 6: Testing and Validation (Weeks 9-10)
- Conduct first full failover test
- Measure actual RTO and RPO
- Refine runbooks based on test results
- Document lessons learned

### Phase 7: Go-Live (Week 11)
- Final validation
- Team training
- Handover to operations
- Ongoing maintenance procedures

## Maintenance Procedures

### Weekly
- Review CloudWatch alarms
- Check replication lag metrics
- Verify health check status
- Review cost reports

### Monthly
- Conduct failover test
- Review and update runbooks
- Validate backup integrity
- Update documentation

### Quarterly
- Conduct Game Day exercise
- Review and optimize costs
- Update security patches
- Compliance audit

### Annually
- Full DR plan review
- Third-party audit (optional)
- Architecture review and optimization
- Budget planning for next year

## Appendix A: Terraform Module Structure

```
infrastructure/
├── modules/
│   ├── vpc/
│   ├── eks/
│   ├── rds/
│   ├── alb/
│   ├── s3/
│   └── route53/
├── environments/
│   ├── primary/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── secondary/
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
└── global/
    ├── iam/
    ├── monitoring/
    └── networking/
```

## Appendix B: Contact Information

### Primary Contacts
- **DR Lead:** dr-lead@leaseflow.io
- **Database Admin:** dba@leaseflow.io
- **DevOps Engineer:** devops@leaseflow.io
- **On-Call Engineer:** oncall@leaseflow.io (PagerDuty)

### External Contacts
- **AWS Support:** 1-800-588-1529
- **Cloudflare Support:** support.cloudflare.com
- **Managed Service Provider:** msp@leaseflow.io

## Appendix C: Glossary

- **RTO:** Recovery Time Objective - Time to restore service after outage
- **RPO:** Recovery Point Objective - Maximum acceptable data loss
- **CRR:** Cross-Region Replication - S3 replication across regions
- **ALB:** Application Load Balancer - AWS Layer 7 load balancer
- **EKS:** Elastic Kubernetes Service - AWS managed Kubernetes
- **RDS:** Relational Database Service - AWS managed PostgreSQL
- **VPC:** Virtual Private Cloud - Isolated network in AWS
- **WAL:** Write-Ahead Log - PostgreSQL transaction log
- **HPA:** Horizontal Pod Autoscaler - Kubernetes autoscaling
- **PDB:** Pod Disruption Budget - Kubernetes availability guarantee

---

**Document Version:** 1.0
**Last Updated:** 2026-04-26
**Next Review:** 2026-07-26
