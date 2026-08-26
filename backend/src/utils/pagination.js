const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

// Clamps to safe values rather than rejecting the request — a malformed
// or out-of-range page/pageSize is friendlier handled by falling back to
// a sane default than by 400-ing the whole request.
function parsePagination(query) {
  let page = parseInt(query?.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  let pageSize = parseInt(query?.pageSize, 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = { parsePagination, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE };
