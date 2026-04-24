-- MRR (Monthly Recurring Revenue) View for LeaseFlow Protocol
-- This view calculates normalized monthly recurring revenue for lessors
-- by converting all lease payments to standard monthly amounts

-- First, create a helper view for lease payment normalization
CREATE VIEW IF NOT EXISTS lease_payment_normalization AS
SELECT 
    l.id AS lease_id,
    l.landlord_id,
    l.rent_amount,
    l.currency,
    l.start_date,
    l.end_date,
    l.status,
    l.payment_status,
    -- Calculate lease duration in days
    (julianday(l.end_date) - julianday(l.start_date)) AS lease_duration_days,
    -- Calculate total months in lease (normalized to 30.44 days per month)
    ((julianday(l.end_date) - julianday(l.start_date)) / 30.44) AS total_months,
    -- Calculate monthly rent amount (normalize from any billing cycle)
    CASE 
        -- If rent_amount appears to be weekly (assume 4 weeks per month)
        WHEN l.rent_amount < 1000000 THEN (l.rent_amount * 4.33)  -- Weekly to monthly
        -- If rent_amount appears to be daily (assume 30.44 days per month)  
        WHEN l.rent_amount < 50000 THEN (l.rent_amount * 30.44)  -- Daily to monthly
        -- Otherwise assume it's already monthly
        ELSE l.rent_amount
    END AS normalized_monthly_rent,
    -- Check if lease was active on a specific date (parameterized via WHERE clause)
    1 AS is_active_lease
FROM leases l
WHERE l.status NOT IN ('Grace_Period', 'Delinquent', 'Terminated', 'terminated')
  AND l.payment_status = 'paid';

-- Main MRR calculation view
CREATE VIEW IF NOT EXISTS mrr_by_lessor AS
SELECT 
    landlord_id,
    -- Current MRR (as of today)
    SUM(normalized_monthly_rent) AS current_mrr,
    COUNT(*) AS active_lease_count,
    -- Currency breakdown
    currency,
    -- Average monthly rent per lease
    AVG(normalized_monthly_rent) AS avg_monthly_rent_per_lease,
    -- Maximum and minimum monthly rents
    MAX(normalized_monthly_rent) AS max_monthly_rent,
    MIN(normalized_monthly_rent) AS min_monthly_rent,
    -- Calculation timestamp
    datetime('now') AS calculated_at
FROM lease_payment_normalization
WHERE is_active_lease = 1
  -- Lease is currently active (start_date <= today <= end_date)
  AND date(start_date) <= date('now')
  AND date(end_date) >= date('now')
GROUP BY landlord_id, currency;

-- Historical MRR view (for date-specific queries)
CREATE VIEW IF NOT EXISTS historical_mrr_by_lessor AS
SELECT 
    landlord_id,
    -- MRR as of specific historical date
    SUM(normalized_monthly_rent) AS historical_mrr,
    COUNT(*) AS active_lease_count_historical,
    currency,
    -- This would be used with a date parameter in the query
    'placeholder_date' AS query_date,
    datetime('now') AS calculated_at
FROM lease_payment_normalization lpn
WHERE lpn.is_active_lease = 1
  -- Lease was active on the historical date
  AND date(lpn.start_date) <= 'placeholder_date'
  AND date(lpn.end_date) >= 'placeholder_date'
GROUP BY landlord_id, currency;

-- MRR trend view (monthly aggregates)
CREATE VIEW IF NOT EXISTS mrr_monthly_trends AS
SELECT 
    landlord_id,
    -- Extract year-month from lease start date for trend analysis
    strftime('%Y-%m', start_date) AS month_year,
    SUM(normalized_monthly_rent) AS monthly_mrr,
    COUNT(*) AS new_leases_count,
    currency
FROM lease_payment_normalization
WHERE is_active_lease = 1
GROUP BY landlord_id, strftime('%Y-%m', start_date), currency
ORDER BY month_year DESC;
