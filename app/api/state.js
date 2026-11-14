import { viewerAuthorized } from '../lib/auth.js';
import { LABELS, reply, settings } from '../lib/config.js';
import { publicState } from '../lib/decision.js';
import { readState } from '../lib/store.js';
export function createStateHandler(read = readState) {
return async function handler(req, res) {
  try {
    if (req.method !== 'GET') return reply(res, 405, { error: 'Usa GET.' });
    if (!viewerAuthorized(req)) return reply(res, 401, { error: 'Inicia sesion.' });
    const config = settings();
    reply(res, 200, { labels: LABELS, staleMs: config.staleMs, ...publicState(await read(), config.staleMs) });
  } catch (error) {
    console.error('state:', error.message);
    reply(res, 503, { error: 'No se pudieron obtener datos. Revisa PostgreSQL, las tablas y DATABASE_URL en Railway.' });
  }
}
}
export default createStateHandler();
