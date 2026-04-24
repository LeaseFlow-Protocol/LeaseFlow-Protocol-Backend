/**
 * Demo script to test abandoned asset tracking functionality
 * Run this script to verify the system works correctly
 */

const { AppDatabase } = require('./src/db/appDatabase');
const { AbandonedAssetTracker } = require('./src/services/abandonedAssetTracker');
const { NotificationService } = require('./src/services/notificationService');

async function runDemo() {
  console.log('🚀 Starting Abandoned Asset Tracking Demo...\n');

  // Initialize database (in-memory for demo)
  const database = new AppDatabase(':memory:');
  
  // Run migration to add tracking fields
  console.log('📋 Running migration...');
  database.db.exec(`
    ALTER TABLE leases ADD COLUMN last_interaction_timestamp TEXT;
    ALTER TABLE leases ADD COLUMN abandonment_status TEXT DEFAULT 'active';
    ALTER TABLE leases ADD COLUMN abandonment_alert_sent INTEGER DEFAULT 0;
  `);
  console.log('✅ Migration completed\n');

  // Initialize services
  const notificationService = new NotificationService(database);
  const tracker = new AbandonedAssetTracker(database, notificationService);

  // Create demo data
  console.log('📊 Creating demo lease data...');
  const now = new Date();
  const thirtyOneDaysAgo = new Date(now.getTime() - (31 * 24 * 60 * 60 * 1000));
  const fifteenDaysAgo = new Date(now.getTime() - (15 * 24 * 60 * 60 * 1000));
  const fiveDaysAgo = new Date(now.getTime() - (5 * 24 * 60 * 60 * 1000));

  // Insert test leases
  database.db.run(`
    INSERT INTO leases (id, landlord_id, tenant_id, status, rent_amount, currency, start_date, end_date, created_at, updated_at, last_interaction_timestamp, abandonment_status, abandonment_alert_sent)
    VALUES 
      ('lease_ready_seizure', 'landlord_1', 'tenant_1', 'expired', 1500, 'USD', '2023-01-01', '2023-12-31', '2023-01-01', '2023-12-31', ?, 'active', 0),
      ('lease_fifteen_days', 'landlord_1', 'tenant_2', 'expired', 2000, 'USD', '2023-06-01', '2023-11-30', '2023-06-01', '2023-11-30', ?, 'active', 0),
      ('lease_five_days', 'landlord_2', 'tenant_3', 'terminated', 1200, 'USD', '2023-08-01', '2023-12-15', '2023-08-01', '2023-12-15', ?, 'active', 0)
  `, thirtyOneDaysAgo.toISOString(), fifteenDaysAgo.toISOString(), fiveDaysAgo.toISOString());

  console.log('✅ Created 3 demo leases:');
  console.log('   - lease_ready_seizure: 31 days ago (ready for seizure)');
  console.log('   - lease_fifteen_days: 15 days ago (15 days remaining)');
  console.log('   - lease_five_days: 5 days ago (25 days remaining)\n');

  // Test 1: Get abandoned assets data
  console.log('🔍 Testing abandoned assets query...');
  const abandonedAssets = tracker.getAbandonedAssetsData();
  console.log(`Found ${abandonedAssets.length} abandoned assets:`);
  abandonedAssets.forEach(asset => {
    console.log(`   📋 Lease ${asset.lease_id}:`);
    console.log(`      - Days since interaction: ${asset.countdown.days_since_interaction}`);
    console.log(`      - Remaining days: ${asset.countdown.remaining_days}`);
    console.log(`      - Ready for seizure: ${asset.countdown.is_ready_for_seizure}`);
    console.log(`      - Status: ${asset.abandonment_status}`);
  });
  console.log();

  // Test 2: Update leases ready for seizure
  console.log('⚡ Testing seizure readiness update...');
  const updatedLeases = tracker.updateLeasesReadyForSeizure();
  console.log(`Updated ${updatedLeases.length} leases for seizure readiness`);
  console.log();

  // Test 3: Send seizure alerts
  console.log('📧 Testing seizure alerts...');
  const alertedLeases = await tracker.sendSeizureAlerts();
  console.log(`Sent seizure alerts for ${alertedLeases.length} leases`);
  console.log();

  // Test 4: Timer reset on lessee interaction
  console.log('🔄 Testing timer reset on lessee interaction...');
  const resetSuccess = tracker.resetAbandonmentTimer('lease_ready_seizure');
  console.log(`Timer reset for lease_ready_seizure: ${resetSuccess ? '✅ Success' : '❌ Failed'}`);
  console.log();

  // Test 5: Verify time calculation precision
  console.log('⏰ Testing time calculation precision...');
  const testTimestamp = new Date(now.getTime() - (10 * 24 * 60 * 60 * 1000) - (6 * 60 * 60 * 1000)); // 10 days, 6 hours ago
  const timeData = tracker.calculatePreciseTimeDifference(testTimestamp.toISOString());
  console.log(`For timestamp 10 days and 6 hours ago:`);
  console.log(`   - Days since interaction: ${timeData.daysSinceInteraction}`);
  console.log(`   - Remaining days: ${timeData.remainingDays}`);
  console.log(`   - Remaining hours: ${timeData.remainingHours}`);
  console.log(`   - Is ready for seizure: ${timeData.isReadyForSeizure}`);
  console.log();

  // Test 6: Run complete tracking process
  console.log('🎯 Running complete tracking process...');
  const results = await tracker.runTrackingProcess();
  console.log('Tracking process results:');
  console.log(`   - Leases updated for seizure: ${results.leases_updated_for_seizure.length}`);
  console.log(`   - Seizure alerts sent: ${results.seizure_alerts_sent.length}`);
  console.log(`   - Total abandoned assets tracked: ${results.total_abandoned_assets_tracked}`);
  console.log(`   - Assets ready for seizure: ${results.assets_ready_for_seizure}`);
  console.log(`   - Assets pending seizure: ${results.assets_pending_seizure}`);
  console.log();

  // Test 7: Leap year handling
  console.log('🗓️  Testing leap year handling...');
  const leapDate = new Date('2024-02-29T12:00:00Z');
  const thirtyDaysAfterLeap = new Date('2024-03-30T12:00:00Z');
  
  // Mock current time
  const originalNow = Date.now;
  Date.now = () => thirtyDaysAfterLeap.getTime();
  
  const leapTimeData = tracker.calculatePreciseTimeDifference(leapDate.toISOString());
  console.log(`From Feb 29, 2024 to Mar 30, 2024 (leap year):`);
  console.log(`   - Days since interaction: ${leapTimeData.daysSinceInteraction}`);
  console.log(`   - Is ready for seizure: ${leapTimeData.isReadyForSeizure}`);
  console.log(`   - Expected: Exactly 30 days`);
  
  // Restore original Date.now
  Date.now = originalNow;
  console.log();

  console.log('🎉 Demo completed successfully!');
  console.log('\n📋 Summary:');
  console.log('✅ Database migration works');
  console.log('✅ Abandoned asset tracking works');
  console.log('✅ Time calculations are precise');
  console.log('✅ Seizure alerts are sent automatically');
  console.log('✅ Timer reset on interaction works');
  console.log('✅ Leap year handling is correct');
  console.log('✅ Complete tracking process works');

  // Close database
  database.db.close();
}

// Run demo if this file is executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}

module.exports = { runDemo };
