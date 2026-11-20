import { viewerAuthorized } from '../lib/auth.js';
import { LABELS, reply, settings } from '../lib/config.js';
import { publicState } from '../lib/decision.js';
import { readCameraView } from '../lib/store.js';
export function createStateHandler(read = readCameraView) {
return async function handler(req, res) {
  try {
    if (req.method !== 'GET') return reply(res, 405, { error: 'Usa GET.' });
    const config = settings();
    const { camera, state } = await read();
    const orientationPending = !!state && ((state.orientationVersion ?? '0') !== camera.version || (state.rotation ?? 0) !== camera.rotation);
    const visible = publicState(state, config.staleMs);
    if (orientationPending) visible.state.conclusion = 'No seguro';
    reply(res, 200, { labels: LABELS, staleMs: config.staleMs, camera, canManageCamera: viewerAuthorized(req), orientationPending, ...visible });
  } catch (error) {
    console.error('state:', error.message);
    reply(res, 503, { error: 'No se pudieron obtener las mediciones. Intenta nuevamente.' });
  }
}
}
export default createStateHandler();
