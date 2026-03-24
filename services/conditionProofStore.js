const fs = require('fs/promises');
const path = require('path');

function createFileConditionProofStore({
  filePath = process.env.LEASEFLOW_CONDITION_PROOF_DB_PATH ||
    path.join(__dirname, '..', 'data', 'condition-proofs.json'),
} = {}) {
  async function ensureDb() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.access(filePath);
    } catch (_error) {
      await fs.writeFile(
        filePath,
        JSON.stringify({ proofs: [] }, null, 2),
        'utf8',
      );
    }
  }

  async function readDb() {
    await ensureDb();
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.proofs) ? parsed : { proofs: [] };
  }

  async function writeDb(data) {
    await ensureDb();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  return {
    async save(record) {
      const db = await readDb();
      db.proofs.push(record);
      await writeDb(db);
      return record;
    },

    async listByLeaseId(leaseId) {
      const db = await readDb();
      return db.proofs
        .filter((item) => item.lease_id === leaseId)
        .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
    },
  };
}

module.exports = {
  createFileConditionProofStore,
};
