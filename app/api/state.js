import { LABELS, reply, settings } from '../lib/config.js';
import { publicState, decisionPolicy } from '../lib/decision.js';
import { readCameraView } from '../lib/store.js';
export function createStateHandler(read = readCameraView) {
return async function handler(req, res) {
  try {
    if (req.method !== 'GET') return reply(res, 405, { error: 'Usa GET.' });
    const config = settings();
    const { camera, state } = await read();
    const orientationPending = !!state && ((state.orientationVersion ?? '0') !== camera.version || (state.rotation ?? 0) !== camera.rotation);
    const visible = publicState(state, config.staleMs);
    const policyPending = !!state && (state.decisionProfile ?? 'stable') !== config.decisionProfile;
    if (orientationPending || policyPending) visible.state.conclusion = 'No seguro';
    reply(res, 200, { labels: LABELS, staleMs: config.staleMs, camera, decision:decisionPolicy(config.decisionProfile),
      policyPending, canManageCamera: false, orientationPending, ...visible });
  } catch (error) {
    console.error('state:', error.message);
    reply(res, 503, { error: 'No se pudieron obtener las mediciones. Intenta nuevamente.' });
  }
}
}
export default createStateHandler();
