const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db');
const {
  JWT_SECRET,
  requireAuth
} = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/auth/register
//
// FIRST-BOOT ACCOUNT CREATION
//
// Registration is only allowed when there are ZERO users in the database.
// Once the first account is created, this endpoint is automatically disabled.
// ---------------------------------------------------------------------------

router.post('/register', async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      company_name
    } = req.body;

    // ---------------------------------------------------------------
    // Validate input
    // ---------------------------------------------------------------

    if (
      !name ||
      !email ||
      !password ||
      !company_name
    ) {
      return res.status(400).json({
        error:
          'Name, email, password and company name are required'
      });
    }

    const normalizedName =
      String(name).trim();

    const normalizedEmail =
      String(email)
        .trim()
        .toLowerCase();

    const normalizedCompany =
      String(company_name).trim();

    if (
      !normalizedName ||
      !normalizedEmail ||
      !normalizedCompany
    ) {
      return res.status(400).json({
        error:
          'All fields are required'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error:
          'Password must be at least 8 characters'
      });
    }

    // ---------------------------------------------------------------
    // Check whether a user already exists
    // ---------------------------------------------------------------

    const userCount = await db.get(
      `
        SELECT COUNT(*)::int AS count
        FROM users
      `
    );

    if (Number(userCount.count) > 0) {
      return res.status(403).json({
        error:
          'Account registration is closed. An administrator account already exists.'
      });
    }

    // ---------------------------------------------------------------
    // Hash password
    // ---------------------------------------------------------------

    const passwordHash =
      await bcrypt.hash(
        password,
        12
      );

    // ---------------------------------------------------------------
    // Create first administrator
    // ---------------------------------------------------------------

    const user = await db.get(
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
        'admin',
        normalizedCompany
      ]
    );

    // ---------------------------------------------------------------
    // Automatically log the new user in
    // ---------------------------------------------------------------

    const token = jwt.sign(
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

    return res.status(201).json({
      message:
        'Administrator account created successfully',

      token,

      user
    });

  } catch (error) {
    console.error(
      '[auth/register]',
      error
    );

    // Handle duplicate email gracefully
    if (
      error.code === '23505'
    ) {
      return res.status(409).json({
        error:
          'An account with that email already exists'
      });
    }

    return res.status(500).json({
      error:
        'Unable to create account'
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/setup-status
//
// Frontend uses this to determine whether the initial account needs to be
// created.
// ---------------------------------------------------------------------------

router.get(
  '/setup-status',
  async (req, res) => {
    try {
      const userCount = await db.get(
        `
          SELECT COUNT(*)::int AS count
          FROM users
        `
      );

      const hasUsers =
        Number(userCount.count) > 0;

      return res.json({
        setup_required: !hasUsers
      });

    } catch (error) {
      console.error(
        '[auth/setup-status]',
        error
      );

      return res.status(500).json({
        error:
          'Unable to check account setup status'
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

router.post(
  '/login',
  async (req, res) => {
    try {
      const {
        email,
        password
      } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          error:
            'Email and password are required'
        });
      }

      const normalizedEmail =
        email.trim().toLowerCase();

      const user = await db.get(
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
          password,
          user.password_hash
        ))
      ) {
        return res.status(401).json({
          error:
            'Invalid email or password'
        });
      }

      const token = jwt.sign(
        {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          company_name:
            user.company_name
        },
        JWT_SECRET,
        {
          expiresIn: '12h'
        }
      );

      return res.json({
        token,

        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          company_name:
            user.company_name
        }
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
  }
);

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

router.get(
  '/me',
  requireAuth,
  async (req, res) => {
    try {
      const user = await db.get(
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

module.exports = router;
