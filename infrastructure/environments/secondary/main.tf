terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "leaseflow-terraform-state"
    key            = "environments/secondary/terraform.tfstate"
    region         = "eu-west-1"
    encrypt        = true
    dynamodb_table = "leaseflow-terraform-locks"
  }
}

provider "aws" {
  region = "eu-west-1"

  default_tags {
    tags = {
      Environment = "secondary"
      ManagedBy   = "Terraform"
      Project     = "LeaseFlow"
    }
  }
}

# Data source for primary region resources
data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# VPC Module
module "vpc" {
  source = "../../modules/vpc"

  name               = "leaseflow-secondary-vpc"
  cidr               = "10.1.0.0/16"
  availability_zones = ["eu-west-1a", "eu-west-1b"]

  enable_nat_gateway     = true
  single_nat_gateway     = true
  enable_vpn_gateway     = false
  enable_dns_hostnames   = true
  enable_dns_support     = true

  public_subnet_cidrs  = ["10.1.1.0/24", "10.1.2.0/24"]
  private_subnet_cidrs = ["10.1.10.0/24", "10.1.11.0/24"]
  database_subnet_cidrs = ["10.1.20.0/24", "10.1.21.0/24"]

  tags = {
    Environment = "secondary"
    Region      = "eu-west-1"
  }
}

# PostgreSQL Read Replica
module "rds_read_replica" {
  source = "../../modules/rds"

  identifier = "leaseflow-secondary-db"
  
  engine         = "postgres"
  engine_version = "14.9"
  instance_class = "db.r5.large"
  
  allocated_storage = 500
  storage_type      = "gp3"
  storage_encrypted = true
  
  db_name  = "leaseflow"
  username = var.db_username
  password = var.db_password
  port     = 5432
  
  vpc_id            = module.vpc.vpc_id
  subnet_ids        = module.vpc.database_subnet_ids
  security_group_ids = [module.vpc.database_security_group_id]
  
  multi_az = false  # Read replica doesn't need Multi-AZ
  
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"
  
  # Cross-region read replica configuration
  is_read_replica      = true
  replicate_source_db  = var.primary_db_arn  # ARN of primary database
  
  performance_insights_enabled = true
  monitoring_interval          = 60
  
  # Replication parameters
  family = "postgres14"
  parameters = [
    {
      name  = "max_replication_slots"
      value = "10"
    },
    {
      name  = "max_wal_senders"
      value = "10"
    },
    {
      name  = "wal_level"
      value = "logical"
    }
  ]
  
  tags = {
    Environment = "secondary"
    Region      = "eu-west-1"
    Role        = "read-replica"
  }
}

# EKS Cluster (Passive Standby)
module "eks" {
  source = "../../modules/eks"

  cluster_name    = "leaseflow-secondary"
  cluster_version = "1.28"
  
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnet_ids
  
  # Single node for passive standby
  node_groups = {
    default = {
      desired_capacity = 1
      min_capacity     = 1
      max_capacity     = 3
      
      instance_types = ["m5.large"]
      capacity_type  = "ON_DEMAND"
      
      labels = {
        Environment = "secondary"
        Role        = "standby"
      }
    }
  }
  
  # Enable cluster logging
  cluster_log_retention_period = 7
  
  tags = {
    Environment = "secondary"
    Region      = "eu-west-1"
  }
}

# Application Load Balancer
module "alb" {
  source = "../../modules/alb"

  name       = "leaseflow-secondary-alb"
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.public_subnet_ids
  
  security_group_ids = [module.vpc.alb_security_group_id]
  
  enable_http2   = true
  enable_http3   = false
  enable_deletion_protection = false  # Allow deletion for DR testing
  
  tags = {
    Environment = "secondary"
    Region      = "eu-west-1"
  }
}

# S3 Bucket for PDF Replication
module "s3_secondary" {
  source = "../../modules/s3"

  bucket_name = "leaseflow-lease-agreements-secondary"
  
  versioning = true
  encryption = true
  
  # Lifecycle rules
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
  
  # Replication configuration
  replication_configuration = {
    role = aws_iam_role.s3_replication.arn
    
    rules = [
      {
        id        = "replicate-from-primary"
        status    = "Enabled"
        priority  = 1
        
        destination = {
          bucket        = var.primary_s3_bucket_arn
          storage_class = "STANDARD"
          replica_kms_key_id = var.primary_kms_key_id
          
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
    Environment = "secondary"
    Region      = "eu-west-1"
    Purpose     = "pdf-replication"
  }
}

# IAM Role for S3 Replication
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
  
  tags = {
    Environment = "secondary"
  }
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
          module.s3_secondary.bucket_arn,
          var.primary_s3_bucket_arn
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
          "${module.s3_secondary.bucket_arn}/*",
          "${var.primary_s3_bucket_arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = [
          aws_kms_key.secondary.arn,
          var.primary_kms_key_id
        ]
      }
    ]
  })
}

# KMS Key for secondary region
resource "aws_kms_key" "secondary" {
  description = "KMS key for LeaseFlow secondary region"
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "Allow S3 Replication"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.s3_replication.arn
        }
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = "*"
      }
    ]
  })
  
  tags = {
    Environment = "secondary"
    Region      = "eu-west-1"
  }
}

resource "aws_kms_alias" "secondary" {
  name          = "alias/leaseflow-secondary"
  target_key_id = aws_kms_key.secondary.id
}

# CloudWatch Dashboard for DR Monitoring
resource "aws_cloudwatch_dashboard" "dr_monitoring" {
  dashboard_name = "leaseflow-dr-monitoring"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 2
        properties = {
          markdown = "# LeaseFlow Disaster Recovery Monitoring - Secondary Region (eu-west-1)"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 2
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", module.rds_read_replica.db_instance_id],
            [".", "FreeStorageSpace", ".", "."],
            [".", "DatabaseConnections", ".", "."],
            [".", "ReadReplicaLag", ".", "."]
          ]
          period = 300
          stat   = "Average"
          region = "eu-west-1"
          title  = "RDS Read Replica Metrics"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 2
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/EKS", "cluster_cpu_utilization", "ClusterName", module.eks.cluster_name],
            [".", "cluster_memory_utilization", ".", "."]
          ]
          period = 300
          stat   = "Average"
          region = "eu-west-1"
          title  = "EKS Cluster Metrics"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 8
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", module.alb.alb_arn_suffix],
            [".", "TargetResponseTime", ".", "."],
            [".", "HTTPCode_Target_5XX_Count", ".", "."]
          ]
          period = 300
          stat   = "Sum"
          region = "eu-west-1"
          title  = "ALB Metrics"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 8
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/S3", "BucketSizeBytes", "BucketName", module.s3_secondary.bucket_id, "StorageType", "StandardStorage"],
            [".", "NumberOfObjects", ".", "."]
          ]
          period = 86400
          stat   = "Average"
          region = "eu-west-1"
          title  = "S3 Replication Metrics"
        }
      }
    ]
  })
}
