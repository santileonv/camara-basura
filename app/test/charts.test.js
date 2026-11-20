import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChartEntries, lineSegments, conclusionSpans, nearestEntry } from '../public/chart-data.js';
import { createChartHistoryHandler } from '../api/chart-history.js';
import { createSession } from '../lib/auth.js';
import { createStore } from '../lib/store.js';

test('Graficos conservan valores originales, orden temporal, BIGINT y una ventana acotada sin duplicados', () => {
  const row = (id, receivedAt, trashAverage = .238) => ({ id, receivedAt, trashAverage, conclusion:'No seguro' });
  const old = [row('9007199254740993', 10), row('9007199254740994', 20)];
  const merged = mergeChartEntries(old, [row('9007199254740994', 20), row('9007199254740995', 30), row('9007199254740996', 90)], 15, 40);
  assert.deepEqual(merged.map(item => item.id), ['9007199254740994', '9007199254740995']);
  assert.equal(merged[0].trashAverage, .238); assert.equal(merged[0].conclusion, 'No seguro');
  const many = Array.from({ length:6005 }, (_, i) => row(String(i + 1), i));
  assert.equal(mergeChartEntries([], many, 0, 7000).length, 6000);
  assert.equal(mergeChartEntries([], many, 0, 7000)[0].id, '6');
  assert.equal(nearestEntry(merged, 29).id, '9007199254740995');
  assert.equal(nearestEntry([], 29), null);
});

test('Cortes de red rompen las lineas y dejan huecos en la franja; No seguro sigue siendo un estado distinto', () => {
  const rows = [{ id:'1',receivedAt:100,conclusion:'Hay basura' }, { id:'2',receivedAt:200,conclusion:'Hay basura' },
    { id:'3',receivedAt:300,conclusion:'No seguro' }, { id:'4',receivedAt:1000,conclusion:'Sin basura' }];
  assert.deepEqual(lineSegments(rows, 150).map(group => group.length), [3, 1]);
  assert.deepEqual(conclusionSpans(rows, 0, 1300, 150), [
    { from:100,to:300,conclusion:'Hay basura' }, { from:300,to:450,conclusion:'No seguro' },
    { from:1000,to:1150,conclusion:'Sin basura' }
  ]);
  assert.deepEqual(conclusionSpans([], 0, 1000, 150), []);
});

test('API publica de graficos valida intervalos y cursores y admite actualizaciones incrementales', async () => {
  process.env.SESSION_SECRET = 'charts-session-test-'.repeat(3);
  let calls = [];
  const handler = createChartHistoryHandler(async query => { calls.push(query); return { entries:[],cursor:query.after ?? '0',from:1,to:1000000,truncated:false,limit:6000 }; }, () => 1000000);
  const request = async (url, cookie = '', method = 'GET') => {
    let data; const headers = {}; const res = { setHeader(name, value) { headers[name] = value; }, end(value) { data = JSON.parse(value); } };
    await handler({ method, url, headers:{cookie} }, res); return { status:res.statusCode,data,headers };
  };
  assert.equal((await request('/api/chart-history')).status, 200); assert.equal(calls.length, 1); calls = [];
  const cookie = 'xiao_session=' + createSession();
  for (const suffix of ['minutes=0', 'minutes=120', 'after=-1', 'after=1e2', 'after=9223372036854775808'])
    assert.equal((await request('/api/chart-history?' + suffix, cookie)).status, 400);
  assert.equal((await request('/api/chart-history', cookie, 'POST')).status, 405); assert.equal(calls.length, 0);
  const response = await request('/api/chart-history?minutes=1440&after=9007199254740993', cookie);
  assert.equal(response.status, 200); assert.equal(response.data.cursor, '9007199254740993');
  assert.deepEqual(calls[0], { minutes:1440,after:'9007199254740993',now:1000000 });
  assert.match(response.headers['Cache-Control'], /no-store/); assert.equal(response.data.staleMs, 90000);
});

test('El historial para graficos limita la respuesta sin redondear el cursor de PostgreSQL', async () => {
  const rows = Array.from({length:6001}, (_, i) => ({ id:String(9007199254747999n - BigInt(i)),receivedAt:1000 + i }));
  const store = createStore(async () => rows);
  const result = await store.readChartHistory({ now:1000000 });
  assert.equal(result.entries.length, 6000); assert.equal(result.truncated, true);
  assert.equal(result.cursor, '9007199254747999');
  await assert.rejects(store.readChartHistory({ minutes:2 }), error => error.status === 400);
});
