import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Superficie DOM pequena para ejecutar los eventos reales del monitor sin navegador.
class Element {
  constructor() {
    this.hidden = false; this.disabled = false; this.style = {}; this.attributes = {}; this.children = [];
    this.textContent = ''; const classes = new Set();
    this.classList = { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener() {}
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('Boton del monitor gira inmediatamente, espera la nueva inferencia y no retrocede por una consulta atrasada', async () => {
  const elements = new Map(); const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const document = { getElementById: get, createElement: () => new Element(), body: new Element(), hidden: false, addEventListener() {} };
  const timers = new Map(); let timerId = 0, heldPoll, delayPoll = false, failChange = false;
  let current = { rotation: 0, version: '0' };
  let reading = { receivedAt: Date.now(), rotation: 0, orientationVersion: '0', scores:[.05,.45,.4,.1],
    preview:'normal', conclusion:'Hay basura', trashNow:.95, trashAverage:.95, readings:5, streak:3, threshold:.8, analysisMs:100 };
  const changes = [];
  const fetch = async (url, options = {}) => {
    if (url === '/api/state') {
      const snapshot = { state: { ...reading }, camera: { ...current }, staleMs:90000 };
      if (delayPoll) { delayPoll = false; return new Promise(resolve => { heldPoll = () => resolve(response(snapshot)); }); }
      return response(snapshot);
    }
    if (url.startsWith('/api/history')) return response({ entries:[],nextCursor:null });
    if (url === '/api/camera-settings') {
      if (failChange) return response({ error:'No se pudo guardar el giro.' }, 503);
      const data = JSON.parse(options.body); changes.push(data);
      assert.equal(data.expectedVersion, current.version);
      current = { rotation:data.rotation, version:String(BigInt(current.version) + 1n) };
      return response({ camera: { ...current } });
    }
    if (url === '/api/logout') return response({ ok:true });
    throw new Error('Ruta inesperada: ' + url);
  };
  const context = vm.createContext({ document, fetch, AbortController, AbortSignal, URL, URLSearchParams, Blob,
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    setInterval() {}, historyCSV() {} });
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import \{ historyCSV \} from '\.\/history-format\.js';\n/m, '');
  vm.runInContext(source, context); await settle();
  assert.equal(get('rotateCamera').disabled, false);
  assert.match(get('rotateCamera').textContent, /Invertir/);
  assert.equal(get('total').textContent, '95.0 %');
  assert.equal(get('confidenceLabel').textContent, 'Confianza de que hay basura');
  assert.equal(get('confidenceBar').hidden, false);
  assert.equal(get('trashAverage').textContent, '95.0 %');
  // El porcentaje principal debe referirse al resultado, no siempre a basura.
  reading = { ...reading, conclusion:'Sin basura', trashNow:.02, trashAverage:.1, scores:[.98,.01,.005,.005] };
  await vm.runInContext('poll()', context);
  assert.equal(get('total').textContent, '90.0 %');
  assert.equal(get('totalFill').style.width, '90%');
  assert.equal(get('confidenceLabel').textContent, 'Confianza de que no hay basura');
  assert.equal(get('trashAverage').textContent, '10.0 %');
  assert.equal(get('now').textContent, '2.0 %');
  reading = { ...reading, conclusion:'No seguro', trashNow:.3, trashAverage:.238, streak:0 };
  await vm.runInContext('poll()', context);
  assert.equal(get('total').textContent, '—');
  assert.equal(get('confidenceBar').hidden, true);
  assert.equal(get('trashAverage').textContent, '23.8 %');
  assert.match(get('confidenceHelp').textContent, /conclusión confirmada/);
  assert.match(get('detail').textContent, /evidencia es ambigua/);
  reading = { ...reading, receivedAt:Date.now() - 100000, conclusion:'Sin basura',trashAverage:.1,streak:3 };
  await vm.runInContext('poll()', context);
  assert.equal(get('conclusion').textContent, 'Sin datos recientes');
  assert.equal(get('total').textContent, '—');
  assert.equal(get('confidenceBar').hidden, true);
  assert.equal(get('trashAverage').textContent, '—');
  reading = { ...reading, receivedAt:Date.now(), conclusion:'Hay basura', trashNow:.95, trashAverage:.95, streak:3 };
  await vm.runInContext('poll()', context);
  // Una consulta iniciada antes de guardar el giro responde despues del cambio.
  delayPoll = true; const latePoll = vm.runInContext('poll()', context); await settle();
  await get('rotateCamera').onclick();
  assert.deepEqual(changes, [{ rotation:180,expectedVersion:'0' }]);
  assert.equal(get('rotateCamera').getAttribute('aria-pressed'), 'true');
  assert.match(get('rotateCamera').textContent, /Restaurar/);
  assert.equal(get('photo').classList.contains('upsideDown'), true);
  assert.equal(get('conclusion').textContent, 'Esperando nueva captura');
  assert.equal(get('total').textContent, '—');
  heldPoll(); await latePoll;
  assert.equal(get('rotateCamera').getAttribute('aria-pressed'), 'true');
  assert.equal(get('conclusion').textContent, 'Esperando nueva captura');
  reading = { ...reading, rotation:180,orientationVersion:'1',preview:'rotated',readings:1,streak:0,conclusion:'No seguro' };
  await vm.runInContext('poll()', context);
  assert.equal(get('photo').classList.contains('upsideDown'), false);
  assert.equal(get('conclusion').textContent, 'No seguro');
  assert.equal(get('total').textContent, '—');
  assert.equal(get('confidenceBar').hidden, true);
  assert.equal(get('trashAverage').textContent, '95.0 %');
  failChange = true; await get('rotateCamera').onclick();
  assert.match(get('cameraError').textContent, /No se pudo/);
  assert.equal(get('rotateCamera').getAttribute('aria-pressed'), 'true');
  failChange = false; await get('rotateCamera').onclick();
  assert.deepEqual(changes.at(-1), { rotation:0,expectedVersion:'1' });
  assert.equal(get('rotateCamera').getAttribute('aria-pressed'), 'false');
  assert.equal(get('conclusion').textContent, 'Esperando nueva captura');
  await get('logout').onclick();
  assert.equal(get('rotateCamera').disabled, true); assert.equal(get('dashboard').hidden, true);
});
