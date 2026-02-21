/**
 * Sanitizes the user object by removing sensitive fields.
 *
 * @param {Object} user - The user object to sanitize.
 * @returns {Object} The sanitized user object.
 */
function sanitizeUser(user) {
  if (!user) return null;
  const { password, password_hash, ...safeUser } = user;
  return safeUser;
}

module.exports = { sanitizeUser };
