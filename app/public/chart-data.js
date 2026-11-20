// Datos originales del historial. No se recalculan las conclusiones del servidor.
export const CLASS_LABELS = ['Sin basura', 'Botellas', 'Papeles y Cartones', 'Bolsas'];
export const CLASS_COLORS = ['#258263', '#4678be', '#b67b27', '#9263ac'];
export const STATE_COLORS = { 'Hay basura': '#c66742', 'Sin basura': '#258263', 'No seguro': '#89968d' };

export function mergeChartEntries(previous, incoming, from, to, limit = 6000) {
  const unique = new Map([...previous, ...incoming].map(row => [row.id, row]));
  return [...unique.values()].filter(row => row.receivedAt >= from && row.receivedAt <= to)
    .sort((a, b) => a.receivedAt - b.receivedAt || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0))
    .slice(-limit);
}

export function lineSegments(entries, staleMs) {
  const segments = [];
  for (const row of entries) {
    const current = segments.at(-1), previous = current?.at(-1);
    if (!previous || row.receivedAt - previous.receivedAt > staleMs) segments.push([row]);
    else current.push(row);
  }
  return segments;
}

export function conclusionSpans(entries, from, to, staleMs) {
  const spans = [];
  for (let i = 0; i < entries.length; i++) {
    const row = entries[i];
    const start = Math.max(from, row.receivedAt);
    const end = Math.min(to, row.receivedAt + staleMs, entries[i + 1]?.receivedAt ?? to);
    if (end <= start || !STATE_COLORS[row.conclusion]) continue;
    const previous = spans.at(-1);
    if (previous?.conclusion === row.conclusion && previous.to === start) previous.to = end;
    else spans.push({ from: start, to: end, conclusion: row.conclusion });
  }
  return spans;
}

export function nearestEntry(entries, timestamp) {
  if (!entries.length) return null;
  let lo = 0, hi = entries.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (entries[mid].receivedAt < timestamp) lo = mid + 1; else hi = mid; }
  const right = entries[lo], left = entries[lo - 1];
  return left && timestamp - left.receivedAt <= right.receivedAt - timestamp ? left : right;
}

export function seriesPath(segments, x, y, value, step = false) {
  return segments.map(segment => segment.map((row, i) => {
    const px = x(row.receivedAt).toFixed(1), py = y(value(row)).toFixed(1);
    return i === 0 ? `M${px},${py}` : (step ? `H${px}V${py}` : `L${px},${py}`);
  }).join('')).join('');
}
