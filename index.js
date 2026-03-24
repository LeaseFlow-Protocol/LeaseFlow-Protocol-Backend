require('dotenv').config();
const express = require('express');
const cors = require('cors');
const leaseRoutes = require('./src/routes/leaseRoutes');
const ownerRoutes = require('./src/routes/ownerRoutes');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/leases', leaseRoutes);
app.use('/api/owners', ownerRoutes);

app.get('/', (req, res) => {
  res.json({ 
    project: 'LeaseFlow Protocol Backend', 
    description: 'Secure Lease Indexer and Storage Facilitator',
    status: 'Operational',
    version: '1.0.0',
    contract_id: process.env.CONTRACT_ID || 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4',
    endpoints: {
      upload_lease: 'POST /api/leases/upload',
      view_lease_handshake: 'GET /api/leases/:leaseCID/handshake',
      top_owners: 'GET /api/owners/top'
    }
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('[App] Unhandled Error:', err);
  res.status(500).json({ error: 'Internal server error.', details: err.message });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`LeaseFlow Backend running at http://localhost:${port}`);
    console.log(`Lease Encryption Service: Active`);
    console.log(`IPFS Storage Service: Initialized (Host: ${process.env.IPFS_HOST || 'ipfs.infura.io'})`);
  });
}

module.exports = app;
