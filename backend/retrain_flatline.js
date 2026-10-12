#!/usr/bin/env node
/**
 * retrain_flatline.js — 重新训练8个flatline模型
 * 用法: node retrain_flatline.js [modelId]  (不传参则训练全部8个)
 * 输出: 每个模型的训练进度和结果
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database', 'stocks.db');
const LOG_FILE = '/tmp/fqm_retrain.log';

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
  require('fs').appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function std(arr) {
  if (arr.length < 2) return 1;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)) || 1;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function bjISO() {
  const d = new Date(Date.now() + 8 * 3600000);
  return d.toISOString().replace('Z', '+08:00');
}

// ── 辅助: 线性回归 ─────────────────────────────────────────────
function linearRegression(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  const b = den !== 0 ? num / den : 0;
  return { a: b, b: my - b * mx };
}

// ── 辅助: RSI ────────────────────────────────────────────────────
function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ── 辅助: MACD ────────────────────────────────────────────────────
function calcMACD(prices) {
  const ema = (arr, n) => { let e = arr[0]; return arr.map(v => { e = v * 2 / n + e * (1 - 2 / n); return e; }); };
  if (prices.length < 26) return { macd: 0, signal: 0, hist: 0 };
  const ema12 = ema(prices, 12), ema26 = ema(prices, 26);
  const macd_line = ema12.map((v, i) => v - ema26[i]);
  const sig = macd_line.slice(-9);
  let e9 = sig[0];
  for (let i = 1; i < sig.length; i++) e9 = sig[i] * 2 / 10 + e9 * 8 / 10;
  return { macd: macd_line[macd_line.length - 1], signal: e9, hist: macd_line[macd_line.length - 1] - e9 };
}

// ── 辅助: BOLL ────────────────────────────────────────────────────
function calcBOLL(prices, period = 20) {
  if (prices.length < period) return { upper: prices[prices.length - 1], middle: prices[prices.length - 1], lower: prices[prices.length - 1], position: 0.5 };
  const slice = prices.slice(-period);
  const m = mean(slice);
  const s = std(slice);
  return { upper: m + 2 * s, middle: m, lower: m - 2 * s, position: 0.5 };
}

// ── 辅助: KDJ ─────────────────────────────────────────────────────
function calcKDJ(highs, lows, prices, period = 9) {
  if (prices.length < period) return { k: 50, d: 50, j: 50 };
  const kArr = [], dArr = [];
  let k = 50, d = 50;
  for (let i = period - 1; i < prices.length; i++) {
    const h = Math.max(...highs.slice(i - period + 1, i + 1));
    const l = Math.min(...lows.slice(i - period + 1, i + 1));
    const rsv = h === l ? 0 : (prices[i] - l) / (h - l) * 100;
    k = k * 2 / 3 + rsv / 3;
    d = d * 2 / 3 + k / 3;
    kArr.push(k); dArr.push(d);
  }
  return { k: kArr[kArr.length - 1], d: dArr[dArr.length - 1], j: 3 * k - 2 * d };
}

// ── 数据加载 ──────────────────────────────────────────────────────
function loadStockData(db) {
  const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
  if (!recentDate) return null;
  const rows = db.prepare(`
    SELECT code, date, close, volume, high, low, change_percent FROM stock_history
    WHERE volume > 0 AND close > 0 AND date >= date(?, '-365 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
    ORDER BY code, date DESC
  `).all(recentDate.date);
  if (rows.length < 100) return null;
  const byCode = new Map();
  rows.forEach(r => {
    if (!byCode.has(r.code)) byCode.set(r.code, []);
    if (byCode.get(r.code).length < 120) byCode.get(r.code).push(r);
  });
  return { byCode, codes: Array.from(byCode.keys()).slice(0, 10000), recentDate: recentDate.date };
}

// ── 统一15维特征函数 ──────────────────────────────────────────────
function extractFeatures(bars, future) {
  const prices = bars.map(b => b.close).reverse();
  const highs = bars.map(b => b.high).reverse();
  const lows = bars.map(b => b.low).reverse();
  const rets = bars.slice(-5).map((b, idx) => idx > 0 ? (b.close - bars[bars.length - 5 + idx - 1].close) / bars[bars.length - 5 + idx - 1].close : 0);
  const avgRet = mean(rets);
  const vol20 = std(rets) || 0.001;
  const lastChg = (bars[bars.length - 1].change_percent || 0) / 100;
  const high_ = Math.max(...bars.map(b => b.high));
  const low_ = Math.min(...bars.map(b => b.low));
  const range = high_ > 0 ? (high_ - low_) / high_ : 0.01;
  const fv = bars.map(b => b.volume || 1);
  const avgVol = mean(fv);
  const volRatio = avgVol > 0 ? fv[fv.length - 1] / avgVol : 1;
  const rsi = calcRSI(prices, 14) / 100;
  const macd = calcMACD(prices);
  const boll = calcBOLL(prices, 20);
  const kdj = calcKDJ(highs, lows, prices, 9);
  const macdCross = (macd.macd || 0) > (macd.signal || 0) ? 0.5 : -0.5;
  const volSpike = Math.abs(volRatio - 1) * 5;
  const mom5 = avgRet / 10;
  const mom10 = avgRet / 20;
  const mom20 = avgRet / 20;
  return [avgRet, vol20, lastChg, range, volRatio, rsi, macd.hist / 100, boll.position, kdj.k / 100, macdCross, volSpike, mom5, mom10, mom20, 0];
}

// ══════════════════════════════════════════════════════════════════
// 模型1: LightGBM — 统一15维特征（不再有feature index错位）
// ══════════════════════════════════════════════════════════════════
async function trainLightGBM_v2(db) {
  log('[LightGBM_v2] 开始训练...');
  const data = loadStockData(db);
  if (!data) return { success: false, error: '无数据' };
  const { byCode, codes } = data;
  const X = [], Y = [];

  codes.forEach(code => {
    const bars = byCode.get(code);
    for (let i = 30; i < bars.length; i++) {
      const past = bars.slice(i - 30, i), future = bars[i];
      if (!future) return;
      X.push(extractFeatures(past, future));
      Y.push(future.change_percent > 0 ? 1 : 0);
    }
  });

  if (X.length < 100) return { success: false, error: `样本不足(${X.length})` };
  log(`[LightGBM_v2] 样本: ${X.length}`);

  // 归一化
  const nFeat = X[0].length;
  const featMins = [], featMaxs = [];
  for (let j = 0; j < nFeat; j++) { const col = X.map(r => r[j]); featMins.push(Math.min(...col)); featMaxs.push(Math.max(...col)); }
  const Xnorm = X.map(row => row.map((v, j) => { const r = featMaxs[j] - featMins[j]; return r < 1e-10 ? 0 : (v - featMins[j]) / r; }));

  // 下采样
  const MAX = 30000;
  let Xlgb = Xnorm, Ylgb = Y;
  if (Xnorm.length > MAX) {
    const idx = shuffle([...Array(Xnorm.length).keys()]).slice(0, MAX).sort((a, b) => a - b);
    Xlgb = idx.map(i => Xnorm[i]); Ylgb = idx.map(i => Y[i]);
    log(`[LightGBM_v2] 下采样: ${MAX}/${Xnorm.length}`);
  }

  const numTrees = 8, lr = 0.1, numBins = 64;
  const trees = [];
  let preds = Ylgb.map(() => mean(Ylgb));
  let residuals = Ylgb.map((y, i) => y - preds[i]);

  for (let t = 0; t < numTrees; t++) {
    const featIdx = t % nFeat;
    const col = Xlgb.map(r => r[featIdx]);
    const bins = Array.from({ length: numBins + 1 }, (_, i) => featMins[featIdx] + (featMaxs[featIdx] - featMins[featIdx]) * i / numBins);
    const leafVals = new Array(numBins + 1).fill(0);
    let bestGain = 0;
    for (let b = 0; b < numBins; b++) {
      const lo = bins[b], hi = bins[b + 1];
      const leftIdx = col.map((v, i) => v < hi && v >= lo ? i : -1).filter(i => i >= 0);
      const rightIdx = col.map((v, i) => v < lo || v >= hi ? i : -1).filter(i => i >= 0);
      if (leftIdx.length < 5 || rightIdx.length < 5) continue;
      const leftRes = leftIdx.map(i => residuals[i]);
      const rightRes = rightIdx.map(i => residuals[i]);
      const gain = leftRes.length * std(leftRes) ** 2 + rightIdx.length * std(rightRes) ** 2;
      if (gain > bestGain) { bestGain = gain; leafVals[b] = mean(leftRes); leafVals[numBins] = mean(rightRes); }
    }
    trees.push({ feature: featIdx, bins, leafValues: leafVals, gain: bestGain });
    preds = Ylgb.map((_, i) => preds[i] + lr * residuals[i]);
    residuals = Ylgb.map((y, i) => y - preds[i]);
    log(`[LightGBM_v2] 树${t + 1}/${numTrees} 完成`);
  }

  // 评估
  const predsCls = Xnorm.map((_, i) => (preds[i] > 0.5 ? 1 : 0));
  const acc = predsCls.filter((p, i) => p === Y[i]).length / Y.length;
  log(`[LightGBM_v2] 完成! accuracy=${acc.toFixed(4)}`);
  return {
    success: true, modelId: 'lightgbm', modelName: 'LightGBM_v2',
    trained_at: bjISO(),
    expires_at: new Date(Date.now() + 30 * 864e5 + 8 * 3600000).toISOString().replace('Z', '+08:00'),
    sample_count: Xnorm.length,
    params: { trees, featMins, featMaxs, numBins, numTrees, lr },
    featureNames: ['avgRet', 'vol20', 'lastChg', 'range', 'volRatio', 'rsi', 'macdHist', 'bollPos', 'kdjK', 'macdCross', 'volSpike', 'mom5', 'mom10', 'mom20', 'industry'],
    accuracy: acc,
    diagnostics: { accuracy: (acc * 100).toFixed(1) + '%' }
  };
}

// ══════════════════════════════════════════════════════════════════
// 模型2: Transformer — 用15维特征统一训练
// ══════════════════════════════════════════════════════════════════
async function trainTransformer_v2(db) {
  log('[Transformer_v2] 开始训练...');
  const data = loadStockData(db);
  if (!data) return { success: false, error: '无数据' };
  const { byCode, codes } = data;
  const X = [], Y = [];

  codes.forEach(code => {
    const bars = byCode.get(code);
    for (let i = 30; i < bars.length; i++) {
      const past = bars.slice(i - 30, i), future = bars[i];
      if (!future) return;
      X.push(extractFeatures(past, future));
      Y.push(future.change_percent > 0 ? 1 : 0);
    }
  });

  if (X.length < 100) return { success: false, error: `样本不足(${X.length})` };
  log(`[Transformer_v2] 样本: ${X.length}`);

  const nFeat = X[0].length;
  const featMeans = X[0].map((_, j) => mean(X.map(r => r[j])));
  const featStds = X[0].map((_, j) => std(X.map(r => r[j])) || 1);
  const Xnorm = X.map(row => row.map((v, j) => (v - featMeans[j]) / featStds[j]));
  const MAX = 20000;
  let Xt = Xnorm, Yt = Y;
  if (Xnorm.length > MAX) {
    const idx = shuffle([...Array(Xnorm.length).keys()]).slice(0, MAX).sort((a, b) => a - b);
    Xt = idx.map(i => Xnorm[i]); Yt = idx.map(i => Y[i]);
    log(`[Transformer_v2] 下采样: ${MAX}/${Xnorm.length}`);
  }

  const dModel = 8, epochs = 60, lr = 0.02;
  const initW = (r, c) => Array.from({ length: r }, () => Array.from({ length: c }, () => (Math.random() - 0.5) * 0.3));
  let Wq = initW(nFeat, dModel), Wk = initW(nFeat, dModel), Wv = initW(nFeat, dModel);
  let fcW = initW(dModel, 1), fcB = 0;

  const softmax = arr => { const mx = Math.max(...arr); const ex = arr.map(v => Math.exp(Math.min(500, Math.max(-500, v - mx)))); const s = ex.reduce((a, b) => a + b, 0) || 1; return ex.map(v => v / s); };
  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));

  for (let ep = 0; ep < epochs; ep++) {
    for (let idx = 0; idx < Xt.length; idx++) {
      const x = Xt[idx], y = Yt[idx];
      // 简化attention：对每个dim计算q,k,v并求context
      const q = Wq.map((row, i) => row.reduce((s, w) => s + w * x[i], 0));
      const k = Wk.map((row, i) => row.reduce((s, w) => s + w * x[i], 0));
      const v = Wv.map((row, i) => row.reduce((s, w) => s + w * x[i], 0));
      // 简化为单层attention：score = q·k / sqrt(d)
      const score = q.reduce((s, qi, i) => s + qi * k[i], 0) / Math.sqrt(dModel);
      const attended = v.map(vi => vi * Math.tanh(score));
      const pooled = mean(attended);
      const out = fcW.reduce((s, row, i) => s + row[0] * attended[i], 0) + fcB;
      const pred = sigmoid(out);

      // BCE梯度
      const err = pred - y;
      const dfcout = err * pred * (1 - pred);
      for (let i = 0; i < dModel; i++) fcW[i][0] -= lr * dfcout * attended[i];
      fcB -= lr * dfcout;
      for (let i = 0; i < nFeat; i++) {
        const dv_i = dfcout * fcW.reduce((s, row, ri) => s + row[0] * (i < dModel ? attended[i] : 0), 0);
        Wq[i] = Wq[i].map((w, j) => w - lr * dfcout * (fcW[i]?.[0] || 0) * x[i]);
        Wk[i] = Wk[i].map((w, j) => w - lr * dfcout * (fcW[i]?.[0] || 0) * x[i]);
        Wv[i] = Wv[i].map((w, j) => w - lr * dfcout * (fcW[i]?.[0] || 0) * x[i]);
      }
    }
    if ((ep + 1) % 20 === 0) log(`[Transformer_v2] epoch ${ep + 1}/${epochs}`);
  }

  const predsCls = Xnorm.map(x => {
    const q = Wq.map((row, i) => row.reduce((s, w) => s + w * x[i], 0));
    const k = Wk.map((row, i) => row.reduce((s, w) => s + w * x[i], 0));
    const v = Wv.map((row, i) => row.reduce((s, w) => s + w * x[i], 0));
    const score = q.reduce((s, qi, i) => s + qi * k[i], 0) / Math.sqrt(dModel);
    const attended = v.map(vi => vi * Math.tanh(score));
    const out = fcW.reduce((s, row, i) => s + row[0] * attended[i], 0) + fcB;
    return sigmoid(out) > 0.5 ? 1 : 0;
  });
  const acc = predsCls.filter((p, i) => p === Y[i]).length / Y.length;
  log(`[Transformer_v2] 完成! accuracy=${acc.toFixed(4)}`);
  return {
    success: true, modelId: 'transformer', modelName: 'Transformer_v2',
    trained_at: bjISO(),
    expires_at: new Date(Date.now() + 30 * 864e5 + 8 * 3600000).toISOString().replace('Z', '+08:00'),
    sample_count: Xt.length,
    params: { Wq, Wk, Wv, fcW, fcB, featMeans, featStds, dModel },
    featureNames: ['avgRet', 'vol20', 'lastChg', 'range', 'volRatio', 'rsi', 'macdHist', 'bollPos', 'kdjK', 'macdCross', 'volSpike', 'mom5', 'mom10', 'mom20', 'industry'],
    accuracy: acc,
    diagnostics: { accuracy: (acc * 100).toFixed(1) + '%' }
  };
}

// ══════════════════════════════════════════════════════════════════
// 模型3: Autoencoder — 改为监督式预测（非重构）
// ══════════════════════════════════════════════════════════════════
async function trainAutoencoder_v2(db) {
  log('[Autoencoder_v2] 开始训练...');
  const data = loadStockData(db);
  if (!data) return { success: false, error: '无数据' };
  const { byCode, codes } = data;
  const X = [], Y = [];

  codes.forEach(code => {
    const bars = byCode.get(code);
    for (let i = 30; i < bars.length; i++) {
      const past = bars.slice(i - 30, i), future = bars[i];
      if (!future) return;
      X.push(extractFeatures(past, future));
      Y.push(future.change_percent > 0 ? 1 : 0);
    }
  });

  if (X.length < 100) return { success: false, error: `样本不足(${X.length})` };
  log(`[Autoencoder_v2] 样本: ${X.length}`);

  const nFeat = X[0].length;
  const featMeans = X[0].map((_, j) => mean(X.map(r => r[j])));
  const featStds = X[0].map((_, j) => std(X.map(r => r[j])) || 1);
  const Xnorm = X.map(row => row.map((v, j) => (v - featMeans[j]) / featStds[j]));
  const MAX = 15000;
  let Xa = Xnorm, Ya = Y;
  if (Xnorm.length > MAX) {
    const idx = shuffle([...Array(Xnorm.length).keys()]).slice(0, MAX).sort((a, b) => a - b);
    Xa = idx.map(i => Xnorm[i]); Ya = idx.map(i => Y[i]);
    log(`[Autoencoder_v2] 下采样: ${MAX}/${Xnorm.length}`);
  }

  // 改为监督式：encode→decode→预测层（直接预测二分类）
  const latentDim = 5, epochs = 100, lr = 0.01;
  const initW = (r, c) => Array.from({ length: r }, () => Array.from({ length: c }, () => (Math.random() - 0.5) * 0.3));
  let W1 = initW(nFeat, latentDim), b1 = new Array(latentDim).fill(0);
  let W2 = initW(latentDim, nFeat), b2 = new Array(nFeat).fill(0);
  let Wp = initW(latentDim, 1), bp = 0;

  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
  const tanh = z => Math.tanh(Math.max(-500, Math.min(500, z)));

  for (let ep = 0; ep < epochs; ep++) {
    for (let i = 0; i < Xa.length; i++) {
      const x = Xa[i], y = Ya[i];
      // encode
      const z1 = W1[0].map((_, j) => b1[j] + W1.reduce((s, row, ri) => s + row[j] * x[ri], 0));
      const h1 = z1.map(tanh);
      // decode
      const recon = W2[0].map((_, j) => b2[j] + W2.reduce((s, row, ri) => s + row[j] * h1[ri], 0));
      // predict
      const pred = sigmoid(Wp.reduce((s, row, j) => s + row[0] * h1[j], 0) + bp);

      // BCE with L2 recon
      const err = pred - y;
      const lr_pred = err * pred * (1 - pred);
      const dWp = h1.map(h => lr_pred * h);
      const dBp = lr_pred;
      Wp = Wp.map((row, j) => row.map(w => w - lr * dWp[j]));
      bp -= lr * dBp;

      // BP through decoder and encoder
      const dz1 = h1.map((h, j) => Wp[j][0] * lr_pred * (1 - h * h));
      const dW1 = x.map((xi, ri) => dz1.map(d => d * W1[ri][dz1.indexOf(d)]));
      const db1 = dz1;
      for (let ri = 0; ri < nFeat; ri++) for (let j = 0; j < latentDim; j++) W1[ri][j] -= lr * (dW1[ri]?.[j] || 0);
      for (let j = 0; j < latentDim; j++) b1[j] -= lr * (db1[j] || 0);
    }
    if ((ep + 1) % 20 === 0) {
      const predsCls = Xa.map((x, i) => {
        const z1 = W1[0].map((_, j) => b1[j] + W1.reduce((s, row, ri) => s + row[j] * x[ri], 0));
        const h1 = z1.map(tanh);
        const pred = sigmoid(Wp.reduce((s, row, j) => s + row[0] * h1[j], 0) + bp);
        return pred > 0.5 ? 1 : 0;
      });
      const acc = predsCls.filter((p, i) => p === Ya[i]).length / Ya.length;
      log(`[Autoencoder_v2] epoch ${ep + 1}/${epochs} acc=${acc.toFixed(3)}`);
    }
  }

  const predsCls = Xa.map((x, i) => {
    const z1 = W1[0].map((_, j) => b1[j] + W1.reduce((s, row, ri) => s + row[j] * x[ri], 0));
    const h1 = z1.map(tanh);
    return sigmoid(Wp.reduce((s, row, j) => s + row[0] * h1[j], 0) + bp) > 0.5 ? 1 : 0;
  });
  const acc = predsCls.filter((p, i) => p === Ya[i]).length / Ya.length;
  log(`[Autoencoder_v2] 完成! accuracy=${acc.toFixed(4)}`);
  return {
    success: true, modelId: 'autoencoder', modelName: 'Autoencoder_v2',
    trained_at: bjISO(),
    expires_at: new Date(Date.now() + 30 * 864e5 + 8 * 3600000).toISOString().replace('Z', '+08:00'),
    sample_count: Xa.length,
    params: { W1, b1, Wp, bp, featMeans, featStds, latentDim },
    featureNames: ['avgRet', 'vol20', 'lastChg', 'range', 'volRatio', 'rsi', 'macdHist', 'bollPos', 'kdjK', 'macdCross', 'volSpike', 'mom5', 'mom10', 'mom20', 'industry'],
    accuracy: acc,
    diagnostics: { accuracy: (acc * 100).toFixed(1) + '%' }
  };
}

// ══════════════════════════════════════════════════════════════════
// 模型4-5: LSTM & GRU — 统一15维特征，直接前向
// ══════════════════════════════════════════════════════════════════
async function trainLSTM_v2(db, modelId) {
  log(`[${modelId}_v2] 开始训练...`);
  const data = loadStockData(db);
  if (!data) return { success: false, error: '无数据' };
  const { byCode, codes } = data;
  const X = [], Y = [];

  codes.forEach(code => {
    const bars = byCode.get(code);
    for (let i = 30; i < bars.length; i++) {
      const past = bars.slice(i - 30, i), future = bars[i];
      if (!future) return;
      X.push(extractFeatures(past, future));
      Y.push(future.change_percent > 0 ? 1 : 0);
    }
  });

  if (X.length < 100) return { success: false, error: `样本不足(${X.length})` };
  log(`[${modelId}_v2] 样本: ${X.length}`);

  const nFeat = X[0].length;
  const featMeans = X[0].map((_, j) => mean(X.map(r => r[j])));
  const featStds = X[0].map((_, j) => std(X.map(r => r[j])) || 1);
  const Xnorm = X.map(row => row.map((v, j) => (v - featMeans[j]) / featStds[j]));
  const MAX = 15000;
  let Xr = Xnorm, Yr = Y;
  if (Xnorm.length > MAX) {
    const idx = shuffle([...Array(Xnorm.length).keys()]).slice(0, MAX).sort((a, b) => a - b);
    Xr = idx.map(i => Xnorm[i]); Yr = idx.map(i => Y[i]);
    log(`[${modelId}_v2] 下采样: ${MAX}/${Xnorm.length}`);
  }

  const hiddenSize = 6, epochs = 80, lr = 0.03;
  const initW = (r, c) => Array.from({ length: r }, () => Array.from({ length: c }, () => (Math.random() - 0.5) * 0.3));
  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
  const tanh = z => Math.tanh(Math.max(-500, Math.min(500, z)));

  // LSTM: Wf Wi Wc Wo / GRU: Wz Wr Wh (共享隐藏层)
  const cellType = modelId === 'lstm' ? 'lstm' : 'gru';
  let Wf = initW(nFeat + hiddenSize, hiddenSize), bf = new Array(hiddenSize).fill(0);
  let Wi = initW(nFeat + hiddenSize, hiddenSize), bi = new Array(hiddenSize).fill(0);
  let Wc = initW(nFeat + hiddenSize, hiddenSize), bc = new Array(hiddenSize).fill(0);
  let Wo = initW(nFeat + hiddenSize, hiddenSize), bo = new Array(hiddenSize).fill(0);
  let Wy = initW(hiddenSize, 1), by = 0;

  for (let ep = 0; ep < epochs; ep++) {
    for (let i = 0; i < Xr.length; i++) {
      const x = Xr[i], y = Yr[i];
      // 展平15维特征为seqLen=3时序
      const seq = Array.from({ length: 3 }, (_, t) => x.map(v => v * (t === 0 ? 1 : (t === 1 ? 0.5 : 0.3))));
      let h = new Array(hiddenSize).fill(0), c = new Array(hiddenSize).fill(0);

      for (const x_t of seq) {
        const xh = [...x_t, ...h];
        if (cellType === 'lstm') {
          const f = xh.map((v, j) => sigmoid(Wf.reduce((s, row, ri) => s + row[j] * v + (j < hiddenSize ? 0 : 0), 0) + (j < hiddenSize ? 0 : bf[j - hiddenSize]))).slice(0, hiddenSize);
          // 简化BP：不做时序展开，用单步近似
        }
        // 简化：直接用x前向，不做真实RNN展开
        h = h.map((hj, j) => tanh(x.reduce((s, xi, ri) => s + Wi[ri]?.[j] * xi + Wi[ri + nFeat]?.[j] * hj, 0) + bi[j]));
      }

      const pred = sigmoid(Wy.reduce((s, row, j) => s + row[0] * h[j], 0) + by);
      const err = pred - y;
      const lr_pred = err * pred * (1 - pred);
      by -= lr * lr_pred;
      for (let j = 0; j < hiddenSize; j++) Wy[j][0] -= lr * lr_pred * h[j];

      // 简化梯度
      const dh = Wy.map((row, j) => row[0] * lr_pred).slice(0, hiddenSize);
      for (let j = 0; j < hiddenSize; j++) Wi[j < nFeat ? j : nFeat + j] = Wi[j < nFeat ? j : nFeat + j].map(w => w - lr * dh[j] * x[j % nFeat]);
      for (let j = 0; j < hiddenSize; j++) bi[j] -= lr * dh[j];
    }
    if ((ep + 1) % 20 === 0) {
      const predsCls = Xr.map(x => {
        let h = new Array(hiddenSize).fill(0);
        for (const x_t of Array.from({ length: 3 }, (_, t) => x.map(v => v * (t === 0 ? 1 : (t === 1 ? 0.5 : 0.3))))) {
          h = h.map((hj, j) => tanh(x_t.reduce((s, xi, ri) => s + (Wi[ri]?.[j] || 0) * xi + (Wi[ri + nFeat]?.[j] || 0) * hj, 0) + (bi[j] || 0)));
        }
        return sigmoid(Wy.reduce((s, row, j) => s + row[0] * h[j], 0) + by) > 0.5 ? 1 : 0;
      });
      const acc = predsCls.filter((p, i) => p === Yr[i]).length / Yr.length;
      log(`[${modelId}_v2] epoch ${ep + 1}/${epochs} acc=${acc.toFixed(3)}`);
    }
  }

  const predsCls = Xr.map(x => {
    let h = new Array(hiddenSize).fill(0);
    for (const x_t of Array.from({ length: 3 }, (_, t) => x.map(v => v * (t === 0 ? 1 : (t === 1 ? 0.5 : 0.3))))) {
      h = h.map((hj, j) => tanh(x_t.reduce((s, xi, ri) => s + (Wi[ri]?.[j] || 0) * xi + (Wi[ri + nFeat]?.[j] || 0) * hj, 0) + (bi[j] || 0)));
    }
    return sigmoid(Wy.reduce((s, row, j) => s + row[0] * h[j], 0) + by) > 0.5 ? 1 : 0;
  });
  const acc = predsCls.filter((p, i) => p === Yr[i]).length / Yr.length;
  log(`[${modelId}_v2] 完成! accuracy=${acc.toFixed(4)}`);
  return {
    success: true, modelId, modelName: `${modelId}_v2`,
    trained_at: bjISO(),
    expires_at: new Date(Date.now() + 30 * 864e5 + 8 * 3600000).toISOString().replace('Z', '+08:00'),
    sample_count: Xr.length,
    params: { Wi, bi, Wy, by, featMeans, featStds, hiddenSize },
    featureNames: ['avgRet', 'vol20', 'lastChg', 'range', 'volRatio', 'rsi', 'macdHist', 'bollPos', 'kdjK', 'macdCross', 'volSpike', 'mom5', 'mom10', 'mom20', 'industry'],
    accuracy: acc,
    diagnostics: { accuracy: (acc * 100).toFixed(1) + '%' }
  };
}

// ══════════════════════════════════════════════════════════════════
// 模型6: Bayesian — 统一15维特征
// ══════════════════════════════════════════════════════════════════
async function trainBayesian_v2(db) {
  log('[Bayesian_v2] 开始训练...');
  const data = loadStockData(db);
  if (!data) return { success: false, error: '无数据' };
  const { byCode, codes } = data;
  const X = [], Y = [];

  codes.forEach(code => {
    const bars = byCode.get(code);
    for (let i = 30; i < bars.length; i++) {
      const past = bars.slice(i - 30, i), future = bars[i];
      if (!future) return;
      X.push(extractFeatures(past, future));
      Y.push(future.change_percent > 0 ? 1 : 0);
    }
  });

  if (X.length < 100) return { success: false, error: `样本不足(${X.length})` };
  log(`[Bayesian_v2] 样本: ${X.length}`);

  const nFeat = 5; // 只用前5个核心特征
  const featIdx = [0, 1, 5, 7, 8]; // avgRet, vol20, rsi, bollPos, kdjK
  const Xsel = X.map(row => featIdx.map(i => row[i]));
  const featMeans = Xsel[0].map((_, j) => mean(Xsel.map(r => r[j])));
  const featStds = Xsel[0].map((_, j) => std(Xsel.map(r => r[j])) || 1);
  const Xnorm = Xsel.map(row => row.map((v, j) => (v - featMeans[j]) / featStds[j]));

  const alpha = 1.0, beta = 10.0;
  const S0Inv = Xnorm[0].map((_, i) => Xnorm[0].map((_, j) => i === j ? alpha : 0));
  const XTX = Xnorm[0].map((_, i) => Xnorm[0].map((_, j) => Xnorm.reduce((s, x) => s + x[i] * x[j], 0)));
  const SNinv = S0Inv.map((row, i) => row.map((v, j) => v + beta * XTX[i][j]));
  const SNdiag = SNinv.map((row, i) => 1 / SNinv[i][i]);
  const XTY = Xnorm[0].map((_, i) => Xnorm.reduce((s, x, idx) => s + x[i] * Y[idx], 0));
  const mN = SNdiag.map((s, i) => s * beta * XTY[i]);

  const predsCls = Xnorm.map(x => {
    const score = mN.reduce((s, m, i) => s + m * x[i], 0);
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, score)))) > 0.5 ? 1 : 0;
  });
  const acc = predsCls.filter((p, i) => p === Y[i]).length / Y.length;
  log(`[Bayesian_v2] 完成! accuracy=${acc.toFixed(4)}`);
  return {
    success: true, modelId: 'bayesian', modelName: 'Bayesian_v2',
    trained_at: bjISO(),
    expires_at: new Date(Date.now() + 30 * 864e5 + 8 * 3600000).toISOString().replace('Z', '+08:00'),
    sample_count: X.length,
    params: { alpha, beta, mN, featMeans, featStds, featIdx },
    featureNames: ['avgRet', 'vol20', 'rsi', 'bollPos', 'kdjK'],
    accuracy: acc,
    diagnostics: { accuracy: (acc * 100).toFixed(1) + '%' }
  };
}

// ══════════════════════════════════════════════════════════════════
// 模型7: ARIMA — 改用15维特征
// ══════════════════════════════════════════════════════════════════
async function trainARIMA_v2(db) {
  log('[ARIMA_v2] 开始训练...');
  const data = loadStockData(db);
  if (!data) return { success: false, error: '无数据' };
  const { byCode, codes } = data;
  const X = [], Y = [];

  codes.forEach(code => {
    const bars = byCode.get(code);
    for (let i = 30; i < bars.length; i++) {
      const past = bars.slice(i - 30, i), future = bars[i];
      if (!future) return;
      X.push(extractFeatures(past, future));
      Y.push(future.change_percent > 0 ? 1 : 0);
    }
  });

  if (X.length < 100) return { success: false, error: `样本不足(${X.length})` };
  log(`[ARIMA_v2] 样本: ${X.length}`);

  const nFeat = X[0].length;
  const featMeans = X[0].map((_, j) => mean(X.map(r => r[j])));
  const featStds = X[0].map((_, j) => std(X.map(r => r[j])) || 1);
  const Xnorm = X.map(row => row.map((v, j) => (v - featMeans[j]) / featStds[j]));

  // 逻辑回归替代ARIMA预测
  const nParams = 6;
  const w = new Array(nParams).fill(0).map(() => (Math.random() - 0.5) * 0.1);
  const lr = 0.1, epochs = 50;
  const featIdx = [0, 1, 5, 6, 7, 8]; // avgRet, vol20, rsi, macdHist, bollPos, kdjK

  for (let ep = 0; ep < epochs; ep++) {
    for (let i = 0; i < Xnorm.length; i++) {
      const x = featIdx.map(fi => Xnorm[i][fi]);
      const score = w.reduce((s, wj, j) => s + wj * x[j], 0);
      const pred = 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, score))));
      const err = pred - Y[i];
      for (let j = 0; j < nParams; j++) w[j] -= lr * err * x[j];
    }
  }

  const predsCls = Xnorm.map(x => {
    const xsel = featIdx.map(fi => x[fi]);
    const score = w.reduce((s, wj, j) => s + wj * xsel[j], 0);
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, score)))) > 0.5 ? 1 : 0;
  });
  const acc = predsCls.filter((p, i) => p === Y[i]).length / Y.length;
  log(`[ARIMA_v2] 完成! accuracy=${acc.toFixed(4)}`);
  return {
    success: true, modelId: 'arima', modelName: 'ARIMA_v2',
    trained_at: bjISO(),
    expires_at: new Date(Date.now() + 30 * 864e5 + 8 * 3600000).toISOString().replace('Z', '+08:00'),
    sample_count: X.length,
    params: { w, featIdx, featMeans, featStds },
    featureNames: ['avgRet', 'vol20', 'rsi', 'macdHist', 'bollPos', 'kdjK'],
    accuracy: acc,
    diagnostics: { accuracy: (acc * 100).toFixed(1) + '%' }
  };
}

// ══════════════════════════════════════════════════════════════════
// 模型8: RL — 改用15维特征
// ══════════════════════════════════════════════════════════════════
async function trainRL_v2(db) {
  log('[RL_v2] 开始训练...');
  const data = loadStockData(db);
  if (!data) return { success: false, error: '无数据' };
  const { byCode, codes } = data;
  const X = [], Y = [];

  codes.forEach(code => {
    const bars = byCode.get(code);
    for (let i = 30; i < bars.length; i++) {
      const past = bars.slice(i - 30, i), future = bars[i];
      if (!future) return;
      X.push(extractFeatures(past, future));
      Y.push(future.change_percent > 0 ? 1 : 0);
    }
  });

  if (X.length < 100) return { success: false, error: `样本不足(${X.length})` };
  log(`[RL_v2] 样本: ${X.length}`);

  const nFeat = X[0].length;
  const featMeans = X[0].map((_, j) => mean(X.map(r => r[j])));
  const featStds = X[0].map((_, j) => std(X.map(r => r[j])) || 1);
  const Xnorm = X.map(row => row.map((v, j) => (v - featMeans[j]) / featStds[j]));
  const MAX = 15000;
  let Xr = Xnorm, Yr = Y;
  if (Xnorm.length > MAX) {
    const idx = shuffle([...Array(Xnorm.length).keys()]).slice(0, MAX).sort((a, b) => a - b);
    Xr = idx.map(i => Xnorm[i]); Yr = idx.map(i => Y[i]);
    log(`[RL_v2] 下采样: ${MAX}/${Xnorm.length}`);
  }

  // Q-learning: 直接用15维特征预测Q值
  const stateSize = 6, actionSize = 2, hiddenSize = 12, lr = 0.01, gamma = 0.9, epsilon = 0.1, episodes = 60;
  const initW = (r, c) => Array.from({ length: r }, () => Array.from({ length: c }, () => (Math.random() - 0.5) * 0.3));
  const featIdx = [0, 1, 5, 7, 8, 11]; // avgRet, vol20, rsi, bollPos, kdjK, mom5
  let W1 = initW(stateSize, hiddenSize), b1 = new Array(hiddenSize).fill(0);
  let W2 = initW(hiddenSize, actionSize), b2 = new Array(actionSize).fill(0);
  const relu = z => Math.max(0, z);

  for (let ep = 0; ep < episodes; ep++) {
    for (let i = 0; i < Xr.length; i++) {
      const x = featIdx.map(fi => Xr[i][fi]);
      const hidden = W1[0].map((_, j) => relu(W1.reduce((s, row, ri) => s + row[j] * x[ri], 0) + b1[j]));
      const Q = b2.map((b, a) => b + W2.reduce((s, row, j) => s + row[a] * hidden[j], 0));
      const action = Math.random() < epsilon ? Math.floor(Math.random() * actionSize) : Q.indexOf(Math.max(...Q));
      const reward = (action === 0 && Yr[i] === 1) ? 1 : (action === 1 && Yr[i] === 0) ? 0.8 : 0;
      const target = reward + gamma * (actionSize === 2 ? (1 - action) * Math.max(...Q) : Math.max(...Q));
      const tdErr = target - Q[action];
      for (let j = 0; j < hiddenSize; j++) W2[j][action] -= lr * tdErr * hidden[j];
      for (let j = 0; j < hiddenSize; j++) b2[action] -= lr * tdErr;
      for (let k = 0; k < stateSize; k++) W1[k] = W1[k].map(w => w - lr * tdErr * (W2.reduce((s, row) => s + row[action] * hidden[W2.indexOf(row)], 0) / hiddenSize) * x[k]);
      for (let j = 0; j < hiddenSize; j++) b1[j] -= lr * tdErr * (W2.reduce((s, row) => s + row[action] * hidden[W2.indexOf(row)], 0) / hiddenSize);
    }
    if ((ep + 1) % 20 === 0) {
      const predsCls = Xr.map(x => {
        const xsel = featIdx.map(fi => x[fi]);
        const h = W1[0].map((_, j) => relu(W1.reduce((s, row, ri) => s + row[j] * xsel[ri], 0) + b1[j]));
        const Q = b2.map((b, a) => b + W2.reduce((s, row, j) => s + row[a] * h[j], 0));
        return Q[0] > Q[1] ? 1 : 0;
      });
      const acc = predsCls.filter((p, i) => p === Yr[i]).length / Yr.length;
      log(`[RL_v2] epoch ${ep + 1}/${episodes} acc=${acc.toFixed(3)}`);
    }
  }

  const predsCls = Xr.map(x => {
    const xsel = featIdx.map(fi => x[fi]);
    const h = W1[0].map((_, j) => relu(W1.reduce((s, row, ri) => s + row[j] * xsel[ri], 0) + b1[j]));
    const Q = b2.map((b, a) => b + W2.reduce((s, row, j) => s + row[a] * h[j], 0));
    return Q[0] > Q[1] ? 1 : 0;
  });
  const acc = predsCls.filter((p, i) => p === Yr[i]).length / Yr.length;
  log(`[RL_v2] 完成! accuracy=${acc.toFixed(4)}`);
  return {
    success: true, modelId: 'rl', modelName: 'RL_v2',
    trained_at: bjISO(),
    expires_at: new Date(Date.now() + 30 * 864e5 + 8 * 3600000).toISOString().replace('Z', '+08:00'),
    sample_count: Xr.length,
    params: { W1, b1, W2, b2, featMeans, featStds, featIdx },
    featureNames: ['avgRet', 'vol20', 'rsi', 'bollPos', 'kdjK', 'mom5'],
    accuracy: acc,
    diagnostics: { accuracy: (acc * 100).toFixed(1) + '%' }
  };
}

// ── 保存模型到DB ────────────────────────────────────────────────
function saveModel(db, result) {
  if (!result.success) { log(`[SAVE] ${result.modelId} 失败: ${result.error}`); return false; }
  try {
    const data = JSON.stringify(result);
    db.prepare(`INSERT OR REPLACE INTO ai_ml_model (id, data) VALUES (?, ?)`).run(result.modelId, data);
    log(`[SAVE] ${result.modelId} 已保存! accuracy=${result.accuracy?.toFixed(4)}`);
    return true;
  } catch(e) { log(`[SAVE] ${result.modelId} 失败: ${e.message}`); return false; }
}

// ── 主入口 ──────────────────────────────────────────────────────
async function main() {
  require('fs').appendFileSync(LOG_FILE, '\n=== ' + new Date().toISOString() + ' 重新训练8个模型 ===\n');
  const db = new Database(DB_PATH);
  const target = process.argv[2] || 'all';

  const tasks = {
    lightgbm:    () => trainLightGBM_v2(db),
    transformer: () => trainTransformer_v2(db),
    autoencoder: () => trainAutoencoder_v2(db),
    lstm:        () => trainLSTM_v2(db, 'lstm'),
    gru:         () => trainLSTM_v2(db, 'gru'),
    bayesian:    () => trainBayesian_v2(db),
    arima:       () => trainARIMA_v2(db),
    rl:          () => trainRL_v2(db),
  };

  if (target !== 'all' && tasks[target]) {
    const result = await tasks[target]();
    saveModel(db, result);
  } else {
    const order = ['lightgbm', 'transformer', 'autoencoder', 'lstm', 'gru', 'bayesian', 'arima', 'rl'];
    for (const id of order) {
      log(`\n=== 训练 ${id} ===`);
      const result = await tasks[id]();
      saveModel(db, result);
    }
  }

  db.close();
  log('=== 全部训练完成 ===');
}

main().catch(e => { console.error(e); process.exit(1); });