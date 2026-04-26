variable "zone_id" {
  description = "Route53 hosted zone ID"
  type        = string
}

variable "domain_name" {
  description = "Domain name for the record"
  type        = string
}

variable "primary_alb_dns_name" {
  description = "DNS name of the primary ALB (us-east-1)"
  type        = string
}

variable "primary_alb_zone_id" {
  description = "Hosted zone ID of the primary ALB"
  type        = string
}

variable "secondary_alb_dns_name" {
  description = "DNS name of the secondary ALB (eu-west-1)"
  type        = string
}

variable "secondary_alb_zone_id" {
  description = "Hosted zone ID of the secondary ALB"
  type        = string
}

variable "health_check_path" {
  description = "Health check path"
  type        = string
  default     = "/health"
}

variable "health_check_interval" {
  description = "Health check interval in seconds"
  type        = number
  default     = 30
}

variable "health_check_timeout" {
  description = "Health check timeout in seconds"
  type        = number
  default     = 5
}

variable "health_check_unhealthy_threshold" {
  description = "Number of consecutive health check failures before considering unhealthy"
  type        = number
  default     = 3
}

variable "health_check_healthy_threshold" {
  description = "Number of consecutive health check successes before considering healthy"
  type        = number
  default     = 2
}

variable "failover_routing" {
  description = "Enable failover routing policy"
  type        = bool
  default     = true
}

variable "latency_routing" {
  description = "Enable latency routing policy (alternative to failover)"
  type        = bool
  default     = false
}

variable "regions" {
  description = "List of regions for latency routing"
  type        = list(string)
  default     = ["us-east-1", "eu-west-1"]
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}
