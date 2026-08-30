const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DATA = {
  accounts: [],
  campaigns: [],
  seq: { account: 0, campaign: 0 }
};

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}

function readDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    // corrupted file guard - back it up and reset rather than crash the app
    fs.writeFileSync(DB_FILE + '.corrupt.' + Date.now(), raw);
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

// Very small write queue so concurrent requests don't clobber each other.
let writeChain = Promise.resolve();
function writeDB(data) {
  writeChain = writeChain.then(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  });
  return writeChain;
}

function nextId(db, kind) {
  db.seq[kind] = (db.seq[kind] || 0) + 1;
  return db.seq[kind];
}

module.exports = { readDB, writeDB, nextId, DB_FILE };
