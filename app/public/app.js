'use strict';
import { historyCSV } from './history-format.js';
const $ = id => document.getElementById(id);
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
const percent = value => (100 * value).toFixed(1) + ' %';
function signedIn(value) {
  authenticated = value; $('login').hidden = value; $('dashboard').hidden = !value; $('logout').hidden = !value;
  if (!value) {
    clearTimeout(timer); last = null; sessionEpoch++;
    historyEntries = []; historyCursor = null; historyLoaded = false;
    $('historyRows').replaceChildren(); $('exportHistory').disabled = true;
  }
}
function render() {
  const fresh = last && Date.now() - last.receivedAt <= staleMs;
  const age = last ? Math.max(0, Math.floor((Date.now() - last.receivedAt) / 1000)) : null;
  $('connection').textContent = fresh ? 'Cámara enviando mediciones' : (last ? 'Sin mediciones recientes' : 'Esperando la primera captura');
  $('dot').className = 'dot' + (fresh ? ' online' : '');
  $('age').textContent = age === null ? '—' : 'Última captura hace ' + age + ' s';
  const conclusion = fresh ? last.conclusion : (last ? 'Sin datos recientes' : 'Esperando datos');
  $('conclusion').textContent = conclusion;
  $('result').className = 'card result' + (fresh && conclusion === 'Hay basura' ? ' trash' : (fresh && conclusion === 'Sin basura' ? ' clear' : ''));
  $('detail').textContent = fresh ? (last.streak >= 3 ? 'Resultado confirmado con tres evaluaciones consecutivas.' : 'Reuniendo capturas y confirmaciones para una decisión estable.') : 'Revisa que la XIAO tenga alimentación, Wi-Fi e Internet.';
  $('total').textContent = fresh ? percent(last.trashAverage) : '—';
  $('totalFill').style.width = fresh ? last.trashAverage * 100 + '%' : '0%';
  $('now').textContent = fresh ? percent(last.trashNow) : '—';
  rows.forEach((row, i) => { row.value.textContent = fresh ? percent(last.scores[i]) : '—'; row.fill.style.width = fresh ? last.scores[i] * 100 + '%' : '0%'; });
  $('window').textContent = fresh ? `Promedio de ${last.readings}/5 capturas · Confirmación ${last.streak}/3` : 'La lectura anterior no se presenta como una medición actual.';
  $('threshold').textContent = last ? 'Umbral de decisión: ' + percent(last.threshold) : '';
  $('received').textContent = last ? new Date(last.receivedAt).toLocaleString('es-CL') : '—';
  $('analysis').textContent = last ? last.analysisMs + ' ms' : '—';
}
async function poll() {
  clearTimeout(timer);
  if (busy || document.hidden) return;
  busy = true;
  try {
    const response = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.status === 401) { signedIn(false); return; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar el servidor.');
    signedIn(true); last = data.state; staleMs = data.staleMs;
    if (last?.preview) {
      const source = 'data:image/jpeg;base64,' + last.preview;
      if ($('photo').getAttribute('src') !== source) $('photo').src = source;
      $('photo').hidden = false; $('crop').hidden = false; $('photoEmpty').hidden = true;
    } else { $('photo').hidden = true; $('crop').hidden = true; $('photoEmpty').hidden = false; }
    $('notice').textContent = ''; render();
    if (!historyLoaded && !historyBusy) loadHistory(true);
  } catch (error) {
    if (authenticated) { last = null; render(); $('notice').textContent = error.message; }
    else $('loginError').textContent = 'No se pudo conectar. Comprueba que la web esté desplegada.';
  } finally {
    busy = false;
    if (authenticated && !document.hidden) timer = setTimeout(poll, 15000);
  }
}
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
