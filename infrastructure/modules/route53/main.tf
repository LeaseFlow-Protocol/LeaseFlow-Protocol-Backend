terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Health Check for Primary Region
resource "aws_route53_health_check" "primary" {
  fqdn              = var.primary_alb_dns_name
  port              = 443
  type              = "HTTPS"
  resource_path     = var.health_check_path
  request_interval  = var.health_check_interval
  failure_threshold = var.health_check_unhealthy_threshold
  success_threshold = var.health_check_healthy_threshold

  measure_latency {
    enabled = true
  }

  tags = merge(
    var.tags,
    {
      Name = "${var.domain_name}-primary-health"
      Region = "us-east-1"
    }
  )
}

# Health Check for Secondary Region
resource "aws_route53_health_check" "secondary" {
  fqdn              = var.secondary_alb_dns_name
  port              = 443
  type              = "HTTPS"
  resource_path     = var.health_check_path
  request_interval  = var.health_check_interval
  failure_threshold = var.health_check_unhealthy_threshold
  success_threshold = var.health_check_healthy_threshold

  measure_latency {
    enabled = true
  }

  tags = merge(
    var.tags,
    {
      Name = "${var.domain_name}-secondary-health"
      Region = "eu-west-1"
    }
  )
}

# Primary Record Set
resource "aws_route53_record" "primary" {
  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.primary_alb_dns_name
    zone_id                = var.primary_alb_zone_id
    evaluate_target_health = true
  }

  health_check_id = var.failover_routing ? aws_route53_health_check.primary.id : null

  set_identifier = "primary"
  failover_routing_policy {
    type = "PRIMARY"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Secondary Record Set (Failover)
resource "aws_route53_record" "secondary" {
  count = var.failover_routing ? 1 : 0

  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.secondary_alb_dns_name
    zone_id                = var.secondary_alb_zone_id
    evaluate_target_health = true
  }

  health_check_id = aws_route53_health_check.secondary.id

  set_identifier = "secondary"
  failover_routing_policy {
    type = "SECONDARY"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Latency Routing Records (Alternative to Failover)
resource "aws_route53_record" "latency_us_east" {
  count = var.latency_routing ? 1 : 0

  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.primary_alb_dns_name
    zone_id                = var.primary_alb_zone_id
    evaluate_target_health = true
  }

  set_identifier = "us-east-1"
  latency_routing_policy {
    region = "us-east-1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "latency_eu_west" {
  count = var.latency_routing ? 1 : 0

  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.secondary_alb_dns_name
    zone_id                = var.secondary_alb_zone_id
    evaluate_target_health = true
  }

  set_identifier = "eu-west-1"
  latency_routing_policy {
    region = "eu-west-1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# CloudWatch Alarms for Health Checks
resource "aws_cloudwatch_metric_alarm" "primary_health_check" {
  alarm_name          = "${var.domain_name}-primary-health-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = "60"
  statistic           = "Minimum"
  threshold           = "0"
  alarm_description   = "Alert when primary health check fails"

  dimensions = {
    HealthCheckId = aws_route53_health_check.primary.id
  }
}

resource "aws_cloudwatch_metric_alarm" "secondary_health_check" {
  alarm_name          = "${var.domain_name}-secondary-health-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = "60"
  statistic           = "Minimum"
  threshold           = "0"
  alarm_description   = "Alert when secondary health check fails"

  dimensions = {
    HealthCheckId = aws_route53_health_check.secondary.id
  }
}

# SNS Topic for Failover Notifications
resource "aws_sns_topic" "failover_alerts" {
  name = "${var.domain_name}-failover-alerts"

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "failover_triggered" {
  alarm_name          = "${var.domain_name}-failover-triggered"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = "60"
  statistic           = "Minimum"
  threshold           = "0"
  alarm_description   = "Alert when failover is triggered"

  dimensions = {
    HealthCheckId = aws_route53_health_check.primary.id
  }

  alarm_actions = [aws_sns_topic.failover_alerts.arn]
  ok_actions    = [aws_sns_topic.failover_alerts.arn]
}
