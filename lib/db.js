const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const DEFAULT_DATA = {
  accounts: [],
  campaigns: [],
  seq: { account: 0, campaign: 0 }
};

const MONGODB_URI = process.env.MONGODB_URI;

// ---------------- MongoDB Atlas mode (used in production) ----------------
let clientPromise = null;
let collectionCache = null;

async function getCollection() {
  if (collectionCache) return collectionCache;
  if (!clientPromise) {
    const client = new MongoClient(MONGODB_URI);
    clientPromise = client.connect().then(() => client);
  }
  const client = await clientPromise;
  // If the connection string doesn't specify a db name, name it explicitly
  // instead of silently landing in Mongo's default "test" database.
  const db = client.db(client.options.dbName || 'bulk_email_sender');
  collectionCache = db.collection('app_state');
  return collectionCache;
}

async function readMongo() {
  const col = await getCollection();
  let doc = await col.findOne({ _id: 'state' });
  if (!doc) {
    doc = { _id: 'state', ...DEFAULT_DATA };
    await col.insertOne(doc);
  }
  const { _id, ...data } = doc;
  return data;
}

async function writeMongo(data) {
  const col = await getCollection();
  await col.replaceOne({ _id: 'state' }, { _id: 'state', ...data }, { upsert: true });
}

// ---------------- Local JSON file mode (fallback for local dev only) ----------------
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureLocalDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
}

function readLocal() {
  ensureLocalDB();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    fs.writeFileSync(DB_FILE + '.corrupt.' + Date.now(), raw);
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

let localWriteChain = Promise.resolve();
function writeLocal(data) {
  localWriteChain = localWriteChain.then(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  });
  return localWriteChain;
}

// ---------------- Public API ----------------
if (!MONGODB_URI) {
  console.warn(
    '[db] MONGODB_URI not set — using local data/db.json instead. ' +
    'Fine for local development, but on most free hosting this data will ' +
    'NOT survive a restart. Set MONGODB_URI in production.'
  );
}

async function readDB() {
  return MONGODB_URI ? readMongo() : readLocal();
}

async function writeDB(data) {
  return MONGODB_URI ? writeMongo(data) : writeLocal(data);
}

function nextId(db, kind) {
  db.seq[kind] = (db.seq[kind] || 0) + 1;
  return db.seq[kind];
}

module.exports = { readDB, writeDB, nextId };
