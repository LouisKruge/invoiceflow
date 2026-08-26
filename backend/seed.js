// server/seed.js
//
// InvoiceFlow production seed utility.
//
// IMPORTANT:
//
// This file NEVER creates demo invoices.
//
// It is NOT automatically executed by app.js.
//
// If you want to create the first real administrator account,
// set:
//
//   ADMIN_NAME
//   ADMIN_EMAIL
//   ADMIN_PASSWORD
//
// and manually run:
//
//   node server/seed.js
//
// After the account exists, the seed does nothing.
//
// NO SAMPLE INVOICES.
// NO SAMPLE SUPPLIERS.
// NO FAKE BUSINESS DATA.
//

require('dotenv').config();

const bcrypt =
  require('bcryptjs');

const crypto =
  require('crypto');

const db =
  require('./db');

// ---------------------------------------------------------------------------
// CREATE ADMIN
// ---------------------------------------------------------------------------

function createAdmin() {
  const name =
    String(
      process.env.ADMIN_NAME || ''
    ).trim();

  const email =
    String(
      process.env.ADMIN_EMAIL || ''
    )
      .trim()
      .toLowerCase();

  const password =
    String(
      process.env.ADMIN_PASSWORD || ''
    );

  if (
    !name ||
    !email ||
    !password
  ) {
    console.log(
      '[seed] No admin credentials supplied.'
    );

    console.log(
      '[seed] No data was created.'
    );

    return;
  }

  if (
    password.length < 8
  ) {
    throw new Error(
      'ADMIN_PASSWORD must contain at least 8 characters.'
    );
  }

  const existing =
    db.prepare(
      `
      SELECT id
      FROM users
      WHERE email = ?
      `
    ).get(email);

  if (existing) {
    console.log(
      `[seed] Admin ${email} already exists.`
    );

    return;
  }

  const passwordHash =
    bcrypt.hashSync(
      password,
      12
    );

  const id =
    crypto.randomUUID();

  db.prepare(
    `
    INSERT INTO users (
      id,
      name,
      email,
      password_hash,
      role,
      company_name
    )
    VALUES (
      ?,
      ?,
      ?,
      ?,
      'admin',
      ?
    )
    `
  ).run(
    id,
    name,
    email,
    passwordHash,
    process.env.COMPANY_NAME ||
      'InvoiceFlow Company'
  );

  console.log(
    `[seed] Admin account created: ${email}`
  );
}

// ---------------------------------------------------------------------------
// RUN SEED
// ---------------------------------------------------------------------------

function runSeed() {
  console.log(
    '================================================='
  );

  console.log(
    'InvoiceFlow production seed'
  );

  console.log(
    '================================================='
  );

  console.log(
    '[seed] Demo invoice creation: DISABLED'
  );

  console.log(
    '[seed] Demo supplier creation: DISABLED'
  );

  console.log(
    '[seed] Running administrator setup only.'
  );

  createAdmin();

  console.log(
    '[seed] Complete.'
  );
}

// ---------------------------------------------------------------------------
// RUN WHEN CALLED DIRECTLY
// ---------------------------------------------------------------------------

if (
  require.main === module
) {
  try {
    runSeed();

    db.close();

    process.exit(0);
  } catch (error) {
    console.error(
      '[seed] Failed:',
      error
    );

    try {
      db.close();
    } catch (_) {}

    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------

module.exports = {
  runSeed,
};
