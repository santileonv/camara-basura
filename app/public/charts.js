import { CLASS_LABELS, CLASS_COLORS, STATE_COLORS, mergeChartEntries, lineSegments, conclusionSpans, nearestEntry, seriesPath } from './chart-data.js';

const NS = 'http://www.w3.org/2000/svg';
const pct = value => (100 * value).toFixed(1) + ' %';
const time = value => new Date(value).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
const date = value => new Date(value).toLocaleString('es-CL');
function node(tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createCharts({ onUnauthorized = () => {} } = {}) {
  const $ = id => document.getElementById(id);
  let active = false, entries = [], cursor = null, minutes = 15, staleMs = 90000;
  let request = null, timer, resizeTimer, skew = 0, lastUpdated = null, limited = false, error = '';
  let selectedId = null, refs = [], spans = [];
  const enabled = [true, true, true, true];
  const rangeButtons = [...document.querySelectorAll('[data-chart-minutes]')];
  const seriesButtons = [...document.querySelectorAll('[data-chart-series]')];

  function bounds() { const to = Date.now() + skew; return { from: to - minutes * 60000, to }; }
  function frame(id, from, to, timeline = false) {
    const svg = $(id), width = Math.max(320, svg.getBoundingClientRect().width || 800);
    const height = timeline ? 112 : 270, left = 43, right = width - 18, bottom = timeline ? 68 : 231;
    const x = timestamp => left + (timestamp - from) / (to - from) * (right - left);
    const y = value => bottom - value * (bottom - 18);
    svg.replaceChildren(); svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.append(node('title', {}, svg.getAttribute('aria-label')));
    if (!timeline) {
      for (const value of [0, .2, .4, .6, .8, 1]) {
        svg.append(node('line', { x1:left, x2:right, y1:y(value), y2:y(value), class:'chartGrid' }));
        svg.append(node('text', { x:left - 8, y:y(value) + 4, 'text-anchor':'end', class:'chartAxis' }, Math.round(value * 100) + '%'));
      }
    }
    const ticks = width < 450 ? 3 : 5;
    for (let i = 0; i < ticks; i++) {
      const stamp = from + (to - from) * i / (ticks - 1);
      svg.append(node('text', { x:x(stamp), y:bottom + 25, 'text-anchor':i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle', class:'chartAxis' }, time(stamp)));
    }
    return { svg, x, y, left, right, width, bottom, from, to };
  }

  function addSeries(ref, segments, value, color, thick = 2, dashed = false, step = false) {
    if (!segments.length) return;
    ref.svg.append(node('path', { d:seriesPath(segments, ref.x, ref.y, value, step), fill:'none', stroke:color,
      'stroke-width':thick, ...(dashed ? { 'stroke-dasharray':'5 5' } : {}), 'stroke-linejoin':'round', 'stroke-linecap':'round' }));
    // Una captura aislada tambien debe ser visible.
    for (const segment of segments) if (segment.length === 1)
      ref.svg.append(node('circle', { cx:ref.x(segment[0].receivedAt), cy:ref.y(value(segment[0])), r:2.5, fill:color }));
  }

  function mark(ref, values) {
    ref.marker = node('line', { y1:14, y2:ref.bottom, class:'chartCursor' }); ref.svg.append(ref.marker);
    ref.dots = values.map(([value, color]) => {
      const dot = node('circle', { r:4, fill:color, stroke:'white', 'stroke-width':2 }); ref.svg.append(dot); return { dot, value };
    });
  }

  function selection() {
    const row = entries.find(item => item.id === selectedId) ?? entries.at(-1);
    for (const ref of refs) {
      ref.marker.setAttribute('visibility', row ? 'visible' : 'hidden');
      for (const { dot, value } of ref.dots) {
        dot.setAttribute('visibility', row ? 'visible' : 'hidden');
        if (row) { dot.setAttribute('cx', ref.x(row.receivedAt)); dot.setAttribute('cy', ref.y(value(row))); }
      }
      if (row) { ref.marker.setAttribute('x1', ref.x(row.receivedAt)); ref.marker.setAttribute('x2', ref.x(row.receivedAt)); }
    }
    $('detectionTooltip').textContent = row ? `${date(row.receivedAt)} · Captura: ${pct(row.trashNow)} · Promedio (${row.readings}): ${pct(row.trashAverage)} · ${row.conclusion} · Confirmación ${row.streak}/3` : 'No hay mediciones en este intervalo.';
    const classesText = CLASS_LABELS.map((name, i) => enabled[i] && row ? `${name}: ${pct(row.scores[i])}` : null).filter(Boolean).join(' · ');
    $('classesTooltip').textContent = row ? date(row.receivedAt) + ' · ' + (classesText || 'Todas las clases están ocultas.') : 'No hay mediciones en este intervalo.';
  }

  function timestampAt(event, ref) {
    const box = ref.svg.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width * ref.width;
    return ref.from + Math.max(0, Math.min(1, (px - ref.left) / (ref.right - ref.left))) * (ref.to - ref.from);
  }

  function interact(ref) {
    const inspect = event => { const row = nearestEntry(entries, timestampAt(event, ref)); selectedId = row?.id ?? null; selection(); };
    ref.svg.onpointermove = inspect; ref.svg.onpointerdown = inspect;
    ref.svg.onpointerleave = () => { selectedId = null; selection(); };
    ref.svg.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !entries.length) return;
      event.preventDefault();
      const current = Math.max(0, entries.findIndex(row => row.id === selectedId));
      const start = selectedId === null ? entries.length - 1 : current;
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, start + (event.key === 'ArrowLeft' ? -1 : 1)));
      selectedId = entries[index].id; selection();
    };
  }

  function render() {
    if (!active) return;
    const { from, to } = bounds(); entries = mergeChartEntries(entries, [], from, to);
    const segments = lineSegments(entries, staleMs);
    const detection = frame('detectionChart', from, to), classes = frame('classesChart', from, to);
    addSeries(detection, segments, row => row.threshold, '#c66742', 1.3, true, true);
    addSeries(detection, segments, row => 1 - row.threshold, '#258263', 1.3, true, true);
    addSeries(detection, segments, row => row.trashNow, '#8baca0', 1.5);
    addSeries(detection, segments, row => row.trashAverage, '#245846', 3);
    mark(detection, [[row => row.trashNow, '#8baca0'], [row => row.trashAverage, '#245846']]);
    enabled.forEach((show, i) => { if (show) addSeries(classes, segments, row => row.scores[i], CLASS_COLORS[i], 2); });
    mark(classes, CLASS_COLORS.flatMap((color, i) => enabled[i] ? [[row => row.scores[i], color]] : []));
    refs = [detection, classes]; refs.forEach(interact); selection();
    spans = conclusionSpans(entries, from, to, staleMs);
    const timeline = frame('conclusionsChart', from, to, true);
    const defs = node('defs'), pattern = node('pattern', { id:'noDataPattern', width:8, height:8, patternUnits:'userSpaceOnUse' });
    pattern.append(node('rect', { width:8, height:8, fill:'#f2f5f1' }), node('path', { d:'M0,8L8,0', stroke:'#dbe4dc', 'stroke-width':1 })); defs.append(pattern); timeline.svg.append(defs);
    timeline.svg.append(node('rect', { x:timeline.left, y:24, width:timeline.right - timeline.left, height:36, rx:5, fill:'url(#noDataPattern)' }));
    for (const span of spans) {
      const rect = node('rect', { x:timeline.x(span.from), y:24, width:Math.max(.5, timeline.x(span.to) - timeline.x(span.from)), height:36, fill:STATE_COLORS[span.conclusion] });
      rect.append(node('title', {}, `${span.conclusion}: ${date(span.from)} a ${date(span.to)}`)); timeline.svg.append(rect);
    }
    const spanText = span => `${span.conclusion} · ${date(span.from)} a ${date(span.to)} · ${Math.max(1, Math.round((span.to - span.from) / 1000))} s`;
    const inspectSpan = event => { const stamp = timestampAt(event, timeline); const span = spans.find(item => stamp >= item.from && stamp < item.to); $('conclusionsTooltip').textContent = span ? spanText(span) : `${date(stamp)} · Sin datos recientes`; };
    timeline.svg.onpointermove = inspectSpan; timeline.svg.onpointerdown = inspectSpan;
    timeline.svg.onpointerleave = () => { $('conclusionsTooltip').textContent = 'Los tramos rayados indican períodos sin datos recientes.'; };
    let spanIndex = spans.length - 1;
    timeline.svg.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !spans.length) return;
      event.preventDefault(); spanIndex = event.key === 'Home' ? 0 : event.key === 'End' ? spans.length - 1 : Math.max(0, Math.min(spans.length - 1, spanIndex + (event.key === 'ArrowLeft' ? -1 : 1)));
      $('conclusionsTooltip').textContent = spanText(spans[spanIndex]);
    };
    $('chartStatus').textContent = error || (lastUpdated ? `${entries.length} mediciones · Actualizado ${time(lastUpdated)}. Se actualiza automáticamente.` + (limited ? ' Vista limitada a las 6000 mediciones más recientes.' : '') : 'Consultando mediciones…');
    $('chartStatus').classList.toggle('chartFailure', !!error);
    $('chartEmpty').hidden = entries.length > 0 || !lastUpdated || !!error;
  }

  async function refresh(reset = false) {
    clearTimeout(timer);
    if (!active || document.hidden || (request && !reset)) return;
    if (reset) { request?.abort(); entries = []; cursor = null; lastUpdated = null; selectedId = null; limited = false; error = ''; render(); }
    const controller = new AbortController(); request = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const params = new URLSearchParams({ minutes:String(minutes) }); if (cursor !== null) params.set('after', cursor);
      const response = await fetch('/api/chart-history?' + params, { cache:'no-store', signal:controller.signal });
      if (request !== controller || !active) return;
      if (response.status === 401) { onUnauthorized(); return; }
      const data = await response.json();
      if (request !== controller || !active) return;
      if (!response.ok) throw new Error(data.error || 'No se pudieron consultar los gráficos.');
      skew = data.to - Date.now(); staleMs = data.staleMs; cursor = data.cursor;
      limited = limited || data.truncated || entries.length + data.entries.length > 6000;
      entries = mergeChartEntries(entries, data.entries, data.from, data.to);
      lastUpdated = data.to; error = ''; render();
    } catch (cause) {
      if (request !== controller || !active) return;
      error = 'No se pudieron actualizar los gráficos. ' + (entries.length ? 'Se conservan los datos anteriores; reintentando.' : 'Pulsa Actualizar gráficos o espera el reintento.'); render();
    } finally {
      clearTimeout(timeout);
      if (request === controller) { request = null; if (active && !document.hidden) timer = setTimeout(refresh, 15000); }
    }
  }

  for (const button of rangeButtons) button.onclick = () => {
    minutes = Number(button.dataset.chartMinutes);
    for (const item of rangeButtons) item.setAttribute('aria-pressed', String(item === button));
    refresh(true);
  };
  for (const button of seriesButtons) button.onclick = () => {
    const i = Number(button.dataset.chartSeries); enabled[i] = !enabled[i];
    button.setAttribute('aria-pressed', String(enabled[i])); render();
  };
  $('refreshCharts').onclick = () => refresh(true);
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (document.hidden) { const old = request; request = null; old?.abort(); }
    else if (active) refresh();
  });
  const resize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 100); };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe($('chartSections'));
  else window.addEventListener('resize', resize);
  return {
    start() { if (!active) { active = true; refresh(true); } },
    stop() {
      active = false; clearTimeout(timer); const old = request; request = null; old?.abort();
      entries = []; cursor = null; selectedId = null; refs = []; spans = []; lastUpdated = null;
      for (const id of ['detectionChart', 'classesChart', 'conclusionsChart']) $(id).replaceChildren();
      for (const id of ['detectionTooltip', 'classesTooltip', 'conclusionsTooltip', 'chartStatus']) $(id).textContent = '';
    }
  };
}
