const { checkAndInitializeLease, getLeases, saveLeases } = require('../worker');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../leases.json');

describe('Lease Coordination Worker', () => {
  beforeEach(() => {
    // Reset DB for each test
    const initialDb = {
      "test_lease": {
        "landlord_signed": false,
        "tenant_signed": false,
        "initialized_on_chain": false,
        "status": "DRAFT",
        "contract_data": {}
      }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initialDb, null, 2));
  });

  it('should NOT initialize if only landlord signs', async () => {
    const leases = getLeases();
    leases["test_lease"].landlord_signed = true;
    saveLeases(leases);

    await checkAndInitializeLease("test_lease");
    
    const finalLeases = getLeases();
    expect(finalLeases["test_lease"].initialized_on_chain).toBe(false);
  });

  it('should NOT initialize if only tenant signs', async () => {
    const leases = getLeases();
    leases["test_lease"].tenant_signed = true;
    saveLeases(leases);

    await checkAndInitializeLease("test_lease");
    
    const finalLeases = getLeases();
    expect(finalLeases["test_lease"].initialized_on_chain).toBe(false);
  });

  it('should initialize on-chain ONLY when BOTH signed', async () => {
    const leases = getLeases();
    leases["test_lease"].landlord_signed = true;
    leases["test_lease"].tenant_signed = true;
    saveLeases(leases);

    await checkAndInitializeLease("test_lease");
    
    const finalLeases = getLeases();
    expect(finalLeases["test_lease"].initialized_on_chain).toBe(true);
    expect(finalLeases["test_lease"].status).toBe('INITIALIZED');
  });
});
