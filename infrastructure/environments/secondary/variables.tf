variable "db_username" {
  description = "Database master username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

variable "primary_db_arn" {
  description = "ARN of the primary database in us-east-1 for cross-region replication"
  type        = string
}

variable "primary_s3_bucket_arn" {
  description = "ARN of the primary S3 bucket in us-east-1 for CRR"
  type        = string
}

variable "primary_kms_key_id" {
  description = "KMS key ID of the primary region for S3 replication"
  type        = string
}

variable "aws_profile" {
  description = "AWS profile to use"
  type        = string
  default     = "default"
}
