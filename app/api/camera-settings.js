import { viewerAuthorized, sameOrigin } from '../lib/auth.js';
import { body, reply } from '../lib/config.js';
import { setOrientation } from '../lib/store.js';

export function createCameraSettingsHandler(change = setOrientation) {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') return reply(res, 405, { error: 'Usa POST.' });
      if (!viewerAuthorized(req)) return reply(res, 401, { error: 'Inicia sesion.' });
      if (!sameOrigin(req)) return reply(res, 403, { error: 'Origen no permitido.' });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(res, 415, { error: 'Envio JSON requerido.' });
      let data;
      try { data = JSON.parse((await body(req, 1024)).toString('utf8')); }
      catch (error) { if (error.status) throw error; throw Object.assign(new Error('JSON invalido.'), { status: 400 }); }
      if (!data || ![0, 180].includes(data.rotation) || typeof data.expectedVersion !== 'string' ||
        !/^(0|[1-9]\d{0,18})$/.test(data.expectedVersion) || BigInt(data.expectedVersion) >= 9223372036854775807n)
        return reply(res, 400, { error: 'Usa un giro de 0 o 180 grados y una version valida.' });
      const camera = await change(data.rotation, data.expectedVersion);
      return reply(res, 200, { camera });
    } catch (error) {
      console.error('camera-settings:', error.code || error.name);
      return reply(res, error.status || 503, { error: error.status ? error.message : 'No se pudo guardar la orientacion. Intenta nuevamente.' });
    }
  };
}
export default createCameraSettingsHandler();
