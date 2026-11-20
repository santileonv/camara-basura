import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { rawMeasurements } from '../lib/raw-export.js';
import { createExportHandler } from '../api/export.js';
import { createIngestHandler } from '../api/ingest.js';
import { createSession } from '../lib/auth.js';
import { createServer } from '../lib/http-server.js';
import { connectionOptions } from '../lib/database.js';
async function collect(iterable) { const rows = []; for await (const row of iterable) rows.push(row); return rows; }

test('TLS de Aiven conserva la CA y rechaza conexiones sin verificacion', () => {
  const uri = 'postgres://user:password@demo.aivencloud.com:1234/defaultdb?sslmode=require';
  const ca = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
  const result = connectionOptions(uri, { caCertificate: ca.replace(/\n/g, '\\n') });
  assert.equal(result.ssl.ca, ca); assert.equal(result.ssl.rejectUnauthorized, true);
  assert.equal(result.ssl.servername, 'demo.aivencloud.com');
  assert.equal(new URL(result.connectionString).searchParams.has('sslmode'), false);
  assert.throws(() => connectionOptions(uri), /DATABASE_CA_CERT/);
  assert.throws(() => connectionOptions(uri.replace('require', 'disable'), { caCertificate: ca }), /verificacion TLS/);
  assert.throws(() => connectionOptions(uri.replace('require', 'no-verify')), /DATABASE_CA_CERT/);
  assert.throws(() => connectionOptions(uri, { caCertificate: 'invalid' }), /PEM/);
  assert.throws(() => connectionOptions(uri + '&host=other', { caCertificate: ca }), /host y puerto/);
  assert.equal(connectionOptions('postgres://u:p@postgres.railway.internal:5432/railway').ssl, undefined);
});

test('JSON crudo pagina numericamente, conserva BIGINT, microsegundos y revierte cancelaciones', async () => {
  const db = new PGlite(); let releases = 0; const statements = [];
  const pool = { connect: async () => ({ query: async (sql, values) => { statements.push(sql); return db.query(sql, values); }, release() { releases++; } }) };
  try {
    await db.exec(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await collect(rawMeasurements(pool)), []);
    await db.exec(`INSERT INTO mediciones
      (id,camara_id,recibido_en,arranque,secuencia,conclusion,p_sin_basura,p_botellas,p_papeles_cartones,p_bolsas,basura_actual,basura_promedio,umbral,capturas_promedio,confirmaciones,analisis_ms)
      OVERRIDING SYSTEM VALUE SELECT n,'camara-1','2026-11-20 12:34:56.123456+00','0123456789abcdef',n,'Hay basura',0.05,0.45,0.4,0.1,0.95,0.95,0.8,5,3,123
      FROM unnest(ARRAY[2,9,10,101,9007199254740993]::bigint[]) AS n;`);
    const rows = await collect(rawMeasurements(pool, { batchSize: 2 }));
    assert.deepEqual(rows.map(row => row.id), ['2','9','10','101','9007199254740993']);
    assert.equal(rows.at(-1).secuencia, '9007199254740993');
    assert.equal(rows[0].recibido_en, '2026-11-20T12:34:56.123456Z');
    assert.equal(rows[0].p_botellas, .45); assert.equal(Object.keys(rows[0]).length, 16);
    assert.ok(!('preview' in rows[0])); assert.equal(releases, 2);
    const controller = new AbortController();
    const iterator = rawMeasurements(pool, { signal: controller.signal, batchSize: 2 });
    await iterator.next(); controller.abort(); await assert.rejects(iterator.next());
    assert.equal(statements.at(-1), 'ROLLBACK'); assert.equal(releases, 3);
    const fault = { connect: async () => ({ query: async (sql, values) => {
      if (values?.[0] !== '0' && sql.startsWith('SELECT')) throw new Error('test failure');
      return db.query(sql, values);
    }, release() { releases++; } }) };
    await assert.rejects(collect(rawMeasurements(fault, { batchSize: 2 })), /test failure/);
    assert.equal(releases, 4);
    assert.equal((await db.query('SELECT count(*) AS n FROM mediciones')).rows[0].n, 5);
  } finally { await db.close(); }
});

test('Descarga HTTP completa exige sesion, limita concurrencia y se recupera de errores', async () => {
  process.env.SESSION_SECRET = 'test-session-secret-'.repeat(3);
  process.env.CAMERA_TOKEN = 'test-camera-token-'.repeat(3);
  let gate, entered, fail = false, syncFail = false;
  let paused = false;
  const read = () => {
    if (syncFail) throw new Error('sync failure');
    return (async function* () {
      if (fail) throw new Error('database failure');
      if (paused) { entered(); await gate; }
      for (let i = 1; i <= 253; i++) yield { id: String(i), p_botellas: .45 };
    })();
  };
  const app = createServer({ health: async () => {}, routes: {
    '/api/export.json': createExportHandler(read),
    '/api/ingest': createIngestHandler(() => assert.fail('No debe analizar durante la pausa'), () => assert.fail('No debe escribir durante la pausa'))
  } });
  let release;
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const cookie = 'xiao_session=' + createSession();
    const download = () => fetch(base + '/api/export.json', { headers: { cookie } });
    assert.equal((await fetch(base + '/api/export.json')).status, 401);
    assert.equal((await fetch(base + '/api/export.json', { method: 'POST', headers: { cookie } })).status, 405);
    let response = await download(); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /attachment;.*\.json/);
    const json = await response.json(); assert.equal(json.total_registros, 253); assert.equal(json.datos.length, 253);
    assert.deepEqual(json.datos.at(-1), { id: '253', p_botellas: .45 });
    fail = true; assert.equal((await download()).status, 503); fail = false;
    syncFail = true; assert.equal((await download()).status, 503); syncFail = false;
    assert.equal((await download()).status, 200);
    paused = true; const waiting = new Promise(resolve => { entered = resolve; }); gate = new Promise(resolve => { release = resolve; });
    const first = download(); await waiting;
    response = await download(); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '30');
    release(); assert.equal((await (await first).json()).total_registros, 253);
    process.env.INGEST_PAUSED = 'true';
    response = await fetch(base + '/api/ingest', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.CAMERA_TOKEN } });
    assert.equal(response.status, 503);
    assert.equal((await fetch(base + '/api/ingest', { method: 'POST' })).status, 401);
  } finally {
    delete process.env.INGEST_PAUSED; release?.();
    await new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); });
  }
});

test('JSON vacio valido y descargas fallidas o canceladas liberan el exportador', async () => {
  process.env.SESSION_SECRET = 'test-session-secret-'.repeat(3);
  let mode = 'empty', cleaned = 0, finish;
  const read = ({ signal }) => (async function* () {
    try {
      if (mode === 'empty') return;
      yield { id: '1' };
      if (mode === 'failure') throw new Error('test stream failure');
      await new Promise((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true });
      });
    } finally { cleaned++; finish?.(); }
  })();
  const app = createServer({ health: async () => {}, routes: { '/api/export.json': createExportHandler(read) } });
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + app.server.address().port + '/api/export.json';
    const headers = { cookie: 'xiao_session=' + createSession() };
    const empty = await (await fetch(url, { headers })).json();
    assert.deepEqual(empty.datos, []); assert.equal(empty.total_registros, 0);
    mode = 'failure';
    await assert.rejects(async () => (await fetch(url, { headers })).json());
    mode = 'disconnect';
    const controller = new AbortController();
    const released = new Promise(resolve => { finish = resolve; });
    const response = await fetch(url, { headers, signal: controller.signal });
    assert.equal(response.status, 200); controller.abort();
    await released;
    assert.equal(cleaned, 3);
    // Permitir que el finally del handler termine antes del proximo pedido.
    await new Promise(resolve => setImmediate(resolve));
    mode = 'empty'; assert.equal((await fetch(url, { headers })).status, 200);
  } finally { await new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); }); }
});
