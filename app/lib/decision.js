// La decision se actualiza solo al llegar una nueva foto, nunca por visitas a la web.
export function decide(previous, reading, { threshold, staleMs }) {
  const scores = reading.scores;
  if (!Array.isArray(scores) || scores.length !== 4 || scores.some(x => !Number.isFinite(x) || x < 0 || x > 1) || Math.abs(scores.reduce((a, b) => a + b, 0) - 1) > .001) {
    throw new Error('Predicciones invalidas.');
  }
  // Descartar respuestas repetidas o que terminaron fuera de orden.
  if (previous && (reading.receivedAt < previous.receivedAt ||
      (reading.boot === previous.boot && reading.seq <= previous.seq))) return previous;
  const reset = !previous || reading.boot !== previous.boot ||
    reading.receivedAt - previous.receivedAt > staleMs || previous.threshold !== threshold ||
    (reading.orientationVersion ?? '0') !== (previous.orientationVersion ?? '0') ||
    (reading.rotation ?? 0) !== (previous.rotation ?? 0);
  const history = reset ? [] : [...previous.history];
  const trashNow = Math.min(1, scores.slice(1).reduce((a, b) => a + b, 0));
  history.push(trashNow); if (history.length > 5) history.shift();
  const trashAverage = history.reduce((a, b) => a + b, 0) / history.length;
  let candidate = -1, streak = 0, conclusion = 'No seguro';
  if (history.length >= 3) {
    candidate = trashAverage >= threshold ? 1 : (1 - trashAverage >= threshold ? 0 : -1);
    if (candidate !== -1) {
      streak = !reset && previous.candidate === candidate ? Math.min(3, previous.streak + 1) : 1;
      if (streak >= 3) conclusion = candidate ? 'Hay basura' : 'Sin basura';
    }
  }
  return { ...reading, threshold, history, trashNow, trashAverage, candidate, streak, conclusion };
}
export function publicState(state, staleMs, now = Date.now()) {
  if (!state) return { online: false, state: null };
  const { history, boot, seq, candidate, ...data } = state;
  const online = now - state.receivedAt <= staleMs;
  return { online, state: { ...data, conclusion: online ? data.conclusion : 'Sin datos recientes', readings: history.length } };
}
