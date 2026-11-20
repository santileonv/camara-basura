import { mergeChartEntries, lineSegments, conclusionSpans, nearestEntry, seriesPath, decisionStepSegments, decisionStepPath, historyDomain, windowAtOffset } from './chart-data.js';

const NS = 'http://www.w3.org/2000/svg';
const pct = value => (100 * value).toFixed(1) + ' %';
const time = value => new Date(value).toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit', hour12:false });
const date = value => new Date(value).toLocaleString('es-CL');
function node(tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createCharts({ onUnauthorized = () => {} } = {}) {
  const $ = id => document.getElementById(id);
  let active = false, entries = [], cursor = null, duration = 15 * 60000, staleMs = 90000;
  let request = null, timer, resizeTimer, skew = 0, lastUpdated = null, limited = false, error = '';
  let selectedId = null, probability = null, spans = [], context = null;
  let live = true, viewEnd = null, earliest = null, navigationTimer, loaded = false;
  const scrollers = [...document.querySelectorAll('.historyScroller')];
  const positions = new WeakMap();
  const currentTime = () => Date.now() + skew;
  const domain = () => historyDomain(earliest, currentTime(), duration);

  function bounds() { const to = live ? currentTime() : viewEnd; return { from:Math.max(0, to - duration), to }; }
  function syncNavigation() {
    const extent = domain(), view = bounds();
    const span = extent.to - extent.from, travel = Math.max(0, span - duration);
    const fraction = travel ? Math.max(0, Math.min(1, (view.from - extent.from) / travel)) : 1;
    for (const bar of scrollers) {
      const width = bar.clientWidth || 800;
      bar.firstElementChild.style.width = Math.min(8000000, Math.max(width + 1, width * span / duration)) + 'px';
      const offset = fraction * (bar.scrollWidth - bar.clientWidth);
      positions.set(bar, offset);
      if (Math.abs(bar.scrollLeft - offset) > .75) bar.scrollLeft = offset;
      bar.setAttribute('aria-label', `Desplazar historial de ${date(extent.from)} a ${date(extent.to)}. Izquierda: más antiguo. Derecha: más reciente.`);
    }
    for (const label of document.querySelectorAll('.historyStart')) label.textContent = earliest === null ? 'Sin mediciones guardadas' : 'Inicio: ' + date(earliest);
    $('chartMode').textContent = live ? '● En vivo · sigue las capturas nuevas' : 'Historial · vista fija';
    $('liveCharts').setAttribute('aria-pressed', String(live));
    $('chartRange').textContent = `${date(view.from)} — ${date(view.to)}`;
    $('zoomInCharts').disabled = duration <= 60000;
    $('zoomOutCharts').disabled = duration >= Math.max(60000, currentTime() - (earliest ?? currentTime() - duration));
  }
  function frame(id, from, to, binary = false) {
    const svg = $(id), width = Math.max(300, svg.getBoundingClientRect().width || 800);
    const height = 280, left = binary ? (width < 450 ? 104 : 124) : 48, right = width - 16, top = 34, bottom = 224;
    const x = timestamp => left + (timestamp - from) / (to - from) * (right - left);
    const y = value => binary ? bottom - 24 - value * (bottom - top - 48) : bottom - value * (bottom - top);
    svg.replaceChildren(); svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.append(node('title', {}, svg.getAttribute('aria-label')));
    svg.append(node('text', { x:binary ? 8 : left, y:16, class:'chartAxisTitle' }, binary ? 'Conclusión' : 'Probabilidad de basura (%)'));
    const withDate = new Date(from).toDateString() !== new Date(to).toDateString();
    const ticks = width < 450 ? (withDate ? 2 : 3) : 5;
    for (let i = 0; i < ticks; i++) {
      const stamp = from + (to - from) * i / (ticks - 1);
      const label = (withDate ? new Date(stamp).toLocaleDateString('es-CL', { day:'2-digit',month:'2-digit' }) + ' ' : '') + time(stamp);
      svg.append(node('text', { x:x(stamp), y:bottom + 22, 'text-anchor':i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle', class:'chartAxis' }, label));
    }
    svg.append(node('text', { x:(left + right) / 2, y:height - 7, 'text-anchor':'middle', class:'chartAxisTitle' }, 'Hora de la medición'));
    return { svg, x, y, left, right, width, top, bottom, from, to };
  }
  function grid(ref, binary = false) {
    for (const value of binary ? [0, 1] : [0, .2, .4, .6, .8, 1]) {
      ref.svg.append(node('line', { x1:ref.left, x2:ref.right, y1:ref.y(value), y2:ref.y(value), class:'chartGrid' }));
      ref.svg.append(node('text', { x:ref.left - 10, y:ref.y(value) + 4, 'text-anchor':'end', class:binary ? 'decisionAxis ' + (value ? 'hasTrash' : 'noTrash') : 'chartAxis' }, binary ? (value ? 'Hay basura' : 'Sin basura') : Math.round(value * 100) + '%'));
    }
  }
  function addSeries(ref, segments, value, color, thick = 2, dashed = false) {
    if (!segments.length) return;
    ref.svg.append(node('path', { d:seriesPath(segments, ref.x, ref.y, value, dashed), fill:'none', stroke:color, 'stroke-width':thick,
      ...(dashed ? { 'stroke-dasharray':'5 5' } : {}), 'stroke-linejoin':'round', 'stroke-linecap':'round' }));
    for (const segment of segments) if (segment.length === 1)
      ref.svg.append(node('circle', { cx:ref.x(segment[0].receivedAt), cy:ref.y(value(segment[0])), r:3, fill:color }));
  }
  function shadeThresholds(ref, segments) {
    for (const segment of segments) {
      const first = segment[0], last = segment.at(-1);
      for (const [edge, value, color] of [[1, row => row.threshold, '#fdf0e8'], [0, row => 1 - row.threshold, '#edf6ef']]) {
        const boundary = seriesPath([segment], ref.x, ref.y, value, true);
        const d = boundary + `L${ref.x(last.receivedAt).toFixed(1)},${ref.y(edge).toFixed(1)}H${ref.x(first.receivedAt).toFixed(1)}Z`;
        ref.svg.append(node('path', { d, fill:color, stroke:'none' }));
      }
    }
  }
  function mark(ref) {
    ref.marker = node('line', { y1:ref.top, y2:ref.bottom, class:'chartCursor' }); ref.svg.append(ref.marker);
    ref.dot = node('circle', { r:4, fill:'#b55b36', stroke:'white', 'stroke-width':2 }); ref.svg.append(ref.dot);
  }
  function selection() {
    const row = entries.find(item => item.id === selectedId) ?? entries.at(-1);
    if (probability) {
      probability.marker.setAttribute('visibility', row ? 'visible' : 'hidden'); probability.dot.setAttribute('visibility', row ? 'visible' : 'hidden');
      if (row) {
        const px = probability.x(row.receivedAt); probability.marker.setAttribute('x1', px); probability.marker.setAttribute('x2', px);
        probability.dot.setAttribute('cx', px); probability.dot.setAttribute('cy', probability.y(row.trashAverage));
      }
    }
    $('probabilityAverage').textContent = row ? pct(row.trashAverage) : '—';
    $('probabilityCapture').textContent = row ? pct(row.trashNow) : '—';
    $('averageSamples').textContent = row ? `Promedio de ${row.readings} ${row.readings === 1 ? 'captura' : 'capturas'}` : 'Promedio de hasta 5 capturas';
    $('detectionTooltip').textContent = row ? `${selectedId === null ? 'Última captura del intervalo' : 'Captura seleccionada'}: ${date(row.receivedAt)} · ${row.conclusion} · Confirmación ${row.streak}/3.` : 'No hay mediciones en este intervalo.';
    $('thresholdGuide').textContent = row ? `En esta medición: ≤ ${pct(1 - row.threshold)} apoya «Sin basura»; ≥ ${pct(row.threshold)} apoya «Hay basura». Entre ambos, la evidencia es intermedia.` : 'Los límites punteados muestran los umbrales de decisión.';
  }
  function timestampAt(event, ref) {
    const box = ref.svg.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width * ref.width;
    return ref.from + Math.max(0, Math.min(1, (px - ref.left) / (ref.right - ref.left))) * (ref.to - ref.from);
  }
  function interactProbability(ref) {
    const inspect = event => { selectedId = nearestEntry(entries, timestampAt(event, ref))?.id ?? null; selection(); };
    ref.svg.onpointermove = inspect; ref.svg.onpointerdown = inspect;
    ref.svg.onpointerleave = () => { selectedId = null; selection(); };
    ref.svg.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !entries.length) return;
      event.preventDefault();
      const start = selectedId === null ? entries.length - 1 : Math.max(0, entries.findIndex(row => row.id === selectedId));
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, start + (event.key === 'ArrowLeft' ? -1 : 1)));
      selectedId = entries[index].id; selection();
    };
  }
  function showDecision(stamp) {
    const span = spans.find(item => stamp >= item.from && stamp < item.to);
    const label = !span ? 'Sin datos recientes' : span.conclusion === 'No seguro' ? 'Sin confirmar' : span.conclusion;
    $('stepState').textContent = label;
    $('stepState').className = 'decisionTag ' + (!span ? 'missing' : span.conclusion === 'No seguro' ? 'unsure' : span.conclusion === 'Hay basura' ? 'trash' : 'clear');
    $('stepTime').textContent = date(stamp);
    $('stepTooltip').textContent = !span ? 'No hay una medición vigente en este momento del gráfico.' : span.conclusion === 'No seguro' ? 'El sistema aún no confirma ninguno de los dos resultados. Por eso la línea se interrumpe.' : `Conclusión confirmada entre ${time(span.from)} y ${time(span.to)}. La altura indica el resultado, no un porcentaje.`;
  }
  function drawDecision(from, to) {
    const ref = frame('decisionChart', from, to, true);
    const defs = node('defs'), pattern = node('pattern', { id:'noDataPattern', width:8, height:8, patternUnits:'userSpaceOnUse' });
    pattern.append(node('rect', { width:8, height:8, fill:'#f4f6f2' }), node('path', { d:'M0,8L8,0', stroke:'#dbe4dc', 'stroke-width':1 })); defs.append(pattern); ref.svg.append(defs);
    ref.svg.append(node('rect', { x:ref.left, y:ref.top, width:ref.right - ref.left, height:ref.bottom - ref.top, fill:'url(#noDataPattern)' }));
    for (const span of spans) ref.svg.append(node('rect', { x:ref.x(span.from), y:ref.top, width:ref.x(span.to) - ref.x(span.from), height:ref.bottom - ref.top, fill:span.conclusion === 'No seguro' ? '#fff1d6' : 'white' }));
    grid(ref, true);
    const runs = decisionStepSegments(spans);
    ref.svg.append(node('path', { d:decisionStepPath(runs, ref.x, ref.y), class:'decisionLine', fill:'none' }));
    for (const run of runs) for (const point of [run[0], run.at(-1)])
      ref.svg.append(node('circle', { cx:ref.x(point.at), cy:ref.y(point.value), r:3.5, fill:point.value ? '#c66742' : '#258263' }));
    const marker = node('line', { y1:ref.top, y2:ref.bottom, class:'chartCursor' }); ref.svg.append(marker);
    const inspect = stamp => { showDecision(stamp); marker.setAttribute('visibility', 'visible'); marker.setAttribute('x1', ref.x(stamp)); marker.setAttribute('x2', ref.x(stamp)); };
    ref.svg.onpointermove = event => inspect(timestampAt(event, ref)); ref.svg.onpointerdown = ref.svg.onpointermove;
    ref.svg.onpointerleave = () => { marker.setAttribute('visibility', 'hidden'); showDecision(to - 1); };
    ref.svg.onpointerenter = () => marker.setAttribute('visibility', 'visible');
    let index = spans.length - 1;
    ref.svg.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !spans.length) return;
      event.preventDefault(); index = event.key === 'Home' ? 0 : event.key === 'End' ? spans.length - 1 : Math.max(0, Math.min(spans.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
      marker.setAttribute('visibility', 'visible'); inspect((spans[index].from + spans[index].to) / 2);
    };
    marker.setAttribute('visibility', 'hidden'); showDecision(to - 1);
    $('stepEmpty').hidden = !entries.length || runs.length > 0;
  }
  function render() {
    if (!active) return;
    const { from, to } = bounds(); entries = mergeChartEntries(entries, [], from, to);
    spans = conclusionSpans(context ? [context, ...entries] : entries, from, to, staleMs); drawDecision(from, to);
    const segments = lineSegments(entries, staleMs);
    probability = frame('detectionChart', from, to);
    shadeThresholds(probability, segments); grid(probability);
    addSeries(probability, segments, row => row.threshold, '#c66742', 1.3, true);
    addSeries(probability, segments, row => 1 - row.threshold, '#258263', 1.3, true);
    if ($('showCaptures').checked) addSeries(probability, segments, row => row.trashNow, '#8b9eaa', 1.2);
    addSeries(probability, segments, row => row.trashAverage, '#b55b36', 3);
    mark(probability); interactProbability(probability); selection();
    $('chartStatus').textContent = error || (lastUpdated ? `${entries.length} mediciones · ${live ? 'Actualización en vivo cada 15 s' : 'Historial cargado'}.` + (limited ? ' Hay más de 6000 mediciones en este intervalo: acerca el zoom para ver todas las del tramo.' : '') : 'Consultando mediciones…');
    $('chartStatus').classList.toggle('chartFailure', !!error);
    $('chartEmpty').hidden = entries.length > 0 || !lastUpdated || !!error;
    syncNavigation();
  }

  async function refresh(reset = false) {
    clearTimeout(timer);
    if (!active || document.hidden || (request && !reset)) return;
    if (reset) { request?.abort(); entries = []; context = null; cursor = null; lastUpdated = null; selectedId = null; limited = false; error = ''; loaded = false; render(); }
    const controller = new AbortController(); request = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const view = bounds();
      // La primera consulta obtiene la hora del servidor, aunque el reloj del PC este adelantado.
      const params = new URLSearchParams(earliest === null && live && !loaded ?
        { minutes:String(duration / 60000) } : { from:String(Math.floor(view.from)), to:String(Math.floor(view.to)) });
      if (live && loaded && cursor !== null) params.set('after', cursor);
      const response = await fetch('/api/chart-history?' + params, { cache:'no-store', signal:controller.signal });
      if (request !== controller || !active) return;
      if (response.status === 401) { onUnauthorized(); return; }
      const data = await response.json();
      if (request !== controller || !active) return;
      if (!response.ok) throw new Error(data.error || 'No se pudieron consultar los gráficos.');
      skew = data.now - Date.now(); staleMs = data.staleMs; cursor = data.cursor;
      if ('earliestAt' in data) earliest = data.earliestAt;
      context = data.context;
      limited = limited || data.truncated || entries.length + data.entries.length > 6000;
      entries = mergeChartEntries(entries, data.entries, data.from, data.to);
      if (earliest === null && entries.length) earliest = entries[0].receivedAt;
      loaded = true; lastUpdated = data.now; error = ''; render();
    } catch (cause) {
      if (request !== controller || !active) return;
      error = 'No se pudieron actualizar los gráficos. ' + (entries.length ? 'Se conservan los datos anteriores.' : 'Pulsa Actualizar gráficos para reintentar.'); render();
    } finally {
      clearTimeout(timeout);
      if (request === controller) { request = null; if (active && live && !document.hidden) timer = setTimeout(refresh, 15000); }
    }
  }

  function navigate(to, nextDuration = duration, immediate = false) {
    clearTimeout(timer); clearTimeout(navigationTimer);
    const old = request; request = null; old?.abort();
    duration = nextDuration; live = false; viewEnd = to;
    entries = []; context = null; selectedId = null; cursor = null; lastUpdated = null; loaded = false; limited = false; error = '';
    render();
    if (immediate) refresh(true); else navigationTimer = setTimeout(() => refresh(true), 180);
  }
  for (const bar of scrollers) {
    bar.onscroll = () => {
      if (!active || Math.abs(bar.scrollLeft - (positions.get(bar) ?? -100)) < .75) return;
      const distance = bar.scrollWidth - bar.clientWidth;
      if (distance <= 0) return;
      const view = windowAtOffset(domain(), duration, bar.scrollLeft / distance);
      // Llegar al extremo derecho no reactiva el vivo accidentalmente.
      navigate(view.to);
    };
  }
  function zoom(factor) {
    const view = bounds(), extent = domain();
    const nextDuration = Math.max(60000, Math.min(Math.round(duration * factor), extent.to - extent.from));
    const center = (view.from + view.to) / 2;
    const to = live ? extent.to : Math.min(extent.to, Math.max(extent.from + nextDuration, center + nextDuration / 2));
    const wasLive = live;
    navigate(Math.round(to), nextDuration);
    if (wasLive) { live = true; viewEnd = null; render(); }
  }
  $('zoomInCharts').onclick = () => zoom(.5);
  $('zoomOutCharts').onclick = () => zoom(2);
  $('liveCharts').onclick = () => {
    clearTimeout(navigationTimer); live = true; viewEnd = null; refresh(true);
  };
  $('showCaptures').onchange = () => render();
  $('refreshCharts').onclick = () => { clearTimeout(navigationTimer); refresh(true); };
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer); clearTimeout(navigationTimer);
    if (document.hidden) { const old = request; request = null; old?.abort(); }
    else if (active && (live || !loaded)) refresh(!loaded);
  });
  const resize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 100); };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe($('chartSections'));
  else window.addEventListener('resize', resize);
  return {
    start() { if (!active) { active = true; live = true; viewEnd = null; refresh(true); } },
    stop() {
      active = false; clearTimeout(timer); clearTimeout(navigationTimer); clearTimeout(resizeTimer);
      const old = request; request = null; old?.abort();
      entries = []; context = null; cursor = null; selectedId = null; probability = null; spans = []; lastUpdated = null; loaded = false;
      for (const id of ['detectionChart', 'decisionChart']) $(id).replaceChildren();
      for (const id of ['detectionTooltip', 'stepTooltip', 'stepState', 'stepTime', 'chartStatus', 'probabilityAverage', 'probabilityCapture', 'thresholdGuide', 'chartRange', 'chartMode']) $(id).textContent = '';
    }
  };
}
