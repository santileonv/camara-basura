import { once } from 'node:events';
import { viewerAuthorized } from '../lib/auth.js';
import { reply } from '../lib/config.js';
import { getPool } from '../lib/database.js';
import { rawMeasurements } from '../lib/raw-export.js';

export function createExportHandler(read = options => rawMeasurements(getPool(), options)) {
  let exporting = false;
  return async (req, res) => {
    let iterator, ownsExport = false;
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    try {
      if (req.method !== 'GET') return reply(res, 405, { error: 'Usa GET.' });
      if (!viewerAuthorized(req)) return reply(res, 401, { error: 'Inicia sesion.' });
      if (exporting) { res.setHeader('Retry-After', '30'); return reply(res, 429, { error: 'Ya hay una exportacion en curso. Espera a que termine.' }); }
      exporting = true; ownsExport = true;
      res.on('close', disconnected);
      iterator = read({ signal: controller.signal })[Symbol.asyncIterator]();
      // Comprobar la conexion y comenzar la instantanea antes de enviar cabeceras.
      let current = await iterator.next();
      const now = new Date().toISOString();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', 'attachment; filename="mediciones-xiao-' + now.slice(0, 10) + '.json"');
      const write = async text => {
        controller.signal.throwIfAborted();
        if (!res.write(text)) await once(res, 'drain', { signal: controller.signal });
      };
      await write('{"schema_version":1,"exportado_en":' + JSON.stringify(now) + ',"tabla":"mediciones","datos":[\n');
      let count = 0;
      while (!current.done) {
        await write((count ? ',\n' : '') + JSON.stringify(current.value)); count++;
        current = await iterator.next();
      }
      await write('\n],"total_registros":' + count + '}\n');
      res.end();
    } catch (error) {
      if (!controller.signal.aborted) console.error('export:', error.code || error.name);
      if (!res.headersSent && !res.destroyed) reply(res, 503, { error: 'No se pudo exportar. Revisa la conexion a PostgreSQL e intentalo nuevamente.' });
      else res.destroy(); // Un fallo nunca termina como un JSON aparentemente completo.
    } finally {
      if (iterator?.return) await iterator.return().catch(() => {});
      if (ownsExport) exporting = false;
      res.off('close', disconnected);
    }
  };
}
export default createExportHandler();
