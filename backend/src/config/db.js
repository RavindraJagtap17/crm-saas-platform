const mysql = require("mysql2/promise");
const config = require("./index");

/**
 * The application's own connection pool — separate from the standalone
 * connection migrations/migrate.js opens for itself. Deliberately does NOT
 * enable multipleStatements: that flag is a real footgun once any query is
 * ever built from a string instead of a parameterized placeholder, so it's
 * confined to the one-off migration tool that genuinely needs it.
 */
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: config.db.poolMax,
});

module.exports = pool;
