const AUTH_USER_COLUMNS = [
  'id',
  'email',
  'name',
  'plan_tier',
  'avatar_url',
  'generations_used',
  'monthly_limit',
  'stripe_customer_id',
  'created_at'
];

function getAuthenticatedUserById(db, userId) {
  return db.prepare(`
    SELECT ${AUTH_USER_COLUMNS.join(', ')}
    FROM users
    WHERE id = ?
  `).get(userId);
}

module.exports = {
  AUTH_USER_COLUMNS,
  getAuthenticatedUserById
};
