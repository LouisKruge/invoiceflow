const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db');
const {
  JWT_SECRET,
  requireAuth
} = require('../middleware/auth');

const router = express.Router();

// =============================================================================
// HELPERS
// =============================================================================

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      company_name: user.company_name
    },
    JWT_SECRET,
    {
      expiresIn: '12h'
    }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    company_name: user.company_name
  };
}

// =============================================================================
// POST /api/auth/register
//
// Creates a new InvoiceFlow account.
//
// Expected body:
//
// {
//   "name": "John Smith",
//   "email": "john@company.com",
//   "password": "password123",
//   "company_name": "ABC Engineering"
// }
//
// The first registered user becomes administrator.
// All subsequent users become users.
// =============================================================================

router.post('/register', async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      company_name
    } = req.body || {};

    // -------------------------------------------------------------------------
    // VALIDATION
    // -------------------------------------------------------------------------

    if (!name || !email || !password || !company_name) {
      return res.status(400).json({
        error:
          'Name, email, password and company name are required'
      });
    }

    const normalizedName =
      String(name).trim();

    const normalizedEmail =
      String(email).trim().toLowerCase();

    const normalizedCompany =
      String(company_name).trim();

    const plainPassword =
      String(password);

    if (
      normalizedName.length < 2
    ) {
      return res.status(400).json({
        error:
          'Please enter your full name'
      });
    }

    if (
      normalizedEmail.length < 5 ||
      !normalizedEmail.includes('@')
    ) {
      return res.status(400).json({
        error:
          'Please enter a valid email address'
      });
    }

    if (
      normalizedCompany.length < 2
    ) {
      return res.status(400).json({
        error:
          'Please enter your company name'
      });
    }

    if (
      plainPassword.length < 8
    ) {
      return res.status(400).json({
        error:
          'Password must be at least 8 characters'
      });
    }

    // -------------------------------------------------------------------------
    // CHECK IF EMAIL ALREADY EXISTS
    // -------------------------------------------------------------------------

    const existingUser =
      await db.get(
        `
          SELECT id
          FROM users
          WHERE email = $1
        `,
        [normalizedEmail]
      );

    if (existingUser) {
      return res.status(409).json({
        error:
          'An account with this email already exists'
      });
    }

    // -------------------------------------------------------------------------
    // DETERMINE ROLE
    //
    // If there are currently no users, this is the first account.
    // The first account becomes administrator.
    // -------------------------------------------------------------------------

    const userCount =
      await db.get(
        `
          SELECT COUNT(*)::int AS count
          FROM users
        `
      );

    const isFirstUser =
      Number(userCount?.count || 0) === 0;

    const role =
      isFirstUser
        ? 'admin'
        : 'user';

    // -------------------------------------------------------------------------
    // HASH PASSWORD
    // -------------------------------------------------------------------------

    const passwordHash =
      await bcrypt.hash(
        plainPassword,
        12
      );

    // -------------------------------------------------------------------------
    // CREATE USER
    // -------------------------------------------------------------------------

    const user =
      await db.get(
        `
          INSERT INTO users (
            name,
            email,
            password_hash,
            role,
            company_name
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5
          )
          RETURNING
            id,
            name,
            email,
            role,
            company_name,
            created_at
        `,
        [
          normalizedName,
          normalizedEmail,
          passwordHash,
          role,
          normalizedCompany
        ]
      );

    if (!user) {
      throw new Error(
        'User was not created'
      );
    }

    // -------------------------------------------------------------------------
    // CREATE LOGIN TOKEN
    // -------------------------------------------------------------------------

    const token =
      createToken(user);

    // -------------------------------------------------------------------------
    // RESPONSE
    // -------------------------------------------------------------------------

    return res.status(201).json({
      token,

      user:
        publicUser(user),

      message:
        isFirstUser
          ? 'Administrator account created successfully'
          : 'Account created successfully'
    });

  } catch (error) {
    console.error(
      '[auth/register]',
      error
    );

    // PostgreSQL unique constraint protection.
    if (
      error &&
      error.code === '23505'
    ) {
      return res.status(409).json({
        error:
          'An account with this email already exists'
      });
    }

    return res.status(500).json({
      error:
        'Account creation failed'
    });
  }
});

// =============================================================================
// POST /api/auth/login
// =============================================================================

router.post('/login', async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error:
          'Email and password are required'
      });
    }

    const normalizedEmail =
      String(email)
        .trim()
        .toLowerCase();

    const user =
      await db.get(
        `
          SELECT *
          FROM users
          WHERE email = $1
        `,
        [normalizedEmail]
      );

    if (
      !user ||
      !(await bcrypt.compare(
        String(password),
        user.password_hash
      ))
    ) {
      return res.status(401).json({
        error:
          'Invalid email or password'
      });
    }

    const token =
      createToken(user);

    return res.json({
      token,

      user:
        publicUser(user)
    });

  } catch (error) {
    console.error(
      '[auth/login]',
      error
    );

    return res.status(500).json({
      error:
        'Login failed'
    });
  }
});

// =============================================================================
// GET /api/auth/me
// =============================================================================

router.get(
  '/me',
  requireAuth,
  async (req, res) => {
    try {
      const user =
        await db.get(
          `
            SELECT
              id,
              name,
              email,
              role,
              company_name,
              created_at
            FROM users
            WHERE id = $1
          `,
          [req.user.id]
        );

      if (!user) {
        return res.status(401).json({
          error:
            'Your login session is no longer valid. Please log out and log in again.'
        });
      }

      return res.json({
        user
      });

    } catch (error) {
      console.error(
        '[auth/me]',
        error
      );

      return res.status(500).json({
        error:
          'Unable to load user'
      });
    }
  }
);

// =============================================================================
// EXPORT
// =============================================================================

module.exports = router;
