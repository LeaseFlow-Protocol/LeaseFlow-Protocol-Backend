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
