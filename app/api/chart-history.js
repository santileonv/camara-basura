import { viewerAuthorized } from '../lib/auth.js';
import { reply, settings } from '../lib/config.js';
import { readChartHistory } from '../lib/store.js';

export function createChartHistoryHandler(read = readChartHistory, clock = Date.now) {
  return async (req, res) => {
    try {
      if (req.method !== 'GET') return reply(res, 405, { error: 'Usa GET.' });
      if (!viewerAuthorized(req)) return reply(res, 401, { error: 'Inicia sesion.' });
      const params = new URL(req.url, 'http://localhost').searchParams;
      const minutes = Number(params.get('minutes') || 15), after = params.get('after');
      if (![15, 60, 1440].includes(minutes) || (after !== null &&
        (!/^(0|[1-9]\d{0,18})$/.test(after) || BigInt(after) > 9223372036854775807n)))
        return reply(res, 400, { error: 'Usa un intervalo de 15, 60 o 1440 minutos y un cursor valido.' });
      const data = await read({ minutes, after, now: clock() });
      return reply(res, 200, { ...data, staleMs: settings().staleMs });
    } catch (error) {
      console.error('chart-history:', error.code || error.name);
      return reply(res, error.status || 503, { error: error.status ? error.message : 'No se pudieron consultar los graficos. Intenta nuevamente.' });
    }
  };
}
export default createChartHistoryHandler();
