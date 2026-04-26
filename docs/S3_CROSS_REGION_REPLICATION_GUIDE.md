# S3 Cross-Region Replication Configuration for PDF Lease Agreements

## Overview

This document provides detailed instructions for configuring AWS S3 Cross-Region Replication (CRR) for PDF lease agreements between the primary region (us-east-1) and secondary region (eu-west-1).

**Purpose:** Ensure all PDF lease agreements are automatically replicated to the secondary region for disaster recovery.

**Replication Target:** < 15 minutes (AWS CRR SLA)
**Data Consistency:** Eventually consistent
**Storage Class:** Same as source (STANDARD)

## Architecture

### Primary Bucket (us-east-1)
- **Bucket Name:** leaseflow-lease-agreements-primary
- **Region:** us-east-1 (N. Virginia)
- **Versioning:** Enabled
- **Encryption:** AES-256 (server-side)
- **Access:** Private (via signed URLs)

### Secondary Bucket (eu-west-1)
- **Bucket Name:** leaseflow-lease-agreements-secondary
- **Region:** eu-west-1 (Ireland)
- **Versioning:** Enabled
- **Encryption:** AES-256 (server-side)
- **Access:** Private (via signed URLs)
- **Replication Source:** Primary bucket

## Prerequisites

### 1. Enable Versioning on Both Buckets
```bash
# Enable versioning on primary bucket
aws s3api put-bucket-versioning \
  --bucket leaseflow-lease-agreements-primary \
  --versioning-configuration Status=Enabled \
  --region us-east-1

# Enable versioning on secondary bucket
aws s3api put-bucket-versioning \
  --bucket leaseflow-lease-agreements-secondary \
  --versioning-configuration Status=Enabled \
  --region eu-west-1

# Verify versioning
aws s3api get-bucket-versioning \
  --bucket leaseflow-lease-agreements-primary \
  --region us-east-1

aws s3api get-bucket-versioning \
  --bucket leaseflow-lease-agreements-secondary \
  --region eu-west-1
```

### 2. Create IAM Role for Replication
```bash
# Create trust policy file
cat > replication-trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "s3.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create IAM role
aws iam create-role \
  --role-name leaseflow-s3-replication-role \
  --assume-role-policy-document file://replication-trust-policy.json

# Create permissions policy
cat > replication-permissions-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetReplicationConfiguration",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning"
      ],
      "Resource": [
        "arn:aws:s3:::leaseflow-lease-agreements-primary",
        "arn:aws:s3:::leaseflow-lease-agreements-secondary"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ReplicateObject",
        "s3:ReplicateDelete",
        "s3:ReplicateTags",
        "s3:GetObjectVersion",
        "s3:GetObjectVersionTagging"
      ],
      "Resource": [
        "arn:aws:s3:::leaseflow-lease-agreements-primary/*",
        "arn:aws:s3:::leaseflow-lease-agreements-secondary/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ],
      "Resource": [
        "arn:aws:kms:us-east-1:ACCOUNT_ID:key/PRIMARY_KMS_KEY_ID",
        "arn:aws:kms:eu-west-1:ACCOUNT_ID:key/SECONDARY_KMS_KEY_ID"
      ]
    }
  ]
}
EOF

# Attach policy to role
aws iam put-role-policy \
  --role-name leaseflow-s3-replication-role \
  --policy-name s3-replication-policy \
  --policy-document file://replication-permissions-policy.json

# Get role ARN
aws iam get-role \
  --role-name leaseflow-s3-replication-role \
  --query 'Role.Arn' \
  --output text
```

### 3. Configure KMS Keys (if using SSE-KMS)
```bash
# If using KMS encryption, ensure the replication role has KMS permissions
# This is already included in the permissions policy above

# Grant the replication role access to the KMS keys
aws kms put-key-policy \
  --key-id PRIMARY_KMS_KEY_ID \
  --policy-name default \
  --policy file://kms-policy.json
```

## Replication Configuration

### Option 1: Using AWS CLI
```bash
# Create replication configuration
cat > replication-config.json << EOF
{
  "Role": "arn:aws:iam::ACCOUNT_ID:role/leaseflow-s3-replication-role",
  "Rules": [
    {
      "Id": "leaseflow-pdf-replication",
      "Priority": 1,
      "Status": "Enabled",
      "Filter": {
        "Prefix": ""
      },
      "Destination": {
        "Bucket": "arn:aws:s3:::leaseflow-lease-agreements-secondary",
        "StorageClass": "STANDARD",
        "ReplicationTime": {
          "Status": "Enabled",
          "Time": {
            "Minutes": 15
          }
        },
        "Metrics": {
          "Status": "Enabled"
        },
        "AccessControlTranslation": {
          "Owner": "Destination"
        }
      },
      "DeleteMarkerReplication": {
        "Status": "Enabled"
      },
      "SourceSelectionCriteria": {
        "SseKmsEncryptedObjects": {
          "Enabled": true
        }
      }
    }
  ]
}
EOF

# Apply replication configuration to primary bucket
aws s3api put-bucket-replication \
  --bucket leaseflow-lease-agreements-primary \
  --replication-configuration file://replication-config.json \
  --region us-east-1

# Verify replication configuration
aws s3api get-bucket-replication \
  --bucket leaseflow-lease-agreements-primary \
  --region us-east-1
```

### Option 2: Using Terraform
The Terraform module in `infrastructure/modules/s3` already includes replication configuration support. Use the following configuration:

```hcl
module "s3_primary" {
  source = "../../modules/s3"

  bucket_name = "leaseflow-lease-agreements-primary"
  
  versioning = true
  encryption = true
  kms_key_id = aws_kms_key.primary.arn
  
  lifecycle_rules = [
    {
      id      = "archive-old-files"
      enabled = true
      
      transition = [
        {
          days          = 90
          storage_class = "GLACIER"
        }
      ]
      
      expiration = {
        days = 3650  # 10 years
      }
    }
  ]
  
  replication_configuration = {
    role = aws_iam_role.s3_replication.arn
    
    rules = [
      {
        id        = "replicate-to-secondary"
        status    = "Enabled"
        priority  = 1
        
        destination = {
          bucket        = module.s3_secondary.bucket_arn
          storage_class = "STANDARD"
          replica_kms_key_id = aws_kms_key.secondary.arn
          
          replication_time = {
            status = "Enabled"
            time   = "900"  # 15 minutes
          }
          
          metrics = {
            status = "Enabled"
          }
        }
        
        source_selection_criteria = {
          sse_kms_encrypted_objects = {
            enabled = true
          }
        }
        
        filter = {
          prefix = ""
          tags   = {}
        }
      }
    ]
  }
  
  tags = {
    Environment = "primary"
    Region      = "us-east-1"
    Purpose     = "pdf-storage"
  }
}
```

## Verification

### 1. Test Replication
```bash
# Upload a test file to primary bucket
echo "Test PDF content" > test-pdf.pdf
aws s3 cp test-pdf.pdf s3://leaseflow-lease-agreements-primary/test-pdf.pdf \
  --region us-east-1

# Wait for replication (up to 15 minutes)
# Check if file exists in secondary bucket
aws s3 ls s3://leaseflow-lease-agreements-secondary/test-pdf.pdf \
  --region eu-west-1

# Verify replication status
aws s3api head-object \
  --bucket leaseflow-lease-agreements-secondary \
  --key test-pdf.pdf \
  --region eu-west-1
```

### 2. Check Replication Metrics
```bash
# Use CloudWatch to monitor replication metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3Replication \
  --metric-name ReplicationLatency \
  --dimensions Name=BucketName,Value=leaseflow-lease-agreements-primary \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average

# Check replication bytes
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3Replication \
  --metric-name BytesReplicated \
  --dimensions Name=BucketName,Value=leaseflow-lease-agreements-primary \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Sum
```

### 3. Monitor Replication Status
```bash
# Enable S3 event notifications for replication events
aws s3api put-bucket-notification-configuration \
  --bucket leaseflow-lease-agreements-primary \
  --notification-configuration file://notification-config.json \
  --region us-east-1

# Create notification configuration
cat > notification-config.json << EOF
{
  "QueueConfigurations": [
    {
      "Id": "ReplicationEvents",
      "QueueArn": "arn:aws:sqs:us-east-1:ACCOUNT_ID:leaseflow-replication-queue",
      "Events": [
        "s3:Replication:OperationCompletedReplication",
        "s3:Replication:OperationFailedReplication",
        "s3:Replication:OperationMissedThreshold",
        "s3:Replication:OperationReplicatedAfterThreshold"
      ]
    }
  ]
}
EOF
```

## Monitoring and Alerting

### CloudWatch Alarms
```bash
# Create alarm for replication failures
aws cloudwatch put-metric-alarm \
  --alarm-name leaseflow-s3-replication-failures \
  --alarm-description "Alert when S3 replication fails" \
  --metric-name ReplicationOperationsFailed \
  --namespace AWS/S3Replication \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=BucketName,Value=leaseflow-lease-agreements-primary \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:leaseflow-alerts

# Create alarm for replication latency
aws cloudwatch put-metric-alarm \
  --alarm-name leaseflow-s3-replication-latency \
  --alarm-description "Alert when replication latency exceeds 15 minutes" \
  --metric-name ReplicationLatency \
  --namespace AWS/S3Replication \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 900 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=BucketName,Value=leaseflow-lease-agreements-primary \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:leaseflow-alerts
```

### CloudWatch Dashboard
Create a CloudWatch dashboard to monitor S3 replication:

```json
{
  "widgets": [
    {
      "type": "metric",
      "x": 0,
      "y": 0,
      "width": 12,
      "height": 6,
      "properties": {
        "metrics": [
          ["AWS/S3Replication", "ReplicationLatency", "BucketName", "leaseflow-lease-agreements-primary"],
          [".", "BytesReplicated", ".", "."],
          [".", "OperationsReplicated", ".", "."]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "S3 Replication Metrics"
      }
    },
    {
      "type": "metric",
      "x": 12,
      "y": 0,
      "width": 12,
      "height": 6,
      "properties": {
        "metrics": [
          ["AWS/S3", "BucketSizeBytes", "BucketName", "leaseflow-lease-agreements-primary", "StorageType", "StandardStorage"],
          [".", "NumberOfObjects", ".", "."]
        ],
        "period": 86400,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Primary Bucket Metrics"
      }
    }
  ]
}
```

## Lifecycle Configuration

### Primary Bucket Lifecycle
```bash
# Configure lifecycle rules for primary bucket
aws s3api put-bucket-lifecycle-configuration \
  --bucket leaseflow-lease-agreements-primary \
  --lifecycle-configuration file://primary-lifecycle.json \
  --region us-east-1

cat > primary-lifecycle.json << EOF
{
  "Rules": [
    {
      "Id": "ArchiveOldFiles",
      "Status": "Enabled",
      "Filter": {
        "Prefix": ""
      },
      "Transitions": [
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        },
        {
          "Days": 365,
          "StorageClass": "DEEP_ARCHIVE"
        }
      ],
      "Expiration": {
        "Days": 3650
      }
    }
  ]
}
EOF
```

### Secondary Bucket Lifecycle
```bash
# Configure lifecycle rules for secondary bucket
aws s3api put-bucket-lifecycle-configuration \
  --bucket leaseflow-lease-agreements-secondary \
  --lifecycle-configuration file://secondary-lifecycle.json \
  --region eu-west-1

cat > secondary-lifecycle.json << EOF
{
  "Rules": [
    {
      "Id": "ArchiveOldFiles",
      "Status": "Enabled",
      "Filter": {
        "Prefix": ""
      },
      "Transitions": [
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        },
        {
          "Days": 365,
          "StorageClass": "DEEP_ARCHIVE"
        }
      ],
      "Expiration": {
        "Days": 3650
      }
    }
  ]
}
EOF
```

## Security Considerations

### 1. Bucket Policies
```bash
# Primary bucket policy (restrict access)
cat > primary-bucket-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReplication",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT_ID:role/leaseflow-s3-replication-role"
      },
      "Action": [
        "s3:GetReplicationConfiguration",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning",
        "s3:ReplicateObject",
        "s3:ReplicateDelete",
        "s3:ReplicateTags",
        "s3:GetObjectVersion",
        "s3:GetObjectVersionTagging"
      ],
      "Resource": [
        "arn:aws:s3:::leaseflow-lease-agreements-primary",
        "arn:aws:s3:::leaseflow-lease-agreements-primary/*"
      ]
    },
    {
      "Sid": "DenyUnencryptedObjectUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::leaseflow-lease-agreements-primary/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "AES256"
        }
      }
    }
  ]
}
EOF

aws s3api put-bucket-policy \
  --bucket leaseflow-lease-agreements-primary \
  --policy file://primary-bucket-policy.json \
  --region us-east-1
```

### 2. Block Public Access
```bash
# Ensure both buckets block public access
aws s3api put-public-access-block \
  --bucket leaseflow-lease-agreements-primary \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
  --region us-east-1

aws s3api put-public-access-block \
  --bucket leaseflow-lease-agreements-secondary \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
  --region eu-west-1
```

## Troubleshooting

### Issue: Replication Not Working
**Symptoms:** Files uploaded to primary bucket not appearing in secondary bucket

**Troubleshooting Steps:**
```bash
# 1. Check replication configuration
aws s3api get-bucket-replication \
  --bucket leaseflow-lease-agreements-primary \
  --region us-east-1

# 2. Verify versioning is enabled on both buckets
aws s3api get-bucket-versioning \
  --bucket leaseflow-lease-agreements-primary \
  --region us-east-1

aws s3api get-bucket-versioning \
  --bucket leaseflow-lease-agreements-secondary \
  --region eu-west-1

# 3. Check IAM role permissions
aws iam get-role-policy \
  --role-name leaseflow-s3-replication-role \
  --policy-name s3-replication-policy

# 4. Check CloudTrail logs for replication failures
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=leaseflow-lease-agreements-primary \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)
```

### Issue: Replication Latency High
**Symptoms:** Replication taking longer than 15 minutes

**Troubleshooting Steps:**
```bash
# 1. Check replication metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3Replication \
  --metric-name ReplicationLatency \
  --dimensions Name=BucketName,Value=leaseflow-lease-agreements-primary \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average

# 2. Check if large files are being uploaded
aws s3 ls s3://leaseflow-lease-agreements-primary --recursive --human-readable \
  --region us-east-1 | sort -k3 -h

# 3. Consider increasing replication time threshold
```

### Issue: Encryption Errors
**Symptoms:** Replication failing due to KMS key issues

**Troubleshooting Steps:**
```bash
# 1. Verify KMS key permissions
aws kms get-key-policy \
  --key-id PRIMARY_KMS_KEY_ID \
  --policy-name default

# 2. Ensure replication role has KMS permissions
aws iam get-role-policy \
  --role-name leaseflow-s3-replication-role \
  --policy-name s3-replication-policy

# 3. Test KMS key access
aws kms encrypt \
  --key-id PRIMARY_KMS_KEY_ID \
  --plaintext "test" \
  --region us-east-1
```

## Cost Optimization

### 1. Monitor Replication Costs
```bash
# Use Cost Explorer to track replication costs
# Set up cost allocation tags for buckets
aws s3api put-bucket-tagging \
  --bucket leaseflow-lease-agreements-primary \
  --tagging '{"TagSet": [{"Key": "CostCenter", "Value": "DR"}, {"Key": "Environment", "Value": "primary"}]}' \
  --region us-east-1

aws s3api put-bucket-tagging \
  --bucket leaseflow-lease-agreements-secondary \
  --tagging '{"TagSet": [{"Key": "CostCenter", "Value": "DR"}, {"Key": "Environment", "Value": "secondary"}]}' \
  --region eu-west-1
```

### 2. Optimize Storage Classes
- Use STANDARD for frequently accessed PDFs
- Transition to GLACIER after 90 days
- Transition to DEEP_ARCHIVE after 1 year
- This reduces storage costs significantly

### 3. Lifecycle Rules
- Implement non-current version expiration
- Delete old versions after 1 year
- This reduces storage costs for versioned objects

## Testing and Validation

### Monthly Replication Test
```bash
# Upload test file
aws s3 cp test.pdf s3://leaseflow-lease-agreements-primary/monthly-test-$(date +%Y%m%d).pdf \
  --region us-east-1

# Wait 15 minutes
sleep 900

# Verify replication
aws s3 ls s3://leaseflow-lease-agreements-secondary/monthly-test-$(date +%Y%m%d).pdf \
  --region eu-west-1

# Log results
echo "$(date): Monthly replication test completed" >> /var/log/s3-replication-tests.log
```

### Quarterly Size Comparison
```bash
# Compare bucket sizes
PRIMARY_SIZE=$(aws s3 ls s3://leaseflow-lease-agreements-primary --recursive --summarize \
  --region us-east-1 | grep "Total Size" | awk '{print $3}')

SECONDARY_SIZE=$(aws s3 ls s3://leaseflow-lease-agreements-secondary --recursive --summarize \
  --region eu-west-1 | grep "Total Size" | awk '{print $3}')

echo "Primary size: $PRIMARY_SIZE bytes"
echo "Secondary size: $SECONDARY_SIZE bytes"

# Alert if difference > 5%
DIFFERENCE=$(( (PRIMARY_SIZE - SECONDARY_SIZE) * 100 / PRIMARY_SIZE ))
if [ $DIFFERENCE -gt 5 ]; then
  echo "WARNING: Size difference > 5%"
  # Send alert
fi
```

## Appendix A: Terraform Complete Example

```hcl
# Primary S3 Bucket with Replication
resource "aws_s3_bucket" "primary" {
  bucket = "leaseflow-lease-agreements-primary"
  
  tags = {
    Environment = "primary"
    Region      = "us-east-1"
    Purpose     = "pdf-storage"
  }
}

resource "aws_s3_bucket_versioning" "primary" {
  bucket = aws_s3_bucket.primary.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "primary" {
  bucket = aws_s3_bucket.primary.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "primary" {
  bucket = aws_s3_bucket.primary.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Secondary S3 Bucket
resource "aws_s3_bucket" "secondary" {
  bucket = "leaseflow-lease-agreements-secondary"
  
  tags = {
    Environment = "secondary"
    Region      = "eu-west-1"
    Purpose     = "pdf-replication"
  }
}

resource "aws_s3_bucket_versioning" "secondary" {
  bucket = aws_s3_bucket.secondary.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "secondary" {
  bucket = aws_s3_bucket.secondary.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "secondary" {
  bucket = aws_s3_bucket.secondary.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# IAM Role for Replication
resource "aws_iam_role" "s3_replication" {
  name = "leaseflow-s3-replication-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "s3_replication" {
  name = "s3-replication-policy"
  role = aws_iam_role.s3_replication.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:GetBucketVersioning",
          "s3:PutBucketVersioning"
        ]
        Resource = [
          aws_s3_bucket.primary.arn,
          aws_s3_bucket.secondary.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags",
          "s3:GetObjectVersion",
          "s3:GetObjectVersionTagging"
        ]
        Resource = [
          "${aws_s3_bucket.primary.arn}/*",
          "${aws_s3_bucket.secondary.arn}/*"
        ]
      }
    ]
  })
}

# Replication Configuration
resource "aws_s3_bucket_replication_configuration" "primary" {
  role = aws_iam_role.s3_replication.arn
  bucket = aws_s3_bucket.primary.id
  
  rule {
    id       = "leaseflow-pdf-replication"
    priority = 1
    status   = "Enabled"
    
    destination {
      bucket        = aws_s3_bucket.secondary.arn
      storage_class = "STANDARD"
      
      replication_time {
        status = "Enabled"
        time {
          minutes = 15
        }
      }
      
      metrics {
        status = "Enabled"
      }
      
      account_id = data.aws_caller_identity.current.account_id
    }
    
    delete_marker_replication {
      status = "Enabled"
    }
    
    source_selection_criteria {
      sse_kms_encrypted_objects {
        enabled = true
      }
    }
  }
  
  depends_on = [
    aws_s3_bucket_versioning.primary,
    aws_s3_bucket_versioning.secondary
  ]
}
```

---

**Document Version:** 1.0
**Last Updated:** 2026-04-26
**Next Review:** 2026-07-26
