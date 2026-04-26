output "bucket_id" {
  description = "Bucket ID (name)"
  value       = aws_s3_bucket.this.id
}

output "bucket_arn" {
  description = "Bucket ARN"
  value       = aws_s3_bucket.this.arn
}

output "bucket_domain_name" {
  description = "Bucket domain name"
  value       = aws_s3_bucket.this.bucket_domain_name
}

output "bucket_regional_domain_name" {
  description = "Bucket regional domain name"
  value       = aws_s3_bucket.this.bucket_regional_domain_name
}

output "versioning_enabled" {
  description = "Whether versioning is enabled"
  value       = var.versioning
}

output "encryption_enabled" {
  description = "Whether encryption is enabled"
  value       = var.encryption
}

output "replication_enabled" {
  description = "Whether replication is configured"
  value       = var.replication_configuration != null
}
