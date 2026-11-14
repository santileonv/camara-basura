import { decide } from './decision.js';
import { query } from './database.js';
const CAMERA_ID = 'camara-1';

// La revision evita carreras. El estado y la medicion se escriben juntos:
// si falla el registro, PostgreSQL revierte tambien el cambio de estado.
const SAVE = `
WITH actualizado AS (
  INSERT INTO estado_camara (camara_id, revision, estado)
  VALUES ($1, 1, $2::jsonb)
  ON CONFLICT (camara_id) DO UPDATE
  SET revision = estado_camara.revision + 1,
      estado = EXCLUDED.estado, actualizado_en = clock_timestamp()
  WHERE estado_camara.revision = $3::bigint
  RETURNING estado
), registrado AS (
  INSERT INTO mediciones (
    camara_id, recibido_en, arranque, secuencia, conclusion,
    p_sin_basura, p_botellas, p_papeles_cartones, p_bolsas,
    basura_actual, basura_promedio, umbral, capturas_promedio,
    confirmaciones, analisis_ms
  )
  SELECT $1, to_timestamp((estado->>'receivedAt')::double precision / 1000.0),
    estado->>'boot', (estado->>'seq')::bigint, estado->>'conclusion',
    (estado->'scores'->>0)::double precision, (estado->'scores'->>1)::double precision,
    (estado->'scores'->>2)::double precision, (estado->'scores'->>3)::double precision,
    (estado->>'trashNow')::double precision, (estado->>'trashAverage')::double precision,
    (estado->>'threshold')::double precision, jsonb_array_length(estado->'history'),
    (estado->>'streak')::smallint, (estado->>'analysisMs')::integer
  FROM actualizado
  RETURNING id
)
SELECT estado FROM actualizado CROSS JOIN registrado`;

// La misma implementacion funciona con pg en Railway y PostgreSQL local (PGlite).
export function createStore(execute) {
  async function readVersionedState() {
    const rows = await execute('SELECT revision, estado FROM estado_camara WHERE camara_id = $1', [CAMERA_ID]);
    return rows[0] || { revision: '0', estado: null };
  }
  async function readState() { return (await readVersionedState()).estado; }
  async function saveReading(reading, config) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const previous = await readVersionedState();
      const next = decide(previous.estado, reading, config);
      if (next === previous.estado) return previous.estado;
      const rows = await execute(SAVE, [CAMERA_ID, JSON.stringify(next), previous.revision]);
      if (rows.length) return rows[0].estado;
    }
    throw new Error('Llegaron demasiadas capturas simultaneas.');
  }
  async function readHistory({ before = null, limit = 50 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 250 ||
      (before !== null && (!/^[1-9]\d{0,18}$/.test(before) || BigInt(before) > 9223372036854775807n))) {
      throw Object.assign(new Error('Paginacion invalida.'), { status: 400 });
    }
    const rows = await execute(`
      SELECT id::text AS id, camara_id AS "cameraId",
        (extract(epoch FROM recibido_en) * 1000)::double precision AS "receivedAt",
        conclusion, ARRAY[p_sin_basura, p_botellas, p_papeles_cartones, p_bolsas] AS scores,
        basura_actual AS "trashNow", basura_promedio AS "trashAverage", umbral AS threshold,
        capturas_promedio AS readings, confirmaciones AS streak, analisis_ms AS "analysisMs"
      FROM mediciones
      WHERE camara_id = $1 AND ($2::bigint IS NULL OR id < $2::bigint)
      ORDER BY mediciones.id DESC LIMIT $3`, [CAMERA_ID, before, limit + 1]);
    const entries = rows.slice(0, limit);
    return { entries, nextCursor: rows.length > limit ? entries.at(-1).id : null };
  }
  return { readState, saveReading, readHistory };
}
export const { readState, saveReading, readHistory } = createStore(query);
