/** Builds "fname lname", or null when both are empty. */
function displayName({ fname, lname } = {}) {
  const name = [fname, lname]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return name || null;
}

/** SQL expression: trimmed "fname lname", or NULL when empty. Alias `u` required. */
const USER_DISPLAY_SQL =
  "NULLIF(TRIM(CONCAT(COALESCE(u.fname, ''), ' ', COALESCE(u.lname, ''))), '')";

module.exports = { displayName, USER_DISPLAY_SQL };
