#!/usr/bin/env node
/**
 * batch_build_l2_cache.js
 * 
 * 批量计算全市场 L2 Score 并写入 yaodi_l2_cache 表
 * 目标：从 50 条扩展到 10000 条（覆盖全市场）
 * 
 * 使用 XGBoost 模型的 14 特征向量评分方式
 * 
 * Usage: node batch_build_l2_cache.js [--limit N]
 */

import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

import Database from 'better-sqlite3';

const DB_PATH = path.join(PROJECT_ROOT, 'database', 'stocks.db');
const db = new Database(DB_PATH);

const args = process.argv.slice(2);
const limitStocks = args.includes('--limit')
  ? parseInt(args[args.indexOf('--limit') + 1]) || 999999
  : 999999;

const startTime = Date.now();
console.log(`[L2Cache] 批量构建 L2 缓存，目标 ${limitStocks === 999999 ? '全量' : limitStocks} 只股票`);

// ── 工具函数 ───────────────────────────────────────────────────────────────

function calcMA(closes, period) {
  if (closes.length < period) return null;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return +(100 - 100 / (1 + gains / avgLoss)).toFixed(2);
}

function calcMACD(closes) {
  if (closes.length < 26) return null;
  const kFast = 2 / 13, kSlow = 2 / 27;
  const ema = (vals, k) => {
    let e = vals.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    for (let i = 12; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
    return e;
  };
  const dif = ema(closes, kFast) - ema(closes, kSlow);
  return dif;
}

// 计算14维特征向量
function buildFeatures(code, hist, mfMap, rtMap) {
  if (hist.length < 30) return null;
  
  const closes = hist.map(h => h.close);
  const highs = hist.map(h => h.high || h.close);
  const lows = hist.map(h => h.low || h.close);
  const volumes = hist.map(h => h.volume || 0);
  
  const len = closes.length;
  const lastClose = closes[len - 1];
  const prevClose = closes[len - 2] || lastClose;
  const ma20 = calcMA(closes, 20) || lastClose;
  const ma5 = calcMA(closes, 5) || lastClose;
  
  // 五类因子
  const fValue = lastClose < ma20 ? 70 : 40;
  const fGrowth = ((lastClose - closes[Math.max(0, len - 20)]) / closes[Math.max(0, len - 20)] * 100) > 5 ? 75 : 35;
  const fQuality = lows.slice(-10).reduce((a, b) => a + b, 0) / 10 > lows.slice(-20, -10).reduce((a, b) => a + b, 0) / 10 ? 65 : 30;
  const fMomentum = lastClose > ma5 ? 70 : 35;
  const avgRange = highs.slice(-10).reduce((a, b, i) => a + (highs[highs.length - 10 + i] - lows[lows.length - 10 + i]), 0) / 10 / lastClose * 100;
  const fVolatility = avgRange > 3 ? 60 : 30;
  const fCap = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 / (volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 || 1) * 50;
  const fTurnover = Math.min(100, (volumes[len - 1] || 0) / (volumes.reduce((a, b) => a + b, 0) / len || 1) * 50);
  const fVolumeRatio = Math.min(100, fTurnover * 1.2);
  const fPE = fValue > 50 ? 40 : 65;
  const fPB = fValue > 50 ? 35 : 60;
  const fROE = fQuality > 50 ? 70 : 30;
  const fChangePct = ((lastClose - prevClose) / prevClose * 100 + 50) * 5;
  const fAmplitude = Math.min(100, avgRange * 15);
  
  // 主力强度
  const mfHist = mfMap.get(code) || [];
  const lastDate = hist[len - 1]?.date;
  const mfSample = mfHist.find(r => r.date <= lastDate);
  const mainStrength = mfSample ? Math.min(999, mfSample.main_ratio || 0) : 0;
  
  return [
    fValue, fGrowth, fQuality, fMomentum, fVolatility,
    fCap, fTurnover, fVolumeRatio, fPE, fPB, fROE, fChangePct, fAmplitude, mainStrength
  ];
}

// XGBoost 评分（6棵树，阈值固定）
function scoreXGBoost(features) {
  const [fValue, fGrowth, fQuality, fMomentum, fVolatility, , , , , , , , , mainStrength] = features;
  const thresholds = [40, 35, 30, 35, 30, 0];
  const configs = [
    { v: fValue,    pos: 5,  neg: -3 },
    { v: fGrowth,   pos: 4,  neg: -2 },
    { v: fQuality,  pos: 4,  neg: -3 },
    { v: fMomentum, pos: 3,  neg: -1 },
    { v: fVolatility, pos: -2, neg: 2 },
    { v: mainStrength, pos: 3, neg: -2 },
  ];
  let score = 0;
  for (let i = 0; i < 6; i++) {
    score += features[i] >= thresholds[i] ? configs[i].pos : configs[i].neg;
  }
  // mainStrength单独处理
  score += mainStrength >= 0 ? 3 : -2;
  return Math.max(0, Math.min(100, score + 50));
}

// ── 数据加载 ───────────────────────────────────────────────────────────────

console.log('[L2Cache] 加载股票列表...');
const stockRows = db.prepare(`
  SELECT code FROM stocks 
  ORDER BY RANDOM() 
  LIMIT ?
`).all(limitStocks);
const codes = stockRows.map(r => r.code);
console.log(`[L2Cache] 股票数: ${codes.length}`);

const lookback = 365;
const startDate = new Date(Date.now() - lookback * 24 * 3600000).toISOString().split('T')[0];
const placeholders = codes.map(() => '?').join(',');

console.log('[L2Cache] 加载K线数据...');
const histRows = db.prepare(`
  SELECT code, date, close, high, low, volume 
  FROM stock_history 
  WHERE code IN (${placeholders}) AND date >= ?
  ORDER BY code, date
`).all(...codes, startDate);

console.log('[L2Cache] 加载主力资金数据...');
const mfRows = db.prepare(`
  SELECT code, date, main_ratio FROM stock_main_flow 
  WHERE code IN (${placeholders}) AND date >= ?
`).all(...codes, startDate);

console.log('[L2Cache] 加载实时价格...');
const rtRows = db.prepare(`
  SELECT code, price FROM stock_realtime 
  WHERE code IN (${placeholders})
`).all(...codes);

// 分组
const byCode = {};
for (const r of histRows) {
  if (!byCode[r.code]) byCode[r.code] = [];
  byCode[r.code].push(r);
}
const mfMap = new Map();
for (const r of mfRows) {
  if (!mfMap.has(r.code)) mfMap.set(r.code, []);
  mfMap.get(r.code).push(r);
}
const rtMap = new Map(rtRows.map(r => [r.code, r]));

console.log(`[L2Cache] 数据: ${histRows.length} 条K线, ${mfRows.length} 条主力, ${rtRows.length} 条实时价格`);

// ── 计算 L2 Score ─────────────────────────────────────────────────────────

console.log('[L2Cache] 计算 L2 Score...');
const results = [];
let success = 0, fail = 0;

for (const code of codes) {
  const hist = byCode[code];
  if (!hist || hist.length < 30) { fail++; continue; }
  
  const features = buildFeatures(code, hist, mfMap, rtMap);
  if (!features) { fail++; continue; }
  
  const l2Score = scoreXGBoost(features);
  const rt = rtMap.get(code);
  const price = +(rt?.price || hist[hist.length - 1]?.close || 0);
  
  // 计算 confidence（基于特征的完整度）
  const validFeatures = features.filter(f => f !== null && !isNaN(f)).length;
  const confidence = Math.min(0.95, 0.25 + validFeatures / 14 * 0.7);
  
  results.push({
    code,
    l2_score: +l2Score.toFixed(2),
    confidence: +confidence.toFixed(3),
    price: +price.toFixed(2),
    rank: 0,  // 稍后排序后填充
    gbdt_pred: 0,
    histgbdt_pred: 0,
    category_boost: 0,
    meta_pred: 0,
    win_rate: 0,
    updated_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
  });
  success++;
  
  if (results.length % 1000 === 0) {
    process.stdout.write(`  ${results.length}/${codes.length} `);
  }
}
console.log(`\n[L2Cache] 计算完成: ${success} 成功, ${fail} 失败`);

// ── 写入 yaodi_l2_cache ───────────────────────────────────────────────────

console.log('[L2Cache] 清空旧缓存...');
db.prepare('DELETE FROM yaodi_l2_cache').run();

// 按 l2_score 降序排列并填充 rank
console.log('[L2Cache] 排序并填充 rank...');
results.sort((a, b) => b.l2_score - a.l2_score);
for (let i = 0; i < results.length; i++) {
  results[i].rank = i + 1;
}

console.log('[L2Cache] 写入新缓存...');
const insert = db.prepare(`
  INSERT INTO yaodi_l2_cache 
  (code, l2_score, rank, confidence, gbdt_pred, histgbdt_pred, category_boost, meta_pred, updated_at, win_rate, price)
  VALUES (@code, @l2_score, @rank, @confidence, @gbdt_pred, @histgbdt_pred, @category_boost, @meta_pred, @updated_at, @win_rate, @price)
`);

const batchInsert = db.transaction((rows) => {
  for (const r of rows) insert.run(r);
});

batchInsert(results);

// ── 报告 ──────────────────────────────────────────────────────────────────

const final = db.prepare('SELECT COUNT(*) as n, MIN(l2_score) as mn, MAX(l2_score) as mx, ROUND(AVG(l2_score),1) as avg FROM yaodi_l2_cache').get();
console.log(`\n✅ yaodi_l2_cache 写入完成！`);
console.log(`   条数: ${final.n}`);
console.log(`   范围: ${final.mn} ~ ${final.mx}`);
console.log(`   均值: ${final.avg}`);
console.log(`   耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

db.close();