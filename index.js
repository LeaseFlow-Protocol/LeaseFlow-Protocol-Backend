const express = require('express');
const cors = require('cors');
const { checkAndInitializeLease, getLeases, saveLeases } = require('./worker');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    project: 'LeaseFlow Protocol', 
    status: 'Active',
    contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4'
  });
});

app.get('/leases', (req, res) => {
  res.json(getLeases());
});

app.post('/sign-lease', async (req, res) => {
  const { leaseId, role, signature } = req.body;
  const leases = getLeases();
  const lease = leases[leaseId];

  if (!lease) {
    return res.status(404).json({ error: `Lease ${leaseId} not found.` });
  }

  // SIWS Signature verification (Simulation)
  if (!signature) {
    return res.status(400).json({ error: 'Signature required.' });
  }

  if (role === 'LANDLORD') {
    lease.landlord_signed = true;
    lease.landlord_signature = signature;
  } else if (role === 'TENANT') {
    lease.tenant_signed = true;
    lease.tenant_signature = signature;
  } else {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  saveLeases(leases);
  console.log(`[API] Lease ${leaseId} signed by ${role}. Checking coordination...`);
  
  // Call coordination worker
  await checkAndInitializeLease(leaseId);
  
  res.json({ message: `Lease ${leaseId} signed by ${role}.`, state: leases[leaseId] });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
  });
}

module.exports = app;
