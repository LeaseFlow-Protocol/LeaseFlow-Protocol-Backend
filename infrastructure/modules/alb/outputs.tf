output "lb_id" {
  description = "Load balancer ID"
  value       = aws_lb.this.id
}

output "lb_arn" {
  description = "Load balancer ARN"
  value       = aws_lb.this.arn
}

output "lb_arn_suffix" {
  description = "Load balancer ARN suffix"
  value       = aws_lb.this.arn_suffix
}

output "lb_dns_name" {
  description = "DNS name of the load balancer"
  value       = aws_lb.this.dns_name
}

output "lb_zone_id" {
  description = "Zone ID of the load balancer"
  value       = aws_lb.this.zone_id
}

output "lb_canonical_hosted_zone_id" {
  description = "Canonical hosted zone ID of the load balancer"
  value       = aws_lb.this.canonical_hosted_zone_id
}

output "target_group_arn" {
  description = "ARN of the target group"
  value       = aws_lb_target_group.this.arn
}

output "target_group_id" {
  description = "ID of the target group"
  value       = aws_lb_target_group.this.id
}

output "listener_http_arn" {
  description = "ARN of the HTTP listener"
  value       = aws_lb_listener.http.arn
}

output "listener_https_arn" {
  description = "ARN of the HTTPS listener"
  value       = aws_lb_listener.https.arn
}

output "security_group_id" {
  description = "Security group ID"
  value       = length(var.security_group_ids) > 0 ? var.security_group_ids[0] : aws_security_group.this[0].id
}
