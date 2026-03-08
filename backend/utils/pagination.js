/**
 * Pagination Utility
 * 
 * Provides pagination helpers for list endpoints:
 * - Offset-based pagination (limit, offset)
 * - Cursor-based pagination (cursor, limit)
 * - Total count calculation
 * 
 * Usage:
 * const { limit, offset, cursor } = getPaginationParams(req.query);
 * const { rows: data, totalCount } = await getPaginatedData(pool, sql, params);
 * res.json({
 *   success: true,
 *   data,
 *   pagination: getPaginationMetadata(limit, offset, totalCount)
 * });
 */

/**
 * Extract pagination parameters from query string
 * 
 * @param {object} query - req.query object
 * @returns {object} { limit, offset, page, cursor }
 */
function getPaginationParams(query) {
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 500;
  const DEFAULT_PAGE = 1;

  // Parse limit and enforce max
  let limit = parseInt(query.limit) || DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);
  limit = Math.max(limit, 1); // Minimum 1 record

  // Parse offset
  let offset = parseInt(query.offset) || 0;
  offset = Math.max(offset, 0); // No negative offsets

  // Parse page (for convenience - converts to offset)
  const page = parseInt(query.page) || DEFAULT_PAGE;
  if (query.page) {
    offset = (page - 1) * limit;
  }

  // Parse cursor (for cursor-based pagination)
  const cursor = query.cursor || null;

  return {
    limit,
    offset,
    page: Math.ceil(offset / limit) + 1,
    cursor
  };
}

/**
 * Build SQL LIMIT/OFFSET clause
 * 
 * @param {number} limit - Records per page
 * @param {number} offset - Records to skip
 * @returns {string} SQL clause
 */
function getLimitOffsetClause(limit, offset) {
  return `LIMIT ${limit} OFFSET ${offset}`;
}

/**
 * Execute paginated query with total count
 * 
 * @param {pool} pool - PostgreSQL connection pool
 * @param {string} baseQuery - SQL query (without LIMIT/OFFSET)
 * @param {array} params - Query parameters
 * @param {number} limit - Records per page
 * @param {number} offset - Records to skip
 * @returns {Promise} { rows, total, limit, offset }
 */
async function getPaginatedData(pool, baseQuery, params = [], limit = 50, offset = 0) {
  try {
    // Execute data query with pagination
    const dataQuery = `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const dataResult = await pool.query(dataQuery, [...params, limit, offset]);

    // Execute count query
    const countRegex = /SELECT\s+[\s\S]*?\s+FROM\s+/i;
    const countQuery = baseQuery.replace(countRegex, 'SELECT COUNT(*) as total FROM');
    // Remove LIMIT/OFFSET from count query if present
    const cleanCountQuery = countQuery.replace(/LIMIT\s+\d+(\s+OFFSET\s+\d+)?/i, '').trim();
    const countResult = await pool.query(cleanCountQuery, params);

    const total = parseInt(countResult.rows[0]?.total || 0);

    return {
      rows: dataResult.rows,
      total,
      limit,
      offset,
      page: Math.ceil(offset / limit) + 1,
      totalPages: Math.ceil(total / limit)
    };
  } catch (error) {
    console.error('Pagination query error:', error);
    throw error;
  }
}

/**
 * Build pagination metadata for response
 * 
 * @param {number} limit - Records per page
 * @param {number} offset - Records skipped
 * @param {number} total - Total record count
 * @returns {object} Pagination metadata
 */
function getPaginationMetadata(limit, offset, total) {
  const page = Math.ceil(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  return {
    limit,
    offset,
    page,
    total,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    pageSize: limit,
    remaining: Math.max(0, total - (offset + limit))
  };
}

/**
 * Validate pagination parameters
 * 
 * @param {number} limit - Records per page
 * @param {number} offset - Records to skip
 * @returns {array} Array of error messages (empty if valid)
 */
function validatePaginationParams(limit, offset) {
  const errors = [];

  if (limit < 1) errors.push('Limit must be at least 1');
  if (limit > 500) errors.push('Limit cannot exceed 500');
  if (offset < 0) errors.push('Offset cannot be negative');

  return errors;
}

/**
 * Build cursor-based pagination clause
 * Uses an ID or timestamp as cursor
 * 
 * @param {string} cursor - Cursor value
 * @param {string} field - Field to use for cursor (default: 'created_at')
 * @returns {string} WHERE clause fragment
 */
function getCursorClause(cursor, field = 'created_at') {
  if (!cursor) return '';
  return `AND ${field} < '${cursor}'`;
}

module.exports = {
  getPaginationParams,
  getLimitOffsetClause,
  getPaginatedData,
  getPaginationMetadata,
  validatePaginationParams,
  getCursorClause
};
