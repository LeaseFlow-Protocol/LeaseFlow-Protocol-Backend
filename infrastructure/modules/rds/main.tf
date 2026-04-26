terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  # Determine if this is a read replica
  is_replica = var.is_read_replica || var.replicate_source_db != null
}

# DB Parameter Group
resource "aws_db_parameter_group" "this" {
  count = var.parameter_group_name == null ? 1 : 0

  name        = "${var.identifier}-pg"
  family      = var.family
  description = "Parameter group for ${var.identifier}"

  dynamic "parameter" {
    for_each = var.parameters
    content {
      name  = parameter.value.name
      value = parameter.value.value
    }
  }

  tags = var.tags
}

# DB Subnet Group
resource "aws_db_subnet_group" "this" {
  name       = "${var.identifier}-sg"
  subnet_ids = var.subnet_ids

  tags = merge(
    var.tags,
    {
      Name = "${var.identifier}-subnet-group"
    }
  )
}

# Security Group for RDS
resource "aws_security_group" "this" {
  count = length(var.security_group_ids) == 0 ? 1 : 0

  name_prefix = "${var.identifier}-sg"
  vpc_id      = var.vpc_id

  tags = merge(
    var.tags,
    {
      Name = "${var.identifier}-security-group"
    }
  )
}

# Security Group Rule - Ingress from VPC CIDR
resource "aws_vpc_security_group_ingress_rule" "postgres" {
  count = length(var.security_group_ids) == 0 ? 1 : 0

  security_group_id = aws_security_group.this[0].id
  cidr_ipv4         = "10.0.0.0/8"
  from_port         = var.port
  ip_protocol       = "tcp"
  to_port           = var.port
}

# Security Group Rule - Egress
resource "aws_vpc_security_group_egress_rule" "all" {
  count = length(var.security_group_ids) == 0 ? 1 : 0

  security_group_id = aws_security_group.this[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# RDS Instance
resource "aws_db_instance" "this" {
  identifier = var.identifier

  engine         = var.engine
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  storage_type          = var.storage_type
  storage_encrypted     = var.storage_encrypted
  kms_key_id            = var.kms_key_id
  max_allocated_storage = var.allocated_storage * 2  # Allow doubling

  db_name  = var.db_name
  username = var.username
  password = var.password
  port     = var.port

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = length(var.security_group_ids) > 0 ? var.security_group_ids : [aws_security_group.this[0].id]

  # Multi-AZ configuration
  multi_az = var.multi_az

  # Backup configuration
  backup_retention_period = var.backup_retention_period
  backup_window           = var.backup_window
  skip_final_snapshot     = false
  final_snapshot_identifier = "${var.identifier}-final-snapshot"

  # Maintenance window
  maintenance_window = var.maintenance_window
  auto_minor_version_upgrade = true

  # Parameter group
  parameter_group_name = var.parameter_group_name != null ? var.parameter_group_name : aws_db_parameter_group.this[0].name

  # Performance Insights
  performance_insights_enabled = var.performance_insights_enabled
  performance_insights_retention_period = 7

  # Monitoring
  monitoring_interval = var.monitoring_interval
  monitoring_role_arn = var.monitoring_role_arn

  # Read replica configuration
  replicate_source_db = var.replicate_source_db

  # Deletion protection
  deletion_protection = !local.is_replica

  # Public accessibility
  publicly_accessible = false

  # Storage autoscaling
  storage_autoscaling_enabled = true

  # Copy tags to snapshots
  copy_tags_to_snapshot = true

  # Enable enhanced monitoring
  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = merge(
    var.tags,
    {
      Name        = var.identifier
      Environment = terraform.workspace
      ManagedBy   = "Terraform"
    }
  )

  # Prevent accidental deletion of primary database
  lifecycle {
    ignore_changes = [
      snapshot_identifier,
      password
    ]
  }
}

# CloudWatch Alarms
resource "aws_cloudwatch_metric_alarm" "cpu_utilization" {
  alarm_name          = "${var.identifier}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "Alert when CPU utilization exceeds 80% for 10 minutes"
  alarm_actions       = []

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.this.id
  }
}

resource "aws_cloudwatch_metric_alarm" "free_storage" {
  alarm_name          = "${var.identifier}-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "10737418240"  # 10 GB in bytes
  alarm_description   = "Alert when free storage space is less than 10 GB"
  alarm_actions       = []

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.this.id
  }
}

resource "aws_cloudwatch_metric_alarm" "database_connections" {
  alarm_name          = "${var.identifier}-connections-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "100"
  alarm_description   = "Alert when database connections exceed 100"
  alarm_actions       = []

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.this.id
  }
}

# Replication lag alarm (only for read replicas)
resource "aws_cloudwatch_metric_alarm" "replication_lag" {
  count = local.is_replica ? 1 : 0

  alarm_name          = "${var.identifier}-replication-lag"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "ReadReplicaLag"
  namespace           = "AWS/RDS"
  period              = "60"
  statistic           = "Average"
  threshold           = "5"
  alarm_description   = "Alert when replication lag exceeds 5 seconds"
  alarm_actions       = []

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.this.id
  }
}
