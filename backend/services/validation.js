// services/validation.js
//
// Structured invoice -> validation results. Pure functions, no DB access,
// so they're easy to unit test and reuse (e.g. re-validate after a manual edit).

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.85');

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * @param {object} fields - normalized invoice fields (see aiExtraction REQUIRED_FIELDS)
 * @param {Array} existingInvoices - prior invoices [{invoice_number, supplier_name, total_amount, id}] for duplicate check
 * @returns {Array<{rule_code, passed, severity, message}>}
 */
function validateInvoice(fields, existingInvoices = []) {
  const results = [];

  // --- Missing information ---------------------------------------------
  const requiredForMissingCheck = [
    ['invoice_number', 'Invoice number'],
    ['supplier_name', 'Supplier'],
    ['total_amount', 'Total amount'],
  ];
  for (const [key, label] of requiredForMissingCheck) {
    const present = fields[key] !== null && fields[key] !== undefined && fields[key] !== '';
    results.push({
      rule_code: 'MISSING_FIELD',
      passed: present,
      severity: present ? 'info' : 'error',
      message: present ? `${label} present` : `${label} could not be identified — please enter it manually`,
    });
  }

  // --- Mathematical validation: subtotal + VAT = total -------------------
  if (fields.subtotal != null && fields.vat_amount != null && fields.total_amount != null) {
    const expected = round2(fields.subtotal + fields.vat_amount);
    const diff = Math.abs(expected - round2(fields.total_amount));
    const passed = diff <= 0.05; // 5 cent rounding tolerance
    results.push({
      rule_code: 'MATH_CHECK',
      passed,
      severity: passed ? 'info' : 'error',
      message: passed
        ? 'Subtotal + VAT matches total'
        : `VAT/TOTAL MISMATCH: subtotal + VAT = ${expected.toFixed(2)}, but total is ${Number(fields.total_amount).toFixed(2)}`,
    });
  } else {
    results.push({
      rule_code: 'MATH_CHECK',
      passed: false,
      severity: 'warning',
      message: 'Could not verify subtotal + VAT = total — one or more amounts missing',
    });
  }

  // --- VAT rate consistency (no assumed rate; just flag implausible values) ---
  if (fields.subtotal != null && fields.vat_amount != null && fields.subtotal > 0) {
    const impliedRate = fields.vat_amount / fields.subtotal;
    // South African standard VAT is 15%. We don't assume it applies, but we flag
    // wildly implausible rates (e.g. OCR garbage) for a human to check.
    const passed = impliedRate >= 0 && impliedRate <= 0.25;
    results.push({
      rule_code: 'VAT_CHECK',
      passed,
      severity: passed ? 'info' : 'warning',
      message: passed
        ? `Implied VAT rate (${(impliedRate * 100).toFixed(1)}%) looks plausible`
        : `Implied VAT rate (${(impliedRate * 100).toFixed(1)}%) looks unusual — please verify`,
    });
  }

  // --- Duplicate detection -------------------------------------------------
  const dup = existingInvoices.find(inv =>
    inv.invoice_number && fields.invoice_number &&
    inv.invoice_number.trim().toLowerCase() === String(fields.invoice_number).trim().toLowerCase() &&
    inv.supplier_name && fields.supplier_name &&
    inv.supplier_name.trim().toLowerCase() === String(fields.supplier_name).trim().toLowerCase() &&
    Math.abs((inv.total_amount || 0) - (fields.total_amount || 0)) < 0.05
  );
  results.push({
    rule_code: 'DUPLICATE_CHECK',
    passed: !dup,
    severity: dup ? 'error' : 'info',
    message: dup
      ? `POSSIBLE DUPLICATE INVOICE — matches invoice ${dup.invoice_number} from ${dup.supplier_name} (id ${dup.id})`
      : 'No duplicate detected',
    duplicateOf: dup ? dup.id : null,
  });

  return results;
}

/**
 * Given field confidences, return the list of field names below threshold.
 */
function lowConfidenceFields(confidence) {
  return Object.entries(confidence || {})
    .filter(([, score]) => typeof score === 'number' && score < CONFIDENCE_THRESHOLD)
    .map(([field]) => field);
}

function overallStatus(validationResults, confidence) {
  const hasError = validationResults.some(r => r.severity === 'error');
  const isDuplicate = validationResults.some(r => r.rule_code === 'DUPLICATE_CHECK' && !r.passed);
  const lowConf = lowConfidenceFields(confidence).length > 0;

  if (isDuplicate) return 'duplicate';
  if (hasError) return 'exception';
  if (lowConf) return 'review_required';
  return 'review_required'; // MVP: everything lands in review before human approval, even clean ones
}

module.exports = { validateInvoice, lowConfidenceFields, overallStatus, CONFIDENCE_THRESHOLD };
