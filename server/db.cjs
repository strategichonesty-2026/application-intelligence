// server/db.cjs: one PostgreSQL pool. DATABASE_URL points at THIS app's own database (not Media Studio's).
// Railway's Postgres requires TLS; set APP_INTELLIGENCE_DB_SSL=off only for a local database.
'use strict';
const { Pool } = require('pg');

const ssl = process.env.APP_INTELLIGENCE_DB_SSL === 'off' ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 5 });

module.exports = { pool };
