// Tiny file-backed JSON store. Deliberately not a real database: this app runs on a
// single small VPS process for a single office, so a synchronous JSON file with
// atomic writes is simpler to operate (backup = copy one file) than standing up
// SQLite/Postgres. If usage ever outgrows this, only this module needs to change.
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const SEED = {
  rooms: [
    { id: 'cedar', name: 'Cedar', capacity: 6, floor: 'Tầng 8' },
    { id: 'maple', name: 'Maple', capacity: 10, floor: 'Tầng 8' },
    { id: 'oak', name: 'Oak', capacity: 4, floor: 'Tầng 12' }
  ],
  companies: [
    { id: 'c1', name: 'Công ty TNHH Kim Long', plan: 'Văn phòng riêng · 4 chỗ', freeHours: 18, status: 'active' },
    { id: 'c2', name: 'VNTech Solutions', plan: 'Văn phòng riêng · 8 chỗ', freeHours: 18, status: 'active' },
    { id: 'c3', name: 'Blue Ocean Media', plan: 'Chỗ ngồi linh hoạt · 6 chỗ', freeHours: 18, status: 'active' },
    { id: 'c4', name: 'Fintech Star JSC', plan: 'Văn phòng riêng · 12 chỗ', freeHours: 18, status: 'active' },
    { id: 'c5', name: 'Greenfield Logistics', plan: 'Chỗ ngồi linh hoạt · 3 chỗ', freeHours: 18, status: 'paused' }
  ],
  bookings: [],
  meta: { bookingSeq: 1, companySeq: 6 }
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(SEED, null, 2), 'utf8');
  }
}

let cache = null;

function load() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    cache = JSON.parse(raw);
  } catch (err) {
    throw new Error('data/store.json is corrupted and could not be parsed: ' + err.message);
  }
  return cache;
}

// Atomic write: write to a temp file in the same directory, then rename over the
// target. Rename is atomic on the same filesystem, so a crash mid-write never
// leaves store.json half-written.
function persist() {
  const tmp = DATA_FILE + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function get() {
  if (!cache) load();
  return cache;
}

// All mutations go through mutate() so every write is followed by a persist,
// keeping the in-memory cache and the on-disk file from ever drifting apart.
function mutate(fn) {
  const state = get();
  const result = fn(state);
  persist();
  return result;
}

module.exports = { get, mutate, load, DATA_FILE };
