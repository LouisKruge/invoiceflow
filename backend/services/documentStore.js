// ============================================================================
// DOCUMENT STORE
// ============================================================================
//
// Where the bytes of an uploaded document actually live.
//
// They used to live only on the container's disk. That disk does not survive a
// restart or a deploy, so an invoice captured last week was still listed with
// nothing behind it — the record outlived its own evidence. The bytes now go
// into PostgreSQL alongside the record.
//
// Disk is still written and still read first: it is faster, and it is already
// there. It is a cache now, not the copy that matters.
// ============================================================================

const fs = require('fs');

const db = require('../db');

// Above this, a file is left on disk only. Nothing an invoice scanner produces
// comes close; the guard is here so one enormous upload cannot bloat a row.
const MAX_STORED_BYTES = 25 * 1024 * 1024;

/**
 * Copies a file that is already on disk into the database.
 *
 * Failure is reported, never thrown: a document that could not be kept must
 * not fail the capture that produced it. The file is still on disk either way.
 *
 * @param {string} table - 'invoice_documents' or 'stock_sheets'
 * @param {string} id - the row's primary key
 * @param {string} filePath
 * @returns {Promise<{stored: boolean, bytes?: number, reason?: string}>}
 */
async function keep(table, id, filePath) {
  if (!id || !filePath) {
    return { stored: false, reason: 'nothing_to_store' };
  }

  try {

    if (!fs.existsSync(filePath)) {
      return { stored: false, reason: 'file_missing' };
    }

    const stat = fs.statSync(filePath);

    if (stat.size > MAX_STORED_BYTES) {
      return { stored: false, reason: 'too_large', bytes: stat.size };
    }

    const content = fs.readFileSync(filePath);

    await db.run(
      `UPDATE ${table} SET content = $1, byte_size = $2 WHERE id = $3`,
      [content, content.length, id]
    );

    return { stored: true, bytes: content.length };

  } catch (error) {
    console.warn(
      `[documentStore] Could not keep ${table}/${id}: ${error.message}`
    );

    return { stored: false, reason: error.message };
  }
}

/**
 * Reads a document back.
 *
 * Disk first because it is quicker when the file happens to still be there;
 * the database whenever it is not, which after any restart is always.
 *
 * @returns {Promise<{buffer: Buffer, from: string}|null>}
 */
async function read(table, id, filePath) {
  if (filePath) {
    try {
      if (fs.existsSync(filePath)) {
        return { buffer: fs.readFileSync(filePath), from: 'disk' };
      }
    } catch (error) {
      // Fall through to the database.
    }
  }

  if (!id) return null;

  try {

    const row =
      await db.get(
        `SELECT content FROM ${table} WHERE id = $1`,
        [id]
      );

    if (!row || !row.content) return null;

    // Writing it back means the next read is a file read again, until the
    // next restart empties the disk once more.
    if (filePath) {
      try {
        fs.writeFileSync(filePath, row.content);
      } catch (error) {
        // A read-only or full disk is not a reason to refuse the document.
      }
    }

    return { buffer: row.content, from: 'database' };

  } catch (error) {
    console.warn(
      `[documentStore] Could not read ${table}/${id}: ${error.message}`
    );

    return null;
  }
}

/**
 * Whether a document can still be produced, without reading its bytes.
 *
 * Used by screens that decide whether to offer "view the original".
 */
async function exists(table, id, filePath) {
  if (filePath) {
    try {
      if (fs.existsSync(filePath)) return true;
    } catch (error) {
      // Fall through.
    }
  }

  if (!id) return false;

  try {

    const row =
      await db.get(
        `SELECT byte_size FROM ${table} WHERE id = $1 AND content IS NOT NULL`,
        [id]
      );

    return Boolean(row);

  } catch (error) {
    return false;
  }
}

module.exports = {
  MAX_STORED_BYTES,
  keep,
  read,
  exists,
};
