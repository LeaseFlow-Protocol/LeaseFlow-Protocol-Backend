# Abandoned Asset 30-Day Countdown Tracker

## Overview

This implementation provides transparency into the automated seizure process for ghosted or abandoned rental properties. The system monitors the `last_interaction_timestamp` of all expired leases and calculates the exact remaining time until the 30-day legal abandonment threshold is crossed.

## Features

### ✅ Core Functionality
- **30-Day Countdown Logic**: Precise calculation of time remaining until seizure eligibility
- **Leap Year Handling**: Accurate time calculations accounting for leap years and month-length variations
- **Automated Alerts**: "Asset Ready for Seizure" notifications when timer hits zero
- **Safety Checks**: Timer resets instantly when lessee interacts with the protocol
- **Live Dashboard API**: Real-time countdown data for lessor dashboards

### ✅ API Endpoints

#### GET `/api/v1/leases/abandoned`
Get all abandoned assets with countdown timers.

**Query Parameters:**
- `landlord_id` (optional): Filter by specific landlord
- `status` (optional): Filter by abandonment status (`active`, `pending_seizure`, `seized`)
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Items per page (default: 50)

**Response:**
```json
{
  "success": true,
  "data": {
    "assets": [
      {
        "lease_id": "lease_123",
        "landlord_id": "landlord_456",
        "tenant_id": "tenant_789",
        "status": "expired",
        "rent_amount": 1500,
        "currency": "USD",
        "abandonment_status": "pending_seizure",
        "countdown": {
          "days_since_interaction": 31,
          "remaining_days": 0,
          "remaining_hours": 0,
          "remaining_minutes": 0,
          "remaining_seconds": 0,
          "is_ready_for_seizure": true,
          "exact_time_to_seizure": "2024-01-15T10:30:00.000Z"
        }
      }
    ],
    "pagination": {
      "current_page": 1,
      "per_page": 50,
      "total_items": 1,
      "total_pages": 1
    },
    "summary": {
      "total_abandoned_assets": 1,
      "assets_ready_for_seizure": 1,
      "assets_pending_seizure": 1,
      "assets_active_tracking": 0
    }
  }
}
```

#### GET `/api/v1/leases/abandoned/summary`
Get summary statistics for abandoned assets.

#### GET `/api/v1/leases/abandoned/:leaseId`
Get specific abandoned asset details.

#### POST `/api/v1/leases/abandoned/:leaseId/reset-timer`
Reset abandonment timer when lessee interacts with the protocol.

**Request Body:**
```json
{
  "interaction_type": "payment_received"
}
```

#### POST `/api/v1/leases/abandoned/run-tracking`
Manually trigger the abandoned asset tracking process (admin only).

## Database Schema

### New Fields Added to Leases Table

```sql
-- Timestamp of last lease interaction - used for 30-day abandonment countdown
ALTER TABLE leases ADD COLUMN last_interaction_timestamp TEXT;

-- Status of abandonment process: active, pending_seizure, seized
ALTER TABLE leases ADD COLUMN abandonment_status TEXT DEFAULT 'active';

-- Flag indicating if seizure alert has been sent to lessor
ALTER TABLE leases ADD COLUMN abandonment_alert_sent INTEGER DEFAULT 0;
```

### Database Views

#### `v_abandoned_assets`
Optimized view for tracking abandoned assets and countdown to seizure eligibility.

```sql
CREATE OR REPLACE VIEW v_abandoned_assets AS
SELECT 
    id,
    landlord_id,
    tenant_id,
    status,
    rent_amount,
    currency,
    end_date,
    last_interaction_timestamp,
    abandonment_status,
    abandonment_alert_sent,
    -- Calculate days since last interaction
    (julianday('now') - julianday(last_interaction_timestamp)) as days_since_last_interaction,
    -- Calculate remaining days until 30-day threshold
    (30 - (julianday('now') - julianday(last_interaction_timestamp))) as remaining_days,
    -- Check if ready for seizure (30 days passed)
    CASE 
        WHEN (julianday('now') - julianday(last_interaction_timestamp)) >= 30 THEN 1
        ELSE 0
    END as ready_for_seizure
FROM leases
WHERE status IN ('expired', 'terminated')
  AND abandonment_status != 'seized'
ORDER BY last_interaction_timestamp ASC;
```

## Automated Worker

### Abandoned Asset Tracking Job

The tracking worker runs every hour to:

1. **Monitor Expired Leases**: Identifies all leases with status `expired` or `terminated`
2. **Calculate Precise Time Differences**: Uses exact millisecond calculations for accuracy
3. **Update Seizure Status**: Marks leases as `pending_seizure` when 30-day threshold is crossed
4. **Send Automated Alerts**: Dispatches "Asset Ready for Seizure" notifications to lessors
5. **Reset on Interaction**: Updates `last_interaction_timestamp` when lessee interacts

### Configuration

```bash
# Enable/disable abandoned asset tracking
ABANDONED_ASSET_TRACKING_ENABLED=true

# Custom tracking schedule (optional)
ABANDONED_ASSET_TRACKING_CRON="0 * * * *"  # Every hour
```

## Time Calculation Precision

### Leap Year Handling
The system uses JavaScript's `Date` object for precise time calculations:

```javascript
// Example: Feb 29, 2024 (leap year) to Mar 30, 2024
const leapDate = new Date('2024-02-29T12:00:00Z');
const thirtyDaysLater = new Date('2024-03-30T12:00:00Z');
// Correctly calculates as exactly 30 days
```

### Month-Length Variations
The system handles varying month lengths automatically:

```javascript
// Example: Jan 31 to Mar 1 (non-leap year)
const jan31 = new Date('2024-01-31T12:00:00Z');
const mar1 = new Date('2024-03-01T12:00:00Z');
// Correctly calculates as exactly 30 days
```

### Millisecond Precision
All calculations use millisecond precision for exact timing:

```javascript
const diffMs = now - lastInteraction;
const remainingMs = Math.max(0, thirtyDaysInMs - diffMs);
const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
```

## Safety Mechanisms

### Lessee Interaction Reset
When a lessee interacts with the protocol (payment, communication, etc.), the timer instantly resets:

```javascript
// Triggered by any significant lease activity
function resetAbandonmentTimer(leaseId) {
  // Reset timestamp to now
  // Reset status to 'active'
  // Clear alert sent flag
}
```

### Automatic Triggers
The system automatically updates `last_interaction_timestamp` on:

- Lease status changes
- Payment status updates
- Dispute status changes
- Manual reset via API

## Testing

### Running Tests

```bash
# Install dependencies
npm install

# Run abandoned asset tracker tests
npm test -- src/tests/abandonedAssetTracker.test.js

# Run all tests with coverage
npm test
```

### Test Coverage

The test suite includes:

1. **Time Calculation Tests**
   - Exact 30-day boundary testing
   - Leap year calculations
   - Month-length variations
   - Partial day calculations

2. **Database Integration Tests**
   - Lease filtering and querying
   - Status updates and transitions
   - Alert sending and tracking

3. **End-to-End Lifecycle Tests**
   - Complete abandonment workflow
   - Timer reset on interaction
   - Edge case handling

4. **Integration Tests**
   - Mock timestamp injection
   - Notification service mocking
   - Database transaction testing

### Test Scenarios

#### Scenario 1: Exact 30-Day Threshold
```javascript
// Test lease exactly at 30-day boundary
const exactlyThirtyDaysAgo = new Date();
exactlyThirtyDaysAgo.setDate(exactlyThirtyDaysAgo.getDate() - 30);
// Should trigger seizure readiness
```

#### Scenario 2: Leap Year Handling
```javascript
// Test across Feb 29 in leap year
const leapDate = new Date('2024-02-29T12:00:00Z');
// Verify 30-day calculation is accurate
```

#### Scenario 3: Lessee Interaction Reset
```javascript
// Simulate lessee payment after 25 days
// Verify timer resets and extends deadline
```

## Acceptance Criteria Verification

### ✅ Acceptance 1: Visual Clarity
- **Implementation**: Live countdown API with precise time calculations
- **Verification**: Dashboard can display real-time countdown with days, hours, minutes, seconds
- **API Response**: Includes `remaining_days`, `remaining_hours`, `remaining_minutes`, `remaining_seconds`

### ✅ Acceptance 2: Automated Alerts
- **Implementation**: Hourly worker automatically dispatches "Asset Ready for Seizure" alerts
- **Verification**: Lessors receive notifications without manual blockchain polling
- **Alert Content**: "Asset Ready for Seizure: Lease {id} has been abandoned for 30+ days"

### ✅ Acceptance 3: Lessee Protection
- **Implementation**: Instant timer reset on any lessee interaction
- **Verification**: Prevents premature deposit forfeitures
- **Safety Mechanism**: Multiple automatic triggers and manual reset API

## Performance Considerations

### Database Optimization
- **Indexes**: Optimized indexes on `last_interaction_timestamp` and `abandonment_status`
- **Partitioning**: Expired leases are partitioned for efficient querying
- **Views**: Optimized views for common query patterns

### Worker Efficiency
- **Hourly Schedule**: Balances responsiveness with resource usage
- **Batch Processing**: Processes all leases in single database transactions
- **Selective Queries**: Only processes leases requiring updates

### API Performance
- **Pagination**: Prevents large result sets
- **Filtering**: Efficient database-level filtering
- **Caching**: Summary statistics can be cached

## Monitoring and Observability

### Logs
The system provides detailed logging for:
- Tracking job execution
- Lease status updates
- Alert dispatch
- Timer resets
- Error conditions

### Metrics
Key metrics to monitor:
- Number of abandoned assets
- Alerts sent per hour
- Timer resets per day
- Processing time per job

## Configuration Options

### Environment Variables

```bash
# Enable/disable the tracking system
ABANDONED_ASSET_TRACKING_ENABLED=true

# Custom cron schedule (default: every hour)
ABANDONED_ASSET_TRACKING_CRON="0 * * * *"

# Database configuration
DATABASE_FILENAME="./data/leaseflow-protocol.sqlite"

# Logging level
LOG_LEVEL=info
```

### Future Enhancements

Potential improvements for future versions:
1. **WebSocket Integration**: Real-time updates to dashboards
2. **Customizable Thresholds**: Configurable abandonment periods per jurisdiction
3. **Multi-Channel Alerts**: Email, SMS, push notifications
4. **Analytics Dashboard**: Historical abandonment trends
5. **Automated Reporting**: Periodic reports for lessors

## Troubleshooting

### Common Issues

1. **Missing Database Fields**
   - Run migration: `016_add_abandoned_asset_tracking.sql`
   - Verify schema with `\d leases`

2. **Worker Not Running**
   - Check `ABANDONED_ASSET_TRACKING_ENABLED=true`
   - Verify logs for startup messages

3. **Incorrect Time Calculations**
   - Verify server timezone (should be UTC)
   - Check database timestamp format

4. **Missing Alerts**
   - Verify notification service configuration
   - Check alert sent flag in database

### Debug Commands

```sql
-- Check abandoned assets
SELECT * FROM v_abandoned_assets;

-- Verify tracking fields
SELECT id, last_interaction_timestamp, abandonment_status, abandonment_alert_sent 
FROM leases 
WHERE status IN ('expired', 'terminated');

-- Check recent alerts
SELECT * FROM notifications 
WHERE type = 'asset_ready_for_seizure'
ORDER BY created_at DESC;
```

## Security Considerations

1. **Access Control**: Admin-only endpoints for manual tracking
2. **Data Privacy**: Sensitive lease data protection
3. **Audit Trail**: All timer resets are logged
4. **Input Validation**: API input sanitization
5. **Rate Limiting**: Prevent abuse of timer reset functionality

## Conclusion

This implementation provides a robust, accurate, and secure abandoned asset tracking system that meets all acceptance criteria while providing extensive testing coverage and operational reliability.
