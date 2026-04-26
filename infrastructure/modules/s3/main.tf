terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# S3 Bucket
resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name

  tags = var.tags
}

# S3 Bucket Versioning
resource "aws_s3_bucket_versioning" "this" {
  count = var.versioning ? 1 : 0

  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Server-Side Encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  count = var.encryption ? 1 : 0

  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = var.kms_key_id != null ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_key_id
    }
    bucket_key_enabled = true
  }
}

# S3 Bucket Public Access Block
resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = try(var.block_public_access.block_public_acls, true)
  block_public_policy     = try(var.block_public_access.block_public_policy, true)
  ignore_public_acls      = try(var.block_public_access.ignore_public_acls, true)
  restrict_public_buckets = try(var.block_public_access.restrict_public_buckets, true)
}

# S3 Bucket Lifecycle Configuration
resource "aws_s3_bucket_lifecycle_configuration" "this" {
  count = length(var.lifecycle_rules) > 0 ? 1 : 0

  bucket = aws_s3_bucket.this.id

  dynamic "rule" {
    for_each = var.lifecycle_rules
    content {
      id      = rule.value.id
      enabled = rule.value.enabled
      status  = rule.value.enabled ? "Enabled" : "Disabled"

      dynamic "filter" {
        for_each = rule.value.prefix != null || length(rule.value.tags) > 0 ? [1] : []
        content {
          dynamic "prefix" {
            for_each = rule.value.prefix != null ? [rule.value.prefix] : []
            content {
              prefix = prefix.value
            }
          }

          dynamic "tag" {
            for_each = rule.value.tags
            content {
              key   = tag.key
              value = tag.value
            }
          }
        }
      }

      dynamic "expiration" {
        for_each = rule.value.expiration != null ? [rule.value.expiration] : []
        content {
          days                         = expiration.value.days
          expired_object_delete_marker = expiration.value.expired_object_delete_marker
        }
      }

      dynamic "transition" {
        for_each = rule.value.transition != null ? rule.value.transition : []
        content {
          days          = transition.value.days
          storage_class = transition.value.storage_class
        }
      }

      dynamic "noncurrent_version_expiration" {
        for_each = rule.value.noncurrent_version_expiration != null ? [rule.value.noncurrent_version_expiration] : []
        content {
          noncurrent_days = noncurrent_version_expiration.value.days
        }
      }

      dynamic "noncurrent_version_transition" {
        for_each = rule.value.noncurrent_version_transition != null ? rule.value.noncurrent_version_transition : []
        content {
          noncurrent_days = noncurrent_version_transition.value.days
          storage_class   = noncurrent_version_transition.value.storage_class
        }
      }
    }
  }
}

# S3 Bucket Logging
resource "aws_s3_bucket_logging" "this" {
  count = var.logging != null ? 1 : 0

  bucket = aws_s3_bucket.this.id

  target_bucket = var.logging.target_bucket
  target_prefix = var.logging.target_prefix
}

# S3 Bucket Replication Configuration
resource "aws_s3_bucket_replication_configuration" "this" {
  count = var.replication_configuration != null ? 1 : 0

  role = var.replication_configuration.role
  bucket = aws_s3_bucket.this.id

  dynamic "rule" {
    for_each = var.replication_configuration.rules
    content {
      id       = rule.value.id
      priority = rule.value.priority
      status   = rule.value.status

      destination {
        bucket        = rule.value.destination.bucket
        storage_class = rule.value.destination.storage_class
        account_id    = rule.value.destination.account_id

        dynamic "replication_time" {
          for_each = rule.value.destination.replication_time != null ? [rule.value.destination.replication_time] : []
          content {
            status = replication_time.value.status
            time {
              minutes = replication_time.value.time
            }
          }
        }

        dynamic "metrics" {
          for_each = rule.value.destination.metrics != null ? [rule.value.destination.metrics] : []
          content {
            status = metrics.value.status
          }
        }

        access_control_translation {
          owner = "Destination"
        }
      }

      dynamic "source_selection_criteria" {
        for_each = rule.value.source_selection_criteria != null ? [rule.value.source_selection_criteria] : []
        content {
          sse_kms_encrypted_objects {
            enabled = source_selection_criteria.value.sse_kms_encrypted_objects.enabled
          }
        }
      }

      dynamic "filter" {
        for_each = [1]
        content {
          prefix = rule.value.filter.prefix

          dynamic "tag" {
            for_each = rule.value.filter.tags
            content {
              key   = tag.key
              value = tag.value
            }
          }
        }
      }

      delete_marker_replication {
        status = "Enabled"
      }
    }
  }

  depends_on = [
    aws_s3_bucket_versioning.this[0]
  ]
}

# S3 Bucket Policy (for replication)
resource "aws_s3_bucket_policy" "this" {
  count = var.replication_configuration != null ? 1 : 0

  bucket = aws_s3_bucket.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ReplicationBucketPolicy"
        Effect = "Allow"
        Principal = {
          AWS = var.replication_configuration.role
        }
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:GetBucketVersioning",
          "s3:PutBucketVersioning"
        ]
        Resource = [
          aws_s3_bucket.this.arn
        ]
      },
      {
        Sid    = "S3ReplicationObjectPolicy"
        Effect = "Allow"
        Principal = {
          AWS = var.replication_configuration.role
        }
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags",
          "s3:GetObjectVersion",
          "s3:GetObjectVersionTagging"
        ]
        Resource = [
          "${aws_s3_bucket.this.arn}/*"
        ]
      }
    ]
  })
}

# CloudWatch Alarms for S3
resource "aws_cloudwatch_metric_alarm" "4xx_errors" {
  alarm_name          = "${var.bucket_name}-4xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "4xxErrors"
  namespace           = "AWS/S3"
  period              = "300"
  statistic           = "Sum"
  threshold           = "100"
  alarm_description   = "Alert when 4XX errors exceed 100 in 5 minutes"

  dimensions = {
    BucketName = aws_s3_bucket.this.id
  }
}

resource "aws_cloudwatch_metric_alarm" "5xx_errors" {
  alarm_name          = "${var.bucket_name}-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "5xxErrors"
  namespace           = "AWS/S3"
  period              = "300"
  statistic           = "Sum"
  threshold           = "50"
  alarm_description   = "Alert when 5XX errors exceed 50 in 5 minutes"

  dimensions = {
    BucketName = aws_s3_bucket.this.id
  }
}
