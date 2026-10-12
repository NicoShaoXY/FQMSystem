// ml_models.mjs — 机器学习模型算法库（ESM版）
// 支持 Python 桥接训练（XGBoost/LightGBM/sklearn）
import { bjISO } from './beijingTime.js';
import { checkCpuAndYield, shouldYield } from './auto_train_config.js';
import { AsyncResource } from 'async_hooks';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PYTHON_TRAIN_SCRIPT = join(__dirname, 'ml_python_train.py');
const PYTHON_PATH = '/usr/local/bin/python3.11'; // 用户已安装 Python 3.11.0

// ── 数据库实例（懒加载）──────────────────────────────────────────
let _db = null;
function getDB() {
  if (!_db) {
    // 【P0修复】使用 PROJECT_ROOT 环境变量或动态计算路径
    const projectRoot = process.env.PROJECT_ROOT || process.cwd();
    const dbPath = join(projectRoot, 'database', 'stocks.db');
    console.log('[ML Models] DB路径:', dbPath);
    _db = new Database(dbPath, { readonly: true });
  }
  return _db;
}

// ── 批量查询主力资金数据（优化性能）──────────────────────────────
function batchGetMainFlowData(codes, days = 10, extDb = null) {
  try {
    const db = extDb || getDB();
    const placeholders = codes.map(() => '?').join(',');
    
    // 联合查询主力资金 + 历史成交额，用于估算主力占比
    const sql = `
      SELECT mf.code, mf.date, mf.main_inflow, mf.main_ratio, mf.super_inflow, mf.retail_inflow,
             sh.amount as turnover
      FROM stock_main_flow mf
      LEFT JOIN stock_history sh ON mf.code = sh.code AND mf.date = sh.date
      WHERE mf.code IN (${placeholders})
      ORDER BY mf.code, mf.date DESC
    `;
    const rows = db.prepare(sql).all(...codes);
    
    // 按股票代码分组，并估算主力占比
    const mainFlowMap = new Map();
    rows.forEach(row => {
      if (!mainFlowMap.has(row.code)) {
        mainFlowMap.set(row.code, []);
      }
      if (mainFlowMap.get(row.code).length < days) {
        // 如果 main_ratio 为 0 或 null，用成交额估算
        let ratio = row.main_ratio;
        if ((!ratio || ratio === 0) && row.turnover > 0 && row.main_inflow) {
          ratio = (row.main_inflow / row.turnover) * 100;  // 转为百分比
        }
        mainFlowMap.get(row.code).push({
          ...row,
          main_ratio: ratio || 0
        });
      }
    });
    
    return mainFlowMap;
  } catch (e) {
    console.error('[MainFlow] 批量查询失败:', e.message);
    return new Map();
  }
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function std(arr) { if (arr.length < 2) return 1; const m = mean(arr); return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1)); }
function zscore(arr) { const m = mean(arr), s = std(arr); return arr.map(x => s < 1e-10 ? 0 : (x - m) / s); }
function minmax(arr) { const min = Math.min(...arr), max = Math.max(...arr); const range = max - min; return range < 1e-10 ? arr.map(() => 0.5) : arr.map(x => (x - min) / range); }
function pearson(arr1, arr2) { if (arr1.length !== arr2.length || arr1.length < 3) return 0; const m1 = mean(arr1), m2 = mean(arr2), s1 = std(arr1), s2 = std(arr2); if (s1 < 1e-10 || s2 < 1e-10) return 0; return arr1.reduce((sum, x, i) => sum + (x - m1) * (arr2[i] - m2), 0) / ((arr1.length - 1) * s1 * s2); }
function linearRegression(xs, ys) { if (xs.length !== ys.length || xs.length < 3) return { a: 0, b: mean(ys) }; const xm = mean(xs), ym = mean(ys); const ssxx = xs.reduce((s, x) => s + (x - xm) ** 2, 0); if (ssxx < 1e-10) return { a: 0, b: ym }; const sxy = xs.reduce((s, x, i) => s + (x - xm) * (ys[i] - ym), 0); const a = sxy / ssxx; return { a, b: ym - a * xm }; }
function rmse(pred, actual) { return Math.sqrt(mean(pred.map((p, i) => (p - actual[i]) ** 2))); }
function mae(pred, actual) { return mean(pred.map((p, i) => Math.abs(p - actual[i]))); }
function r2score(pred, actual) { const ssRes = pred.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0); const ssTot = actual.reduce((s, y) => s + (y - mean(actual)) ** 2, 0); return ssTot < 1e-10 ? 0 : 1 - ssRes / ssTot; }

// ── 统一20维特征集（所有基于特征的模型共用）─────────────────────────
// 删除5个死特征: northFlow/marginChange/floatRatio/limitDist/limitDownDist
const UNIFIED_FEATURE_NAMES = [
  // 【Phase5进化 2026-07-07】特征工程重构 - 新增6个有效特征
  // 总计20维核心特征：
  
  // === 基础收益特征 (3维) ===
  'avgReturn', 'returnVol', 'lastChange',
  
  // === 量价特征 (6维) ===
  'volRatio', 'rsi', 'macdHist', 'volSpike',
  'obv',          // 【新增】OBV能量潮
  'vwapDev',      // 【新增】VWAP偏离度
  
  // === 波动特征 (3维) ===
  'atr',          // 【新增】ATR真实波幅
  'volatility',   // 【新增】历史波动率
  'williamR',     // 【新增】威廉指标
  
  // === 动量趋势 (4维) ===
  'mom5', 'industry', 'mainStrength', 'turnover',
  
  // === 交互特征 (4维) ===
  'momentumStrength',    // 动量×资金
  'volumePriceAlign',    // 放量×动量
  'industryMomentum',    // 行业×动量
  'volatilityMomentum'   // 【新增】波动×动量
];

function buildUnifiedFeatures(past, code, mainFlowData = null, northboundData = null) {
  const prices = past.map(b => b.close).reverse();
  const highs = past.map(b => b.high).reverse();
  const lows = past.map(b => b.low).reverse();
  const volumes = past.map(b => b.volume || 1);
  const avgVol = mean(volumes);
  const returns = past.slice(-10).map((b, idx) => idx > 0 ? (b.close - past[past.length - 10 + idx - 1].close) / past[past.length - 10 + idx - 1].close : 0);
  const lastChg = past[past.length - 1].change_percent / 100;
  const volProxy = avgVol > 0 ? volumes[volumes.length - 1] / avgVol : 1;
  const rsi = calcRSI(prices, 14) / 100;
  const macd = calcMACD(prices);
  const macdCross = calcMACDCross(prices);
  const boll = calcBOLL(prices, 20);
  const kdj = calcKDJ(highs, lows, prices, 9);
  const volSpike = calcVolumeSpike(volumes) / 5;
  const [mom5, mom10, mom20] = calcMultiMom(prices).map(v => Math.max(-0.2, Math.min(0.2, v)) / 0.2);
  const industryFactor = calcIndustryFactor(code);
  
  // ── 【Phase5新增特征】OBV能量潮 ──
  const obv = calcOBV(prices, volumes);
  
  // ── 【Phase5新增特征】VWAP偏离度 ──
  const vwapDev = calcVWAPDev(prices, volumes);
  
  // ── 【Phase5新增特征】ATR真实波幅 ──
  const atr = calcATRFeature(highs, lows, prices);
  
  // ── 【Phase5新增特征】历史波动率 ──
  const volatility = calcVolatility(returns);
  
  // ── 【Phase5新增特征】威廉指标 ──
  const williamR = calcWilliamR(highs, lows, prices);
  
  // ── 主力资金强度（真实数据优先）─────────────────────────────
  let mainStrength;
  if (mainFlowData && mainFlowData.length > 0) {
    // 使用真实主力资金数据：最近5日主力净占比平均值
    const recentRatios = mainFlowData.slice(0, 5).map(d => d.main_ratio || 0);
    const avgRatio = mean(recentRatios);
    mainStrength = Math.max(-1, Math.min(1, avgRatio / 100)); // 标准化到 [-1, 1]
  } else {
    // 回退到成交量代理（无真实数据时）
    mainStrength = volProxy > 1.5 ? 0.5 : volProxy < 0.5 ? -0.5 : (volProxy - 1) * 1.0;
  }
  
  const sectorCorr = (industryFactor - 0.3) * 2;
  const vpDivergence = lastChg > 0 && volProxy < 1 ? -Math.min(0.5, 1 - volProxy) * 0.5
                     : lastChg < 0 && volProxy > 1 ? Math.min(0.5, volProxy - 1) * 0.5
                     : 0;
  const turnover = Math.min(1, Math.abs(volProxy - 1) * 2);
  const capFactor = Math.min(1, Math.log10(Math.max(1, past[past.length - 1].close)) / 5);
  
  // ─── 北向持股特征（Phase 2）────────────────────────────
  let northboundRatio = 0;
  let northboundChange = 0;
  let northboundMarketValue = 0;
  if (northboundData && northboundData.has(code)) {
    const nb = northboundData.get(code);
    northboundRatio = Math.max(0, Math.min(1, (nb.holdRatio || 0) / 100)); // 标准化到 [0, 1]
    northboundChange = Math.max(-1, Math.min(1, (nb.holdChange || 0) / 100000000)); // 标准化到 [-1, 1]（亿元）
    northboundMarketValue = Math.max(0, Math.min(1, (nb.holdMarketValue || 0) / 1000000000)); // 标准化到 [0, 1]（十亿元）
  }
  
  // 【特征交叉2026-06-09】3个交互特征
  const momentumStrength = mom5 * mainStrength;   // 动量×资金：强行业+强资金=双重确认
  const volumePriceAlign = volSpike * lastChg;    // 放量×动量：放量上涨=资金认可
  const industryMomentum = industryFactor * mom5; // 行业×动量：强行业热点

  // 【Phase5新增特征】交互特征
  const volatilityMomentum = volatility * mom5; // 波动×动量：高波动+强动量=趋势确认
  
  // 【降维2026-06-09】14维核心特征（原11维 + 3个交互特征）
  // 【Phase5进化 2026-07-07】扩展到20维
  // 删除: range, bollPos, kdjK, macdCross, mom10, mom20, sectorCorr, vpDivergence, capFactor
  return [
    mean(returns),                           // avgReturn
    std(returns) || 0.001,                   // returnVol
    lastChg,                                 // lastChange
    volProxy,                                // volRatio
    rsi,                                     // rsi
    macd.hist / 100,                         // macdHist
    volSpike,                                // volSpike
    obv,                                     // 【Phase5新增】OBV能量潮
    vwapDev,                                 // 【Phase5新增】VWAP偏离度
    atr,                                     // 【Phase5新增】ATR真实波幅
    volatility,                              // 【Phase5新增】历史波动率
    williamR,                                // 【Phase5新增】威廉指标
    mom5,                                    // mom5
    industryFactor,                          // industry
    mainStrength,                            // mainStrength
    turnover,                                // turnover
    momentumStrength,                        // 动量×资金
    volumePriceAlign,                        // 放量×动量
    industryMomentum,                        // 行业×动量
    volatilityMomentum                       // 【Phase5新增】波动×动量
  ];
}

// ── 自适应百分位阈值搜索（改进分裂策略）─────────────
// 替代固定阈值[0.2,0.4,0.6,0.8]或单一均值，使用数据驱动的百分位点
function percentileThresholds(featVals, percs = [10, 25, 40, 50, 60, 75, 90]) {
  const sorted = [...featVals].sort((a, b) => a - b);
  const n = sorted.length;
  if (n < 20) return [mean(sorted)]; // 样本太少时退化为均值
  const thresholds = new Set();
  for (const p of percs) {
    const idx = Math.min(Math.floor((p / 100) * n), n - 1);
    thresholds.add(sorted[idx]);
  }
  return [...thresholds].filter(t => isFinite(t));
}

// ── Newton二阶增益（XGBoost风格）─────────────
// 用梯度和海森矩阵计算最优分裂，比一阶梯度更精确
function newtonLeafValue(residuals, probs) {
  // 对于logistic loss: gradient = (p - y), hessian = p*(1-p)
  // leaf_value = -sum(gradients) / (sum(hessians) + lambda)
  const lambda = 1.0; // L2正则化
  let sumG = 0, sumH = 0;
  for (let i = 0; i < residuals.length; i++) {
    sumG -= residuals[i]; // -gradient = y - p
    sumH += probs[i] * (1 - probs[i]); // hessian
  }
  return sumG / (sumH + lambda);
}
// ── 可复现随机数生成器（用于训练检查点恢复）────────────
let _rngState = Date.now(); // 当前随机种子
let _rngCalls = 0; // 已调用次数

function rng() {
  // 线性同余生成器 (LCG)
  _rngState = (_rngState * 1664525 + 1013904223) & 0xffffffff;
  _rngCalls++;
  return (_rngState >>> 0) / 0xffffffff;
}

function rngSeed(seed) { _rngState = seed >>> 0; _rngCalls = 0; }
function rngReset(calls) { /* 不支持回退，仅用于记录 */ }
function rngGetState() { return { seed: _rngState >>> 0, calls: _rngCalls }; }

// ── Python 训练桥接函数 ──────────────────────────────────────────────────
// 调用 ml_python_train.py 执行训练，返回 JS 兼容的模型参数
// 【修复】改用临时文件传数据，避免 stdin 管道死锁（50MB JSON 会卡死）
async function trainWithPython(modelName, X, Y, featureNames) {
  const nSamples = X.length;
  const nFeatures = X[0]?.length || 15;
  console.log(`[Python-Train] ${modelName}: ${nSamples}样本, ${nFeatures}维特征`);
  
  // 写入临时文件（避免 stdin 管道死锁）
  const tmpFile = `/tmp/fqm_train_${modelName}_${process.pid}_${Date.now()}.json`;
  const payload = JSON.stringify({ model: modelName, X, Y, feature_names: featureNames });
  writeFileSync(tmpFile, payload);
  console.log(`[Python-Train] 数据已写入临时文件: ${(payload.length/1024/1024).toFixed(1)}MB`);
  
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_PATH, [PYTHON_TRAIN_SCRIPT, '--file', tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    
    let stdout = '', stderr = '', timeout = false;
    const timer = setTimeout(() => {
      timeout = true;
      proc.kill();
      try { unlinkSync(tmpFile); } catch {}
      reject(new Error('Python训练超时(10分钟)'));
    }, 600000);
    
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    
    proc.on('close', (code) => {
      clearTimeout(timer);
      try { unlinkSync(tmpFile); } catch {}
      if (timeout) return;
      if (code !== 0) {
        console.error(`[Python-Train] ${modelName} 失败(code=${code}):`, stderr.slice(0, 500));
        reject(new Error(stderr || 'Python训练失败'));
        return;
      }
      try {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines.filter(l => l.startsWith('{')).pop() || stdout.trim();
        const result = JSON.parse(jsonLine);
        if (!result.success) {
          reject(new Error(result.error || 'Python训练返回失败'));
          return;
        }
        console.log(`[Python-Train] ${modelName} 成功: acc=${(result.accuracy*100).toFixed(1)}% (${result.trainAcc?.toFixed(1)||'-'}/${result.testAcc?.toFixed(1)||'-'}), nFeat=${nFeatures}`);
        resolve(result);
      } catch(e) {
        console.error(`[Python-Train] JSON解析失败:`, stdout.slice(0,200), stderr.slice(0,200));
        reject(new Error('Python返回非JSON: ' + stdout.slice(0,100)));
      }
    });
    
    proc.on('error', (e) => {
      try { unlinkSync(tmpFile); } catch {}
      clearTimeout(timer);
      reject(new Error('Python进程启动失败: ' + e.message));
    });
  });
}

function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

// ── 检查点恢复工具 ──────────────────────────────────────────────────
// 从数据库恢复训练状态（供后端启动时调用）
function getCheckpointResumeState(db, modelId) {
  try {
    const cp = db.prepare(`SELECT * FROM ml_training_checkpoint WHERE model_id = ? AND status = 'in_progress'`).get(modelId);
    if (!cp) return null;
    return {
      checkpoint: cp,
      randomSeed: cp.random_seed || null,
      treesBuilt: cp.trees_built || 0,
      totalTrees: cp.total_trees || 0,
      progressPct: cp.progress_pct || 0,
      sampleCount: cp.sample_count || 0
    };
  } catch(e) { return null; }
}

// ── 技术指标计算函数 ──────────────────────────────────────────────────
function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[prices.length - i] - prices[prices.length - i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period || 0.001;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal) return { macd: 0, signal: 0, hist: 0 };
  const ema = (data, period) => {
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  };
  const emaFast = prices.map((_, i) => ema(prices.slice(0, i + 1), fast));
  const emaSlow = prices.map((_, i) => ema(prices.slice(0, i + 1), slow));
  const macdLine = emaFast.map((f, i) => f - emaSlow[i]);
  const signalLine = macdLine.map((_, i) => ema(macdLine.slice(0, i + 1), signal));
  const last = prices.length - 1;
  return {
    macd: macdLine[last] || 0,
    signal: signalLine[last] || 0,
    hist: (macdLine[last] - signalLine[last]) || 0
  };
}

// MACD金叉/死叉检测（新特征）
function calcMACDCross(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal + 5) return 0;
  const ema = (data, period) => {
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
    return ema;
  };
  // 计算最近N天的MACD线
  const lookback = Math.min(30, prices.length - 1);
  const macd历史 = [];
  for (let i = prices.length - lookback; i < prices.length; i++) {
    const fastEMA = ema(prices.slice(0, i + 1), fast);
    const slowEMA = ema(prices.slice(0, i + 1), slow);
    macd历史.push(fastEMA - slowEMA);
  }
  // 检测最近的金叉/死叉
  for (let i = macd历史.length - 2; i >= 0; i--) {
    const prev = macd历史[i], curr = macd历史[i + 1];
    if ((prev < 0 && curr >= 0) || (prev > 0 && curr <= 0)) {
      return curr > 0 ? 1 : -1; // 金叉=1，死叉=-1
    }
  }
  return 0; // 无交叉
}

// 成交量异动检测（新特征）
function calcVolumeSpike(volumes, period = 20) {
  if (!volumes || volumes.length < period) return 1;
  const avg = mean(volumes.slice(-period));
  const current = volumes[volumes.length - 1];
  return avg > 0 ? Math.min(5, current / avg) : 1; // 上限5倍
}

// 多时间窗口动量（新特征）
function calcMultiMom(prices, periods = [5, 10, 20]) {
  if (!prices || prices.length < 25) return periods.map(() => 0);
  return periods.map(p => {
    if (prices.length < p + 1) return 0;
    const past = prices[prices.length - p - 1];
    const current = prices[prices.length - 1];
    return past > 0 ? (current - past) / past : 0;
  });
}

// 行业因子（模拟）
function calcIndustryFactor(code) {
  if (!code) return 0;
  const prefix = code.charCodeAt(0);
  // 6=上海主板, 0=中小板, 3=创业板, 其他=北交所等
  if (prefix === 54) return 0.6; // 60xx 上证
  if (prefix === 48) return 0.3; // 00xx 中小板
  if (prefix === 51) return 0.4; // 30xx 创业板
  return 0.2; // 其他
}

function calcBOLL(prices, period = 20, multiplier = 2) {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0, position: 0.5 };
  const recentPrices = prices.slice(-period);
  const middle = mean(recentPrices);
  const stdDev = std(recentPrices);
  const upper = middle + multiplier * stdDev;
  const lower = middle - multiplier * stdDev;
  const current = prices[prices.length - 1];
  const position = upper > lower ? (current - lower) / (upper - lower) : 0.5;
  return { upper, middle, lower, position };
}

function calcKDJ(highs, lows, closes, period = 9) {
  if (highs.length < period) return { k: 50, d: 50, j: 50 };
  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);
  const currentClose = closes[closes.length - 1];
  const rsv = highestHigh > lowestLow ? (currentClose - lowestLow) / (highestHigh - lowestLow) * 100 : 50;
  const k = rsv; // 简化：使用当前 RSV 作为 K 值
  const d = k; // 简化
  const j = 3 * k - 2 * d;
  return { k, d, j };
}

// ── 【Phase5新增】OBV能量潮 ──
function calcOBV(prices, volumes) {
  if (prices.length < 2) return 0;
  let obv = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) {
      obv += volumes[i];
    } else if (prices[i] < prices[i - 1]) {
      obv -= volumes[i];
    }
  }
  // 标准化到 [-1, 1]
  const avgVol = mean(volumes);
  return avgVol > 0 ? Math.max(-1, Math.min(1, obv / (avgVol * prices.length))) : 0;
}

// ── 【Phase5新增】VWAP偏离度 ──
function calcVWAPDev(prices, volumes) {
  if (prices.length < 5) return 0;
  let sumPV = 0, sumV = 0;
  for (let i = 0; i < prices.length; i++) {
    sumPV += prices[i] * volumes[i];
    sumV += volumes[i];
  }
  const vwap = sumV > 0 ? sumPV / sumV : prices[prices.length - 1];
  const currentPrice = prices[prices.length - 1];
  // 偏离度标准化到 [-1, 1]
  return vwap > 0 ? Math.max(-1, Math.min(1, (currentPrice - vwap) / vwap * 10)) : 0;
}

// ── 【Phase5新增】ATR真实波幅 ──
function calcATRFeature(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return 0.02;
  const trueRanges = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }
  const atr = mean(trueRanges.slice(-period));
  const currentPrice = closes[closes.length - 1];
  // ATR占比标准化到 [0, 0.1]
  return currentPrice > 0 ? Math.min(0.1, atr / currentPrice) : 0.02;
}

// ── 【Phase5新增】历史波动率 ──
function calcVolatility(returns) {
  if (returns.length < 5) return 0.02;
  // 使用收益率标准差作为波动率
  const vol = std(returns) || 0.02;
  // 标准化到 [0, 0.2]
  return Math.min(0.2, Math.max(0, vol));
}

// ── 【Phase5新增】威廉指标 ──
function calcWilliamR(highs, lows, closes, period = 14) {
  if (closes.length < period) return -50;
  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);
  const currentClose = closes[closes.length - 1];
  
  if (highestHigh === lowestLow) return -50;
  
  // Williams %R = (Highest High - Close) / (Highest High - Lowest Low) * -100
  const williamR = ((highestHigh - currentClose) / (highestHigh - lowestLow)) * -100;
  // 标准化到 [-1, 1] (超卖=-1, 超买=0)
  return Math.max(-1, Math.min(0, williamR / 100));
}

// 获取主力资金强度（需要数据库查询）
async function getMainStrength(db, code, date) {
  try {
    const row = db.prepare(`
      SELECT strength_class, strength_percent FROM stock_main_flow 
      WHERE code = ? AND date = ?
    `).get(code, date);
    if (!row) return 0;
    const strengthMap = { '抢筹': 100, '建仓': 60, '洗盘': 0, '出货': -60 };
    return strengthMap[row.strength_class] || row.strength_percent || 0;
  } catch (e) {
    return 0;
  }
}

// ── 线性回归/逻辑回归 ────────────────────────────────────────────────
async function trainLinear(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 5000;  // 默认5000
  try {
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, volume, high, low, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 60) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, targetSampleCount);
    
    // ── 批量查询主力资金数据 ──────────────────────────────────────
    const mainFlowMap = batchGetMainFlowData(codes, 10, db);
    const northboundMap = batchGetNorthboundData(codes, 5, db);
    console.log('[Northbound] 已加载 ' + northboundMap.size + '/' + codes.length + ' 只股票的北向持股数据');
    console.log(`[MainFlow] 已加载 ${mainFlowMap.size}/${codes.length} 只股票的主力资金数据`);
    
    const X = [], Y = [];
    let _dbgSkip = 0, _firstCode = true;
    codes.forEach(code => {
      const bars = byCode.get(code);
      if (!bars || bars.length < 34) { _dbgSkip++; return; }
      if (_firstCode) {
        _firstCode = false;
        try {
          const testFeat = buildUnifiedFeatures(bars.slice(0, 30).reverse(), code, [], null);
          console.error('[Bayesian TEST] first feat:', JSON.stringify(testFeat?.slice(0,5)), 'len=' + testFeat?.length);
        } catch(e2) {
          console.error('[Bayesian TEST] ERROR:', e2.message);
        }
      }
      const mainFlowData = mainFlowMap.get(code) || [];
      for (let i = 30; i < bars.length; i++) {
        const past = bars.slice(i - 30, i);
        const future = bars[i];
                if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;
        try {
          const feat = buildUnifiedFeatures(past, code, mainFlowData, northboundMap.get(code));
          if (feat && feat.length > 0 && feat.every(v => isFinite(v))) {
            X.push(feat);
            Y.push(Math.max(-0.3, Math.min(0.3, (future5.close - future.close) / future.close)));
          } else _dbgSkip++;
        } catch(e) { _dbgSkip++; }
      }
    });
    var _dbgMsg = 'skip=' + _dbgSkip + ' X=' + X.length;

    if (X.length < 50) return { success: false, error: '有效样本不足' };

    // 标准化
    const nFeat = X[0].length;
    const featMeans = X[0].map((_, j) => mean(X.map(r => r[j])));
    const featStds = X[0].map((_, j) => std(X.map(r => r[j])) || 1);
    const Xnorm = X.map(row => row.map((v, j) => (v - featMeans[j]) / featStds[j]));

    // ── Python Ridge回归训练（子进程，非主线程阻塞）──
    const featureNames = UNIFIED_FEATURE_NAMES;
    const pyResult = await trainWithPython('linear', X, Y, featureNames);

    // 保存检查点（训练完成）
    db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('linear', bjISO(), X.length, 1, 1, 100, 'in_progress', null);

    // 重新构建params（统一格式：含w/b/scaler）
    const params = {
      python_model: true,
      w: pyResult.params?.w || [],
      b: pyResult.params?.b || 0,
      scaler_mean: pyResult.params?.scaler_mean || [],
      scaler_std: pyResult.params?.scaler_std || []
    };

    // Python返回的是test方向准确率
    const accuracy = pyResult.accuracy || 0;
    const wAbs = (pyResult.featureImportance || []).map(Math.abs);
    const maxW = Math.max(...wAbs, 1e-10);
    const featureImportance = wAbs.map(v => v / maxW);
    const r2 = pyResult.diagnostics?.r2 ? parseFloat(pyResult.diagnostics.r2) : 0;
    const rmse = pyResult.diagnostics?.rmse ? parseFloat(pyResult.diagnostics.rmse.replace('%','')) / 100 : 0;

    return {
      success: true,
      modelId: 'linear',
      modelName: '线性回归/逻辑回归',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: pyResult.sample_count || X.length,
      featureNames: UNIFIED_FEATURE_NAMES,
      featureImportance,
      accuracy,
      params,
      diagnostics: pyResult.diagnostics || {}
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── Linear 预测函数 ──────────────────────────────────────────────
function predictLinear(modelParams, features) {
  /*
  使用训练好的Linear模型进行预测
  modelParams: { w, b, scaler_mean, scaler_std }（Python Ridge格式）
  features: 特征向量（25维，来自_extractMLFeatures，但训练只用前14维）
  返回: 预测的3日收益率（回归值）
  */
  try {
    const { w, b, scaler_mean, scaler_std } = modelParams;
    if (!w || b === undefined) return null;
    
    let x = features;
    if (typeof features === 'object' && !Array.isArray(features)) return null;
    
    // 应用 StandardScaler 标准化（仅使用前14维，与Python训练对齐）
    let z = b;
    for (let i = 0; i < w.length; i++) {
      const raw = x[i] || 0;
      let scaled = raw;
      if (scaler_mean && scaler_std) {
        const mean = scaler_mean[i] || 0;
        const std = scaler_std[i] || 1;
        scaled = std > 1e-9 ? (raw - mean) / std : 0;
      }
      z += w[i] * scaled;
    }
    
    // 回归输出，裁剪到合理范围
    return Math.max(-0.3, Math.min(0.3, z));
  } catch(e) {
    console.error('[ML] predictLinear error:', e.message);
    return null;
  }
}

// ── XGBoost ──────────────────────────────────────────────────────────
async function trainXGBoost(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 50000;
  const usePython = options.usePython !== false; // 默认使用 Python
  
  try {
    // 准备数据（与 Python 版本共享逻辑）
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, volume, high, low, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 120) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 15000);
    
    const northboundMap = batchGetNorthboundData(codes, 5, db);
    console.log('[Northbound] 已加载 ' + northboundMap.size + '/' + codes.length + ' 只股票的北向持股数据');
    // ── 批量查询主力资金数据 ──────────────────────────────────────
    const mainFlowMap = batchGetMainFlowData(codes, 10, db);
    console.log(`[MainFlow] 已加载 ${mainFlowMap.size}/${codes.length} 只股票的主力资金数据`);
    
    const X = [], Y = [];

    codes.forEach(code => {
      const bars = byCode.get(code);
      const mainFlowData = mainFlowMap.get(code) || [];
      for (let i = 30; i < bars.length; i++) {
        const past = bars.slice(i - 30, i);
        const future = bars[i];
                if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;
        const _feat = buildUnifiedFeatures(past, code, mainFlowData, northboundMap.get(code));
        if (X.length === 0) console.error('[Bayesian DBG] first feat len=' + _feat?.length + ' val=' + JSON.stringify(_feat?.slice(0,4)), 'bars=' + bars.length, 'past=' + past.length, 'code=' + code);
        X.push(_feat);
        Y.push(Math.max(-0.3, Math.min(0.3, (future5.close - future.close) / future.close)));
      }
    });

    if (X.length < 50) return { success: false, error: '有效样本不足' };

    // 样本下采样
    const XGB_MAX = targetSampleCount;
    let Xxgb = X, Yxgb = Y;
    if (X.length > XGB_MAX) {
      const idx = Array.from({ length: X.length }, (_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const picked = idx.slice(0, XGB_MAX).sort((a, b) => a - b);
      Xxgb = picked.map(i => X[i]);
      Yxgb = picked.map(i => Y[i]);
      console.log(`[ML] XGBoost样本下采样: ${XGB_MAX}/${X.length}`);
    }

    const featureNames = UNIFIED_FEATURE_NAMES;

    // ── Python 桥接训练（默认启用）──
    if (usePython) {
      try {
        console.log('[ML] XGBoost 尝试 Python 训练...');
        const result = await trainWithPython('xgboost', Xxgb, Yxgb, featureNames);
        // 补充 sample_count 等字段
        return { ...result, sample_count: Xxgb.length, n_features: featureNames.length, featureNames, trained_with: 'python-xgboost' }; 
      } catch(e) {
        console.warn('[ML] XGBoost Python 训练失败，回退 JS 实现:', e.message);
        // 回退到 JS 实现
      }
    }

    // ── JS 回退实现（当 Python 不可用时）──
    // 注意：Xxgb/Yxgb 已在 Python 桥接块之前定义

    const nFeat = Xxgb[0].length;
    const featMins = [], featMaxs = [];
    for (let j = 0; j < nFeat; j++) {
      const col = Xxgb.map(r => r[j]);
      featMins.push(Math.min(...col));
      featMaxs.push(Math.max(...col));
    }
    const Xnorm = Xxgb.map(row => row.map((v, j) => {
      const r = featMaxs[j] - featMins[j];
      return r < 1e-10 ? 0 : (v - featMins[j]) / r;
    }));

    // XGBoost: 梯度提升决策树（改进版：自适应阈值+特征子采样）
    const numTrees = 20;
    // 检查点恢复逻辑
    const resumeXGB = getCheckpointResumeState(db, 'xgboost');
    let startFromTreeXGB = 0;
    if (resumeXGB && resumeXGB.treesBuilt > 0) {
      rngSeed(resumeXGB.randomSeed);
      startFromTreeXGB = Math.min(resumeXGB.treesBuilt, numTrees);
      console.log(`[ML] XGBoost从检查点恢复: seed=${resumeXGB.randomSeed}, 从第${startFromTreeXGB}棵树继续`);
    } else {
      rngSeed(Date.now());
    }
    const learnRate = 0.1;
    const maxFeatPerTree = Math.max(2, Math.floor(nFeat * 0.7));
    let trees = [];
    let preds = Yxgb.map(() => Math.log(mean(Yxgb) / (1 - mean(Yxgb) + 1e-10))); // 初始logit
    const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));

    // 预计算每个特征的百分位阈值
    const featThresholds = [];
    for (let f = 0; f < nFeat; f++) {
      const featVals = Xnorm.map(r => r[f]);
      featThresholds.push(percentileThresholds(featVals, [5, 15, 25, 35, 50, 65, 75, 85, 95]));
    }
    console.log(`[ML] XGBoost自适应阈值: 每特征${featThresholds[0]?.length || 0}个分裂点, maxFeat=${maxFeatPerTree}/${nFeat}`);

    for (let t = startFromTreeXGB; t < numTrees; t++) {
      // CPU自适应让步（高负载时暂停训练让出CPU）
      if (options?.yaodiControlled && checkCpuAndYield(options.cpuThreshold || 80)) {
        if (shouldYield()) { await new Promise(r => setTimeout(r, 100)); }
      }
      // 特征子采样
      const featSubset = shuffle([...Array(nFeat).keys()]).slice(0, maxFeatPerTree);
      // 计算梯度
      const probs = preds.map(p => sigmoid(p));
      const residuals = Yxgb.map((y, i) => y - probs[i]);

      // 找最佳分裂点（一阶梯度gain）
      let bestGain = -Infinity;
      let bestFeat = 0;
      let bestThresh = 0.5;

      for (const f of featSubset) {
        const featVals = Xnorm.map(r => r[f]);
        for (const thresh of featThresholds[f]) {
          let sumGL = 0, sumGR = 0, cntL = 0, cntR = 0;
          for (let i = 0; i < Xxgb.length; i++) {
            if (featVals[i] < thresh) { sumGL += residuals[i]; cntL++; }
            else { sumGR += residuals[i]; cntR++; }
          }
          if (cntL < 10 || cntR < 10) continue;
          const gain = (sumGL * sumGL) / cntL + (sumGR * sumGR) / cntR;
          if (gain > bestGain) { bestGain = gain; bestFeat = f; bestThresh = thresh; }
        }
      }

      // 一阶叶值
      const tree = { feature: bestFeat, threshold: bestThresh, learnRate };
      let sumLV = 0, sumRV = 0, cntLV = 0, cntRV = 0;
      for (let i = 0; i < Xxgb.length; i++) {
        if (Xnorm[i][bestFeat] < bestThresh) { sumLV += residuals[i]; cntLV++; }
        else { sumRV += residuals[i]; cntRV++; }
      }
      tree.leftVal = (cntLV > 0 ? sumLV / cntLV : 0) * learnRate;
      tree.rightVal = (cntRV > 0 ? sumRV / cntRV : 0) * learnRate;
      trees.push(tree);

      // 更新预测
      preds = preds.map((p, i) => {
        const treePred = Xnorm[i][bestFeat] < bestThresh ? tree.leftVal : tree.rightVal;
        return p + treePred;
      });

      if ((t + 1) % 5 === 0) console.log(`[ML] XGBoost第${t + 1}/${numTrees}棵树完成`);

      // Save checkpoint after each tree (auto-save for crash recovery)
      const rngState = rngGetState();
      const progress_pct = ((t + 1) / numTrees) * 100;
      try {
        db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          'xgboost', bjISO(), Xxgb.length, t + 1, numTrees, Math.round(progress_pct * 10) / 10, 'in_progress', rngState.seed
        );
      } catch(e) { /* ignore checkpoint errors */ }
    }

    // 评估（回归：方向准确率）
    const correct = preds.filter((p, i) => (p > 0) === (Yxgb[i] > 0)).length;
    const accuracy = correct / Yxgb.length;

    // 特征重要性
    const featureImportance = new Array(nFeat).fill(0);
    trees.forEach(t => featureImportance[t.feature]++);
    const maxImp = Math.max(...featureImportance, 1);
    const importanceNorm = featureImportance.map(v => v / maxImp);

    // Mark checkpoint as completed
    try {
      db.prepare(`UPDATE ml_training_checkpoint SET status = 'completed' WHERE model_id = 'xgboost'`).run();
    } catch(e) { /* ignore */ }

    return {
      success: true,
      modelId: 'xgboost',
      modelName: 'XGBoost',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: Xxgb.length,
      numTrees,
      featureNames: UNIFIED_FEATURE_NAMES,
      featureImportance: importanceNorm,
      accuracy,
      params: { learnRate, numTrees, maxFeat: maxFeatPerTree, trees }
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── XGBoost 预测函数 ──────────────────────────────────────────
function predictXGBoost(modelParams, features) {
  /*
    使用训练好的XGBoost模型进行预测
    modelParams: 从数据库加载的模型参数（包含trees）
    features: 特征向量（数组）
    返回: 预测概率（0-1之间）
  */
  try {
    // ai_ml_model.data = { params: { learnRate, numTrees, maxFeat, trees }, accuracy, featureNames, ... }
    const { trees } = modelParams || {};
    if (!trees || !Array.isArray(trees) || trees.length === 0) return null;
    
    // 计算每棵树的预测，求和
    let pred = 0;
    for (const tree of trees) {
      const featureVal = features[tree.feature] || 0;
      pred += featureVal <= tree.threshold ? tree.leftVal : tree.rightVal;
    }
    
    // Sigmoid激活
    const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
    return sigmoid(pred);
  } catch(e) {
    console.error('[ML] predictXGBoost error:', e.message);
    return null;
  }
}

// ── LightGBM ──────────────────────────────────────────────────────────
async function trainLightGBM(db, options = {}) {
  try {
    // 使用Python桥接训练（与XGBoost统一架构）
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, volume, high, low, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: `数据不足（${rows.length}条）` };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 120) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 15000);
    const northboundMap = batchGetNorthboundData(codes, 5, db);
    console.log('[Northbound] 已加载 ' + northboundMap.size + '/' + codes.length + ' 只股票的北向持股数据');
    
    // ── 批量查询主力资金数据 ──────────────────────────────────────
    const mainFlowMap = batchGetMainFlowData(codes, 10, db);
    console.log(`[MainFlow] 已加载 ${mainFlowMap.size}/${codes.length} 只股票的主力资金数据`);
    
    const X = [], Y = [];

    codes.forEach(code => {
      const bars = byCode.get(code);
      const mainFlowData = mainFlowMap.get(code) || [];
      for (let i = 30; i < bars.length; i++) {
        const past = bars.slice(i - 30, i), future = bars[i];
        if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;
        X.push(buildUnifiedFeatures(past, code, mainFlowData, northboundMap.get(code)));
        Y.push(Math.max(-0.3, Math.min(0.3, (future5.close - future.close) / future.close)));
      }
    });

    if (X.length < 50) return { success: false, error: `有效样本不足（${X.length}条）` };

    const featureNames = UNIFIED_FEATURE_NAMES;
    
    // 清除旧检查点
    try { db.prepare(`DELETE FROM ml_training_checkpoint WHERE model_id = 'lightgbm'`).run(); } catch(e) {}

    console.log(`[ML] LightGBM调用Python训练: ${X.length}样本×${X[0].length}特征`);
    const result = await trainWithPython('lightgbm', X, Y, featureNames);
    return result;
  } catch(e) { return { success: false, error: e.message }; }
}

// ── LightGBM 预测函数 ──────────────────────────────────────────
function predictLightGBM(modelParams, features) {
  try {
    const p = modelParams || {};
    const trees = p.trees || [];
    if (!trees || trees.length === 0) return null;
    const numBins = p.numBins || 64;
    const hasMinMax = (p.featMins || []).length > 0;
    const hasMeanStd = (p.featMeans || []).length > 0;

    let pred = 0;
    for (const tree of trees) {
      const fi = tree.feature;
      const raw = (fi >= 0 && fi < features.length) ? features[fi] : 0;
      let binIdx;
      if (hasMinMax) {
        const mn = p.featMins[fi] ?? raw, mx = p.featMaxs[fi] ?? raw;
        const rng = mx - mn;
        binIdx = rng > 1e-10 ? Math.floor(((raw - mn) / rng) * numBins) : 0;
      } else if (hasMeanStd) {
        const v = raw, m = p.featMeans?.[fi] ?? raw, s = p.featStds?.[fi] ?? 1;
        binIdx = Math.max(0, Math.min(numBins - 1, Math.floor(((s ? (v - m) / s : 0) + 2) / 4 * numBins)));
      } else {
        binIdx = Math.max(0, Math.min(numBins - 1, Math.floor(raw * numBins)));
      }
      pred += tree.leafValues?.[binIdx] ?? 0;
    }
    const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
    return sigmoid(pred);
  } catch(e) { return null; }
}

// ── ARIMA ────────────────────────────────────────────────────────────
async function trainARIMA(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 50000;
  try {
    // 用日期范围获取所有股票历史
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 60) return { success: false, error: '历史数据不足60条' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 90) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, targetSampleCount);
    let arCoeffs = [], mseSum = 0, validCount = 0;

    codes.forEach(code => {
      const bars = byCode.get(code).reverse().slice(-60);
      if (bars.length < 20) return;
      const logPrices = bars.map(b => Math.log(Math.max(b.close, 0.01)));
      const returns = []; for (let i = 1; i < logPrices.length; i++) returns.push(logPrices[i] - logPrices[i - 1]);
      if (returns.length < 10) return;
      const r_t = returns.slice(1), r_tm1 = returns.slice(0, -1);
      const { a: phi, b } = linearRegression(r_tm1, r_t);
      const fitted = r_tm1.map(xt => phi * xt + b);
      const mse = mean(fitted.map((f, i) => (f - r_t[i]) ** 2));
      if (Math.abs(phi) < 1 && mse < 0.1) { arCoeffs.push({ phi, intercept: b, mse }); mseSum += mse; validCount++; }
    });

    if (validCount < 5) return { success: false, error: `有效样本不足（${validCount}支）` };

    const avgPhi = mean(arCoeffs.map(c => c.phi));
    const avgIntercept = mean(arCoeffs.map(c => c.intercept));
    const isStationary = Math.abs(avgPhi) < 1;
    const forecast = [];
    let lastReturn = avgPhi * avgIntercept + avgIntercept;
    for (let h = 1; h <= 5; h++) { const f = avgPhi * lastReturn + avgIntercept; forecast.push({ horizon: h, expectedReturn: f, direction: f > 0 ? 'up' : 'down' }); lastReturn = f; }

    // 计算ARIMA准确率：基于MSE和平稳性
    const avgMse = mseSum / validCount;
    const mseScore = Math.max(0, 1 - avgMse * 10);
    const stationarityBonus = isStationary ? 0.1 : 0;
    const arimaAccuracy = Math.min(0.95, Math.max(0.45, mseScore + stationarityBonus));

    return { success: true, modelId: 'arima', modelName: 'ARIMA(1,0,0)', trained_at: bjISO(), expires_at: new Date(Date.now() + 864e5 + 8*3600000).toISOString().replace('Z','+08:00'), sample_count: validCount, accuracy: arimaAccuracy, params: { phi: avgPhi, intercept: avgIntercept, p: 1, d: 0, q: 0 }, diagnostics: { isStationary, avgMse, accuracy: (arimaAccuracy * 100).toFixed(1) + '%' }, forecast: forecast.slice(0, 3), marketBias: avgPhi > 0.3 ? 'trendFollowing' : avgPhi < -0.3 ? 'meanReversion' : 'neutral' };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── GARCH ─────────────────────────────────────────────────────────────
async function trainGARCH(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 50000;
  try {
    // 用日期范围获取所有股票，避免 LIMIT 偏向排序靠前的股票
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, high, low FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);

    // 按 code 分组，处理全市场所有股票（约11000只）
    const byCode = new Map();
    let stockCount = 0;
    rows.forEach(r => {
      if (stockCount >= 15000) return;
      if (!byCode.has(r.code)) { byCode.set(r.code, []); stockCount++; }
      if (byCode.get(r.code).length < 90) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys());
    const results = [];

    codes.forEach(code => {
      const bars = byCode.get(code).reverse().slice(-60);
      if (bars.length < 15) return;
      const returns = []; for (let i = 1; i < bars.length; i++) { const r = (bars[i].close - bars[i - 1].close) / bars[i - 1].close; if (isFinite(r) && Math.abs(r) < 0.2) returns.push(r); }
      if (returns.length < 10) return;
      const mean_r = mean(returns), centered = returns.map(r => r - mean_r);
      const variance0 = mean(centered.map(c => c ** 2));
      const eps2 = centered.slice(1).map(c => c ** 2), sigma2滞后 = centered.slice(0, -1).map(c => c ** 2), eps2当期 = centered.slice(1).map(c => c ** 2);
      const { a: alpha, b: beta_raw } = linearRegression(sigma2滞后, eps2当期);
      const omega = variance0 * (1 - Math.max(0, Math.min(0.999, alpha)));
      const persist = Math.max(0, Math.min(0.999, alpha + (isFinite(beta_raw) ? beta_raw : 0)));
      const halfLife = persist > 0 && persist < 1 ? Math.log(0.5) / Math.log(persist) : Infinity;
      const longTermVar = persist < 1 && isFinite(omega) && omega > 0 ? omega / (1 - persist) : variance0;
      results.push({ alpha, psi: isFinite(beta_raw) ? Math.max(0, Math.min(0.999, beta_raw)) : 0.8, omega, meanReturn: mean_r, variance: variance0, halfLife: Math.round(halfLife * 10) / 10, persist: Math.round(persist * 1000) / 1000, longTermVol: Math.sqrt(longTermVar), currentVol: Math.sqrt(variance0) });
    });

    if (results.length < 5) return { success: false, error: `有效样本不足（${results.length}支）` };

    const avgPhi = mean(results.map(r => r.alpha)), avgPsi = mean(results.map(r => r.psi)), avgOmega = mean(results.map(r => r.omega));
    const avgHalfLife = mean(results.map(r => r.halfLife)), avgPersist = mean(results.map(r => r.persist));
    const avgVol = mean(results.map(r => r.currentVol)), avgLongVol = mean(results.map(r => r.longTermVol));

    const forecast = []; let var_t = results[0]?.variance || avgVol ** 2;
    for (let h = 1; h <= 5; h++) { var_t = avgOmega + avgPhi * var_t + avgPsi * var_t; forecast.push({ horizon: h, variance: Math.max(0, var_t), vol: Math.sqrt(Math.max(0, var_t)), dailyVaR_95: Math.round(-1.645 * Math.sqrt(Math.max(0, var_t)) * 10000) / 100 + '%' }); }

    // 计算GARCH准确率：基于波动率预测质量
    const volScore = Math.max(0.4, Math.min(0.9, 1 - avgVol * 10));
    const persistScore = avgPersist < 0.9 ? 0.1 : 0;
    const garchAccuracy = Math.min(0.9, volScore + persistScore);

    return { success: true, modelId: 'garch', modelName: 'GARCH(1,1)', trained_at: bjISO(), expires_at: new Date(Date.now() + 6 * 3600 * 1000 + 8*3600000).toISOString().replace('Z','+08:00'), sample_count: results.length, accuracy: garchAccuracy, params: { omega: avgOmega, alpha: avgPhi, beta: avgPsi, p: 1, q: 1 }, diagnostics: { avgPersist: Math.round(avgPersist * 1000) / 1000, avgHalfLife: Math.round(avgHalfLife * 10) / 10, marketVol: Math.round(avgVol * 10000) / 100 + '%', longTermVol: Math.round(avgLongVol * 10000) / 100 + '%', accuracy: (garchAccuracy * 100).toFixed(1) + '%' }, forecast: forecast.slice(0, 3), usage: { var_95: Math.round(-1.645 * avgVol * 10000) / 100 + '% (日度95% VaR)', positionSize: avgVol > 0.03 ? '低仓位（高波动）' : avgVol > 0.02 ? '标准仓位' : '可提高仓位（低波动）' } };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── Random Forest ─────────────────────────────────────────────────────
async function trainRandomForest(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 50000;
  try {
    // 用日期范围获取所有股票历史
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, volume, high, low, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '训练数据不足' };

    const byCodeRF = new Map();
    rows.forEach(r => {
      if (!byCodeRF.has(r.code)) byCodeRF.set(r.code, []);
      if (byCodeRF.get(r.code).length < 60) byCodeRF.get(r.code).push(r);
    });
    const codes = Array.from(byCodeRF.keys()).slice(0, 15000);
    const northboundMap = batchGetNorthboundData(codes, 5, db);
    console.log('[Northbound] 已加载 ' + northboundMap.size + '/' + codes.length + ' 只股票的北向持股数据');
    // ── 批量查询主力资金数据 ──────────────────────────────────────
    const mainFlowMap = batchGetMainFlowData(codes, 10, db);
    console.log(`[MainFlow] RF 已加载 ${mainFlowMap.size}/${codes.length} 只股票的主力资金数据`);
    
    const F = 3, X = [], Y = [];

    codes.forEach(code => {
      const bars = byCodeRF.get(code);
      const mainFlowData = mainFlowMap.get(code) || [];
      for (let i = 30; i < bars.length; i++) {
        const past = bars.slice(i - 30, i), future = bars[i];
        if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;
        const label5d = (future5.close - future.close) / future.close;
        if (isFinite(label5d) && Math.abs(label5d) < 0.3) {
          X.push(buildUnifiedFeatures(past, code, mainFlowData, northboundMap.get(code)));
          Y.push(label5d);
        }
      }
    });

    if (X.length < 50) return { success: false, error: `有效样本不足（${X.length}条）` };

    // 性能优化：限制样本上限，随机下采样保持分布
    const MAX_RF_SAMPLES = targetSampleCount;
    if (X.length > MAX_RF_SAMPLES) {
      const keepIdx = Array.from({ length: MAX_RF_SAMPLES }, () => Math.floor(rng() * X.length));
      const Xs = keepIdx.map(i => X[i]), Ys = keepIdx.map(i => Y[i]);
      X.length = 0; Y.length = 0; X.push(...Xs); Y.push(...Ys);
      console.log(`[ML] RF样本下采样: ${Xs.length}/${keepIdx.length} (上限${MAX_RF_SAMPLES})`);
    }

    const nFeat = X[0].length;
    const featMeans = X[0].map((_, j) => mean(X.map(r => r[j])));
    const featStds = X[0].map((_, j) => std(X.map(r => r[j])) || 1);
    const Xnorm = X.map(row => row.map((v, j) => (v - featMeans[j]) / featStds[j]));

    const numTrees = 50, maxDepth = 8, minLeafSize = 30;

    function buildTree(Xs, Ys, depth) {
      if (depth >= maxDepth || Ys.length <= minLeafSize) return { leaf: true, value: mean(Ys) };
      const nSubFeat = Math.max(1, Math.floor(Math.sqrt(nFeat)));
      const featIdx = shuffle([...Array(nFeat).keys()]).slice(0, nSubFeat);
      let bestVar = Infinity, bestSplit = 0, bestFeat = 0;
      // 预计算Ys均值用于方差
      const yMean = mean(Ys);
      for (const fi of featIdx) {
        const vals = Xs.map(r => r[fi]);
        const minV = Math.min(...vals), maxV = Math.max(...vals);
        if (maxV - minV < 1e-6) continue;
        const split = (minV + maxV) / 2;
        // 单次遍历计算左右方差，避免多次filter和mean
        let sumL = 0, sumR = 0, cntL = 0, cntR = 0;
        for (let i = 0; i < Ys.length; i++) {
          if (vals[i] <= split) { sumL += Ys[i]; cntL++; }
          else { sumR += Ys[i]; cntR++; }
        }
        if (cntL < 1 || cntR < 1) continue;
        const meanL = sumL / cntL, meanR = sumR / cntR;
        let varL = 0, varR = 0;
        for (let i = 0; i < Ys.length; i++) {
          if (vals[i] <= split) varL += (Ys[i] - meanL) ** 2;
          else varR += (Ys[i] - meanR) ** 2;
        }
        const totalVar = (varL + varR) / Ys.length;
        if (totalVar < bestVar) { bestVar = totalVar; bestSplit = split; bestFeat = fi; }
      }
      if (bestVar === Infinity) return { leaf: true, value: mean(Ys) };
      // 单次遍历分裂数据
      const Xleft = [], Yleft = [], Xright = [], Yright = [];
      for (let i = 0; i < Xs.length; i++) {
        if (Xs[i][bestFeat] <= bestSplit) { Xleft.push(Xs[i]); Yleft.push(Ys[i]); }
        else { Xright.push(Xs[i]); Yright.push(Ys[i]); }
      }
      return { leaf: false, feature: bestFeat, split: bestSplit, featMean: featMeans[bestFeat], featStd: featStds[bestFeat], left: buildTree(Xleft, Yleft, depth + 1), right: buildTree(Xright, Yright, depth + 1) };
    }

    function predictTree(tree, x) {
      if (tree.leaf) return tree.value;
      // x 已经是标准化后的 Xnorm，无需再次标准化
      return x[tree.feature] <= tree.split ? predictTree(tree.left, x) : predictTree(tree.right, x);
    }

    // 检查点恢复逻辑
    const resumeCP = getCheckpointResumeState(db, 'rf');
    let startFromTree = 0;
    if (resumeCP && resumeCP.treesBuilt > 0) {
      rngSeed(resumeCP.randomSeed);
      startFromTree = resumeCP.treesBuilt;
      console.log(`[ML] RF从检查点恢复: seed=${resumeCP.randomSeed}, 从第${startFromTree}棵树继续`);
    } else {
      rngSeed(Date.now());
    }

    const trees = [];
    for (let t = startFromTree; t < numTrees; t++) {
      // CPU自适应让步
      if (options?.yaodiControlled && checkCpuAndYield(options.cpuThreshold || 80)) {
        if (shouldYield()) { await new Promise(r => setTimeout(r, 100)); }
      }
      const bootIdx = Array.from({ length: Xnorm.length }, () => Math.floor(rng() * Xnorm.length));
      const Xboot = bootIdx.map(i => Xnorm[i]), Yboot = bootIdx.map(i => Y[i]);
      trees.push(buildTree(Xboot, Yboot, 0));
      console.log(`[ML] RF第${t + 1}/${numTrees}棵树完成`);
      // Save checkpoint after each tree (auto-save for crash recovery)
      const rngState = rngGetState();
      const progress_pct = ((t + 1) / numTrees) * 100;
      try {
        db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          'rf', bjISO(), X.length, t + 1, numTrees, Math.round(progress_pct * 10) / 10, 'in_progress', rngState.seed
        );
      } catch(e) { /* ignore checkpoint errors */ }
    }

    const preds = Xnorm.map(x => mean(trees.map(tr => predictTree(tr, x))));
    const r2 = r2score(preds, Y);
    const mseVal = mean(preds.map((p, i) => (p - Y[i]) ** 2));

    // 分类准确率：预测方向与实际方向一致
    const dirCorrect = preds.filter((p, i) => (p > 0 && Y[i] > 0) || (p < 0 && Y[i] < 0) || (Math.abs(p) < 0.001 && Math.abs(Y[i]) < 0.005)).length;
    const accuracy = dirCorrect / Y.length;

    const featImp = new Array(nFeat).fill(0);
    trees.forEach(tr => { function countSplits(node) { if (node.leaf) return; featImp[node.feature]++; countSplits(node.left); countSplits(node.right); } countSplits(tr); });
    const totalImp = featImp.reduce((a, b) => a + b, 1);
    const featureImportance = featImp.map(v => v / totalImp);

    // Mark checkpoint as completed
    try {
      db.prepare(`UPDATE ml_training_checkpoint SET status = 'completed' WHERE model_id = 'rf'`).run();
    } catch(e) { /* ignore */ }

    return { success: true, modelId: 'rf', modelName: 'Random Forest', trained_at: bjISO(), expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'), sample_count: X.length, accuracy: Math.round(accuracy * 10000) / 10000, numTrees, maxDepth, trees, featureNames: UNIFIED_FEATURE_NAMES, params: { trees, featureNames: UNIFIED_FEATURE_NAMES }, featureImportance, diagnostics: { r2: Math.round(r2 * 1000) / 1000, rmse: Math.round(Math.sqrt(mseVal) * 10000) / 100 + '%', directionAccuracy: Math.round(accuracy * 10000) / 100 + '%' }, usage: { r2Score: Math.round(Math.max(0, r2) * 100) + '%', description: r2 > 0.05 ? '有预测能力' : r2 > 0 ? '预测能力弱' : '几乎无预测能力（符合市场有效性）' } };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── SVM ──────────────────────────────────────────────────────────────
async function trainSVM(db, options = {}) {
  try {
    // 使用Python桥接训练（SVR回归）
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, volume, high, low, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '训练数据不足' };

    const byCodeSVM = new Map();
    rows.forEach(r => {
      if (!byCodeSVM.has(r.code)) byCodeSVM.set(r.code, []);
      if (byCodeSVM.get(r.code).length < 120) byCodeSVM.get(r.code).push(r);
    });
    const codes = Array.from(byCodeSVM.keys()).slice(0, 15000);
    const northboundMap = batchGetNorthboundData(codes, 5, db);
    console.log('[Northbound] 已加载 ' + northboundMap.size + '/' + codes.length + ' 只股票的北向持股数据');
    
    // ── 批量查询主力资金数据 ──────────────────────────────────────
    const mainFlowMap = batchGetMainFlowData(codes, 10, db);
    console.log(`[MainFlow] SVM 已加载 ${mainFlowMap.size}/${codes.length} 只股票的主力资金数据`);
    
    const X = [], Y = [];

    codes.forEach(code => {
      const bars = byCodeSVM.get(code);
      const mainFlowData = mainFlowMap.get(code) || [];
      for (let i = 30; i < bars.length; i++) {
        const past = bars.slice(i - 30, i), future = bars[i];
        if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;
        X.push(buildUnifiedFeatures(past, code, mainFlowData, northboundMap.get(code)));
        Y.push(Math.max(-0.3, Math.min(0.3, (future5.close - future.close) / future.close)));
      }
    });

    if (X.length < 50) return { success: false, error: `有效样本不足（${X.length}条）` };

    const featureNames = UNIFIED_FEATURE_NAMES;

    // 清除旧检查点
    try { db.prepare(`DELETE FROM ml_training_checkpoint WHERE model_id = 'svm'`).run(); } catch(e) {}

    console.log(`[ML] SVM调用Python训练(SVR): ${X.length}样本×${X[0].length}特征`);
    const result = await trainWithPython('svm', X, Y, featureNames);
    return result;
  } catch(e) { return { success: false, error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// Phase 2 模型
// ═══════════════════════════════════════════════════════════════

// ── CatBoost ──────────────────────────────────────────────────────────
async function trainCatBoost(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 50000;
  try {
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, volume, high, low, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 60) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 15000);
    
    // ── 批量查询主力资金数据 ──────────────────────────────────────
    const mainFlowMap = batchGetMainFlowData(codes, 10, db);
    const northboundMap = batchGetNorthboundData(codes, 5, db);
    console.log('[Northbound] 已加载 ' + northboundMap.size + '/' + codes.length + ' 只股票的北向持股数据');
    console.log(`[MainFlow] 已加载 ${mainFlowMap.size}/${codes.length} 只股票的主力资金数据`);
    
    const X = [], Y = [];

    codes.forEach(code => {
      const bars = byCode.get(code);
      const mainFlowData = mainFlowMap.get(code) || [];
      for (let i = 30; i < bars.length; i++) {
        const past = bars.slice(i - 30, i);
        const future = bars[i];
                if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;
        X.push(buildUnifiedFeatures(past, code, mainFlowData, northboundMap.get(code)));
        Y.push(Math.max(-0.3, Math.min(0.3, (future5.close - future.close) / future.close)));
      }
    });

    if (X.length < 50) return { success: false, error: '有效样本不足' };

    // CatBoost样本下采样（防止训练时间过长）
    const CB_MAX = targetSampleCount;
    let Xcb = X, Ycb = Y;
    if (X.length > CB_MAX) {
      const idx = Array.from({ length: X.length }, (_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const picked = idx.slice(0, CB_MAX).sort((a, b) => a - b);
      Xcb = picked.map(i => X[i]);
      Ycb = picked.map(i => Y[i]);
      console.log(`[ML] CatBoost样本下采样: ${CB_MAX}/${X.length} (上限${CB_MAX})`);
    }

    // 标准化
    const nFeat = Xcb[0].length;
    const featMeans = Xcb[0].map((_, j) => mean(Xcb.map(r => r[j])));
    const featStds = Xcb[0].map((_, j) => std(Xcb.map(r => r[j])) || 1);
    const Xnorm = Xcb.map(row => row.map((v, j) => (v - featMeans[j]) / featStds[j]));

    // 梯度提升（改进版：自适应百分位阈值+特征子采样+一阶梯度）
    const numTrees = 20, learnRate = 0.1;
    const maxFeatPerTree = Math.max(2, Math.floor(nFeat * 0.7)); // 每棵树随机选70%特征
    let preds = Ycb.map(() => Math.log(mean(Ycb) / (1 - mean(Ycb) + 1e-10)));
    const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
    let featureImportance = new Array(nFeat).fill(0);

    // 收集树结构用于推理
    const trees = [];
    // 预计算每个特征的百分位阈值
    const cbFeatThresholds = [];
    for (let f = 0; f < nFeat; f++) {
      const featVals = Xnorm.map(r => r[f]);
      cbFeatThresholds.push(percentileThresholds(featVals, [10, 20, 30, 40, 50, 60, 70, 80, 90]));
    }
    console.log(`[ML] CatBoost自适应阈值: 每特征${cbFeatThresholds[0]?.length || 0}个分裂点, maxFeat=${maxFeatPerTree}/${nFeat}`);

    for (let t = 0; t < numTrees; t++) {
      // CPU自适应让步
      if (options?.yaodiControlled && checkCpuAndYield(options.cpuThreshold || 80)) {
        if (shouldYield()) { await new Promise(r => setTimeout(r, 100)); }
      }
      // 特征子采样（防止所有树选同一特征）
      const featSubset = shuffle([...Array(nFeat).keys()]).slice(0, maxFeatPerTree);
      const probs = preds.map(p => sigmoid(p));
      const residuals = Ycb.map((y, i) => y - probs[i]);

      // 找最佳特征和分裂点（一阶梯度gain）
      let bestFeat = 0, bestGain = -Infinity, bestThresh = 0;
      for (const f of featSubset) {
        const featVals = Xnorm.map(r => r[f]);
        for (const thresh of cbFeatThresholds[f]) {
          let sumGL = 0, sumGR = 0;
          let cntL = 0, cntR = 0;
          for (let i = 0; i < Xcb.length; i++) {
            if (featVals[i] < thresh) { sumGL += residuals[i]; cntL++; }
            else { sumGR += residuals[i]; cntR++; }
          }
          if (cntL < 10 || cntR < 10) continue;
          // 一阶gain: 更大的加权残差分离
          const gain = (sumGL * sumGL) / cntL + (sumGR * sumGR) / cntR;
          if (gain > bestGain) { bestGain = gain; bestFeat = f; bestThresh = thresh; }
        }
      }
      featureImportance[bestFeat]++;

      // 一阶叶值（更稳定）
      let sumGLV = 0, sumGRV = 0, cntLV = 0, cntRV = 0;
      for (let i = 0; i < Xcb.length; i++) {
        if (Xnorm[i][bestFeat] < bestThresh) { sumGLV += residuals[i]; cntLV++; }
        else { sumGRV += residuals[i]; cntRV++; }
      }
      const leftVal = (cntLV > 0 ? sumGLV / cntLV : 0) * learnRate;
      const rightVal = (cntRV > 0 ? sumGRV / cntRV : 0) * learnRate;
      trees.push({ feature: bestFeat, threshold: bestThresh, leftVal, rightVal });
      preds = preds.map((p, i) => p + (Xnorm[i][bestFeat] < bestThresh ? leftVal : rightVal));
      if ((t + 1) % 5 === 0) console.log(`[ML] CatBoost第${t + 1}/${numTrees}棵树完成`);
      // 保存检查点
      const progress_pct = ((t + 1) / numTrees) * 100;
      db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('catboost', bjISO(), Xcb.length, t + 1, numTrees, progress_pct, 'in_progress', null);
      // 检查点已通过DB Proxy代理给主进程写入
    }

    // 评估（回归：方向准确率 + R²/RMSE）
    const correct = preds.filter((p, i) => (p > 0) === (Ycb[i] > 0)).length;
    const accuracy = correct / Ycb.length;
    // R² 和 RMSE
    const n = Ycb.length;
    const meanY = Ycb.reduce((a, b) => a + b, 0) / n;
    const ssRes = Ycb.reduce((s, y, i) => s + (y - preds[i]) ** 2, 0);
    const ssTot = Ycb.reduce((s, y) => s + (y - meanY) ** 2, 0);
    const r2 = ssTot < 1e-6 ? 0 : 1 - ssRes / ssTot;  // 防止方差极小导致R²爆炸
    const rmse = Math.sqrt(ssRes / n);

    const maxImp = Math.max(...featureImportance, 1);
    const importanceNorm = featureImportance.map(v => v / maxImp);

    return {
      success: true,
      modelId: 'catboost',
      modelName: 'CatBoost',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: Xcb.length,
      featureNames: UNIFIED_FEATURE_NAMES,
      featureImportance: importanceNorm,
      accuracy,
      r2,
      rmse,
      params: { numTrees, learnRate, trees, featMeans, featStds }
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── Autoencoder ──────────────────────────────────────────────────────
async function trainAutoencoder(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 50000;
  try {
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, volume, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 40) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 15000);
    const X = [];

    // 获取主力资金和北向持股数据（其他训练函数有，autoencoder之前缺失）
    const mainFlowMap = batchGetMainFlowData(codes, 10, db);
    const northboundMap = batchGetNorthboundData(codes, 5, db);
    
    codes.forEach(code => {
      const bars = byCode.get(code);
      if (bars.length < 30) return;
      // 用最近30根K线构建统一特征
      const past = bars.slice(0, 30);
      const mainFlowData = mainFlowMap.get(code) || [];
      X.push(buildUnifiedFeatures(past, code, mainFlowData, northboundMap.get(code)));
    });

    if (X.length < 50) return { success: false, error: '有效样本不足' };

    // 标准化
    const nFeat = X[0].length;
    const featMeans = X[0].map((_, j) => mean(X.map(r => r[j])));
    const featStds = X[0].map((_, j) => std(X.map(r => r[j])) || 1);
    const Xnorm = X.map(row => row.map((v, j) => (v - featMeans[j]) / featStds[j]));

    // Autoencoder: 20 -> 8 -> 20
    const latentDim = 8;
    const lr = 0.01, epochs = 200;
    
    // 初始化权重
    const initW = (rows, cols) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.5));
    let W1 = initW(nFeat, latentDim);
    let b1 = new Array(latentDim).fill(0);
    let W2 = initW(latentDim, nFeat);
    let b2 = new Array(nFeat).fill(0);

    const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
    const sigmoidDeriv = z => { const s = sigmoid(z); return s * (1 - s); };

    for (let epoch = 0; epoch < epochs; epoch++) {
      // CPU自适应让步
      if (options?.yaodiControlled && checkCpuAndYield(options.cpuThreshold || 80)) {
        if (shouldYield()) { await new Promise(r => setTimeout(r, 50)); }
      }
      for (const x of Xnorm) {
        // 前向传播
        const z1 = [];
        for (let j = 0; j < latentDim; j++) {
          let sum = b1[j];
          for (let i = 0; i < nFeat; i++) {
            sum += W1[i][j] * x[i];
          }
          z1.push(sum);
        }
        const h1 = z1.map(sigmoid);
        
        const recon = [];
        for (let j = 0; j < nFeat; j++) {
          let sum = b2[j];
          for (let i = 0; i < latentDim; i++) {
            sum += W2[i][j] * h1[i];
          }
          recon.push(sum);
        }

        // 反向
        const err = recon.map((r, i) => r - x[i]);
        const dW2 = h1.map(h => err.map(e => e * h));
        const db2 = err;
        const dh1 = err.map((e, i) => W2[i % latentDim].reduce((s, w) => s + w * e, 0));
        const dz1 = dh1.map((d, i) => d * sigmoidDeriv(z1[i] || 0));
        const dW1 = x.map(xi => dz1.map(d => d * xi));
        const db1 = dz1;

        // 更新
        for (let i = 0; i < nFeat; i++) {
          for (let j = 0; j < latentDim; j++) {
            W1[i][j] -= lr * (dW1[i]?.[j] || 0);
          }
        }
        for (let i = 0; i < latentDim; i++) {
          b1[i] -= lr * (db1[i] || 0);
          for (let j = 0; j < nFeat; j++) {
            W2[i][j] -= lr * (dW2[i]?.[j] || 0);
          }
        }
        for (let i = 0; i < nFeat; i++) {
          b2[i] -= lr * db2[i];
        }
      }
      // 保存检查点（每10个epoch）
      if (epoch % 10 === 0) {
        const progress_pct = ((epoch + 1) / epochs) * 100;
        db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('autoencoder', bjISO(), X.length, epoch + 1, epochs, progress_pct, 'in_progress', null);
      }
    }

    // 计算重构误差
    const reconErrors = Xnorm.map(x => {
      const z1 = [];
      for (let j = 0; j < latentDim; j++) {
        let sum = b1[j];
        for (let i = 0; i < nFeat; i++) sum += W1[i][j] * x[i];
        z1.push(sum);
      }
      const h1 = z1.map(sigmoid);
      const recon = [];
      for (let j = 0; j < nFeat; j++) {
        let sum = b2[j];
        for (let i = 0; i < latentDim; i++) sum += W2[i][j] * h1[i];
        recon.push(sum);
      }
      return Math.sqrt(mean(recon.map((r, i) => (r - x[i]) ** 2)));
    });
    const avgReconError = mean(reconErrors);
    const anomalyThreshold = mean(reconErrors) + 2 * std(reconErrors);
    // 安全检查：防止 NaN/Infinity 导致 accuracy 为 undefined
    if (!isFinite(avgReconError) || isNaN(avgReconError)) {
      return { success: false, error: `训练异常: avgReconError=${avgReconError}` };
    }

    // 训练完成：保存最终检查点
    db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('autoencoder', bjISO(), X.length, epochs, epochs, 100, 'completed', null);

    // 用重构误差估算 accuracy：误差越小越准
    const aeAccuracy = Math.min(0.95, Math.max(0.45, 1 - avgReconError * 2));

    return {
      success: true,
      modelId: 'autoencoder',
      modelName: 'Autoencoder',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: X.length,
      accuracy: aeAccuracy,
      latentDim,
      featureNames: UNIFIED_FEATURE_NAMES,
      params: { latentDim, lr, epochs, W1, b1, W2, b2, featMeans, featStds, reconThreshold: anomalyThreshold },
      diagnostics: { avgReconError: avgReconError.toFixed(4), anomalyThreshold: anomalyThreshold.toFixed(4), accuracy: (aeAccuracy * 100).toFixed(1) + '%' }
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── LSTM ──────────────────────────────────────────────────────────────
async function trainLSTM(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 200000;
  try {
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 40) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 15000);
    const X = [], Y = [];
    const seqLen = 5;

    codes.forEach(code => {
      const bars = byCode.get(code);
      for (let i = seqLen; i < bars.length; i++) {
        const seq = bars.slice(i - seqLen, i);
        const future = bars[i];
                if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;  // 3日收益率需3天后数据
        X.push(seq.map(b => b.change_percent / 100));
        Y.push(Math.max(-0.3, Math.min(0.3, (future5.close - future.close) / future.close)))  // 3日收益率标签;
      }
    });

    if (X.length < 50) return { success: false, error: '有效样本不足' };

    // 简化LSTM: 使用门控机制
    const hiddenSize = 16;
    const lr = 0.005, epochs = 30;  // 降低lr防震荡, 减少epoch(154K样本每epoch很慢)
    
    const initW = (rows, cols) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.3));
    const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
    const tanh = z => Math.tanh(Math.max(-500, Math.min(500, z)));

    // 门控权重: hiddenSize x (1 + hiddenSize) = 输入xt + 隐状态h
    let Wf = initW(hiddenSize, 2), Wi = initW(hiddenSize, 2), Wc = initW(hiddenSize, 2), Wo = initW(hiddenSize, 2);
    let bf = new Array(hiddenSize).fill(1), bi = new Array(hiddenSize).fill(0), bc = new Array(hiddenSize).fill(0), bo = new Array(hiddenSize).fill(1);  // forget gate bias=1(初始记住)
    let Wy = initW(1, hiddenSize), by_val = 0;

    // 子采样加速
    const maxSamples = Math.min(X.length, 50000);
    const sampleIdx = X.length <= maxSamples ? X.map((_,i)=>i) : Array.from({length:maxSamples}, ()=>Math.floor(Math.random()*X.length));

    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;
      // CPU自适应让步
      if (options?.yaodiControlled && checkCpuAndYield(options.cpuThreshold || 80)) {
        if (shouldYield()) { await new Promise(r => setTimeout(r, 50)); }
      }
      for (const idx of sampleIdx) {
        const seq = X[idx];
        let h = new Array(hiddenSize).fill(0), c_state = new Array(hiddenSize).fill(0);
        // 保存每步的中间值用于BPTT
        const gates = [];
        
        for (const xt of seq) {
          const ft = h.map((hi, i) => sigmoid(Wf[i][0] * xt + Wf[i][1] * hi + bf[i]));
          const it = h.map((hi, i) => sigmoid(Wi[i][0] * xt + Wi[i][1] * hi + bi[i]));
          const ct = h.map((hi, i) => tanh(Wc[i][0] * xt + Wc[i][1] * hi + bc[i]));
          const c_new = c_state.map((ci, i) => ft[i] * ci + it[i] * ct[i]);
          const ot = h.map((hi, i) => sigmoid(Wo[i][0] * xt + Wo[i][1] * hi + bo[i]));
          const h_new = ot.map((oi, i) => oi * tanh(c_new[i]));
          gates.push({ ft, it, ct, ot, c_prev: [...c_state], h_prev: [...h], xt });
          c_state = c_new;
          h = h_new;
        }
        
        // 回归输出(不用sigmoid，直接线性输出)
        const pred = h.reduce((s, hi, i) => s + Wy[0][i] * hi, 0) + by_val;
        const err = pred - Y[idx];
        totalLoss += err * err;
        
        // 反向传播: 输出层梯度
        const dWy = h.map(hi => lr * err * hi);
        const dby = lr * err;
        for (let i = 0; i < hiddenSize; i++) Wy[0][i] -= dWy[i];
        by_val -= dby;

        // BPTT: 反传到门控权重(简化: 只反传最后1步)
        const dh = h.map((hi, i) => err * Wy[0][i]);  // dL/dh
        const lastGate = gates[gates.length - 1];
        if (lastGate) {
          const { ft: lft, it: lit, ct: lct, ot: lot, c_prev: lc, h_prev: lh, xt: lxt } = lastGate;
          for (let i = 0; i < hiddenSize; i++) {
            const dot = dh[i] * tanh(lc[i] * lft[i] + lit[i] * lct[i]);  // dh/dot
            const dc_raw = dh[i] * lot[i] * (1 - tanh(lc[i] * lft[i] + lit[i] * lct[i])**2);
            // forget gate
            const dft = dc_raw * lc[i] * lft[i] * (1 - lft[i]);
            Wf[i][0] -= lr * dft * lxt;
            Wf[i][1] -= lr * dft * lh[i];
            bf[i] -= lr * dft;
            // input gate
            const dit = dc_raw * lct[i] * lit[i] * (1 - lit[i]);
            Wi[i][0] -= lr * dit * lxt;
            Wi[i][1] -= lr * dit * lh[i];
            bi[i] -= lr * dit;
            // cell candidate
            const dct = dc_raw * lit[i] * (1 - lct[i]**2);
            Wc[i][0] -= lr * dct * lxt;
            Wc[i][1] -= lr * dct * lh[i];
            bc[i] -= lr * dct;
            // output gate
            const dotGrad = dh[i] * tanh(lc[i] * lft[i] + lit[i] * lct[i]) * lot[i] * (1 - lot[i]);
            Wo[i][0] -= lr * dotGrad * lxt;
            Wo[i][1] -= lr * dotGrad * lh[i];
            bo[i] -= lr * dotGrad;
          }
        }
      }
      // 保存检查点（每5个epoch）
      if (epoch % 5 === 0) {
        const progress_pct = ((epoch + 1) / epochs) * 100;
        db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('lstm', bjISO(), sampleIdx.length, epoch + 1, epochs, progress_pct, 'in_progress', null);
      }
    }

    // 评估
    let correct = 0;
    for (let idx = 0; idx < X.length; idx++) {
      const seq = X[idx];
      let h = new Array(hiddenSize).fill(0), c_state = new Array(hiddenSize).fill(0);
      for (const xt of seq) {
        const ft = h.map((hi, i) => sigmoid(Wf[i][0] * xt + Wf[i][1] * hi + bf[i]));
        const it = h.map((hi, i) => sigmoid(Wi[i][0] * xt + Wi[i][1] * hi + bi[i]));
        const ct = h.map((hi, i) => tanh(Wc[i][0] * xt + Wc[i][1] * hi + bc[i]));
        const c_new = c_state.map((ci, i) => ft[i] * ci + it[i] * ct[i]);
        const ot = h.map((hi, i) => sigmoid(Wo[i][0] * xt + Wo[i][1] * hi + bo[i]));
        h = ot.map((oi, i) => oi * tanh(c_new[i]));
        c_state = c_new;
      }
      const pred = h.reduce((s, hi, i) => s + Wy[0][i] * hi, 0) + by_val;
      if ((pred > 0) === (Y[idx] > 0)) correct++;  // 方向准确率
    }
    const accuracy = correct / X.length;

    return {
      success: true,
      modelId: 'lstm',
      modelName: 'LSTM',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: X.length,
      hiddenSize,
      params: { hiddenSize, seqLen, lr, epochs, Wf, Wi, Wc, Wo, bf, bi, bc, bo, Wy, by: by_val, featMeans: null, featStds: null },
      accuracy,
      diagnostics: { directionAccuracy: (accuracy * 100).toFixed(1) + '%' }
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── GRU ───────────────────────────────────────────────────────────────
async function trainGRU(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 200000;
  try {
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 40) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 15000);
    const X = [], Y = [];
    const seqLen = 5;

    codes.forEach(code => {
      const bars = byCode.get(code);
      for (let i = seqLen; i < bars.length; i++) {
        const seq = bars.slice(i - seqLen, i);
        const future = bars[i];
                if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;  // 3日收益率需3天后数据
        X.push(seq.map(b => b.change_percent / 100));
        Y.push(Math.max(-0.3, Math.min(0.3, (future5.close - future.close) / future.close)))  // 3日收益率标签;
      }
    });

    if (X.length < 50) return { success: false, error: '有效样本不足' };

    const hiddenSize = 6;
    const lr = 0.01, epochs = 80;
    
    const initW = (rows, cols) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.3));
    const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
    const tanh = z => Math.tanh(Math.max(-500, Math.min(500, z)));

    let Wz = initW(hiddenSize, 1), Wr = initW(hiddenSize, 1), Wh = initW(hiddenSize, 1);
    let bz = new Array(hiddenSize).fill(0), br = new Array(hiddenSize).fill(0), bh = new Array(hiddenSize).fill(0);
    let Wy = initW(1, hiddenSize), by = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      // CPU自适应让步
      if (options?.yaodiControlled && checkCpuAndYield(options.cpuThreshold || 80)) {
        if (shouldYield()) { await new Promise(r => setTimeout(r, 50)); }
      }
      for (let idx = 0; idx < X.length; idx++) {
        const seq = X[idx];
        let h = new Array(hiddenSize).fill(0);
        
        for (const xt of seq) {
          const zt = h.map((hi, i) => sigmoid(Wz[i][0] * xt + bz[i]));
          const rt = h.map((hi, i) => sigmoid(Wr[i][0] * xt + br[i]));
          const ht = h.map((hi, i) => tanh(Wh[i][0] * xt + rt[i] * hi + bh[i]));
          h = h.map((hi, i) => (1 - zt[i]) * hi + zt[i] * ht[i]);
        }
        
        const pred = sigmoid(h.reduce((s, hi, i) => s + Wy[0][i] * hi, 0) + by);
        const err = pred - Y[idx];
        
        for (let i = 0; i < hiddenSize; i++) {
          Wy[0][i] -= lr * err * h[i];
        }
        by -= lr * err;
      }
      // 保存检查点（每10个epoch）
      if (epoch % 10 === 0) {
        const progress_pct = ((epoch + 1) / epochs) * 100;
        db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('gru', bjISO(), X.length, epoch + 1, epochs, progress_pct, 'in_progress', null);
      }
    }

    let correct = 0;
    for (let idx = 0; idx < X.length; idx++) {
      const seq = X[idx];
      let h = new Array(hiddenSize).fill(0);
      for (const xt of seq) {
        const zt = h.map((hi, i) => sigmoid(Wz[i][0] * xt + bz[i]));
        const rt = h.map((hi, i) => sigmoid(Wr[i][0] * xt + br[i]));
        const ht = h.map((hi, i) => tanh(Wh[i][0] * xt + rt[i] * hi + bh[i]));
        h = h.map((hi, i) => (1 - zt[i]) * hi + zt[i] * ht[i]);
      }
      const pred = h.reduce((s, hi, i) => s + Wy[0][i] * hi, 0) + by;  // 回归输出
      if ((pred > 0) === (Y[idx] > 0)) correct++;  // 方向准确率
    }
    const accuracy = correct / X.length;

    return {
      success: true,
      modelId: 'gru',
      modelName: 'GRU',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: X.length,
      hiddenSize,
      params: { hiddenSize, seqLen, lr, epochs, Wz, Wr, Wh, bz, br, bh, Wy, by },
      accuracy,
      diagnostics: { directionAccuracy: (accuracy * 100).toFixed(1) + '%' }
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// Phase 3 模型
// ═══════════════════════════════════════════════════════════════

// ── CNN ───────────────────────────────────────────────────────────────
async function trainCNN(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 200000;
  try {
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, high, low, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 40) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 15000);
    const X = [], Y = [];
    const seqLen = 10;

    codes.forEach(code => {
      const bars = byCode.get(code);
      for (let i = seqLen; i < bars.length; i++) {
        const seq = bars.slice(i - seqLen, i);
        const future = bars[i];
                if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;  // 3日收益率需3天后数据
        // K线特征: [close, range, position]
        X.push(seq.map(b => [
          b.close / seq[0].close - 1,
          (b.high - b.low) / b.close,
          (b.close - b.low) / (b.high - b.low + 0.001)
        ]));
        Y.push(Math.max(-0.3, Math.min(0.3, (future5.close - future.close) / future.close)))  // 3日收益率标签;
      }
    });

    if (X.length < 50) return { success: false, error: '有效样本不足' };

    // 简化CNN: 1D卷积 + 池化
    const numFilters = 4;
    const filterSize = 3;
    const lr = 0.01, epochs = 100;
    
    const initW = (n) => Array.from({ length: n }, () => (Math.random() - 0.5) * 0.5);
    let filters = Array.from({ length: numFilters }, () => initW(filterSize * 3));
    let filterBias = new Array(numFilters).fill(0);
    let fcW = initW(numFilters * Math.floor((seqLen - filterSize + 1) / 2));
    let fcB = 0;
    
    const relu = z => Math.max(0, z);
    const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));

    for (let epoch = 0; epoch < epochs; epoch++) {
      // CPU自适应让步
      if (options?.yaodiControlled && checkCpuAndYield(options.cpuThreshold || 80)) {
        if (shouldYield()) { await new Promise(r => setTimeout(r, 50)); }
      }
      for (let idx = 0; idx < X.length; idx++) {
        const seq = X[idx];
        
        // 卷积
        const convOut = [];
        for (let f = 0; f < numFilters; f++) {
          const featMap = [];
          for (let i = 0; i <= seqLen - filterSize; i++) {
            let sum = filterBias[f];
            for (let j = 0; j < filterSize; j++) {
              for (let k = 0; k < 3; k++) {
                sum += filters[f][j * 3 + k] * seq[i + j][k];
              }
            }
            featMap.push(relu(sum));
          }
          convOut.push(featMap);
        }
        
        // 池化
        const pooled = [];
        for (let f = 0; f < numFilters; f++) {
          for (let i = 0; i < convOut[f].length; i += 2) {
            pooled.push(Math.max(convOut[f][i] || 0, convOut[f][i + 1] || 0));
          }
        }
        
        // 全连接
        const pred = sigmoid(pooled.reduce((s, p, i) => s + fcW[i] * p, 0) + fcB);
        const err = pred - Y[idx];
        
        // 更新
        for (let i = 0; i < fcW.length && i < pooled.length; i++) {
          fcW[i] -= lr * err * pooled[i];
        }
        fcB -= lr * err;
      }
      // 保存检查点（每10个epoch）
      if (epoch % 10 === 0) {
        const progress_pct = ((epoch + 1) / epochs) * 100;
        db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('cnn', bjISO(), X.length, epoch + 1, epochs, progress_pct, 'in_progress', null);
      }
    }

    // 评估
    let correct = 0;
    for (let idx = 0; idx < X.length; idx++) {
      const seq = X[idx];
      const convOut = [];
      for (let f = 0; f < numFilters; f++) {
        const featMap = [];
        for (let i = 0; i <= seqLen - filterSize; i++) {
          let sum = filterBias[f];
          for (let j = 0; j < filterSize; j++) {
            for (let k = 0; k < 3; k++) {
              sum += filters[f][j * 3 + k] * seq[i + j][k];
            }
          }
          featMap.push(relu(sum));
        }
        convOut.push(featMap);
      }
      const pooled = [];
      for (let f = 0; f < numFilters; f++) {
        for (let i = 0; i < convOut[f].length; i += 2) {
          pooled.push(Math.max(convOut[f][i] || 0, convOut[f][i + 1] || 0));
        }
      }
      const pred = pooled.reduce((s, p, i) => s + fcW[i] * p, 0) + fcB;  // 回归输出
      if ((pred > 0) === (Y[idx] > 0)) correct++;  // 方向准确率
    }
    const accuracy = correct / X.length;

    return {
      success: true,
      modelId: 'cnn',
      modelName: 'CNN',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: X.length,
      params: { numFilters, filterSize, seqLen, lr, epochs, filters, filterBias, fcW, fcB },
      accuracy,
      diagnostics: { directionAccuracy: (accuracy * 100).toFixed(1) + '%' }
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── Transformer ───────────────────────────────────────────────────────
async function trainTransformer(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 200000;
  try {
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 25) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 400);
    const X = [], Y = [];
    const seqLen = 8;

    codes.forEach(code => {
      const bars = byCode.get(code);
      for (let i = seqLen; i < bars.length; i++) {
        const seq = bars.slice(i - seqLen, i);
        const future = bars[i];
                if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;  // 3日收益率需3天后数据
        X.push(seq.map(b => b.change_percent / 100));
        Y.push(Math.max(-0.3, Math.min(0.3, (future5.close - future.close) / future.close)))  // 3日收益率标签;
      }
    });

    if (X.length < 50) return { success: false, error: '有效样本不足' };

    // 简化Transformer: Self-Attention
    const dModel = 4;
    const lr = 0.01, epochs = 80;
    
    const initW = (rows, cols) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.3));
    
    let Wq = initW(1, dModel), Wk = initW(1, dModel), Wv = initW(1, dModel);
    let fcW = initW(1, dModel), fcB = 0;
    
    const softmax = arr => {
      const max = Math.max(...arr);
      const exp = arr.map(a => Math.exp(a - max));
      const sum = exp.reduce((a, b) => a + b, 0);
      return exp.map(e => e / sum);
    };
    const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));

    for (let epoch = 0; epoch < epochs; epoch++) {
      // CPU自适应让步
      if (options?.yaodiControlled && checkCpuAndYield(options.cpuThreshold || 80)) {
        if (shouldYield()) { await new Promise(r => setTimeout(r, 50)); }
      }
      for (let idx = 0; idx < X.length; idx++) {
        const seq = X[idx];
        
        // 简化: 对每个时间步做attention
        const embeddings = seq.map(x => [x, x * 0.5, x * 0.3, x * 0.2]);
        
        // Self-attention
        const context = [];
        for (let t = 0; t < seqLen; t++) {
          const q = embeddings[t].map((e, i) => Wq[0][i] * e);
          const scores = embeddings.map(e => q.reduce((s, qi, i) => s + qi * Wk[0][i] * e[i], 0) / Math.sqrt(dModel));
          const weights = softmax(scores);
          const attended = embeddings[0].map((_, i) => embeddings.reduce((s, e, j) => s + weights[j] * Wv[0][i] * e[i], 0));
          context.push(attended);
        }
        
        // 聚合
        const pooled = context[0].map((_, i) => mean(context.map(c => c[i])));
        const pred = sigmoid(pooled.reduce((s, p, i) => s + fcW[0][i] * p, 0) + fcB);
        const err = pred - Y[idx];
        
        for (let i = 0; i < dModel; i++) {
          fcW[0][i] -= lr * err * pooled[i];
        }
        fcB -= lr * err;
      }
      // 保存检查点（每10个epoch）
      if (epoch % 10 === 0) {
        const progress_pct = ((epoch + 1) / epochs) * 100;
        db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('transformer', bjISO(), X.length, epoch + 1, epochs, progress_pct, 'in_progress', null);
      }
    }

    // 评估
    let correct = 0;
    for (let idx = 0; idx < X.length; idx++) {
      const seq = X[idx];
      const embeddings = seq.map(x => [x, x * 0.5, x * 0.3, x * 0.2]);
      const context = [];
      for (let t = 0; t < seqLen; t++) {
        const q = embeddings[t].map((e, i) => Wq[0][i] * e);
        const scores = embeddings.map(e => q.reduce((s, qi, i) => s + qi * Wk[0][i] * e[i], 0) / Math.sqrt(dModel));
        const weights = softmax(scores);
        const attended = embeddings[0].map((_, i) => embeddings.reduce((s, e, j) => s + weights[j] * Wv[0][i] * e[i], 0));
        context.push(attended);
      }
      const pooled = context[0].map((_, i) => mean(context.map(c => c[i])));
      const pred = pooled.reduce((s, p, i) => s + fcW[0][i] * p, 0) + fcB;  // 回归输出
      if ((pred > 0) === (Y[idx] > 0)) correct++;  // 方向准确率
    }
    const accuracy = correct / X.length;

    return {
      success: true,
      modelId: 'transformer',
      modelName: 'Transformer',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: X.length,
      params: { dModel, seqLen, lr, epochs, Wq, Wk, Wv, fcW, fcB, numHeads: 1 },
      accuracy,
      diagnostics: { directionAccuracy: (accuracy * 100).toFixed(1) + '%' }
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── GNN ────────────────────────────────────────────────────────────────
async function trainGNN(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 200000;
  try {
    // GNN用于板块传导，需要行业数据
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 20) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 15000);
    
    // 构建板块图（简化：按股票代码前缀分组）
    const sectors = {};
    codes.forEach(code => {
      const prefix = code.substring(0, 3);
      if (!sectors[prefix]) sectors[prefix] = [];
      sectors[prefix].push(code);
    });
    
    // 收集原始样本数据
    const X_raw = [], Y_raw = [];
    codes.forEach(code => {
      const bars = byCode.get(code);
      if (bars.length < 5) return;
      const prefix = code.substring(0, 3);
      const sectorCodes = sectors[prefix] || [];
      
      // 节点特征：自身收益率 + 板块平均收益率
      const selfReturn = bars[0].change_percent / 100;
      let sectorReturn = 0;
      let count = 0;
      sectorCodes.forEach(c => {
        if (c !== code && byCode.has(c)) {
          const cBars = byCode.get(c);
          if (cBars.length > 0) {
            sectorReturn += cBars[0].change_percent / 100;
            count++;
          }
        }
      });
      sectorReturn = count > 0 ? sectorReturn / count : 0;
      
      // 🔧 FIX: 预测"明天的涨跌"(下一个bar的change_percent)，而非"今天的涨跌"
      const nextChange = bars.length >= 2 ? bars[1].change_percent : 0;
      X_raw.push([selfReturn, sectorReturn, sectorCodes.length / 50]);
      Y_raw.push(nextChange > 0 ? 1 : 0);
    });

    if (X_raw.length < 30) return { success: false, error: `GNN有效样本不足(${X_raw.length})` };

    // 🔧 FIX: 预测"明天的涨跌"，而不是"今天的涨跌"
    // 训练集: 用前N-1天的数据预测第N天的涨跌
    // 测试集: 用最后20%的数据
    const splitIdx = Math.floor(X_raw.length * 0.8);
    const X_train_raw = X_raw.slice(0, splitIdx);
    const Y_train_raw = Y_raw.slice(0, splitIdx);
    const X_test_raw = X_raw.slice(splitIdx);
    const Y_test_raw = Y_raw.slice(splitIdx);

    if (X_train_raw.length < 30 || X_test_raw.length < 10) {
      // 数据太少，回退到简单留一法
      return { success: false, error: `GNN样本不足(train:${X_train_raw.length},test:${X_test_raw.length})` };
    }

    const X = X_train_raw, Y = Y_train_raw;
    const X_test = X_test_raw, Y_test = Y_test_raw;

    // 简化GNN: 图卷积
    const hiddenSize = 8;
    const lr = 0.05, epochs = 200;
    
    const initW = (rows, cols) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.5));
    let W1 = initW(3, hiddenSize), W2 = initW(hiddenSize, 1);
    let b1 = new Array(hiddenSize).fill(0), b2 = 0;
    
    const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
    const relu = z => Math.max(0, z);
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

    for (let epoch = 0; epoch < epochs; epoch++) {
      const indices = Array.from({ length: X.length }, (_, i) => i);
      // Shuffle
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      for (const idx of indices) {
        // CPU自适应让步
        if (options?.yaodiControlled && checkCpuAndYield(options.cpuThreshold || 80)) {
          if (shouldYield()) { await new Promise(r => setTimeout(r, 50)); }
        }
        const x = X[idx];
        
        // 图卷积层
        const h = x.map((xi, i) => W1[i].map(w => relu(w * xi + b1[i % hiddenSize])));
        const pooled = h[0].map((_, j) => mean(h.map(hi => hi[j])));
        
        // 输出层
        const pred = sigmoid(pooled.reduce((s, p, i) => s + W2[i][0] * p, 0) + b2);
        const err = pred - Y[idx];
        
        for (let i = 0; i < hiddenSize; i++) {
          W2[i][0] -= lr * err * pooled[i];
        }
        b2 -= lr * err;
      }
      // 保存检查点（每20个epoch）
      if (epoch % 20 === 0) {
        const progress_pct = ((epoch + 1) / epochs) * 100;
        // 验证集评估
        let vCorrect = 0;
        for (let i = 0; i < X_test.length; i++) {
          const x = X_test[i];
          const h = x.map((xi, i2) => W1[i2].map(w => relu(w * xi + b1[i2 % hiddenSize])));
          const pooled = h[0].map((_, j) => mean(h.map(hi => hi[j])));
          const pred = pooled.reduce((s, p, j) => s + W2[j][0] * p, 0) + b2;  // 回归输出
          if ((pred > 0) === (Y_test[i] > 0)) vCorrect++;  // 方向准确率
        }
        const valAcc = (vCorrect / X_test.length * 100).toFixed(1);
        db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('gnn', bjISO(), X.length, epoch + 1, epochs, progress_pct, 'in_progress', null);
      }
    }

    // Out-of-sample evaluation
    let correct = 0;
    for (let idx = 0; idx < X_test.length; idx++) {
      const x = X_test[idx];
      const h = x.map((xi, i) => W1[i].map(w => relu(w * xi + b1[i % hiddenSize])));
      const pooled = h[0].map((_, j) => mean(h.map(hi => hi[j])));
      const pred = pooled.reduce((s, p, i) => s + W2[i][0] * p, 0) + b2;  // 回归输出
      if ((pred > 0) === (Y_test[idx] > 0)) correct++;  // 方向准确率
    }
    const accuracy = correct / X_test.length;
    const trainSamples = X.length, testSamples = X_test.length;

    return {
      success: true,
      modelId: 'gnn',
      modelName: 'GNN',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: X.length + X_test.length,  // 总样本数（含测试集）
      train_samples: X.length,
      test_samples: X_test.length,
      accuracy,
      params: { hiddenSize, lr, epochs, numSectors: Object.keys(sectors).length, W1, W2, b1, b2 },
      diagnostics: { directionAccuracy: (accuracy * 100).toFixed(1) + '%' }
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 贝叶斯模型 ────────────────────────────────────────────────────────
async function trainBayesian(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 150000;
  try {
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, volume, high, low, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 40) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 15000);
    
    // ── 批量查询主力资金数据 ──────────────────────────────────────
    const mainFlowMap = batchGetMainFlowData(codes, 10, db);
    const northboundMap = batchGetNorthboundData(codes, 5, db);
    console.log(`[MainFlow] 已加载 ${mainFlowMap.size}/${codes.length} 只股票的主力资金数据`);
    
    const X = [], Y = [];

    codes.forEach(code => {
      const bars = byCode.get(code);
      const mainFlowData = mainFlowMap.get(code) || [];
      for (let i = 30; i < bars.length; i++) {
        const past = bars.slice(i - 30, i);
        const future = bars[i];
                if (!future) continue;
        const future5 = bars[i + 5]; if (!future5) continue;
        X.push(buildUnifiedFeatures(past, code, mainFlowData, northboundMap.get(code)));
        Y.push(Math.max(-0.3, Math.min(0.3, (future5.close - future.close) / future.close)));
      }
    });

    if (X.length < 50) return { success: false, error: '有效样本不足(X=' + X.length + ', codes=' + codes.length + ', rows=' + rows.length + ')' };

    // 【修复2026-06-11】样本量上限防止矩阵病态
    const MAX_SAMPLES = 30000;
    const useSamples = X.length > MAX_SAMPLES ? 
      X.slice(0, MAX_SAMPLES) : X;
    const useY = X.length > MAX_SAMPLES ? 
      Y.slice(0, MAX_SAMPLES) : Y;
    console.log(`[Bayesian] 样本: ${X.length} → ${useSamples.length} (上限${MAX_SAMPLES})`);

    // 贝叶斯线性回归: p(w|D) ∝ p(D|w) * p(w)
    // 使用共轭先验，解析求解后验
    const nFeat = useSamples[0].length;
    const alpha = 0.1; // 【修复】先验精度调小，更稳定
    const beta = 20.0; // 【修复】噪声精度调大，更稳定

    // 标准化
    const featMeans = useSamples[0].map((_, j) => mean(useSamples.map(r => r[j])));
    const featStds = useSamples[0].map((_, j) => std(useSamples.map(r => r[j])) || 1);
    const Xnorm = useSamples.map(row => row.map((v, j) => (v - featMeans[j]) / (featStds[j] + 1e-8)));

    // 【修复】使用对角先验 + 批量均值估计，避免矩阵病态
    // 简化贝叶斯：每个特征独立估计后验均值和方差
    const mN = [];
    const SNdiag = [];
    for (let j = 0; j < nFeat; j++) {
      const xj = Xnorm.map(x => x[j]);
      const yBar = mean(useY);
      const xBar = mean(xj);
      const cov = xj.reduce((s, xi, i) => s + (xi - xBar) * (useY[i] - yBar), 0);
      const varX = xj.reduce((s, xi) => s + (xi - xBar) ** 2, 0) + 1e-8;
      // 后验均值：带正则化的线性回归系数
      const w = (beta * cov) / (varX * beta + alpha);
      const b = yBar - w * xBar;
      mN.push(w);
      SNdiag.push(alpha / (varX * beta + alpha + 1e-8));
    }

    // 预测分布（每个特征独立）
    const preds = Xnorm.map(x => {
      let sum = 0, sumVar = 0;
      for (let i = 0; i < nFeat; i++) {
        sum += mN[i] * x[i];
        sumVar += SNdiag[i] * x[i] * x[i];
      }
      const mean = Math.max(-0.5, Math.min(0.5, sum)); // 裁剪防止溢出
      const predVar = sumVar + 1 / beta;
      // 【修复】NaN/Inf检查
      const std = (isFinite(predVar) && predVar > 0) ? Math.sqrt(predVar) : 0.1;
      return { mean, std };
    });

    // 评估
    // 评估（回归：方向准确率）
    const correct = preds.filter((p, i) => (p.mean > 0) === (useY[i] > 0)).length;
    const accuracy = correct / useY.length;

    // 【修复】NaN/Inf检查
    const accuracy_final = isFinite(accuracy) ? accuracy : 0.5;
    if (!isFinite(accuracy)) {
      console.warn(`[Bayesian] 准确率异常: ${accuracy}, 使用默认值0.5`);
    }

    // 置信区间
    const avgUncertainty = mean(preds.map(p => p.std));

    return {
      success: true,
      modelId: 'bayesian',
      modelName: '贝叶斯模型',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: useY.length,
      params: { alpha, beta, prior: 'DiagonalGaussian', mN, featureNames: UNIFIED_FEATURE_NAMES, featMeans, featStds },
      accuracy: accuracy_final, // 方向准确率
      diagnostics: { 
        directionAccuracy: (accuracy_final * 100).toFixed(1) + '%',
        r2: 'N/A (贝叶斯无R²)',
        avgUncertainty: avgUncertainty.toFixed(4),
        posteriorMean: mN.map(m => isFinite(m) ? m.toFixed(3) : '0').join(', ')
      }
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 强化学习 (DQN) ────────────────────────────────────────────────────
async function trainRL(db, options = {}) {
  const targetSampleCount = options.targetSampleCount || 50000;
  try {
    const recentDate = db.prepare(`SELECT date FROM stock_history WHERE volume > 0 ORDER BY date DESC LIMIT 1`).get();
    if (!recentDate) return { success: false, error: '无历史数据' };
    const rows = db.prepare(`
      SELECT code, date, close, change_percent FROM stock_history
      WHERE volume > 0 AND close > 0 AND date >= date(?, '-180 days') AND code IN (SELECT code FROM stocks WHERE name NOT LIKE '%ST%' AND name NOT LIKE '%*ST%' AND name NOT LIKE '%退%' AND name NOT LIKE '%N ' AND name NOT LIKE '%*%')
      ORDER BY code, date DESC
    `).all(recentDate.date);
    if (rows.length < 100) return { success: false, error: '数据不足' };

    const byCode = new Map();
    rows.forEach(r => {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      if (byCode.get(r.code).length < 40) byCode.get(r.code).push(r);
    });
    const codes = Array.from(byCode.keys()).slice(0, 15000);

    // DQN参数
    const stateSize = 3; // [return, volatility, position]
    const actionSize = 3; // [buy, hold, sell]
    const hiddenSize = 8;
    const lr = 0.01;
    const gamma = 0.95;
    const epsilon = 0.1;
    const episodes = 50;

    const initW = (rows, cols) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.3));
    let W1 = initW(stateSize, hiddenSize), b1 = new Array(hiddenSize).fill(0);
    let W2 = initW(hiddenSize, actionSize), b2 = new Array(actionSize).fill(0);
    
    const relu = z => Math.max(0, z);

    // 训练回合
    let totalReward = 0;
    for (let episode = 0; episode < episodes; episode++) {
      // CPU自适应让步
      if (options?.yaodiControlled && checkCpuAndYield(options.cpuThreshold || 80)) {
        if (shouldYield()) { await new Promise(r => setTimeout(r, 50)); }
      }
      for (const code of codes) {
        const bars = byCode.get(code);
        if (bars.length < 10) continue;
        
        let position = 0; // 0=空仓, 1=持仓
        let entryPrice = 0;
        
        for (let i = 5; i < bars.length - 1; i++) {
          const past = bars.slice(i - 5, i);
          const current = bars[i];
          const next = bars[i + 1];
          
          // 状态
          const returns = past.map((b, idx) => idx > 0 ? (b.close - past[idx - 1].close) / past[idx - 1].close : 0);
          const state = [mean(returns), std(returns) || 0.001, position];
          
          // Q值
          const hidden = state.map((s, i) => W1[i].map(w => relu(w * s + b1[i % hiddenSize])));
          const pooled = hidden[0].map((_, j) => mean(hidden.map(h => h[j])));
          const Q = b2.map((b, a) => b + pooled.reduce((s, p, i) => s + W2[i][a] * p, 0));
          
          // 动作选择 (epsilon-greedy)
          let action;
          if (Math.random() < epsilon) {
            action = Math.floor(Math.random() * actionSize);
          } else {
            action = Q.indexOf(Math.max(...Q));
          }
          
          // 执行动作
          let reward = 0;
          if (action === 0 && position === 0) { // buy
            position = 1;
            entryPrice = current.close;
          } else if (action === 2 && position === 1) { // sell
            reward = (current.close - entryPrice) / entryPrice;
            position = 0;
            entryPrice = 0;
          }
          
          // 下一个状态的Q值
          const nextReturns = past.slice(1).concat([current]).map((b, idx) => idx > 0 ? (b.close - past[idx]?.close || b.close) / (past[idx]?.close || b.close) : 0);
          const nextState = [mean(nextReturns), std(nextReturns) || 0.001, position];
          const nextHidden = nextState.map((s, i) => W1[i].map(w => relu(w * s + b1[i % hiddenSize])));
          const nextPooled = nextHidden[0].map((_, j) => mean(nextHidden.map(h => h[j])));
          const nextQ = b2.map((b, a) => b + nextPooled.reduce((s, p, i) => s + W2[i][a] * p, 0));
          const maxNextQ = Math.max(...nextQ);
          
          // TD误差
          const target = reward + gamma * maxNextQ;
          const tdError = target - Q[action];
          totalReward += reward;
          
          // 更新权重
          for (let i = 0; i < hiddenSize; i++) {
            for (let a = 0; a < actionSize; a++) {
              W2[i][a] -= lr * (a === action ? tdError * pooled[i] : 0);
            }
          }
        }
      }
      // 保存检查点（每10个episode）
      if (episode % 10 === 0) {
        const progress_pct = ((episode + 1) / episodes) * 100;
        db.prepare(`INSERT OR REPLACE INTO ml_training_checkpoint (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('rl', bjISO(), codes.length, episode + 1, episodes, progress_pct, 'in_progress', null);
      }
    }

    // 评估
    let correct = 0, total = 0;
    for (const code of codes.slice(0, 50)) {
      const bars = byCode.get(code);
      if (bars.length < 10) continue;
      
      let position = 0;
      for (let i = 5; i < bars.length - 1; i++) {
        const past = bars.slice(i - 5, i);
        const current = bars[i];
        const next = bars[i + 1];
        
        const returns = past.map((b, idx) => idx > 0 ? (b.close - past[idx - 1].close) / past[idx - 1].close : 0);
        const state = [mean(returns), std(returns) || 0.001, position];
        
        const hidden = state.map((s, i) => W1[i].map(w => relu(w * s + b1[i % hiddenSize])));
        const pooled = hidden[0].map((_, j) => mean(hidden.map(h => h[j])));
        const Q = b2.map((b, a) => b + pooled.reduce((s, p, i) => s + W2[i][a] * p, 0));
        const action = Q.indexOf(Math.max(...Q));
        
        const actualUp = next.change_percent > 0;
        const predictedUp = action === 0; // buy signal
        
        if (position === 0) {
          total++;
          if ((predictedUp && actualUp) || (!predictedUp && !actualUp)) correct++;
        }
        
        if (action === 0 && position === 0) position = 1;
        else if (action === 2 && position === 1) position = 0;
      }
    }
    const accuracy = total > 0 ? correct / total : 0.5;

    return {
      success: true,
      modelId: 'rl',
      modelName: '强化学习 DQN',
      trained_at: bjISO(),
      expires_at: new Date(Date.now() + 7 * 864e5 + 8*3600000).toISOString().replace('Z','+08:00'),
      sample_count: codes.length,
      params: { stateSize, actionSize, hiddenSize, lr, gamma, epsilon, episodes, W1, b1, W2, b2 },
      accuracy,
      diagnostics: { 
        accuracy: (accuracy * 100).toFixed(1) + '%',
        totalReward: totalReward.toFixed(4)
      }
    };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 注册表 ───────────────────────────────────────────────────────────

// ── ARIMA Predict ─────────────────────────────────────────────────────
function predictARIMA(params, features) {
  if (!params || params.status === 'failed') return 0.5;
  const { w, featIdx, featMeans, featStds } = params;
  const fsel = (featIdx || [0,1,5,6,7,8]).map((fi, j) => {
    const v = features[fi] || 0, s = featStds?.[j] || 1;
    return s !== 0 ? (v - (featMeans?.[j] || 0)) / s : 0;
  });
  const score = (w || []).reduce((s, wj, j) => s + wj * (fsel[j] || 0), 0);
  return Math.max(0.05, Math.min(0.95, 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, score))))));}

// ── GARCH Predict ────────────────────────────────────────────────────
function predictGARCH(params, features) {
  if (!params || params.status === 'failed') return 0.5;
  const vol = features[1] || 0; // volatility_20d (index 1 in _extractMLFeatures)
  const omega = params.omega || 0.1;
  const alpha = params.alpha || 0.1;
  const beta = params.beta || 0.8;
  const persist = alpha + beta; // GARCH持续性参数
  // Map persistence to score: high persist (>0.8) → trending → slight bullish bias
  // low persist (<0.5) → mean-reverting → neutral
  // 使用tanh映射避免极端值
  const persistScore = 0.5 + 0.15 * Math.tanh((persist - 0.5) * 4);
  // Volatility contribution: moderate vol slightly bullish, extreme vol neutral
  const volLevel = Math.max(0, Math.min(1, vol * 10));
  const volScore = 0.5 + 0.1 * Math.sin(volLevel * Math.PI); // peak at mid-vol
  // Blend: persist dominant, vol secondary
  return Math.max(0.15, Math.min(0.85, persistScore * 0.6 + volScore * 0.2 + 0.5 * 0.2));
}

// ── Autoencoder Predict ──────────────────────────────────────────────
function predictAutoencoder(params, features) {
  if (!params || params.status === 'failed') return 0.5;
  const { W1, b1, Wp, bp, featMeans, featStds, latentDim = 5 } = params;
  // 归一化
  const x = features.map((v, i) => {
    const s = featStds?.[i] || 1;
    return s !== 0 ? (v - (featMeans?.[i] || 0)) / s : 0;
  });
  // encode
  const z1 = W1?.[0] ? W1[0].map((_, j) => (b1?.[j] || 0) + (W1 || []).reduce((s, row) => s + (row[j] || 0) * x[W1.indexOf(row)], 0)) : new Array(latentDim).fill(0);
  const h1 = z1.map(v => Math.tanh(Math.max(-500, Math.min(500, v))));
  // 预测
  const score = (Wp || []).reduce((s, row, j) => s + (row[0] || 0) * h1[j], 0) + (bp || 0);
  const pred = 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, score))));
  return Math.max(0.05, Math.min(0.95, pred));
}

// ── LSTM Predict ─────────────────────────────────────────────────────
function predictLSTM(params, features) {
  if (!params || params.status === 'failed') return 0.5;
  const { Wf, Wi_p, Wc, Wo, bf, bi, bc, bo, Wy, by: byVal, featMeans, featStds, hiddenSize = 16, seqLen = 5 } = params;
  // 兼容新旧参数名: 训练时Wi是门控权重, predict时Wi_p避免与input gate冲突
  const WiGate = params.Wi || Wi_p;
  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
  const tanhFn = z => Math.tanh(Math.max(-500, Math.min(500, z)));
  
  // 特征归一化 → 构造序列输入
  const norm = features.slice(0, 20).map((v, i) => {
    const mean = featMeans?.[i] || 0, std = featStds?.[i] || 1;
    return std > 0 ? (v - mean) / std : 0;
  });
  
  // 用特征均值构造序列(每个时间步用同一特征)
  const xt = norm.reduce((s, v) => s + v, 0) / Math.max(norm.length, 1);  // 压缩为标量
  
  // 前向传播(与训练一致)
  let h = new Array(hiddenSize).fill(0), c_state = new Array(hiddenSize).fill(0);
  for (let t = 0; t < seqLen; t++) {
    const ft = h.map((hi, i) => sigmoid((Wf?.[i]?.[0] || 0) * xt + (Wf?.[i]?.[1] || 0) * hi + (bf?.[i] || 0)));
    const it = h.map((hi, i) => sigmoid((WiGate?.[i]?.[0] || 0) * xt + (WiGate?.[i]?.[1] || 0) * hi + (bi?.[i] || 0)));
    const ct = h.map((hi, i) => tanhFn((Wc?.[i]?.[0] || 0) * xt + (Wc?.[i]?.[1] || 0) * hi + (bc?.[i] || 0)));
    const c_new = c_state.map((ci, i) => ft[i] * ci + it[i] * ct[i]);
    const ot = h.map((hi, i) => sigmoid((Wo?.[i]?.[0] || 0) * xt + (Wo?.[i]?.[1] || 0) * hi + (bo?.[i] || 0)));
    h = ot.map((oi, i) => oi * tanhFn(c_new[i]));
    c_state = c_new;
  }
  
  // 输出层(回归，不用sigmoid)
  const pred = h.reduce((s, hi, i) => s + (Wy?.[0]?.[i] || 0) * hi, 0) + (byVal || 0);
  // 映射到0-1概率
  return Math.max(0.05, Math.min(0.95, sigmoid(pred * 5)));  // 放大5倍增强区分度
}

// ── GRU Predict ──────────────────────────────────────────────────────
function predictGRU(params, features) {
  if (!params || params.status === 'failed') return 0.5;
  const { Wi, bi, Wy, by, featMeans, featStds, hiddenSize = 6 } = params;
  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
  
  // Normalize features using featMeans/featStds
  const norm = features.slice(0, 15).map((v, i) => {
    const mean = featMeans?.[i] || 0, std = featStds?.[i] || 1;
    return std > 0 ? (v - mean) / std : 0;
  });
  
  // Compute hidden layer
  const h = [];
  for (let hi = 0; hi < hiddenSize; hi++) {
    let sum = (bi?.[hi] || 0);
    for (let fi = 0; fi < norm.length && (fi + 6) < Wi.length; fi++) {
      sum += (Wi[fi + 6]?.[hi] || 0) * norm[fi];
    }
    h.push(sigmoid(sum));
  }
  
  // If Wy is null/missing, use mean of hidden values
  let outSum = (by || 0);
  const hasWy = Wy?.some(w => w?.[0] != null);
  if (hasWy) {
    for (let hi = 0; hi < hiddenSize; hi++) outSum += h[hi] * (Wy[hi + 6]?.[0] || 0);
  } else {
    return Math.max(0.05, Math.min(0.95, h.reduce((a, b) => a + b, 0) / hiddenSize));
  }
  return Math.max(0.05, Math.min(0.95, sigmoid(outSum)));
}

// ── CNN Predict ──────────────────────────────────────────────────────
function predictCNN(params, features) {
  if (!params || params.status === 'failed') return 0.5;
  const { numFilters, filterSize, seqLen, filters, filterBias, fcW, fcB } = params;
  const relu = z => Math.max(0, z);
  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));

  // 构造成K线序列
  const seq = [];
  for (let t = seqLen - 1; t >= 0; t--) {
    seq.push(features.map(v => v * (1 - t * 0.03)));
  }
  const nFeatPerStep = 3;

  // 卷积
  const convOut = [];
  for (let f = 0; f < numFilters; f++) {
    const featMap = [];
    for (let i = 0; i <= seqLen - filterSize; i++) {
      let sum = (filterBias[f] || 0);
      for (let j = 0; j < filterSize; j++) {
        for (let k = 0; k < nFeatPerStep; k++) {
          sum += (filters[f]?.[j * nFeatPerStep + k] || 0) * (seq[i + j]?.[k] || 0);
        }
      }
      featMap.push(relu(sum));
    }
    convOut.push(featMap);
  }
  // 池化
  const pooled = [];
  for (let f = 0; f < numFilters; f++) {
    for (let i = 0; i < (convOut[f]?.length || 0); i += 2) {
      pooled.push(Math.max(convOut[f][i] || 0, convOut[f][i + 1] || 0));
    }
  }
  const score = sigmoid(pooled.reduce((s, p, i) => s + (fcW[i] || 0) * p, 0) + (fcB || 0));
  return Math.max(0.05, Math.min(0.95, score));
}

// ── Transformer Predict ──────────────────────────────────────────────
function predictTransformer(params, features) {
  if (!params || params.status === 'failed') return 0.5;
  const { Wq, Wk, Wv, fcW, fcB, featMeans, featStds, dModel = 8 } = params;
  // 归一化
  const x = features.map((v, i) => {
    const s = featStds?.[i] || 1;
    return s !== 0 ? (v - (featMeans?.[i] || 0)) / s : 0;
  });
  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
  const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const softmax = arr => { const mx = Math.max(...arr); const ex = arr.map(v => Math.exp(Math.min(500, Math.max(-500, v - mx)))); const s = ex.reduce((a, b) => a + b, 0) || 1; return ex.map(v => v / s); };
  // QKV attention
  const q = (Wq || []).map((row, i) => row.reduce((s, w) => s + w * x[i], 0));
  const k = (Wk || []).map((row, i) => row.reduce((s, w) => s + w * x[i], 0));
  const v = (Wv || []).map((row, i) => row.reduce((s, w) => s + w * x[i], 0));
  const attn = softmax(q.map((qi, i) => qi * (k[i] || 0) / Math.sqrt(dModel)));
  const attended = v.map((vi, i) => vi * attn[i]);
  const pooled = mean(attended);
  const out = (fcW || []).reduce((s, row, i) => s + (row[0] || 0) * attended[i], 0) + (fcB || 0);
  return Math.max(0.05, Math.min(0.95, sigmoid(out)));
}

// ── GNN Predict ──────────────────────────────────────────────────────
function predictGNN(params, features) {
  if (!params || params.status === 'failed') return 0.5;
  const { W1, W2, b1, b2 } = params;
  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
  const relu = z => Math.max(0, Math.min(5, z)); // cap relu output

  // features: [selfReturn, sectorReturn, sectorSize] — 从14维映射
  // No aggressive multiplier - features already normalized in _extractMLFeatures
  const x = [
    features[8] || 0,   // mom5
    features[1] || 0,   // vol20
    features[13] || 0   // industry
  ];

  // 图卷积层
  const h = x.map((xi, i) => (W1[i] || []).map(w => relu(w * xi + (b1[i] || 0))));
  const pooled = h[0].map((_, j) => {
    let s = 0, cnt = 0;
    for (let i = 0; i < h.length; i++) { s += (h[i]?.[j] || 0); cnt++; }
    return cnt > 0 ? s / cnt : 0;
  });
  const logit = pooled.reduce((s, p, i) => s + (W2[i]?.[0] || 0) * p, 0) + (b2 || 0);
  const clampedLogit = Math.max(-6, Math.min(6, logit));
  return sigmoid(clampedLogit);
}

// ── Bayesian Predict ──────────────────────────────────────────────────
function predictBayesian(params, features) {
  if (!params || params.status === 'failed') return 0.5;
  const { mN, featMeans, featStds } = params;
  // 使用全部14个特征，无过时featIdx
  const nFeat = (mN || []).length || 14;
  let score = 0;
  for (let i = 0; i < nFeat; i++) {
    const v = features[i] || 0;
    const mean = (featMeans || [])[i] || 0;
    const std = (featStds || [])[i] || 1;
    const norm = std > 1e-8 ? (v - mean) / std : 0;
    score += (mN[i] || 0) * norm;
  }
  const clipped = Math.max(-500, Math.min(500, score));
  return 0.05 + 0.90 / (1 + Math.exp(-clipped));
}

// ── RL(DQN) Predict ───────────────────────────────────────────────────
function predictRL(params, features) {
  if (!params || params.status === 'failed') return 0.5;
  const { W1, b1, W2, b2, featMeans, featStds, featIdx } = params;
  const fsel = (featIdx || [0,1,5,7,8,11]).map((fi, j) => {
    const v = features[fi] || 0, s = featStds?.[j] || 1;
    return s !== 0 ? (v - (featMeans?.[j] || 0)) / s : 0;
  });
  const relu = z => Math.max(0, z);
  const hidden = (W1?.[0] && W1.length >= 6)
    ? W1[0].map((_, j) => relu((W1 || []).reduce((s, row, ri) => s + (row[j] || 0) * (fsel[ri] || 0), 0) + (b1?.[j] || 0)))
    : new Array(12).fill(0);
  const qBuy = hidden.reduce((s, h, j) => s + ((W2 || [])[j]?.[0] || 0) * h, 0) + (b2?.[0] || 0);
  const qSell = hidden.reduce((s, h, j) => s + ((W2 || [])[j]?.[2] || 0) * h, 0) + (b2?.[2] || 0);
  const score = qBuy > qSell ? 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, qBuy - qSell)))) : 0.5;
  return Math.max(0.05, Math.min(0.95, score));
}


export const ML_MODELS = {
  // Phase 1
  linear:    { name: '线性回归/逻辑回归', phase: 1, fn: trainLinear, predict: predictLinear },
  xgboost:   { name: 'XGBoost',           phase: 1, fn: trainXGBoost, predict: predictXGBoost },
  lightgbm:  { name: 'LightGBM',          phase: 1, fn: trainLightGBM, predict: predictLightGBM },
  arima:     { name: 'ARIMA',             phase: 1, fn: trainARIMA, predict: predictARIMA },
  garch:     { name: 'GARCH',             phase: 1, fn: trainGARCH, predict: predictGARCH },
  rf:        { name: 'Random Forest',     phase: 1, fn: trainRandomForest, predict: predictRandomForest },
  // Phase 2
  catboost:  { name: 'CatBoost',          phase: 2, fn: trainCatBoost, predict: predictCatBoost },
  svm:       { name: 'SVM',               phase: 2, fn: trainSVM, predict: predictSVM },
  autoencoder: { name: 'Autoencoder',     phase: 2, fn: trainAutoencoder, predict: predictAutoencoder },
  lstm:      { name: 'LSTM',              phase: 2, fn: trainLSTM, predict: predictLSTM },
  gru:       { name: 'GRU',               phase: 2, fn: trainGRU, predict: predictGRU },
  // Phase 3
  cnn:       { name: 'CNN',               phase: 3, fn: trainCNN, predict: predictCNN },
  transformer: { name: 'Transformer',     phase: 3, fn: trainTransformer, predict: predictTransformer },
  gnn:       { name: 'GNN',               phase: 3, fn: trainGNN, predict: predictGNN },
  bayesian:  { name: '贝叶斯模型',         phase: 3, fn: trainBayesian, predict: predictBayesian },
  rl:        { name: '强化学习 DQN',       phase: 3, fn: trainRL, predict: predictRL },
};


function predictRandomForest(params, features) {
  if (!params.trees || !params.featureNames) return null;
  const { trees, featureNames } = params;
  // features 已按 featureNames 顺序传入（由 _predictWithMLModels 的特征映射保证）
  const preds = trees.map(tree => {
    let node = tree;
    while (!node.leaf) {
      const featVal = features[node.feature] !== undefined ? features[node.feature] : 0;
      const threshold = node.split !== undefined ? node.split : node.threshold; // 兼容 split 和 threshold 两种命名
      node = featVal <= threshold ? node.left : node.right;
    }
    return node.value || 0;
  });
  const avg = preds.reduce((a, b) => a + b, 0) / preds.length;
  return 1 / (1 + Math.exp(-avg * 10));
}
function predictSVM(params, features) {
  if (!params.w || params.b === undefined) return null;
  const nWeights = params.w.length;
  let x = features.slice(0, nWeights);
  if (params.featMeans && params.featStds) {
    x = x.map((v, i) => {
      const std = params.featStds[i] || 1;
      return (v - (params.featMeans[i] || 0)) / std;
    });
  }
  // Clip normalized features to [-2, 2] to prevent z-score explosion
  x = x.map(v => Math.max(-2, Math.min(2, v)));
  const z = x.reduce((sum, xi, i) => sum + (params.w[i] || 0) * xi, 0) + params.b;
  const clampedZ = Math.max(-4, Math.min(4, z));
  return 1 / (1 + Math.exp(-clampedZ));
}
function predictCatBoost(modelParams, features) {
  if (!modelParams || !modelParams.trees || modelParams.trees.length === 0) return null;
  // Normalize features using training statistics if available
  let x = features;
  if (modelParams.featMeans && modelParams.featStds) {
    x = features.map((v, i) => {
      const std = modelParams.featStds[i] || 1;
      return (v - (modelParams.featMeans[i] || 0)) / std;
    });
  }
  // CatBoost trees are flat: { feature, threshold, leftVal, rightVal }
  let logit = 0;
  for (const tree of modelParams.trees) {
    logit += x[tree.feature] < tree.threshold ? tree.leftVal : tree.rightVal;
  }
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, logit))));
}
function predictWithModel(modelId, features, params) {
  const fns = { linear: predictLinear, xgboost: predictXGBoost, lightgbm: predictLightGBM, rf: predictRandomForest, svm: predictSVM, catboost: predictCatBoost };
  if (!fns[modelId]) return null;
  try { return fns[modelId](params, features); } catch(e) { return null; }
}
async function batchPredictWithMLModels(db, stockCode, features) {
  const results = {};
  for (const [modelId, model] of Object.entries(ML_MODELS)) {
    if (!model.predict) continue;
    try {
      const row = db.prepare(`SELECT data FROM ai_ml_model WHERE id=?`).get(modelId);
      if (!row) continue;
      const modelData = JSON.parse(row.data);
      if (!modelData || !modelData.params || modelData.params.status === 'failed') continue;
      const score = model.predict(modelData.params, features);
      if (score !== null) results[modelId] = { score, accuracy: modelData.accuracy || 0 };
    } catch(e) { /* skip */ }
  }
  return results;
}

export { predictLinear, predictXGBoost, predictLightGBM, predictRandomForest, predictSVM, predictCatBoost, predictWithModel, batchPredictWithMLModels };

// 【Phase 2 2026-05-27】批量获取北向持股数据
function batchGetNorthboundData(codes, days = 5, extDb = null) {
  const result = new Map();
  if (!codes || codes.length === 0) return result;
  
  try {
    const db = extDb || getDB();
    const placeholders = codes.map(() => '?').join(',');
    const today = bjISO().slice(0,10);
    
    // 查询最近 N 日北向持股数据
    const rows = db.prepare(`
      SELECT code, date, hold_ratio, hold_amount, hold_market_value, change_amount
      FROM northbound_holdings
      WHERE code IN (${placeholders}) AND date <= ?
      ORDER BY code, date DESC
    `).all(...codes, today);
    
    // 按股票代码分组，计算平均持股占比
    const codeData = {};
    rows.forEach(row => {
      if (!codeData[row.code]) codeData[row.code] = [];
      codeData[row.code].push(row);
    });
    
    Object.keys(codeData).forEach(code => {
      const recent = codeData[code].slice(0, days);
      const avgHoldRatio = recent.reduce((sum, r) => sum + (r.hold_ratio || 0), 0) / recent.length;
      const avgChange = recent.reduce((sum, r) => sum + (r.change_amount || 0), 0) / recent.length;
      const latestMarketValue = recent[0]?.hold_market_value || 0;
      
      result.set(code, {
        holdRatio: avgHoldRatio || 0,
        holdChange: avgChange || 0,
        holdMarketValue: latestMarketValue || 0
      });
    });
    
    if (result.size > 0) {
      console.log(`[北向持股] 获取 ${result.size} 只股票北向持股数据`);
    }
  } catch (e) {
    console.error('[北向持股] 查询失败:', e.message);
  }
  
  return result;
}

export { UNIFIED_FEATURE_NAMES, buildUnifiedFeatures };
