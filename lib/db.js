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
let dbCache = null;

async function getMongoDb() {
  if (dbCache) return dbCache;
  if (!clientPromise) {
    const client = new MongoClient(MONGODB_URI);
    clientPromise = client.connect().then(() => client);
  }
  const client = await clientPromise;
  // If the connection string doesn't specify a db name, name it explicitly
  // instead of silently landing in Mongo's default "test" database.
  dbCache = client.db(client.options.dbName || 'bulk_email_sender');
  return dbCache;
}

async function readMongo() {
  const db = await getMongoDb();
  const col = db.collection('app_state');
  let doc = await col.findOne({ _id: 'state' });
  if (!doc) {
    doc = { _id: 'state', ...DEFAULT_DATA };
    await col.insertOne(doc);
  }
  const { _id, ...data } = doc;
  return data;
}

async function writeMongo(data) {
  const db = await getMongoDb();
  const col = db.collection('app_state');
  await col.replaceOne({ _id: 'state' }, { _id: 'state', ...data }, { upsert: true });
}

// Attachments live in their own collection, one document per file, so a
// pile of image/PDF attachments can never grow the main state document
// toward Mongo's 16MB-per-document cap.
async function saveAttachmentMongo(id, meta) {
  const db = await getMongoDb();
  await db.collection('attachments').replaceOne(
    { _id: id },
    { _id: id, ...meta, createdAt: new Date().toISOString() },
    { upsert: true }
  );
}

async function getAttachmentMongo(id) {
  const db = await getMongoDb();
  const doc = await db.collection('attachments').findOne({ _id: id });
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

// ---------------- Local JSON file mode (fallback for local dev only) ----------------
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');

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

function saveAttachmentLocal(id, meta) {
  if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ATTACHMENTS_DIR, `${id}.json`),
    JSON.stringify({ ...meta, createdAt: new Date().toISOString() })
  );
}

function getAttachmentLocal(id) {
  const file = path.join(ATTACHMENTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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

async function saveAttachment(id, meta) {
  return MONGODB_URI ? saveAttachmentMongo(id, meta) : saveAttachmentLocal(id, meta);
}

async function getAttachment(id) {
  return MONGODB_URI ? getAttachmentMongo(id) : getAttachmentLocal(id);
}

function nextId(db, kind) {
  db.seq[kind] = (db.seq[kind] || 0) + 1;
  return db.seq[kind];
}

module.exports = { readDB, writeDB, saveAttachment, getAttachment, nextId };
