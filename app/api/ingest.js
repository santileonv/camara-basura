import { cameraAuthorized } from '../lib/auth.js';
import { body, reply, settings } from '../lib/config.js';
import { classify } from '../lib/model.js';
import { saveReading, readCameraSettings } from '../lib/store.js';

export function createIngestHandler(analyze = classify, save = saveReading, readCamera = readCameraSettings) {
return async function handler(req, res) {
  try {
    if (req.method !== 'POST') return reply(res, 405, { error: 'Usa POST.' });
    if (!cameraAuthorized(req)) return reply(res, 401, { error: 'Token de camara incorrecto.' });
    if (process.env.INGEST_PAUSED === 'true') return reply(res, 503, { error: 'Recepcion pausada por mantenimiento. Se conserva el historial.' });
    if (!/^(?:image\/jpeg|application\/octet-stream)(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(res, 415, { error: 'Envio JPEG requerido.' });
    const boot = req.headers['x-camera-boot'], seqText = req.headers['x-frame-seq'];
    if (!/^[a-f0-9]{16}$/.test(boot || '') || !/^\d{1,10}$/.test(seqText || '')) return reply(res, 400, { error: 'Identificador de captura invalido.' });
    const receivedAt = Date.now();
    const jpeg = await body(req, 1000000);
    if (jpeg.length < 4 || jpeg[0] !== 255 || jpeg[1] !== 216) return reply(res, 415, { error: 'JPEG invalido.' });
    const camera = await readCamera();
    if (camera.rotation !== 180) throw new Error('La camara requiere la orientacion fija de 180 grados.');
    const result = await analyze(jpeg, { rotation: camera.rotation });
    const state = await save({ ...result, boot, seq: Number(seqText), receivedAt,
      rotation: camera.rotation, orientationVersion: camera.version }, settings());
    return reply(res, 200, { ok: true, conclusion: state.conclusion, analysisMs: result.analysisMs });
  } catch (error) {
    console.error('ingest:', error.code || error.name);
    reply(res, error.status || 503, { error: error.status ? error.message : 'No se pudo analizar o guardar. Revisa los registros y las variables de Railway.' });
  }
}
}
export default createIngestHandler();
