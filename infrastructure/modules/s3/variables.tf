variable "bucket_name" {
  description = "Name of the S3 bucket"
  type        = string
}

variable "versioning" {
  description = "Enable versioning"
  type        = bool
  default     = true
}

variable "encryption" {
  description = "Enable server-side encryption"
  type        = bool
  default     = true
}

variable "kms_key_id" {
  description = "KMS key ID for encryption"
  type        = string
  default     = null
}

variable "lifecycle_rules" {
  description = "List of lifecycle rules"
  type = list(object({
    id      = string
    enabled = bool
    prefix  = optional(string)
    tags    = optional(map(string))
    expiration = optional(object({
      days                         = number
      expired_object_delete_marker = optional(bool)
    }))
    transition = optional(list(object({
      days          = number
      storage_class = string
    })))
    noncurrent_version_expiration = optional(object({
      days = number
    }))
    noncurrent_version_transition = optional(list(object({
      days          = number
      storage_class = string
    })))
  }))
  default = []
}

variable "replication_configuration" {
  description = "S3 replication configuration"
  type = object({
    role = string
    rules = list(object({
      id        = string
      status    = string
      priority  = optional(number)
      destination = object({
        bucket                 = string
        storage_class          = optional(string)
        replica_kms_key_id     = optional(string)
        account_id             = optional(string)
        replication_time = optional(object({
          status = string
          time   = number
        }))
        metrics = optional(object({
          status = string
        }))
      })
      source_selection_criteria = optional(object({
        sse_kms_encrypted_objects = object({
          enabled = bool
        })
      }))
      filter = object({
        prefix = string
        tags   = map(string)
      })
    }))
  })
  default = null
}

variable "block_public_access" {
  description = "Block public access settings"
  type = object({
    block_public_acls       = optional(bool, true)
    block_public_policy     = optional(bool, true)
    ignore_public_acls      = optional(bool, true)
    restrict_public_buckets = optional(bool, true)
  })
  default = {}
}

variable "logging" {
  description = "S3 access logging configuration"
  type = object({
    target_bucket = string
    target_prefix = string
  })
  default = null
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}
