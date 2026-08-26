const pool = require("../config/db");

async function findByName(name) {
  const [rows] = await pool.query("SELECT id, name FROM roles WHERE name = ? LIMIT 1", [name]);
  return rows[0] || null;
}

module.exports = { findByName };
