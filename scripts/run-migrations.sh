#!/bin/sh
set -e

# Migration runner script with distributed locking
# This script executes SQL migrations idempotently with PostgreSQL advisory locks
# to prevent race conditions when multiple pods boot simultaneously

# Configuration
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-leaseflow}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD}"
LOCK_TIMEOUT="${LOCK_TIMEOUT:-300}"  # 5 minutes default
POD_ID="${POD_ID:-$(hostname)}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] $1"
}

log_success() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') ${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') ${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') ${YELLOW}[WARNING]${NC} $1"
}

# Validate required environment variables
if [ -z "$DB_PASSWORD" ]; then
    log_error "DB_PASSWORD environment variable is required"
    exit 1
fi

# Set PGPASSWORD for psql
export PGPASSWORD="$DB_PASSWORD"

# Function to check database connectivity
check_db_connection() {
    log_info "Checking database connectivity..."
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1; then
        log_success "Database connection successful"
        return 0
    else
        log_error "Failed to connect to database"
        return 1
    fi
}

# Function to initialize migration tracking table
init_migration_tracker() {
    log_info "Initializing migration tracking table..."
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$MIGRATIONS_DIR/migration-tracker.sql" > /dev/null 2>&1; then
        log_success "Migration tracking table initialized"
        return 0
    else
        log_error "Failed to initialize migration tracking table"
        return 1
    fi
}

# Function to calculate checksum of a file
calculate_checksum() {
    if command -v sha256sum > /dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum > /dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        md5sum "$1" | awk '{print $1}'
    fi
}

# Function to acquire migration lock
acquire_lock() {
    local version="$1"
    local lock_key="migration_${version}"
    
    log_info "Attempting to acquire lock for migration: $version"
    
    # Use PostgreSQL advisory lock for distributed locking
    local lock_result
    lock_result=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT try_acquire_migration_lock('$lock_key', '$POD_ID');" 2>&1)
    
    if [ "$lock_result" = "t" ]; then
        log_success "Lock acquired for migration: $version"
        return 0
    else
        log_warning "Lock already held for migration: $version"
        
        # Check who holds the lock
        local lock_status
        lock_status=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
            "SELECT locked_by, locked_at FROM get_migration_lock_status('$lock_key');" 2>&1)
        
        log_info "Lock status: $lock_status"
        return 1
    fi
}

# Function to release migration lock
release_lock() {
    local version="$1"
    local lock_key="migration_${version}"
    
    log_info "Releasing lock for migration: $version"
    
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT release_migration_lock('$lock_key', '$POD_ID');" > /dev/null 2>&1
    
    log_success "Lock released for migration: $version"
}

# Function to check if migration has been applied
is_migration_applied() {
    local version="$1"
    
    local applied
    applied=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT is_migration_applied('$version');" 2>&1)
    
    if [ "$applied" = "t" ]; then
        return 0
    else
        return 1
    fi
}

# Function to execute a single migration
execute_migration() {
    local migration_file="$1"
    local version=$(basename "$migration_file" .sql)
    local checksum=$(calculate_checksum "$migration_file")
    
    log_info "Processing migration: $version"
    
    # Check if migration has already been applied
    if is_migration_applied "$version"; then
        log_info "Migration $version already applied, skipping"
        return 0
    fi
    
    # Acquire lock
    if ! acquire_lock "$version"; then
        log_warning "Could not acquire lock for $version, another pod may be running it"
        # Wait a moment and check again if it was applied
        sleep 5
        if is_migration_applied "$version"; then
            log_success "Migration $version was applied by another pod"
            return 0
        fi
        log_error "Migration $version still not applied and lock not available"
        return 1
    fi
    
    # Execute migration
    local start_time=$(date +%s%3N)
    local output
    local exit_code
    
    log_info "Executing migration: $version"
    output=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$migration_file" 2>&1)
    exit_code=$?
    
    local end_time=$(date +%s%3N)
    local execution_time=$((end_time - start_time))
    
    if [ $exit_code -eq 0 ]; then
        log_success "Migration $version executed successfully in ${execution_time}ms"
        
        # Record successful migration
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
            "SELECT record_migration('$version', '$version', '$checksum', TRUE, $execution_time, NULL, '$POD_ID');" > /dev/null 2>&1
        
        release_lock "$version"
        return 0
    else
        log_error "Migration $version failed after ${execution_time}ms"
        log_error "Error output: $output"
        
        # Record failed migration
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
            "SELECT record_migration('$version', '$version', '$checksum', FALSE, $execution_time, '$output', '$POD_ID');" > /dev/null 2>&1
        
        release_lock "$version"
        return 1
    fi
}

# Function to run all migrations
run_migrations() {
    log_info "Starting migration process..."
    log_info "Migrations directory: $MIGRATIONS_DIR"
    log_info "Pod ID: $POD_ID"
    
    # Check database connection
    if ! check_db_connection; then
        log_error "Database connection failed, aborting migrations"
        exit 1
    fi
    
    # Initialize migration tracking table
    if ! init_migration_tracker; then
        log_error "Failed to initialize migration tracking table, aborting migrations"
        exit 1
    fi
    
    # Get list of migration files sorted by version
    local migration_files
    migration_files=$(find "$MIGRATIONS_DIR" -name "*.sql" -type f ! -name "migration-tracker.sql" | sort)
    
    if [ -z "$migration_files" ]; then
        log_warning "No migration files found in $MIGRATIONS_DIR"
        return 0
    fi
    
    local migration_count=$(echo "$migration_files" | wc -l)
    log_info "Found $migration_count migration files"
    
    # Execute migrations in order
    local success_count=0
    local failure_count=0
    
    for migration_file in $migration_files; do
        if execute_migration "$migration_file"; then
            success_count=$((success_count + 1))
        else
            failure_count=$((failure_count + 1))
            log_error "Migration failed, aborting remaining migrations"
            break
        fi
    done
    
    log_info "Migration process completed: $success_count successful, $failure_count failed"
    
    if [ $failure_count -gt 0 ]; then
        log_error "Migration process failed with $failure_count errors"
        exit 1
    else
        log_success "All migrations completed successfully"
        return 0
    fi
}

# Function to force release a stuck lock (for recovery)
force_release_lock() {
    local version="$1"
    local lock_key="migration_${version}"
    
    log_warning "Force releasing lock for migration: $version"
    
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "SELECT pg_advisory_unlock(hashtext('$lock_key'));" > /dev/null 2>&1
    
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "UPDATE schema_migrations SET locked_by = NULL, locked_at = NULL WHERE version = '$version';" > /dev/null 2>&1
    
    log_success "Force released lock for migration: $version"
}

# Main execution
main() {
    case "${1:-run}" in
        run)
            run_migrations
            ;;
        force-release)
            if [ -z "$2" ]; then
                log_error "Usage: $0 force-release <migration_version>"
                exit 1
            fi
            force_release_lock "$2"
            ;;
        status)
            log_info "Migration status:"
            psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
                "SELECT version, name, success, applied_at, execution_time_ms, locked_by FROM schema_migrations ORDER BY applied_at DESC;"
            ;;
        *)
            log_error "Usage: $0 {run|force-release|status}"
            exit 1
            ;;
    esac
}

main "$@"
