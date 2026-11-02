// Журнал аудита: история действий с бронированиями и ресурсами (таблица audit_events)
async function audit(db, req, { action, objectType, objectId = null, result = 'success', details = null }) {
  await db.query(
    `INSERT INTO audit_events (actor_id, action, object_type, object_id, result, request_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [req.user ? req.user.id : null, action, objectType, objectId, result, req.id, details]);
}

module.exports = { audit };
