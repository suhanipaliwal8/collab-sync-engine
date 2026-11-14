import pg from 'pg';
import { silentLogger } from './logger.js';

const { Pool } = pg; // pg is a CommonJS package, so we take Pool from the default import

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS operations (
    seq         BIGSERIAL PRIMARY KEY,
    document_id TEXT        NOT NULL,
    op_key      TEXT        NOT NULL,
    op          JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, op_key)
  );
  CREATE INDEX IF NOT EXISTS operations_document_seq_idx
    ON operations (document_id, seq);
`;

// Append-only storage of operations in PostgreSQL.
export class OperationStore {
  constructor({ connectionString, logger = silentLogger }) {
    this.logger = logger;
    this.pool = new Pool({ connectionString }); // a pool reuses a few connections
    this.pool.on('error', (error) => logger.error(`database connection error: ${error.message}`));
  }

  async init() {
    try {
      await this.pool.query(SCHEMA_SQL);
    } catch (error) {
      throw new Error(
        `Cannot reach PostgreSQL (${error.code || error.message}). Is it running? Try: npm run db:up`,
      );
    }
  }

  // Returns true if the operation was stored, false if it was already there.
  async append(documentId, opKey, op) {
    const result = await this.pool.query(
      `INSERT INTO operations (document_id, op_key, op)
       VALUES ($1, $2, $3)
       ON CONFLICT (document_id, op_key) DO NOTHING`,
      [documentId, opKey, op],
    );
    return result.rowCount === 1;
  }

  // All operations of a document, in the order they were stored.
  async loadAll(documentId) {
    const result = await this.pool.query(
      'SELECT op FROM operations WHERE document_id = $1 ORDER BY seq',
      [documentId],
    );
    return result.rows.map((row) => row.op);
  }

  async close() {
    await this.pool.end();
  }
}