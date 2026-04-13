// Postgres helper. Uses a singleton Pool keyed on globalThis to survive
// hot reloads in dev and to be reused across serverless invocations.
import pg from 'pg';
const { Pool } = pg;

const FREE_QUOTA = parseInt(process.env.FREE_QUOTA || '3', 10);

function makePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not configured');
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
  });
}

export function getPool() {
  if (!globalThis.__tbpicPool) globalThis.__tbpicPool = makePool();
  return globalThis.__tbpicPool;
}

let initialized = false;
export async function ensureSchema() {
  if (initialized) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      kakao_id      TEXT PRIMARY KEY,
      nickname      TEXT,
      profile_image TEXT,
      quota         INTEGER NOT NULL DEFAULT ${FREE_QUOTA},
      used          INTEGER NOT NULL DEFAULT 0,
      is_blocked    BOOLEAN NOT NULL DEFAULT FALSE,
      is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at  TIMESTAMPTZ
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS generations (
      id          BIGSERIAL PRIMARY KEY,
      kakao_id    TEXT NOT NULL REFERENCES users(kakao_id) ON DELETE CASCADE,
      style_id    TEXT,
      ok          BOOLEAN NOT NULL,
      error       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_gen_user_time ON generations(kakao_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS charge_requests (
      id             BIGSERIAL PRIMARY KEY,
      kakao_id       TEXT NOT NULL REFERENCES users(kakao_id) ON DELETE CASCADE,
      package_size   INTEGER NOT NULL,
      amount_won     INTEGER NOT NULL,
      depositor_name TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      note           TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at   TIMESTAMPTZ,
      processed_by   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_charge_status ON charge_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_charge_user ON charge_requests(kakao_id, created_at DESC);
  `);
  initialized = true;
}

export async function upsertUser({ kakaoId, nickname, profileImage }) {
  await ensureSchema();
  const pool = getPool();
  // 첫 가입자는 자동으로 슈퍼어드민
  const { rows: existing } = await pool.query(`SELECT 1 FROM users LIMIT 1`);
  const promoteAdmin = existing.length === 0;
  const { rows } = await pool.query(
    `INSERT INTO users (kakao_id, nickname, profile_image, is_admin)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (kakao_id) DO UPDATE
       SET nickname      = COALESCE(EXCLUDED.nickname, users.nickname),
           profile_image = COALESCE(EXCLUDED.profile_image, users.profile_image),
           last_login_at = NOW()
     RETURNING kakao_id, nickname, profile_image, quota, used, is_blocked, is_admin`,
    [String(kakaoId), nickname || null, profileImage || null, promoteAdmin]
  );
  return rows[0];
}

// kakao_id로 admin 여부 확인 (요청 헤더 X-Kakao-Id 신뢰)
export async function isAdminUser(kakaoId) {
  if (!kakaoId) return false;
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT is_admin FROM users WHERE kakao_id = $1`,
    [String(kakaoId)]
  );
  return !!rows[0]?.is_admin;
}

export async function getUser(kakaoId) {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT kakao_id, nickname, profile_image, quota, used, is_blocked, is_admin,
            created_at, last_login_at, last_used_at
       FROM users WHERE kakao_id = $1`,
    [String(kakaoId)]
  );
  return rows[0] || null;
}

// Atomically reserve one slot. Returns the new (used,quota) or null if no slot.
export async function reserveQuota(kakaoId) {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE users
        SET used = used + 1, last_used_at = NOW()
      WHERE kakao_id = $1
        AND is_blocked = FALSE
        AND used < quota
      RETURNING used, quota`,
    [String(kakaoId)]
  );
  return rows[0] || null;
}

// Refund the slot when generation fails after reservation.
export async function refundQuota(kakaoId) {
  const pool = getPool();
  await pool.query(
    `UPDATE users SET used = GREATEST(used - 1, 0) WHERE kakao_id = $1`,
    [String(kakaoId)]
  );
}

export async function logGeneration({ kakaoId, styleId, ok, error }) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO generations (kakao_id, style_id, ok, error) VALUES ($1, $2, $3, $4)`,
    [String(kakaoId), styleId || null, !!ok, error ? String(error).slice(0, 500) : null]
  );
}

export async function listUsers({ limit = 100 } = {}) {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT kakao_id, nickname, profile_image, quota, used, is_blocked, is_admin,
            created_at, last_login_at, last_used_at
       FROM users
      ORDER BY is_admin DESC, last_login_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function listGenerations(kakaoId, { limit = 50 } = {}) {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, style_id, ok, error, created_at
       FROM generations
      WHERE kakao_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [String(kakaoId), limit]
  );
  return rows;
}

export async function adjustUser(kakaoId, { quota, used, isBlocked }) {
  await ensureSchema();
  const fields = [];
  const vals = [];
  let i = 1;
  if (quota !== undefined)  { fields.push(`quota = $${i++}`);      vals.push(parseInt(quota, 10)); }
  if (used !== undefined)   { fields.push(`used = $${i++}`);       vals.push(parseInt(used, 10)); }
  if (isBlocked !== undefined) { fields.push(`is_blocked = $${i++}`); vals.push(!!isBlocked); }
  if (!fields.length) return null;
  vals.push(String(kakaoId));
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE kakao_id = $${i} RETURNING *`,
    vals
  );
  return rows[0] || null;
}

export async function isAdminRequest(req) {
  const kakaoId = req.headers['x-kakao-id'] || req.headers['X-Kakao-Id'];
  return await isAdminUser(kakaoId);
}

/* =========================== Charge requests =========================== */

export async function createChargeRequest({ kakaoId, packageSize, amountWon, depositorName }) {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO charge_requests (kakao_id, package_size, amount_won, depositor_name)
       VALUES ($1, $2, $3, $4)
     RETURNING id, kakao_id, package_size, amount_won, depositor_name, status, created_at`,
    [String(kakaoId), parseInt(packageSize, 10), parseInt(amountWon, 10), depositorName || null]
  );
  return rows[0];
}

export async function listChargeRequests({ status, kakaoId, limit = 100 } = {}) {
  await ensureSchema();
  const pool = getPool();
  const where = [];
  const vals = [];
  let i = 1;
  if (status) { where.push(`c.status = $${i++}`); vals.push(status); }
  if (kakaoId) { where.push(`c.kakao_id = $${i++}`); vals.push(String(kakaoId)); }
  vals.push(limit);
  const sql = `
    SELECT c.id, c.kakao_id, c.package_size, c.amount_won, c.depositor_name,
           c.status, c.note, c.created_at, c.processed_at, c.processed_by,
           u.nickname, u.profile_image
      FROM charge_requests c
      JOIN users u ON u.kakao_id = c.kakao_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY c.created_at DESC
     LIMIT $${i}`;
  const { rows } = await pool.query(sql, vals);
  return rows;
}

// 승인: 트랜잭션으로 quota 추가 + 상태 변경
export async function approveCharge({ id, adminKakaoId, note }) {
  await ensureSchema();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cReq } = await client.query(
      `SELECT id, kakao_id, package_size, status FROM charge_requests WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!cReq[0]) { await client.query('ROLLBACK'); return { error: '요청을 찾을 수 없습니다' }; }
    if (cReq[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return { error: '이미 처리된 요청입니다' };
    }
    await client.query(
      `UPDATE users SET quota = quota + $1 WHERE kakao_id = $2`,
      [cReq[0].package_size, cReq[0].kakao_id]
    );
    await client.query(
      `UPDATE charge_requests
          SET status = 'approved', processed_at = NOW(), processed_by = $1, note = $2
        WHERE id = $3`,
      [String(adminKakaoId), note || null, id]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { error: err.message };
  } finally {
    client.release();
  }
}

export async function rejectCharge({ id, adminKakaoId, note }) {
  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE charge_requests
        SET status = 'rejected', processed_at = NOW(), processed_by = $1, note = $2
      WHERE id = $3 AND status = 'pending'
      RETURNING id`,
    [String(adminKakaoId), note || null, id]
  );
  return { ok: rows.length > 0 };
}
