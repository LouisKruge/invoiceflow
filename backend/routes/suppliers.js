const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const suppliers = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM invoices i WHERE i.supplier_id = s.id) as invoice_count,
      (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i WHERE i.supplier_id = s.id AND i.status != 'rejected') as total_spend
    FROM suppliers s ORDER BY s.name
  `).all();
  res.json({ suppliers });
});

module.exports = router;
