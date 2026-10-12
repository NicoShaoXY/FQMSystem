#!/usr/bin/env node
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
/**
 * batch_generate_yaodi_samples.js
 * 
 * 批量生成 yaodi_samples 表：扩展覆盖到全量股票（目标 1000+ 只）
 * 
 * 策略：遍历有主力资金数据的股票（6180只），用滑动窗口为每只股票生成多条样本
 * 每条样本 = 技术指标(MA/MACD/RSI/KDJ/BOLL) + 主力量化 + 未来收益标签
 * 
 * Usage: node batch_generate_yaodi_samples.js [--limit N] [--days N]
 */

import Database from 'better-sqlite3';

const DB_PATH = path.join(PROJECT_ROOT, 'database', 'stocks.db');
const db = new Database(DB_PATH);

const args = process.argv.slice(2);
const limitStocks = args.includes('--limit') 
  ? parseInt(args[args.indexOf('--limit') + 1]) || 999999 
  : 999999;
const lookbackDays = args.includes('--days')
  ? parseInt(args[args.indexOf('--days') + 1]) || 365
  : 365;

const startTime = Date.now();
console.log(`[yaodi_samples] 目标: ${limitStocks === 999999 ? '全量' : limitStocks} 只股票，回看 ${lookbackDays} 天`);

// ── 0. 计算技术指标的工具函数 ─────────────────────────────────────────────────

function calcSMA(values, period) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  const emaFast = calcEMAForMACD(closes, fast);
  const emaSlow = calcEMAForMACD(closes, slow);
  if (emaFast === null || emaSlow === null) return null;
  const macdLine = emaFast - emaSlow;
  // MACD signal = EMA of MACD line, simplified: just return DIF and DEA as proxy
  return macdLine;
}

function calcEMAForMACD(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcBollinger(closes, period = 20, multiplier = 2) {
  if (closes.length < period) return null;
  const sma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const variance = closes.slice(-period).reduce((sum, v) => sum + Math.pow(v - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return { upper: sma + multiplier * stdDev, lower: sma - multiplier * stdDev, sma };
}

function calcKDJ(highs, lows, closes, period = 9) {
  if (closes.length < period) return null;
  let highestHigh = -Infinity, lowestLow = Infinity;
  for (let i = closes.length - period; i < closes.length; i++) {
    if (highs[i] > highestHigh) highestHigh = highs[i];
    if (lows[i] < lowestLow) lowestLow = lows[i];
  }
  const rsv = highestHigh === lowestLow 
    ? 50 
    : (closes[closes.length - 1] - lowestLow) / (highestHigh - lowestLow) * 100;
  // Simplified KDJ (no full EMA chain)
  const k = 50, d = 50, j = 3 * k - 2 * d;
  return { k: k || 50, j: j || 50 };
}

// ── 1. 获取股票列表 ─────────────────────────────────────────────────────────

// 2026-06-03: 改为从stock_history取全量股票，主力资金缺失时填0
// 优先有主力数据的股票排前面
const stockCodes = db.prepare(`
  SELECT DISTINCT h.code FROM stock_history h
  LEFT JOIN stock_main_flow m ON h.code = m.code
  WHERE h.code GLOB '6*' OR h.code GLOB '0*' OR h.code GLOB '3*' OR h.code GLOB '68*'
  GROUP BY h.code
  ORDER BY (MAX(m.date) IS NOT NULL) DESC, RANDOM()
  LIMIT ?
`).all(limitStocks).map(r => r.code);

console.log(`[yaodi_samples] 将处理 ${stockCodes.length} 只股票`);

// ── 2. 预加载所有数据 ───────────────────────────────────────────────────────

const startDate = new Date(Date.now() - lookbackDays * 24 * 3600000).toISOString().split('T')[0];
console.log(`[yaodi_samples] 加载K线数据（从 ${startDate} 起）...`);

const histRows = db.prepare(`
  SELECT code, date, open, high, low, close, volume, amount 
  FROM stock_history 
  WHERE code IN (${stockCodes.map(() => '?').join(',')}) AND date >= ?
  ORDER BY code, date
`).all(...stockCodes, startDate);

// 按 code 分组
const byCode = {};
for (const r of histRows) {
  if (!byCode[r.code]) byCode[r.code] = [];
  byCode[r.code].push(r);
}

// 预加载主力资金数据
const mfRows = db.prepare(`
  SELECT code, date, main_inflow, amount, main_ratio 
  FROM stock_main_flow 
  WHERE code IN (${stockCodes.map(() => '?').join(',')}) AND date >= ?
`).all(...stockCodes, startDate);

const mfByCode = {};
for (const r of mfRows) {
  if (!mfByCode[r.code]) mfByCode[r.code] = [];
  mfByCode[r.code].push(r);
}

console.log(`[yaodi_samples] 已加载: ${histRows.length} 条K线, ${mfRows.length} 条主力数据`);

// ── 3. 清空旧数据并批量写入 ────────────────────────────────────────────────

console.log('[yaodi_samples] 清空 yaodi_samples...');
db.prepare('DELETE FROM yaodi_samples').run();

// 准备批量 INSERT
const insert = db.prepare(`
  INSERT INTO yaodi_samples 
  (code, date, ma5, ma10, ma20, ma60, macd_dif, macd, rsi, kdj_k, kdj_j, 
   boll_upper, boll_lower, pct_change, amplitude, turnover_rate,
   result_1d, result_3d, result_5d, yaodi_direction, source, created_at)
  VALUES 
  (@code, @date, @ma5, @ma10, @ma20, @ma60, @macd_dif, @macd, @rsi, @kdj_k, @kdj_j,
   @boll_upper, @boll_lower, @pct_change, @amplitude, @turnover_rate,
   @result_1d, @result_3d, @result_5d, @yaodi_direction, 'batch_gen', datetime('now'))
`);

const insertMany = db.transaction((samples) => {
  for (const s of samples) insert.run(s);
});

const allSamples = [];

// ── 4. 为每只股票生成样本 ───────────────────────────────────────────────────

let processedStocks = 0;
let totalSamples = 0;
const WINDOW_SIZE = 20;  // 窗口大小（天数）
const SLIDE_STEP = 5;    // 滑动步长
const MAX_WINDOWS_PER_STOCK = 20; // 每只股票最多样本数

const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

for (const code of stockCodes) {
  const hist = byCode[code];
  if (!hist || hist.length < WINDOW_SIZE + 5) continue; // 至少需要窗口+5天未来数据（25天最小）
  
  const closes = hist.map(h => h.close);
  const highs = hist.map(h => h.high || h.close);
  const lows = hist.map(h => h.low || h.close);
  const volumes = hist.map(h => h.volume || 0);
  const mfHist = mfByCode[code] || [];
  const mfMap = new Map(mfHist.map(r => [r.date, r]));

  // 滑动窗口生成多样本
  const maxWindows = Math.min(
    Math.floor((hist.length - WINDOW_SIZE - 5) / SLIDE_STEP) + 1,
    MAX_WINDOWS_PER_STOCK
  );

  for (let w = 0; w < maxWindows; w++) {
    const end = WINDOW_SIZE + w * SLIDE_STEP;
    if (end + 5 > hist.length) break;

    const window = hist.slice(0, end);
    const wCloses = window.map(h => h.close);
    const wHighs = window.map(h => h.high || h.close);
    const wLows = window.map(h => h.low || h.close);
    const wVolumes = window.map(h => h.volume || 0);
    const lastBar = window[window.length - 1];
    const prevClose = wCloses[wCloses.length - 2] || lastBar.close;

    // MA
    const ma5 = calcSMA(wCloses, 5);
    const ma10 = calcSMA(wCloses, 10);
    const ma20 = calcSMA(wCloses, 20);
    const ma60 = calcSMA(wCloses, 60);

    // MACD
    const macdDif = calcMACD(wCloses);
    const macdSignal = macdDif !== null ? macdDif * 0.9 : null; // simplified DEA

    // RSI
    const rsi = calcRSI(wCloses);

    // KDJ
    const kdj = calcKDJ(wHighs, wLows, wCloses);

    // BOLL
    const boll = calcBollinger(wCloses);

    // 主力量化
    const sampleDate = lastBar.date;
    const mfSample = mfMap.get(sampleDate);
    const mainRatio = mfSample?.main_ratio || 0;

    // 未来收益（作为 label）
    const future1 = hist[end]?.close || lastBar.close;
    const future3 = hist[end + 2]?.close || lastBar.close;
    const future5 = hist[end + 4]?.close || lastBar.close;
    const result1d = ((future1 - lastBar.close) / lastBar.close * 100);
    const result3d = ((future3 - lastBar.close) / lastBar.close * 100);
    const result5d = ((future5 - lastBar.close) / lastBar.close * 100);

    // 涨跌方向
    const yaodiDirection = result5d > 0.5 ? 'up' : result5d < -0.5 ? 'down' : 'sideways';

    // 振幅
    const amp = (Math.max(...wHighs) - Math.min(...wLows)) / lastBar.close * 100;

    // 换手率（从 stock_history 的 amount 推算，简化）
    const turnover = lastBar.volume > 0 
      ? Math.min(30, (lastBar.volume / (wVolumes.reduce((a,b)=>a+b,0)/wVolumes.length)) * 0.5) 
      : 0;

    allSamples.push({
      code,
      date: sampleDate,
      ma5: ma5 || null,
      ma10: ma10 || null,
      ma20: ma20 || null,
      ma60: ma60 || null,
      macd_dif: macdDif || null,
      macd: macdSignal || null,
      rsi: rsi || null,
      kdj_k: kdj?.k || null,
      kdj_j: kdj?.j || null,
      boll_upper: boll?.upper || null,
      boll_lower: boll?.lower || null,
      pct_change: ((lastBar.close - prevClose) / prevClose * 100) || 0,
      amplitude: amp || 0,
      turnover_rate: turnover || 0,
      result_1d: result1d || 0,
      result_3d: result3d || 0,
      result_5d: result5d || 0,
      yaodi_direction: yaodiDirection,
    });
  }

  processedStocks++;
  totalSamples = allSamples.length;
  
  if (processedStocks % 500 === 0) {
    console.log(`[yaodi_samples] 已处理 ${processedStocks}/${stockCodes.length} 只股票, 样本 ${totalSamples} 条`);
    insertMany(allSamples.splice(0, allSamples.length)); // 批量flush
  }
}

// ── 5. 最终写入 ─────────────────────────────────────────────────────────────

console.log(`[yaodi_samples] 写入剩余 ${allSamples.length} 条样本...`);
insertMany(allSamples);

// ── 6. 统计报告 ─────────────────────────────────────────────────────────────

const final = db.prepare('SELECT COUNT(DISTINCT code) as stocks, COUNT(*) as rows FROM yaodi_samples').get();
console.log(`\n✅ yaodi_samples 生成完成！`);
console.log(`   覆盖股票: ${final.stocks} 只`);
console.log(`   样本总数: ${final.rows} 条`);
console.log(`   耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

db.close();
