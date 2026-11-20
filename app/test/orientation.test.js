import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { prepareImage, classify, predictRGB } from '../lib/model.js';
import { createStore } from '../lib/store.js';
import { createSession } from '../lib/auth.js';
import { createServer } from '../lib/http-server.js';
import { createStateHandler } from '../api/state.js';
import { createIngestHandler } from '../api/ingest.js';
import { createCameraSettingsHandler } from '../api/camera-settings.js';
import { migrate } from '../lib/migrate.js';

const schema = () => readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
const config = { threshold: .8, staleMs: 90000 };
const frame = seq => ({ boot: '0123456789abcdef', seq, receivedAt: Date.now() + seq,
  scores: [.05, .45, .4, .1], preview: 'miniatura', analysisMs: 12 });
const executeFor = db => async (sql, params) => (await db.query(sql, params)).rows;

test('Giro real de 180 grados: miniatura y pixeles de inferencia tienen la misma orientacion', async () => {
  const size = 224, pixels = Buffer.alloc(size * size * 3);
  const colors = [[230,20,20],[20,220,20],[20,20,230],[230,220,20]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const color = colors[(y >= size / 2 ? 2 : 0) + (x >= size / 2 ? 1 : 0)];
    for (let c = 0; c < 3; c++) pixels[(y * size + x) * 3 + c] = color[c];
  }
  const jpeg = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  const normal = await prepareImage(jpeg), rotated = await prepareImage(jpeg, 180);
  const expected = Buffer.alloc(normal.rgb.length);
  for (let i = 0; i < size * size; i++) normal.rgb.copy(expected, i * 3, (size * size - i - 1) * 3, (size * size - i) * 3);
  assert.deepEqual(rotated.rgb, expected);
  const preview = await sharp(rotated.preview).raw().toBuffer();
  const point = (buffer, x, y) => [...buffer.subarray((y * size + x) * 3, (y * size + x) * 3 + 3)];
  assert.ok(point(preview, 20, 20).every((v, i) => Math.abs(v - colors[3][i]) < 15));
  assert.ok(point(preview, 200, 200).every((v, i) => Math.abs(v - colors[0][i]) < 15));
  const result = await classify(jpeg, { rotation: 180 });
  assert.deepEqual(result.scores, await predictRGB(rotated.rgb));
  assert.equal(result.preview, rotated.preview.toString('base64'));
  await assert.rejects(prepareImage(jpeg, 90), /Orientacion invalida/);
});

test('Orientacion persistente: reinicia promedio, conserva historial y rechaza inferencias atrasadas incluso al volver al mismo giro', async () => {
  const db = new PGlite(), execute = executeFor(db), store = createStore(execute);
  try {
    await db.exec(await schema());
    assert.deepEqual(await store.readCameraSettings(), { rotation: 0, version: '0' });
    for (let i = 1; i <= 5; i++) await store.saveReading(frame(i), config);
    const original = (await store.readHistory()).entries;
    assert.equal((await store.readState()).conclusion, 'Hay basura');
    assert.deepEqual(await store.setOrientation(180, '0'), { rotation: 180, version: '1' });
    assert.deepEqual(await createStore(execute).readCameraSettings(), { rotation: 180, version: '1' });
    assert.deepEqual((await store.readHistory()).entries, original);
    await assert.rejects(store.saveReading(frame(6), config), error => error.status === 409);
    await assert.rejects(store.setOrientation(0, '0'), error => error.status === 409);
    let state = await store.saveReading({ ...frame(6), rotation: 180, orientationVersion: '1' }, config);
    assert.equal(state.history.length, 1); assert.equal(state.streak, 0); assert.equal(state.conclusion, 'No seguro');
    for (let i = 7; i <= 10; i++) state = await store.saveReading({ ...frame(i), rotation: 180, orientationVersion: '1' }, config);
    assert.equal(state.conclusion, 'Hay basura');
    assert.deepEqual(await store.setOrientation(180, '1'), { rotation: 180, version: '1' });
    await store.setOrientation(0, '1'); await store.setOrientation(180, '2');
    await assert.rejects(store.saveReading({ ...frame(11), rotation: 180, orientationVersion: '1' }, config), error => error.status === 409);
    let changed = false;
    const racing = createStore(async (sql, params) => {
      if (!changed && sql.includes('WITH configuracion_actual')) { changed = true; await store.setOrientation(0, '3'); }
      return execute(sql, params);
    });
    await assert.rejects(racing.saveReading({ ...frame(11), rotation: 180, orientationVersion: '3' }, config), error => error.status === 409);
    assert.equal((await execute('SELECT count(*)::integer AS n FROM mediciones'))[0].n, 10);
    assert.deepEqual(await store.readState(), state);
    const pool = { connect: async () => ({ query: sql => db.exec(sql), release() {} }) };
    await migrate(pool);
    assert.deepEqual(await store.readCameraSettings(), { rotation: 0, version: '4' });
  } finally { await db.close(); }
});

test('Actualizar esquema anterior conserva datos y usa orientacion normal por defecto', async () => {
  const db = new PGlite();
  try {
    // La tabla anterior no tenia las columnas de orientacion.
    await db.exec("CREATE TABLE camaras (id text PRIMARY KEY,nombre text NOT NULL,ubicacion text,creada_en timestamptz NOT NULL DEFAULT now()); INSERT INTO camaras(id,nombre) VALUES ('camara-1','Nombre existente');");
    const pool = { connect: async () => ({ query: sql => db.exec(sql), release() {} }) };
    await migrate(pool); await migrate(pool);
    assert.equal((await db.query('SELECT nombre FROM camaras')).rows[0].nombre, 'Nombre existente');
    assert.deepEqual(await createStore(executeFor(db)).readCameraSettings(), { rotation: 0, version: '0' });
  } finally { await db.close(); }
});

test('HTTP: giro autorizado, conflicto entre dispositivos, nueva captura y cambio durante el analisis', async () => {
  process.env.SESSION_SECRET = 'rotation-session-test-'.repeat(3);
  process.env.CAMERA_TOKEN = 'rotation-camera-test-'.repeat(3);
  const db = new PGlite(), store = createStore(executeFor(db)); let app, release;
  try {
    await db.exec(await schema());
    await store.saveReading({ ...frame(1), receivedAt: Date.now() - 1000 }, config);
    let gate, entered, wait = false; const seen = [];
    const analyze = async (_jpeg, options) => {
      seen.push(options.rotation);
      if (wait) { entered(); await gate; }
      return { scores: [.05,.45,.4,.1], preview: 'preview', analysisMs: 12 };
    };
    app = createServer({ health: async () => {}, routes: {
      '/api/state': createStateHandler(store.readCameraView),
      '/api/camera-settings': createCameraSettingsHandler(store.setOrientation),
      '/api/ingest': createIngestHandler(analyze, store.saveReading, store.readCameraSettings)
    } });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const cookie = 'xiao_session=' + createSession();
    const headers = { cookie, 'content-type': 'application/json' };
    const rotate = (rotation, expectedVersion, extra = {}) => fetch(base + '/api/camera-settings', {
      method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ rotation, expectedVersion })
    });
    const state = async () => (await fetch(base + '/api/state', { headers: { cookie } })).json();
    assert.equal((await rotate(180,'0',{ cookie:'' })).status, 401);
    assert.equal((await fetch(base + '/api/camera-settings', { headers })).status, 405);
    assert.equal((await rotate(180,'0',{ origin:'https://otro-sitio.test' })).status, 403);
    for (const [rotation, version] of [[90,'0'],['180','0'],[180,0],[180,'-1'],[180,'9223372036854775807']])
      assert.equal((await rotate(rotation, version)).status, 400);
    const first = await rotate(180, '0'); assert.equal(first.status, 200);
    assert.deepEqual((await first.json()).camera, { rotation: 180, version: '1' });
    let view = await state(); assert.equal(view.orientationPending, true); assert.equal(view.state.conclusion, 'No seguro');
    assert.equal((await rotate(0,'0')).status, 409);
    const send = seq => fetch(base + '/api/ingest', { method: 'POST', headers: {
      authorization: 'Bearer ' + process.env.CAMERA_TOKEN, 'content-type':'image/jpeg',
      'x-camera-boot': '0123456789abcdef', 'x-frame-seq':String(seq)
    }, body: Buffer.from([255,216,255,217]) });
    assert.equal((await send(2)).status, 200);
    view = await state(); assert.equal(view.orientationPending, false); assert.equal(view.state.rotation, 180); assert.equal(view.state.readings, 1);
    wait = true; const waiting = new Promise(resolve => { entered = resolve; }); gate = new Promise(resolve => { release = resolve; });
    const running = send(3); await waiting;
    assert.equal((await rotate(0,'1')).status, 200);
    release(); assert.equal((await running).status, 409);
    assert.equal((await store.readHistory()).entries.length, 2);
    wait = false; assert.equal((await send(4)).status, 200);
    view = await state(); assert.equal(view.orientationPending, false); assert.equal(view.state.rotation, 0); assert.equal(view.state.readings, 1);
    assert.deepEqual(seen, [180,180,0]);
  } finally {
    release?.();
    if (app) await new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); });
    await db.close();
  }
});
