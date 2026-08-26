```javascript
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db');
const {
  JWT_SECRET,
  requireAuth
} = require('../middleware/auth');

const router = express.Router();

// ===========================================================================
// HELPERS
// ===========================================================================

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeText(value) {
  return String(value || '').trim();
}

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
    company_name: user.company_name,
    created_at: user.created_at
  };
}

// ===========================================================================
// POST /api/auth/register
//
// CREATE A NEW INVOICEFLOW USER
//
// The first registered user becomes an administrator.
// All users registered afterwards become normal users.
//
// Every account is permanently saved in PostgreSQL.
// ===========================================================================

router.post(
  '/register',
  async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        company_name
      } = req.body || {};

      // ---------------------------------------------------------------------
      // Validate required fields
      // ---------------------------------------------------------------------

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
        normalizeText(name);

      const normalizedEmail =
        normalizeEmail(email);

      const normalizedCompany =
        normalizeText(company_name);

      const normalizedPassword =
        String(password);

      if (
        !normalizedName ||
        !normalizedEmail ||
        !normalizedCompany ||
        !normalizedPassword
      ) {
        return res.status(400).json({
          error:
            'All fields are required'
        });
      }

      // ---------------------------------------------------------------------
      // Basic validation
      // ---------------------------------------------------------------------

      if (normalizedName.length < 2) {
        return res.status(400).json({
          error:
            'Please enter a valid name'
        });
      }

      if (
        !normalizedEmail.includes('@') ||
        !normalizedEmail.includes('.')
      ) {
        return res.status(400).json({
          error:
            'Please enter a valid email address'
        });
      }

      if (normalizedPassword.length < 8) {
        return res.status(400).json({
          error:
            'Password must be at least 8 characters'
        });
      }

      if (normalizedCompany.length < 2) {
        return res.status(400).json({
          error:
            'Please enter a valid company name'
        });
      }

      // ---------------------------------------------------------------------
      // Check whether this email already exists
      // ---------------------------------------------------------------------

      const existingUser =
        await db.get(
          `
            SELECT
              id
            FROM users
            WHERE email = $1
            LIMIT 1
          `,
          [
            normalizedEmail
          ]
        );

      if (existingUser) {
        return res.status(409).json({
          error:
            'An account with that email already exists'
        });
      }

      // ---------------------------------------------------------------------
      // Determine role
      //
      // First account = admin
      // Every account after that = user
      // ---------------------------------------------------------------------

      const userCount =
        await db.get(
          `
            SELECT
              COUNT(*)::int AS count
            FROM users
          `
        );

      const role =
        Number(userCount?.count || 0) === 0
          ? 'admin'
          : 'user';

      // ---------------------------------------------------------------------
      // Hash password
      // ---------------------------------------------------------------------

      const passwordHash =
        await bcrypt.hash(
          normalizedPassword,
          12
        );

      // ---------------------------------------------------------------------
      // Create user
      // ---------------------------------------------------------------------

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

      // ---------------------------------------------------------------------
      // Automatically log the new user in
      // ---------------------------------------------------------------------

      const token =
        createToken(user);

      console.log(
        `[auth/register] New ${role} account created: ${user.email}`
      );

      return res.status(201).json({
        message:
          'Account created successfully',

        token,

        user:
          publicUser(user)
      });

    } catch (error) {
      console.error(
        '[auth/register]',
        error
      );

      // ---------------------------------------------------------------------
      // PostgreSQL duplicate email protection
      // ---------------------------------------------------------------------

      if (
        error &&
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
  }
);

// ===========================================================================
// GET /api/auth/setup-status
//
// Kept for frontend compatibility.
//
// This no longer controls whether registration is allowed.
// ===========================================================================

router.get(
  '/setup-status',
  async (req, res) => {
    try {
      const userCount =
        await db.get(
          `
            SELECT
              COUNT(*)::int AS count
            FROM users
          `
        );

      return res.json({
        setup_required:
          Number(userCount?.count || 0) === 0
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

// ===========================================================================
// POST /api/auth/login
// ===========================================================================

router.post(
  '/login',
  async (req, res) => {
    try {
      const {
        email,
        password
      } = req.body || {};

      // ---------------------------------------------------------------------
      // Validate input
      // ---------------------------------------------------------------------

      if (!email || !password) {
        return res.status(400).json({
          error:
            'Email and password are required'
        });
      }

      const normalizedEmail =
        normalizeEmail(email);

      if (!normalizedEmail) {
        return res.status(400).json({
          error:
            'Email is required'
        });
      }

      // ---------------------------------------------------------------------
      // Find user
      // ---------------------------------------------------------------------

      const user =
        await db.get(
          `
            SELECT
              *
            FROM users
            WHERE email = $1
            LIMIT 1
          `,
          [
            normalizedEmail
          ]
        );

      // ---------------------------------------------------------------------
      // Validate password
      // ---------------------------------------------------------------------

      if (
        !user ||
        !user.password_hash ||
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

      // ---------------------------------------------------------------------
      // Create session token
      // ---------------------------------------------------------------------

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
  }
);

// ===========================================================================
// GET /api/auth/me
// ===========================================================================

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
            LIMIT 1
          `,
          [
            req.user.id
          ]
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

// ===========================================================================
// EXPORT
// ===========================================================================

module.exports =
  router;
```
