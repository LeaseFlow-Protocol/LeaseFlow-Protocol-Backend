output "primary_record_fqdn" {
  description = "FQDN of the primary record"
  value       = aws_route53_record.primary.fqdn
}

output "secondary_record_fqdn" {
  description = "FQDN of the secondary record"
  value       = var.failover_routing ? aws_route53_record.secondary[0].fqdn : null
}

output "primary_health_check_id" {
  description = "ID of the primary health check"
  value       = aws_route53_health_check.primary.id
}

output "secondary_health_check_id" {
  description = "ID of the secondary health check"
  value       = aws_route53_health_check.secondary.id
}

output "sns_topic_arn" {
  description = "ARN of the SNS topic for failover alerts"
  value       = aws_sns_topic.failover_alerts.arn
}

output "sns_topic_name" {
  description = "Name of the SNS topic for failover alerts"
  value       = aws_sns_topic.failover_alerts.name
}
