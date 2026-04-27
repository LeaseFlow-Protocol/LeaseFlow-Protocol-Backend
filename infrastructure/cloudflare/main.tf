# Terraform Configuration for Cloudflare DNS Failover
# Task 1: DNS-Level Failover with Cloudflare
# 
# Prerequisites:
# - Terraform installed
# - Cloudflare API token with Load Balancing permissions
# - AWS ALB DNS name
# - Backup server addresses

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}

variable "zone_id" {
  description = "Cloudflare Zone ID"
  type        = string
}

variable "aws_alb_dns" {
  description = "AWS Application Load Balancer DNS name"
  type        = string
}

variable "backup_servers" {
  description = "List of backup server hostnames"
  type        = list(string)
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# Primary Health Check (AWS)
resource "cloudflare_load_balancer_healthcheck" "primary" {
  zone_id     = var.zone_id
  name        = "leaseflow-primary-health"
  description = "Health check for primary AWS infrastructure"
  
  path              = "/health"
  port              = 443
  expected_codes    = "200"
  method            = "GET"
  timeout           = 5
  retries           = 3
  interval          = 60
  check_regions     = ["us-east", "us-west", "eu-west"]
}

# Secondary Health Check (Backup)
resource "cloudflare_load_balancer_healthcheck" "secondary" {
  zone_id     = var.zone_id
  name        = "leaseflow-secondary-health"
  description = "Health check for secondary infrastructure"
  
  path              = "/health"
  port              = 443
  expected_codes    = "200"
  method            = "GET"
  timeout           = 5
  retries           = 3
  interval          = 60
  check_regions     = ["us-east", "us-west"]
}

# Primary Pool (AWS)
resource "cloudflare_load_balancer_pool" "primary" {
  zone_id       = var.zone_id
  name          = "leaseflow-primary-pool"
  description   = "Primary AWS infrastructure pool"
  enabled       = true
  minimum_origins = 1
  healthcheck_id = cloudflare_load_balancer_healthcheck.primary.id

  dynamic "origins" {
    for_each = [var.aws_alb_dns]
    content {
      name    = "aws-alb-primary"
      address = origins.value
      enabled = true
      weight  = 1
    }
  }
}

# Secondary Pool (Backup Servers)
resource "cloudflare_load_balancer_pool" "secondary" {
  zone_id        = var.zone_id
  name           = "leaseflow-secondary-pool"
  description    = "Secondary backup pool"
  enabled        = true
  minimum_origins = 1
  healthcheck_id = cloudflare_load_balancer_healthcheck.secondary.id

  dynamic "origins" {
    for_each = var.backup_servers
    content {
      name    = "backup-${origins.key}"
      address = origins.value
      enabled = true
      weight  = 1
    }
  }
}

# Main Load Balancer with Failover
resource "cloudflare_load_balancer" "main" {
  zone_id                  = var.zone_id
  name                     = "api"
  fallback_pool_id         = cloudflare_load_balancer_pool.secondary.id
  default_pool_ids         = [cloudflare_load_balancer_pool.primary.id]
  steering_policy          = "geo"
  ttl                      = 60
  session_affinity         = "cookie"
  session_affinity_ttl     = 3600
  session_affinity_attributes {
    samesite = "strict"
    secure   = "always"
  }

  # Geographic steering rules
  dynamic "rules" {
    for_each = [1]
    content {
      name      = "north-america"
      condition = "ip.geoip.country in {\"US\" \"CA\" \"MX\"}"
      pools     = [cloudflare_load_balancer_pool.primary.id]
      
      overrides {
        steering_policy = "geo"
      }
    }
  }

  dynamic "rules" {
    for_each = [1]
    content {
      name      = "europe"
      condition = "ip.geoip.country in {\"GB\" \"DE\" \"FR\" \"ES\" \"IT\"}"
      pools     = [cloudflare_load_balancer_pool.primary.id]
      
      overrides {
        steering_policy = "geo"
      }
    }
  }

  # Notification settings
  notification_email = "devops@leaseflow.io"
}

# ============================================================
# Issue #131: WAF Rules for API Rate Limiting & DDoS Protection
# ============================================================

# Block known malicious IPs, Tor exit nodes, and automated bots
resource "cloudflare_ruleset" "waf_rules" {
  zone_id     = var.zone_id
  name        = "LeaseFlow WAF Rules"
  description = "WAF rules for API protection - Issue #131"
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  # Rule 1: Block Tor exit nodes and known malicious ASNs
  rules {
    action      = "block"
    description = "Block Tor exit nodes and high-risk ASNs"
    enabled     = true
    expression  = "(ip.src in $cf.open_proxies) or (cf.threat_score gt 50)"
  }

  # Rule 2: Block automated headless browsers (no JS challenge support)
  rules {
    action      = "managed_challenge"
    description = "Challenge automated/headless browser traffic"
    enabled     = true
    expression  = "(cf.bot_management.score lt 30) and (not cf.bot_management.verified_bot)"
  }

  # Rule 3: Rate limit auth endpoints - 10 attempts/min per IP
  rules {
    action      = "block"
    description = "Block excessive auth attempts (>10/min per IP)"
    enabled     = true
    expression  = "(http.request.uri.path matches \"^/api/(auth|kyc|login|token)\") and (rate(http.request.uri.path, 60) gt 10)"
  }

  # Rule 4: Rate limit general API - 200 req/min per IP at edge
  rules {
    action      = "block"
    description = "Block excessive general API requests (>200/min per IP)"
    enabled     = true
    expression  = "(http.request.uri.path matches \"^/api/\") and (rate(http.request.uri.path, 60) gt 200)"
  }

  # Rule 5: Block common attack payloads before they reach K8s
  rules {
    action      = "block"
    description = "Block SQL injection and XSS payloads at edge"
    enabled     = true
    expression  = "(http.request.uri.query contains \"UNION SELECT\") or (http.request.uri.query contains \"<script\") or (http.request.body contains \"UNION SELECT\")"
  }
}

# Output the load balancer details
output "load_balancer_hostname" {
  value       = cloudflare_load_balancer.main.hostname
  description = "Hostname of the created load balancer"
}

output "primary_pool_id" {
  value       = cloudflare_load_balancer_pool.primary.id
  description = "ID of the primary pool"
}

output "secondary_pool_id" {
  value       = cloudflare_load_balancer_pool.secondary.id
  description = "ID of the secondary pool"
}
