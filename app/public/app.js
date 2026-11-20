'use strict';
import { historyCSV } from './history-format.js';
import { createCharts } from './charts.js';
const $ = id => document.getElementById(id);
const charts = createCharts({ onUnauthorized: () => signedIn(false) });
const labels = ['Sin basura', 'Botellas', 'Papeles y Cartones', 'Bolsas'];
const rows = labels.map(label => {
  const row = document.createElement('div'); row.className = 'classRow';
  const title = document.createElement('div'); title.className = 'classLabel';
  const name = document.createElement('span'); name.textContent = label;
  const value = document.createElement('strong'); value.textContent = '—';
  const bar = document.createElement('div'); bar.className = 'bar';
  const fill = document.createElement('div'); bar.append(fill); title.append(name, value); row.append(title, bar); $('classes').append(row);
  return { value, fill };
});
let authenticated = false, timer, busy = false, last = null, staleMs = 90000;
let historyEntries = [], historyCursor = null, historyBusy = false, historyLoaded = false, sessionEpoch = 0;
let jsonBusy = false, exportController;
let camera = { rotation: 0, version: '0' }, cameraKnown = false, cameraBusy = false;
const percent = value => (100 * value).toFixed(1) + ' %';
function signedIn(value) {
  authenticated = value; $('login').hidden = value; $('dashboard').hidden = !value; $('logout').hidden = !value;
  $('exportJSON').disabled = !value || jsonBusy;
  $('rotateCamera').disabled = !value || !cameraKnown || cameraBusy;
  if (value) charts.start(); else charts.stop();
  if (!value) {
    clearTimeout(timer); last = null; sessionEpoch++;
    exportController?.abort();
    cameraKnown = false; $('cameraError').textContent = '';
    historyEntries = []; historyCursor = null; historyLoaded = false;
    $('historyRows').replaceChildren(); $('exportHistory').disabled = true;
  }
}
function acceptCamera(next) {
  // Una respuesta atrasada de otra consulta no deshace el cambio recien guardado.
  if (cameraKnown && BigInt(next.version) < BigInt(camera.version)) return;
  camera = next; cameraKnown = true;
}
function render() {
  const pending = last && cameraKnown && ((last.orientationVersion ?? '0') !== camera.version || (last.rotation ?? 0) !== camera.rotation);
  const fresh = last && !pending && Date.now() - last.receivedAt <= staleMs;
  $('rotateCamera').disabled = !authenticated || !cameraKnown || cameraBusy;
  $('rotateCamera').textContent = cameraBusy ? 'Guardando giro…' : (camera.rotation === 180 ? 'Restaurar posición normal' : 'Invertir cámara · 180°');
  $('rotateCamera').setAttribute('aria-pressed', String(camera.rotation === 180));
  $('orientationStatus').textContent = cameraKnown ? (camera.rotation === 180 ? 'Orientación: girada 180°.' : 'Orientación: normal.') +
    (pending ? ' Esperando una nueva captura para actualizar el análisis.' : ' El giro se aplica a la imagen y al análisis.') : 'Consultando orientación…';
  $('photo').classList.toggle('upsideDown', !!last && cameraKnown && camera.rotation !== (last.rotation ?? 0));
  const age = last ? Math.max(0, Math.floor((Date.now() - last.receivedAt) / 1000)) : null;
  $('connection').textContent = pending ? 'Esperando captura con la nueva orientación' : (fresh ? 'Cámara enviando mediciones' : (last ? 'Sin mediciones recientes' : 'Esperando la primera captura'));
  $('dot').className = 'dot' + (fresh ? ' online' : '');
  $('age').textContent = age === null ? '—' : 'Última captura hace ' + age + ' s';
  const conclusion = pending ? 'Esperando nueva captura' : (fresh ? last.conclusion : (last ? 'Sin datos recientes' : 'Esperando datos'));
  $('conclusion').textContent = conclusion;
  $('result').className = 'card result' + (fresh && conclusion === 'Hay basura' ? ' trash' : (fresh && conclusion === 'Sin basura' ? ' clear' : ''));
  const ambiguous = fresh && last.readings >= 3 && last.trashAverage < last.threshold && 1 - last.trashAverage < last.threshold;
  $('detail').textContent = pending ? 'El giro está guardado. La conclusión se actualizará con las próximas capturas.' : (fresh ?
    (ambiguous ? 'La evidencia es ambigua: el promedio de basura está entre los dos umbrales de decisión.' :
      (last.streak >= 3 ? 'Resultado confirmado con tres evaluaciones consecutivas.' : 'Reuniendo capturas y confirmaciones para una decisión estable.')) :
    'Revisa que la XIAO tenga alimentación, Wi-Fi e Internet.');
  // La barra expresa confianza en la conclusion mostrada. La suma de basura
  // se mantiene separada: para "Sin basura" usamos su complemento.
  const confidence = fresh && conclusion === 'Hay basura' ? last.trashAverage :
    (fresh && conclusion === 'Sin basura' ? 1 - last.trashAverage : null);
  $('confidenceLabel').textContent = confidence === null ? 'Confianza estimada en la conclusión' :
    (conclusion === 'Hay basura' ? 'Confianza de que hay basura' : 'Confianza de que no hay basura');
  $('total').textContent = confidence === null ? '—' : percent(confidence);
  $('confidenceBar').hidden = confidence === null;
  $('totalFill').style.width = confidence === null ? '0%' : confidence * 100 + '%';
  $('confidenceHelp').textContent = confidence === null ? 'El porcentaje aparecerá cuando haya una conclusión confirmada.' :
    'Confianza estimada del modelo, calculada con el promedio de las últimas capturas.';
  $('now').textContent = fresh ? percent(last.trashNow) : '—';
  $('trashAverage').textContent = fresh ? percent(last.trashAverage) : '—';
  $('averageLabel').textContent = fresh ? `Promedio de basura · ${last.readings} ${last.readings === 1 ? 'captura' : 'capturas'}` : 'Promedio de basura de las últimas capturas';
  rows.forEach((row, i) => { row.value.textContent = fresh ? percent(last.scores[i]) : '—'; row.fill.style.width = fresh ? last.scores[i] * 100 + '%' : '0%'; });
  $('window').textContent = pending ? 'El promedio empezará de nuevo con la orientación elegida.' : (fresh ? `Promedio de ${last.readings}/5 capturas · Confirmación ${last.streak}/3` : 'La lectura anterior no se presenta como una medición actual.');
  $('threshold').textContent = last ? `Sobre el promedio: Hay basura ≥ ${percent(last.threshold)} · Sin basura ≤ ${percent(1 - last.threshold)}. Entre ambos: No seguro.` : '';
  $('received').textContent = last ? new Date(last.receivedAt).toLocaleString('es-CL') : '—';
  $('analysis').textContent = last ? last.analysisMs + ' ms' : '—';
}
async function poll() {
  clearTimeout(timer);
  if (busy || document.hidden) return;
  busy = true;
  const epoch = sessionEpoch;
  try {
    const response = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (epoch !== sessionEpoch) return;
    if (response.status === 401) { signedIn(false); return; }
    const data = await response.json();
    if (epoch !== sessionEpoch) return;
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar el servidor.');
    acceptCamera(data.camera); signedIn(true); last = data.state; staleMs = data.staleMs;
    if (last?.preview) {
      const source = 'data:image/jpeg;base64,' + last.preview;
      if ($('photo').getAttribute('src') !== source) $('photo').src = source;
      $('photo').hidden = false; $('crop').hidden = false; $('photoEmpty').hidden = true;
    } else { $('photo').hidden = true; $('crop').hidden = true; $('photoEmpty').hidden = false; }
    $('notice').textContent = ''; render();
    if (!historyLoaded && !historyBusy) loadHistory(true);
  } catch (error) {
    if (epoch !== sessionEpoch) return;
    if (authenticated) { last = null; render(); $('notice').textContent = error.message; }
    else $('loginError').textContent = 'No se pudo conectar. Comprueba que la web esté desplegada.';
  } finally {
    busy = false;
    if (authenticated && !document.hidden) timer = setTimeout(poll, 15000);
  }
}
$('rotateCamera').onclick = async () => {
  if (!authenticated || !cameraKnown || cameraBusy) return;
  const epoch = sessionEpoch;
  const change = { rotation: camera.rotation === 180 ? 0 : 180, expectedVersion: camera.version };
  cameraBusy = true; $('cameraError').textContent = ''; render();
  try {
    const response = await fetch('/api/camera-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change), signal: AbortSignal.timeout(15000) });
    if (epoch !== sessionEpoch || !authenticated) return;
    if (response.status === 401) { signedIn(false); return; }
    const data = await response.json();
    if (epoch !== sessionEpoch || !authenticated) return;
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el giro.');
    acceptCamera(data.camera);
  } catch (error) {
    if (epoch === sessionEpoch && authenticated) $('cameraError').textContent = error.message || 'No se pudo confirmar el giro. Actualiza para comprobar la orientación guardada.';
  } finally {
    cameraBusy = false;
    if (epoch === sessionEpoch && authenticated) { render(); await poll(); }
  }
};
async function loadHistory(reset = false) {
  if (historyBusy || !authenticated) return;
  historyBusy = true;
  const epoch = sessionEpoch;
  $('refreshHistory').disabled = true; $('moreHistory').disabled = true;
  $('historyStatus').textContent = 'Consultando historial…';
  try {
    const query = new URLSearchParams({ limit: '50' });
    if (!reset && historyCursor) query.set('before', historyCursor);
    const response = await fetch('/api/history?' + query, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (epoch !== sessionEpoch || !authenticated) return;
    if (response.status === 401) { signedIn(false); return; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo leer el historial.');
    if (epoch !== sessionEpoch || !authenticated) return;
    if (reset) { historyEntries = []; $('historyRows').replaceChildren(); }
    const known = new Set(historyEntries.map(row => row.id));
    const newEntries = data.entries.filter(row => !known.has(row.id));
    historyEntries.push(...newEntries); historyCursor = data.nextCursor; historyLoaded = true;
    for (const row of newEntries) {
      const tr = document.createElement('tr');
      const values = [new Date(row.receivedAt).toLocaleString('es-CL'), row.conclusion, percent(row.trashNow), percent(row.trashAverage), ...row.scores.map(percent)];
      for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      $('historyRows').append(tr);
    }
    $('historyStatus').textContent = historyEntries.length ? `${historyEntries.length} registros cargados · Consulta: ${new Date().toLocaleTimeString('es-CL')}` : 'Aún no hay mediciones guardadas. El historial comienza al recibir fotos con esta versión.';
    $('moreHistory').hidden = !historyCursor; $('exportHistory').disabled = historyEntries.length === 0;
  } catch (error) {
    if (epoch === sessionEpoch && authenticated) $('historyStatus').textContent = error.message || 'No se pudo consultar el historial.';
  } finally {
    historyBusy = false; $('refreshHistory').disabled = false; $('moreHistory').disabled = false;
  }
}
$('refreshHistory').onclick = () => loadHistory(true);
$('moreHistory').onclick = () => loadHistory(false);
$('exportJSON').onclick = async () => {
  if (!authenticated || jsonBusy) return;
  const epoch = sessionEpoch;
  const controller = new AbortController(); exportController = controller;
  jsonBusy = true; $('exportJSON').disabled = true;
  $('exportStatus').textContent = 'Preparando todas las mediciones…';
  try {
    const response = await fetch('/api/export.json', { cache: 'no-store', signal: controller.signal });
    if (response.status === 401) { signedIn(false); return; }
    if (!response.ok) {
      const data = await response.json(); throw new Error(data.error || 'No se pudo exportar.');
    }
    const blob = await response.blob();
    if (epoch !== sessionEpoch || !authenticated) return;
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'mediciones-xiao-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('exportStatus').textContent = 'Archivo preparado con todas las mediciones de la instantánea.';
  } catch (error) {
    if (!controller.signal.aborted && epoch === sessionEpoch && authenticated)
      $('exportStatus').textContent = error.message || 'La descarga se interrumpió. Intenta nuevamente.';
  } finally {
    jsonBusy = false; exportController = undefined; $('exportJSON').disabled = !authenticated;
  }
};
$('exportHistory').onclick = () => {
  if (!authenticated || !historyEntries.length) return;
  const url = URL.createObjectURL(new Blob([historyCSV(historyEntries)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url;
  link.download = 'mediciones-xiao-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('loginForm').addEventListener('submit', async event => {
  event.preventDefault(); $('enter').disabled = true; $('loginError').textContent = '';
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('password').value }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    $('password').value = ''; signedIn(true); await poll();
  } catch (error) { $('loginError').textContent = error.message || 'No se pudo conectar.'; }
  finally { $('enter').disabled = false; }
});
$('logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); signedIn(false); };
document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && authenticated) poll(); });
setInterval(() => { if (authenticated && !document.hidden) render(); }, 1000);
poll();
