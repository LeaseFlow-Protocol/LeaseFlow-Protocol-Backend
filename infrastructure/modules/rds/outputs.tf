output "db_instance_id" {
  description = "RDS instance ID"
  value       = aws_db_instance.this.id
}

output "db_instance_arn" {
  description = "RDS instance ARN"
  value       = aws_db_instance.this.arn
}

output "db_instance_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.this.endpoint
}

output "db_instance_address" {
  description = "RDS instance address"
  value       = aws_db_instance.this.address
}

output "db_instance_port" {
  description = "RDS instance port"
  value       = aws_db_instance.this.port
}

output "db_instance_name" {
  description = "Database name"
  value       = aws_db_instance.this.db_name
}

output "db_instance_username" {
  description = "Database username"
  value       = aws_db_instance.this.username
  sensitive   = true
}

output "db_instance_security_group_id" {
  description = "Security group ID"
  value       = length(var.security_group_ids) > 0 ? var.security_group_ids[0] : aws_security_group.this[0].id
}

output "db_parameter_group_id" {
  description = "Parameter group ID"
  value       = var.parameter_group_name != null ? var.parameter_group_name : aws_db_parameter_group.this[0].id
}

output "db_subnet_group_id" {
  description = "Subnet group ID"
  value       = aws_db_subnet_group.this.id
}

output "is_read_replica" {
  description = "Whether this is a read replica"
  value       = local.is_replica
}

output "cloudwatch_alarm_cpu" {
  description = "CPU utilization alarm ID"
  value       = aws_cloudwatch_metric_alarm.cpu_utilization.id
}

output "cloudwatch_alarm_storage" {
  description = "Storage alarm ID"
  value       = aws_cloudwatch_metric_alarm.free_storage.id
}

output "cloudwatch_alarm_connections" {
  description = "Connections alarm ID"
  value       = aws_cloudwatch_metric_alarm.database_connections.id
}

output "cloudwatch_alarm_replication_lag" {
  description = "Replication lag alarm ID (if read replica)"
  value       = local.is_replica ? aws_cloudwatch_metric_alarm.replication_lag[0].id : null
}
