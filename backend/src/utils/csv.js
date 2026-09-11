// Small, dependency-free CSV builder shared by any export feature this
// app adds (lead export today; kept generic rather than lead-specific).

// OWASP CSV-injection mitigation: a cell whose first character is one of
// these is interpreted as a formula by Excel/Sheets/LibreOffice when the
// file is opened. Prefixing with a single quote forces it to render as
// literal text — the quote is a display-only marker spreadsheet apps
// strip, not a change to the underlying value.
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);

function csvEscapeCell(value) {
  let str = value === null || value === undefined ? "" : String(value);
  if (str && FORMULA_PREFIXES.has(str[0])) str = `'${str}`;
  // RFC 4180: quote whenever the value contains a comma, quote, or
  // newline; a literal quote inside the value is escaped by doubling it.
  if (/[",\r\n]/.test(str)) str = `"${str.replace(/"/g, '""')}"`;
  return str;
}

// `rows` is an array of arrays (cell values, not yet escaped) — a plain,
// order-preserving shape, not objects, so header/row alignment can never
// drift silently. CRLF line endings per RFC 4180, the ending every
// spreadsheet app expects from a downloaded .csv.
function buildCsv(headers, rows) {
  const lines = [headers.map(csvEscapeCell).join(",")];
  for (const row of rows) lines.push(row.map(csvEscapeCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

module.exports = { csvEscapeCell, buildCsv };
