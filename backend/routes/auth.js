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
// LOGIN
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
        email
          .trim()
          .toLowerCase();

      const user =
        await db.get(
          `
            SELECT *
            FROM users
            WHERE email = $1
            LIMIT 1
          `,
          [normalizedEmail]
        );

      if (!user) {

        return res.status(401).json({
          error:
            'Invalid email or password'
        });
      }

      const validPassword =
        await bcrypt.compare(
          password,
          user.password_hash
        );

      if (!validPassword) {

        return res.status(401).json({
          error:
            'Invalid email or password'
        });
      }

      const token =
        jwt.sign(
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
          'Unable to sign in. Please try again.'
      });
    }
  }
);

// ---------------------------------------------------------------------------
// CURRENT USER
// ---------------------------------------------------------------------------

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
          [req.user.id]
        );

      if (!user) {

        return res.status(401).json({
          error:
            'User account no longer exists.'
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
          'Unable to load your account.'
      });
    }
  }
);

module.exports = router;
