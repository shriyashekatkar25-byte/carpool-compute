// Off-main-thread compute: keeps sliders and the 3D scene responsive while 20k runs x T caps are simulated.
import { evaluate, surface } from './engine.js';

self.onmessage = (ev) => {
  const { id, type, params } = ev.data;
  try {
    const t0 = performance.now();
    let result;
    if (type === 'evaluate') {
      const r = evaluate(params);
      result = { ...r, draws: Array.from(r.draws) };
    } else if (type === 'surface') {
      const pGrid = Array.from({ length: 13 }, (_, i) => +(i * 0.0025).toFixed(4));
      result = surface(params, pGrid, 1500);
    } else throw new Error('unknown job type ' + type);
    self.postMessage({ id, ok: true, type, result, ms: performance.now() - t0 });
  } catch (e) {
    self.postMessage({ id, ok: false, type, error: String(e && e.message || e) });
  }
};
