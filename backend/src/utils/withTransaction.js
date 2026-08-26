const pool = require("../config/db");

// Shared transaction wrapper — used anywhere Step 4 needs multiple writes
// to succeed or fail together (lead creation + duplicate lock, status
// change + history, assignment + activity).
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = withTransaction;
