/**
 * ============================================================
 * 尧帝2.0 核心选股引擎 (YaodiV2 Core)
 * ============================================================
 * 路径: /Users/shao/Projects/FQMSystem/backend/yaodi_v2_core.js
 * 作者: 量化系统后端开发工程师
 * 版本: 2.0.0
 * 描述: 三层引擎驱动的智能选股系统：L1多维因子共振 → L2 Stacking集成精排 → L3三重防御风控
 * 
 * 架构:
 *   L1 (每日批处理): 全市场股票 → Top 300 候选池
 *   L2 (盘中扫描):   Top 300 → Top 50 精排池
 *   L3 (实时过滤):   Top 50 → 最终信号 + 风控拦截
 * ============================================================
 */

'use strict';

import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

// ESM 环境下定义 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import BetterSqlite3 from 'better-sqlite3';
import { saveModels, loadModels, savePools, loadPools } from './yaodi_v2/model_persistence.js';
import {
  logSignal, updateSignalRewards,
  evaluateFactorPerformance, adjustFactorWeights,
  evaluateModelAccuracy, shouldRetrain,
  getFactorWeights, getLearningStatus,
  initConfig as initLearningConfig,
  recordSignalOutcome as recordOutcome,
} from './yaodi_v2/incremental_learning.js';
import { toBeijingTime, bjDate, bjISO, bjNow, bjNowStr } from './beijingTime.js';

// ============================================================
// 数据库访问层 (Database Access Layer)
// ============================================================

/**
 * 数据库访问封装 — 统一所有SQL操作
 * 使用 better-sqlite3 同步API，性能优异
 */
class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this._init();
  }

  _init() {
    try {
      this.db = new BetterSqlite3(this.dbPath, {
        // 高性能配置
        fileMustExist: false,
        timeout: 30000,
        verbose: null  // 调试时可改为 console.log
      });
      // 启用外键约束（默认关闭以提升写入性能）
      this.db.pragma('foreign_keys = ON');
      // WAL模式提升并发读性能
      this.db.pragma('journal_mode = WAL');
      this._ensureTables();
      Logger.info('[DB] 数据库初始化完成', { path: this.dbPath });
    } catch (err) {
      Logger.error('[DB] 初始化失败', { error: err.message });
      throw err;
    }
  }

  /**
   * 确保必要的数据表存在，不存在则创建
   */
  _ensureTables() {
    // L1因子缓存表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS yaodi_l1_cache (
        code        TEXT PRIMARY KEY,
        name        TEXT,
        l1_score    REAL NOT NULL DEFAULT 0,
        rank        INTEGER,
        value_score REAL DEFAULT 0,
        size_score  REAL DEFAULT 0,
        momentum_score REAL DEFAULT 0,
        quality_score REAL DEFAULT 0,
        volatility_score REAL DEFAULT 0,
        pe_percentile  REAL,
        pb_percentile  REAL,
        dividend_yield REAL,
        market_cap_log  REAL,
        relative_return_120d REAL,
        price_strength_20d REAL,
        roe_stability    REAL,
        cash_flow_ratio  REAL,
        idio_volatility  REAL,
        sector_code      TEXT,
        updated_at       TEXT DEFAULT (datetime('now','+8 hours'))
      );

      CREATE TABLE IF NOT EXISTS yaodi_l2_cache (
        code        TEXT PRIMARY KEY,
        l2_score    REAL NOT NULL DEFAULT 0,
        rank        INTEGER,
        confidence  REAL DEFAULT 0,
        gbdt_pred   REAL DEFAULT 0,
        histgbdt_pred REAL DEFAULT 0,
        category_boost REAL DEFAULT 0,
        meta_pred   REAL DEFAULT 0,
        updated_at  TEXT DEFAULT (datetime('now','+8 hours'))
      );

      CREATE TABLE IF NOT EXISTS yaodi_l3_signals (
        code        TEXT PRIMARY KEY,
        name        TEXT,
        kelly_pct   REAL NOT NULL DEFAULT 0,
        stop_loss_pct REAL,
        atr         REAL,
        confidence  REAL DEFAULT 0,
        signal_status TEXT DEFAULT 'pending',
        block_reason TEXT,
        sector_code TEXT,
        l2_rank     INTEGER,
        updated_at  TEXT DEFAULT (datetime('now','+8 hours'))
      );

      CREATE TABLE IF NOT EXISTS yaodi_engine_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        layer       TEXT NOT NULL,
        run_at      TEXT NOT NULL,
        duration_ms INTEGER,
        stock_count INTEGER,
        market_env  TEXT,
        status      TEXT DEFAULT 'success',
        error_msg   TEXT,
        created_at  TEXT DEFAULT (datetime('now','+8 hours'))
      );

      CREATE INDEX IF NOT EXISTS idx_l1_score ON yaodi_l1_cache(l1_score DESC);
      CREATE INDEX IF NOT EXISTS idx_l2_score ON yaodi_l2_cache(l2_score DESC);
      CREATE INDEX IF NOT EXISTS idx_l3_kelly ON yaodi_l3_signals(kelly_pct DESC);
    `);
  }

  /**
   * 执行带参数化的SELECT查询，返回全部结果
   */
  all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  /**
   * 执行带参数化的SELECT查询，返回首行
   */
  get(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }

  /**
   * 执行INSERT/UPDATE/DELETE，返回changes数量
   */
  run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  /**
   * 批量upsert（事务保证原子性）
   */
  batchUpsert(table, rows, primaryKey) {
    if (!rows || rows.length === 0) return 0;
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(', ');
    const updateCols = cols.filter(c => c !== primaryKey).map(c => `${c}=excluded.${c}`).join(', ');
    
    const insertSql = `INSERT INTO ${table} (${cols.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT(${primaryKey}) DO UPDATE SET ${updateCols}`;
    
    const stmt = this.db.prepare(insertSql);
    const transaction = this.db.transaction(() => {
      let count = 0;
      for (const row of rows) {
        const res = stmt.run(...cols.map(c => row[c]));
        count += res.changes;
      }
      return count;
    });
    return transaction();
  }

  /**
   * 获取预编译语句（直接暴露底层 better-sqlite3 的 prepare）
   */
  prepare(sql) {
    return this.db.prepare(sql);
  }

  /**
   * 执行事务（直接暴露底层 better-sqlite3 的 transaction）
   */
  transaction(fn) {
    const t = this.db.transaction(fn);
    return t();
  }

  close() {
    if (this.db) {
      this.db.close();
      Logger.info('[DB] 数据库连接已关闭');
    }
  }
}

// ============================================================
// 日志系统 (Logger)
// ============================================================

const Logger = {
  prefix: '[YaodiV2]',

  _log(level, msg, meta = {}) {
    const ts = bjISO();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    // eslint-disable-next-line no-console
    console.log(`${ts} ${this.prefix} [${level}] ${msg}${metaStr}`);
  },

  info(msg, meta)  { this._log('INFO',  msg, meta); },
  warn(msg, meta)  { this._log('WARN',  msg, meta); },
  error(msg, meta) { this._log('ERROR', msg, meta); },
  debug(msg, meta) { if (process.env.YAODI_DEBUG) this._log('DEBUG', msg, meta); }
};

// ============================================================
// 工具函数库 (Utilities)
// ============================================================

/**
 * 计算数组的百分位数
 * @param {number[]} arr 数值数组
 * @param {number} p 百分位 (0-100)
 * @returns {number} 百分位值
 */
function percentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].filter(v => isFinite(v) && v !== null && !isNaN(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

/**
 * 计算数组均值
 */
function mean(arr) {
  const valid = arr.filter(v => isFinite(v));
  return valid.length === 0 ? 0 : valid.reduce((s, v) => s + v, 0) / valid.length;
}

/**
 * 计算数组标准差
 */
function std(arr) {
  const valid = arr.filter(v => isFinite(v));
  if (valid.length < 2) return 0;
  const m = mean(valid);
  const variance = valid.reduce((s, v) => s + (v - m) ** 2, 0) / (valid.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

/** 计算RSI (Relative Strength Index) */
function calcRSI(changes, period = 14) {
  if (changes.length < 2) return 50;
  let gains = 0, losses = 0;
  for (let i = Math.max(0, changes.length - period - 1); i < changes.length; i++) {
    if (changes[i] > 0) gains += changes[i];
    else losses -= changes[i];
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/** 计算EMA (Exponential Moving Average) */
function calcEMA(prices, period) {
  if (prices.length < period) return prices.length > 0 ? mean(prices) : 0;
  const k = 2 / (period + 1);
  let ema = mean(prices.slice(0, period));
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

/** 计算MACD: { macd, signal, hist } */
function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return { macd: 0, signal: 0, hist: 0 };
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  let macdLine = emaFast - emaSlow;
  let signalLine = macdLine;
  const macdHist = macdLine - signalLine;
  return { macd: macdLine, signal: signalLine, hist: macdHist };
}

/** 计算布林带: { upper, middle, lower } */
function calcBOLL(closes, period = 20, mult = 2) {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = closes.slice(-period);
  const middle = mean(slice);
  const s = Math.sqrt(slice.reduce((sum, p) => sum + (p - middle) ** 2, 0) / period);
  return { upper: middle + mult * s, middle, lower: middle - mult * s };
}

/** 计算KDJ */
function calcKDJ(closes, period = 9) {
  if (closes.length < period) return { k: 50, d: 50, j: 50 };
  const slice = closes.slice(-period);
  const max_ = Math.max(...slice), min_ = Math.min(...slice);
  const range = max_ - min_;
  const k = range > 0 ? ((closes[closes.length - 1] - min_) / range) * 100 : 50;
  return { k: Math.round(k * 10) / 10, d: k, j: k * 3 - k * 2 };
}

/**
 * Z-Score 标准化
 */
function zscore(val, arr) {
  const m = mean(arr);
  const s = std(arr);
  return s === 0 ? 0 : (val - m) / s;
}

/**
 * 线性回归（用于行业中性化）
 * 返回 { slope, intercept, residuals }
 */
function linearRegression(xArr, yArr) {
  const n = Math.min(xArr.length, yArr.length);
  if (n < 2) return { slope: 0, intercept: 0, residuals: yArr.map(() => 0) };

  const xMean = mean(xArr);
  const yMean = mean(yArr);
  let ssXY = 0, ssXX = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (xArr[i] - xMean) * (yArr[i] - yMean);
    ssXX += (xArr[i] - xMean) ** 2;
  }
  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = yMean - slope * xMean;
  const residuals = yArr.slice(0, n).map((y, i) => y - (slope * xArr[i] + intercept));
  return { slope, intercept, residuals };
}

/**
 * Pearson相关系数
 */
function pearsonCorr(xArr, yArr) {
  const n = Math.min(xArr.length, yArr.length);
  if (n < 2) return 0;
  const xMean = mean(xArr), yMean = mean(yArr);
  let cov = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xArr[i] - xMean, dy = yArr[i] - yMean;
    cov += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  const denom = Math.sqrt(sx * sy);
  return denom === 0 ? 0 : cov / denom;
}

/**
 * 根据股票代码前缀推断行业板块代码
 * 规则：000深主板 / 002中小板 / 300创业板 / 600|601|603沪主板 / 688科创板 / 8xx北交所
 */
function getSectorCode(code) {
  if (!code || code.length < 3) return 'OTHER';
  const prefix = code.substring(0, 3);
  if (code.startsWith('8')) return 'BEI';
  if (code.startsWith('688')) return 'KCB';
  if (['600', '601', '603'].includes(prefix)) return 'SH';
  if (prefix === '000') return 'SZ_MAIN';
  if (prefix === '002') return 'SME';
  if (prefix === '300') return 'GEM';
  return 'OTHER';
}

/**
 * 获取市场板块中文名称
 */
function getSectorName(code) {
  const map = {
    'SH':      '沪主板',
    'SZ_MAIN': '深主板',
    'SME':     '中小板',
    'GEM':     '创业板',
    'KCB':     '科创板',
    'BEI':     '北交所',
    'OTHER':   '其他'
  };
  return map[getSectorCode(code)] || '其他';
}

/**
 * ATR (Average True Range) 计算
 * @param {Array} bars 形如 { high, low, close }
 * @param {number} period 默认14
 */
function calcATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const high  = bars[i].high;
    const low   = bars[i].low;
    const prev  = bars[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prev),
      Math.abs(low  - prev)
    );
    if (isFinite(tr)) trs.push(tr);
  }
  if (trs.length < period) return 0;
  // Wilder's smoothing
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/**
 * 复利增长均值（用于动量因子）
 */
function cagr(returns) {
  if (!returns || returns.length === 0) return 0;
  // returns 数组中每个元素是单日涨跌幅 (小数)
  const total = returns.reduce((s, r) => s * (1 + r), 1);
  const years = returns.length / 252; // 假设年交易日252天
  return Math.pow(total, 1 / years) - 1;
}

/**
 * 日期工具
 */
function todayStr() {
  return bjDate();
}

function NDaysAgo(n) {
  const d = toBeijingTime();
  d.setDate(d.getDate() - n);
  const pad = m => String(m).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

// ============================================================
// L1: 多维因子共振引擎
// ============================================================

/**
 * L1 多维因子共振引擎
 * 全市场 → Top 300 候选池
 * 
 * 五大因子:
 *   1. 价值因子 (Value)   — PE/PB分位数、股息率
 *   2. 市值因子 (Size)    — 自由流通市值对数（倾向50-200亿）
 *   3. 动量因子 (Momentum)— 120日相对大盘涨幅 + 20日价格强度
 *   4. 质量因子 (Quality) — ROE稳定性、经营性现金流/净利润
 *   5. 波动因子 (Vol)     — 特异性波动率（剔除妖股）
 * 
 * 行业中性化: 对每个因子做分组哑变量回归，取残差
 * 动态权重: 根据牛熊市场环境动态调整
 */
class L1Engine {
  constructor(db, marketEnv = 'neutral') {
    this.db = db;
    this.marketEnv = marketEnv || 'neutral';
    // 行业中性化因子权重（牛熊动态调整）
    this.factorWeights = this._getFactorWeights();
  }

  /**
   * 根据市场环境返回五大因子权重
   * 牛市: 动量+质量为主；熊市: 价值+质量为主；震荡: 均衡
   */
  _getFactorWeights() {
    // 优先使用增量学习模块的动态因子权重
    const learnedWeights = getFactorWeights();
    if (learnedWeights && Object.keys(learnedWeights).length > 0) {
      return {
        value:     learnedWeights.value     ?? 1.0,
        size:      learnedWeights.size      ?? 0.5,
        momentum:  learnedWeights.momentum  ?? 1.0,
        quality:   learnedWeights.quality   ?? 1.0,
        volatility:learnedWeights.volatility ?? 1.0,
      };
    }

    // 回退：根据市场环境使用默认权重
    const env = this.marketEnv || 'neutral';
    const weights = {
      bull:    { value: 0.15, size: 0.10, momentum: 0.30, quality: 0.30, volatility: 0.15 },
      bear:    { value: 0.35, size: 0.05, momentum: 0.10, quality: 0.35, volatility: 0.15 },
      neutral: { value: 0.20, size: 0.15, momentum: 0.20, quality: 0.25, volatility: 0.20 }
    };
    return weights[env] || weights.neutral;
  }

  /**
   * 主入口: 运行L1全量扫描（两遍扫描优化）
   * @param {string} marketEnv 市场环境: 'bull' | 'bear' | 'neutral'
   * @returns {Promise<{top300, factorStats, runTime, marketEnv}>}
   */
  async run(marketEnv) {
    const startTime = Date.now();
    const env = marketEnv || this.marketEnv;

    Logger.info(`[L1] 开始L1因子扫描（两遍扫描）, 环境=${env}`);

    try {
      // ========== Pass 1: 基础扫描（无历史K线）==========
      Logger.info('[L1] ========= Pass 1: 基础扫描 =========');
      const stocksPass1 = this._loadMarketData(null, true);
      if (stocksPass1.length === 0) {
        Logger.warn('[L1] 市场数据为空');
        return { top300: [], factorStats: {}, runTime: 0, marketEnv: env };
      }

      // 计算因子（momentum/volatility会是0或默认值）
      const withFactorsP1 = this._computeFactors(stocksPass1, env);
      const scoredP1 = this._computeScores(withFactorsP1);
      const top1000 = scoredP1
        .sort((a, b) => b.l1_total_score - a.l1_total_score)
        .slice(0, 500)
        .map(s => s.code);

      Logger.info(`[L1] Pass 1 完成，选出top1000`, { count: top1000.length });

      // ========== Pass 2: 流式批处理（每次50只，控制内存）==========
      Logger.info('[L1] ========= Pass 2: 流式批处理 =========');
      const BATCH_SIZE = 50;
      let allWithFactors = [];

      for (let i = 0; i < top1000.length; i += BATCH_SIZE) {
        const batchCodes = top1000.slice(i, i + BATCH_SIZE);
        Logger.info(`[L1] 批次 ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(top1000.length/BATCH_SIZE)} (${batchCodes.length} 只)`);
        
        // 只加载这50只的历史数据 (50 × 120 = 6,000 K线, 约30MB)
        const batchStocks = this._loadMarketData(batchCodes, false);
        
        // 计算因子（使用120天历史）
        const batchWithFactors = this._computeFactors(batchStocks, env);
        
        // 合并到全局
        allWithFactors = allWithFactors.concat(batchWithFactors);
        
        // 显式释放大对象（帮助GC）
        batchStocks.forEach(s => { s.history = null; s.benchmark = null; });
        Logger.info(`[L1] 批次完成，已处理 ${allWithFactors.length}/${top1000.length}`);
      }

      Logger.info('[L1] 所有批次完成，开始行业中性化');
      const withFactorsP2 = allWithFactors;

      // Step 3: 行业中性化（对每个因子做分组回归残差）
      const neutralized = this._industryNeutralize(withFactorsP2);

      // Step 4: 动态打分 + 合并综合分
      const scoredP2 = this._computeScores(neutralized);

      // Step 5: 排序并截取Top300
      const top300 = scoredP2
        .sort((a, b) => b.l1_total_score - a.l1_total_score)
        .slice(0, 300);

      // Step 6: 补充排名
      top300.forEach((s, i) => { s.l1_rank = i + 1; });

      // Step 7: 因子统计
      const factorStats = this._computeFactorStats(withFactorsP2);

      // Step 8: 写入缓存
      this._saveToCache(top300);

      const runTime = Date.now() - startTime;
      Logger.info(`[L1] Pass 2 完成，Top300耗时${runTime}ms`);

      return { top300, factorStats, runTime, marketEnv: env };
    } catch (err) {
      Logger.error('[L1] L1运行异常', { error: err.message, stack: err.stack });
      throw err;
    }
  }

  /**
   * 加载全市场基础数据（实时+财务+历史）
   * @param {string[]|null} codeFilter 可选，只加载指定股票代码
   * @param {boolean} skipHistory 可选，跳过历史K线加载（第一遍扫描用）
   * @returns {Object[]} 股票数组
   */
  _loadMarketData(codeFilter = null, skipHistory = false) {
    // 取最近20个交易日
    const histDates = this.db.prepare(`SELECT DISTINCT date FROM stock_history ORDER BY date DESC LIMIT 20`).all().map(r => r.date).reverse();

    if (histDates.length < 20) {
      Logger.warn('[L1] 历史数据不足20日', { available: histDates.length });
    }

    // 实时行情（过滤ST/退市股）
    const realtime = this.db.prepare(`SELECT code, name, price, pre_close, change, change_percent,
              high, low, volume, amount
       FROM stock_realtime
       WHERE price > 0 AND volume > 0
         AND name NOT LIKE '%ST%' AND name NOT LIKE '%退%'`).all();
    Logger.info('[L1] 加载实时行情', { total: realtime.length, filtered: 'ST/退' });

    // 财务数据
    const fundamentals = this.db.prepare(`SELECT code, pe_ttm, pb, ps_ttm, roe_ttm, roa, gross_margin,
              net_margin, revenue_growth_yoy, profit_growth_yoy,
              asset_turnover, current_ratio, dividend_yield,
              market_cap, float_cap,
              industry_level1
       FROM stock_fundamentals_v2`).all();
    const fundMap = new Map(fundamentals.map(f => [f.code, f]));

    // 如果跳过历史加载（第一遍扫描），直接返回
    if (skipHistory) {
      Logger.info('[L1] 跳过历史K线加载（第一遍扫描）');
      return realtime.map(s => ({
        ...s,
        fundamentals: fundMap.get(s.code) || {},
        history: [],
        benchmark: [],
        sector_code: getSectorCode(s.code)
      }));
    }

    // 第二遍：只加载指定股票的历史数据
    const targetCodes = codeFilter || realtime.map(s => s.code);
    Logger.info('[L1] 加载历史数据', { totalStocks: targetCodes.length, filtered: !!codeFilter });

    // 历史K线（取60日）— 分批查询优化
    const histMap = new Map();
    const BATCH_SIZE = 500;

    for (let i = 0; i < targetCodes.length; i += BATCH_SIZE) {
      const batchCodes = targetCodes.slice(i, i + BATCH_SIZE);
      const batchHist = this.db.prepare(`SELECT code, date, open, high, low, close, volume, amount, change_percent
         FROM stock_history
         WHERE code IN (${batchCodes.map(() => '?').join(',')})
         ORDER BY code, date DESC`).all(batchCodes);

      // 按股票代码分组（只保留最近60条）
      let lastCode = null;
      let count = 0;
      for (const row of batchHist) {
        if (row.code !== lastCode) {
          lastCode = row.code;
          count = 0;
          if (!histMap.has(row.code)) histMap.set(row.code, []);
        }
        if (count < 120) {
          histMap.get(row.code).push(row);
          count++;
        }
      }
    }

    // 反转每只股票的历史数据（使时间正序）
    for (const [code, hist] of histMap) {
      histMap.set(code, hist.reverse());
    }

    // 大盘基准（sh000001 上证指数）— 恢复为120天
    const benchmark = this.db.prepare(`SELECT date, close FROM stock_history
       WHERE code = 'sh000001'
       ORDER BY date DESC LIMIT 120`).all().reverse();
    Logger.info('[L1] 大盘基准数据', { days: benchmark.length });

    const result = realtime.map(s => ({
      ...s,
      fundamentals: fundMap.get(s.code) || {},
      history: histMap.get(s.code) || [],
      benchmark,
      sector_code: getSectorCode(s.code)
    }));

    // 显式释放大对象
    histMap.clear();
    fundMap.clear();

    return result;
  }

  /**
   * 计算五大原始因子
   */
  _computeFactors(stocks, env) {
    // 先按股票池计算各因子的全局分位数
    const peArr     = stocks.map(s => s.fundamentals?.pe_ttm).filter(v => isFinite(v) && v > 0 && v < 500);
    const pbArr     = stocks.map(s => s.fundamentals?.pb).filter(v => isFinite(v) && v > 0 && v < 50);
    const dyArr     = stocks.map(s => s.fundamentals?.dividend_yield).filter(v => isFinite(v) && v >= 0);

    // 市值因子：market_cap 在数据库中以 万元 为单位存储，正常范围：1000~500000 万元
    const sizeArr = stocks.map(s => {
      const mktCap = s.fundamentals?.market_cap || 0;
      // market_cap单位是亿元，无需转换
      // 异常大值(>500000亿)跳过
      if (!mktCap || mktCap > 500000) return 0;
      return Math.log(mktCap + 1);   // 对数化，偏好中间市值（5~200亿最优）
    });

    // 质量因子：使用真实ROE数据 + 营收增长率
    // ROE稳定性：实际ROE值（越高越好，标准化到[0,100]）
    const roeArr = stocks.map(s => s.fundamentals?.roe_ttm || 0);
    const maxRoe = Math.max(...roeArr.filter(v => isFinite(v) && v > 0), 1);

    const qualArr = stocks.map(s => {
      const roe  = s.fundamentals?.roe_ttm || 0;
      const revG = s.fundamentals?.revenue_growth_yoy || 0;  // 营收增长%
      // 质量 = ROE * (1 + 营收增速%)，标准化到[0,100]
      return roe * (1 + Math.max(-0.5, Math.min(revG, 2)) / 10);
    });

    // 各因子全部计算完毕后，再统一计算分位数
    // 第一遍：记录原始值
    const rawFactors = stocks.map((s, idx) => {
      const h = s.history;
      const b = s.benchmark;

      // 120日相对大盘涨幅（恢复为120天）
      let relReturn120d = 0;
      if (h.length >= 120 && b.length >= 120) {
        const stockStart = h[0]?.close || 1;
        const stockEnd   = h[119]?.close || stockStart;
        const benchStart = b[0]?.close || 1;
        const benchEnd   = b[119]?.close || benchStart;
        const stockRet = (stockEnd / stockStart) - 1;
        const benchRet = (benchEnd / benchStart) - 1;
        relReturn120d = stockRet - benchRet;
      }

      // 20日价格强度（恢复为20天）
      let priceStrength20d = 0;
      if (h.length >= 20) {
        const gains = h.slice(-20).filter(b => b.change_percent !== undefined)
          .map(b => b.change_percent / 100);
        priceStrength20d = gains.filter(g => g > 0).length / Math.max(gains.length, 1);
      }

      // 特异性波动率（剔除市场波动后的残差波动）
      let idioVol = 0;
      if (h.length >= 20) {
        const h20 = h.slice(-20);
        const stockReturns = h20.map((bar, i) =>
          i === 0 ? 0 : (bar.close - h20[i-1].close) / h20[i-1].close
        );
        if (b.length >= 20) {
          const b20 = b.slice(-20);
          const benchReturns = b20.map((bar, i) =>
            i === 0 ? 0 : (bar.close - b20[i-1].close) / b20[i-1].close
          );
          const { residuals } = linearRegression(benchReturns, stockReturns);
          idioVol = std(residuals);
        } else {
          // 无基准数据时用个股自身日波动率
          idioVol = std(stockReturns);
        }
      }

      return {
        code:       s.code,
        name:       s.name,
        price:      s.price,
        volume:     s.volume,
        amount:     s.amount,
        sector_code: s.sector_code,
        // 原始因子值（120天历史）
        pe_raw:          s.fundamentals?.pe_ttm || 0,
        pb_raw:          s.fundamentals?.pb || 0,
        dy_raw:          s.fundamentals?.dividend_yield || (s.fundamentals?.pe_ttm > 0 ? 1/s.fundamentals.pe_ttm * 100 : 0),
        size_raw:        sizeArr[idx] || 0,
        rel_return_120d: relReturn120d,
        price_strength: priceStrength20d,
        roe_stability:   s.fundamentals?.roe_ttm || 0,
        cf_ratio:        s.fundamentals?.asset_turnover || 0.5,
        idio_vol:        idioVol
      };
    });

    // 第二遍：计算因子分位数（基于全局分布）
    const p5  = percentile(peArr,  5);
    const p95 = percentile(peArr, 95);
    const pb5  = percentile(pbArr,  5);
    const pb95 = percentile(pbArr, 95);

    return rawFactors.map((f, fi) => {
      // PE分位数：估值越低分位越靠前（取百分位，越低越好→转为高score）
      const pe_pct  = percentile(peArr, f.pe_raw);
      const pb_pct  = percentile(pbArr, f.pb_raw);
      const dy_pct  = percentile(dyArr, f.dy_raw);

      // 价值因子：PE/PB分位数越低越好（转换为正向score）
      f.pe_percentile   = pe_pct;
      f.pb_percentile   = pb_pct;
      f.dividend_yield  = f.dy_raw;
      f.value_score_raw = (100 - pe_pct + 100 - pb_pct + dy_pct) / 3; // 估值低+股息高

      // 市值因子：使用 ln(size_raw+1) 归一化（解决原始 size_raw 范围 0~1.68 过窄问题）
      // size_raw = ln(市值/亿元)，0→微型(~2kw), 2.3→小盘(~10亿), 4.6→中盘(~100亿), 6.9→大盘(~1000亿)
      // 映射：微型/超大盘→高分(90-100)，小/中盘→低分(10-60)，偏好适中市值
      f.market_cap_log = f.size_raw;
      const logSize = Math.log(f.size_raw + 1); // ln(raw+1) 压缩到 0~2.1
      const sizeNormalized = logSize / 2.5; // 归一化到 0~1
      f.size_score_raw = Math.max(0, Math.min(100,
        sizeNormalized > 0.7 ? Math.max(0, 100 - (sizeNormalized - 0.7) * 250) : // 超大盘→低分
        sizeNormalized < 0.25 ? 50 + sizeNormalized * 200 : // 微型→中高分
        80 - Math.abs(sizeNormalized - 0.45) * 200 // 小/中盘偏好，中间最优
      ));

      // 动量因子（120天历史）
      f.relative_return_120d = f.rel_return_120d;
      f.price_strength_20d  = f.price_strength;
      f.momentum_score_raw   = f.relative_return_120d * 100 + f.price_strength_20d * 20;

      // 质量因子：真实ROE + 营收增速
      const origRoe = f.roe_stability || 0;
      f.roe_stability   = origRoe;
      f.cash_flow_ratio = f.cf_ratio || 0.5;
      f.quality_score_raw = qualArr[fi] || 0;

      // 波动因子：idiopathic volatility (日波动率)，avg=0.0006, max=0.033
      // range: [0, 0.033] → vol_score_raw: [100, 0]，直接线性映射扩大区分度
      f.idio_volatility = f.idio_vol;
      f.volatility_score_raw = Math.max(0, 100 - f.idio_vol * 3000); // ×3000 将 max=0.033→0, min=0→100

      return f;
    });
  }

  /**
   * 行业中性化 — 对每个因子做分组哑变量回归，取残差的Z-Score
   */
  _industryNeutralize(stocks) {
    // 正确实现：对每个因子做行业均值中性化（取回归残差的Z-Score）
    // 即：去掉行业均值的影响，保留行业内相对排序
    // 公式：neutral = (value - sectorMean) / sectorStd
    const sectors = [...new Set(stocks.map(s => s.sector_code))];
    const factors = ['value_score_raw', 'size_score_raw', 'momentum_score_raw',
                     'quality_score_raw', 'volatility_score_raw'];

    for (const factor of factors) {
      for (const sector of sectors) {
        const group = stocks.filter(s => s.sector_code === sector);
        if (group.length < 3) continue;

        const vals = group.map(s => s[factor] || 0);
        const m   = mean(vals);
        const s   = std(vals);

        group.forEach((stock, i) => {
          // 行业内部 Z-Score：零均值、单位方差（去均值，除行业标准差）
          stock[`${factor}_neutral`] = s === 0 ? 0 : (vals[i] - m) / s;
        });
      }
    }

    return stocks;
  }

  /**
   * 动态打分：应用环境权重合并综合分
   * 核心修复：对每个因子做全局 Z-Score 归一化，确保因子间可比
   */
  _computeScores(stocks) {
    const w = this.factorWeights;

    // 百分位排名打分：基于行业中性化后的因子值
    // 关键：使用 percentileRank（位置百分位），即使 resStd=0 也有 0~100 的区分度
    const percentileRank = (arr) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return arr.map(v => {
        const pos = sorted.findIndex(x => x === v);
        return (pos / Math.max(sorted.length - 1, 1)) * 100;
      });
    };

    // 行业中性化后的因子值（来自 _industryNeutralize）
    const neutralKeys = [
      { neutral: 'value_score_raw_neutral',     key: 'value_score'     },
      { neutral: 'size_score_raw_neutral',      key: 'size_score'      },
      { neutral: 'momentum_score_raw_neutral',  key: 'momentum_score'  },
      { neutral: 'quality_score_raw_neutral',   key: 'quality_score'   },
      { neutral: 'volatility_score_raw_neutral', key: 'volatility_score' },
    ];

    for (const { neutral, key } of neutralKeys) {
      const arr = stocks.map(s => s[neutral] ?? 0);
      const ranked = percentileRank(arr);
      stocks.forEach((s, i) => { s[key] = Math.round(ranked[i] * 10) / 10; });
    }

    return stocks.map((s) => {
      s.l1_total_score =
        w.value     * (s.value_score     || 50) +
        w.size      * (s.size_score      || 50) +
        w.momentum  * (s.momentum_score  || 50) +
        w.quality   * (s.quality_score   || 50) +
        w.volatility * (s.volatility_score || 50);
      return s;
    });
  }

  /**
   * 逐因子 Z-Score 标准化到 N(50, 20) 再裁剪
   * 保留：兼容单值输入（单值时返回50）
   */
  _zScore(val) {
    return Math.max(0, Math.min(100, val + 50));
  }

  /**
   * 计算因子统计摘要
   */
  _computeFactorStats(stocks) {
    return {
      total_stocks:  stocks.length,
      value_mean:    mean(stocks.map(s => s.value_score_raw || 0)),
      momentum_mean: mean(stocks.map(s => s.momentum_score_raw || 0)),
      quality_mean:  mean(stocks.map(s => s.quality_score_raw || 0)),
      weights:       this.factorWeights,
      sectors:       [...new Set(stocks.map(s => s.sector_code))].length
    };
  }

  /**
   * 持久化到SQLite缓存
   */
  _saveToCache(top300) {
    const rows = top300.map(s => ({
      code:               s.code,
      name:               s.name,
      l1_score:           s.l1_total_score || 0,
      value_score:        s.value_score    || 0,
      size_score:         s.size_score     || 0,
      momentum_score:     s.momentum_score || 0,
      quality_score:      s.quality_score  || 0,
      volatility_score:   s.volatility_score || 0,
      pe_percentile:      s.pe_percentile  || 0,
      pb_percentile:      s.pb_percentile  || 0,
      dividend_yield:    s.dividend_yield  || 0,
      market_cap_log:     s.market_cap_log || 0,
      relative_return_120d: s.relative_return_120d || 0,
      price_strength_20d:  s.price_strength_20d || 0,
      roe_stability:      s.roe_stability  || 0,
      cash_flow_ratio:   s.cash_flow_ratio || 0,
      idio_volatility:    s.idio_volatility || 0,
      sector_code:        s.sector_code     || 'OTHER',
      updated_at:         bjISO()
    }));

    // 【修复 2026-05-09】清理旧缓存，只保留本次运行结果，避免积压（之前每次upsert保留历史股票导致1105行>300）
    const del1 = this.db.prepare('DELETE FROM yaodi_l1_cache').run();
    this.db.batchUpsert('yaodi_l1_cache', rows, 'code');
    Logger.info('[L1] 缓存已写入', { deleted: del1.changes, inserted: rows.length });
  }
}

// ============================================================
// L2: Stacking 集成精排引擎
// ============================================================

/**
 * L2 Stacking集成精排引擎
 * Top 300 → Top 50
 * 
 * 架构:
 *   Base Learner 1 (GBDT):   全局特征，梯度提升树
 *   Base Learner 2 (HistGBDT): 直方图GBDT，捕捉短线爆发
 *   Base Learner 3 (CategoryBoost): 行业/板块增强
 *   Meta Learner (ElasticNet): 融合三个Base输出
 * 
 * 全部纯JavaScript实现，不引入外部ML依赖
 */
class L2Engine {
  constructor(db) {
    this.db = db;
    // 训练后的模型参数
    this.models = {
      gbdt:    null,
      histgbdt: null,
      categoryBoost: null,
      meta:    null
    };
    this.isTrained = false;
    // 【P0修复】ML模块缓存，消除运行时 import() 阻塞
    this._mlModCache = null;
    this._mlModLoading = false;
  }

  /** 预加载ML模块和模型数据（在启动时异步执行，不阻塞事件循环） */
  async _preloadMLModels() {
    if (this._mlModLoading) return;
    this._mlModLoading = true;
    try {
      console.log('[ML-PRELOAD] 开始预加载ML模型...');
      const mod = await import('./ml_models.mjs');
      this._mlModCache = { mod, ML_MODELS: mod.ML_MODELS };
      // 预加载模型参数（同步DB查询，启动时执行无害）
      this._loadMLModels();
      console.log('[ML-PRELOAD] ML模型预加载完成，缓存', this._mlCache?.size || 0, '个模型');
    } catch(e) {
      console.error('[ML-PRELOAD] ML模型预加载失败:', e.message);
    } finally {
      this._mlModLoading = false;
    }
  }

  /**
   * 主入口: L2精排
   * @param {Array} l1Pool Top300候选池
   * @param {Object} realtimeData 实时行情映射
   * @param {Object} marketMetrics 市场指标
   */
  async run(l1Pool, realtimeData = {}, marketMetrics = {}) {
    const startTime = Date.now();
    Logger.info(`[L2] 开始L2精排，候选池=${l1Pool.length}`);

    try {
      // Step 1: 准备特征矩阵
      const featureMatrix = this._prepareFeatures(l1Pool, realtimeData, marketMetrics);

      // Step 2: 若未训练则先训练模型
      if (!this.isTrained) {
        await this._trainModels(featureMatrix);
      }

      // Step 3: Base Learner 预测
      const base1 = this._predictGBDT(featureMatrix);
      const base2 = this._predictHistGBDT(featureMatrix);
      const base3 = this._predictCategoryBoost(featureMatrix);

      // Step 3.5: ML模型集成预测 (方案A)
      // ── 批量计算实时技术指标（打破特征同质化）──────────────────
      const l2Codes = featureMatrix.map(s => s.code);
      const indMap = this._batchComputeIndicators(l2Codes);
      featureMatrix.forEach(s => {
        const ind = indMap.get(s.code);
        if (ind) {
          s.rsi_14 = ind.rsi_14;
          s.macd_hist = ind.macd_hist;
          s.bollinger_upper = ind.bollinger_upper;
          s.bollinger_lower = ind.bollinger_lower;
          s.kdj_k = ind.kdj_k;
          s.macd = ind.macd;
          s.macd_signal = ind.macd_signal;
        }
      });

      const { scores: mlScores, stockModelScores: mlModelScores } = await this._predictWithMLModels(featureMatrix);

      // Step 4: Meta Learner 融合
      const metaScores = this._metaElasticNet(base1, base2, base3, mlScores);

      // Step 5: 合并结果并排序
      const scored = featureMatrix.map((stock, i) => ({
        ...stock,
        gbdt_pred:         base1[i],
        histgbdt_pred:     base2[i],
        category_boost:    base3[i],
        meta_pred:         metaScores[i],
        l2_score:          metaScores[i],
        confidence: this._computeConfidence(base1[i], base2[i], base3[i], {
          l2Score: metaScores[i]
        }),
      }));

      const scoredFiltered = scored
        .filter(s => s.l2_score > 0 && isFinite(s.l2_score))
        // 过滤price为'-'或无效的股票（退市/停牌）
        .filter(s => {
          const rawPrice = s.price;
          const price = (rawPrice === '-' || rawPrice === null || rawPrice === undefined) ? 0 : Number(rawPrice) || 0;
          return price > 0;
        })
        .sort((a, b) => b.l2_score - a.l2_score)
        .slice(0, 10000);

      scored.forEach((s, i) => {
        s.ml_ensemble_score = mlScores[i] || 0.5;
        s.l2_score = metaScores[i];
        s.l2_rank = i + 1;
        
        // 构建modelScores对象（混合方案）- 从ML预测获取个体分数
        const sms = mlModelScores?.[i];
        s.modelScores = {
          xgboost: sms?.get('xgboost') ?? base1[i] ?? null,
          lightgbm: sms?.get('lightgbm') ?? null,
          rf: sms?.get('rf') ?? null,
          svm: sms?.get('svm') ?? null,
          catboost: sms?.get('catboost') ?? base3[i] ?? null,
          linear: sms?.get('linear') ?? null,
          bayesian: sms?.get('bayesian') ?? null,
          rl: sms?.get('rl') ?? null,
          arima: sms?.get('arima') ?? null,
          garch: sms?.get('garch') ?? null,
          lstm: sms?.get('lstm') ?? null,
          gru: sms?.get('gru') ?? null,
          cnn: sms?.get('cnn') ?? null,
          transformer: sms?.get('transformer') ?? null,
          gnn: sms?.get('gnn') ?? null,
          autoencoder: sms?.get('autoencoder') ?? null
        };
      });

      // Step 6: 评估模型准确率（必须在保存缓存之前）
      const modelAccuracy = this._evaluateModel(scoredFiltered);
      const runTime = Date.now() - startTime;

      // Step 7: 保存缓存
      this._saveCache(scoredFiltered, modelAccuracy);

      Logger.info(`[L2] 完成，缓存耗时${runTime}ms，模型准确率=${modelAccuracy.toFixed(4)}`);

      // 增量学习：L2 运行结束后保存模型
      try {
        const modelInfo = saveModels(this, 'latest');
        Logger.info(`[Core] 模型持久化完成: ${modelInfo.tag}`);
      } catch (e) {
        Logger.error('[Core] 模型保存失败', { error: e.message });
      }

      // 增量学习：评估是否需要触发重训
      try {
        const accuracy = evaluateModelAccuracy(this.l2Engine);
        const config = initLearningConfig();
        if (shouldRetrain(accuracy, config)) {
          Logger.warn('[Core] 模型准确率过低，标记需要重训');
          // 重置训练标记，下次 L2 运行时会重新训练
          this.l2Engine.isTrained = false;
        }
      } catch (e) { /* ignore */ }

      // 为L2候选股票注入胜率数据（来源：历史胜率均值 或 模型准确率）
      const histWinRate = this.l3Engine?.winRateHistory?.length >= 5
        ? this.l3Engine.winRateHistory.slice(-30).reduce((a,b)=>a+b,0)/this.l3Engine.winRateHistory.length
        : modelAccuracy;
      scoredFiltered.forEach(s => { s.win_rate = +histWinRate.toFixed(4); });
      Logger.info(`[L2] 胜率统计: 历史均值=${histWinRate.toFixed(4)}, 缓存样本=${scoredFiltered.length}`);
      return { top50: scoredFiltered, predictions: scored, modelAccuracy };
    } catch (err) {
      Logger.error('[L2] L2运行异常', { error: err.message });
      throw err;
    }
  }

  /**
   * 准备L2特征矩阵
   * 特征包括: L1五因子 + 涨跌家数比 + 市场波动率 + 动量子特征
   */
  _prepareFeatures(l1Pool, realtimeData, marketMetrics) {
    // 市场统计
    const mStats = this.db.get(`SELECT * FROM market_stats ORDER BY rowid DESC LIMIT 1`) || {};
    const upCount   = mStats.up_count   || 0;
    const downCount = mStats.down_count || 1;
    const totalCount= mStats.total_count || 1;

    // 市场情绪指标
    const breadthRatio = upCount / Math.max(downCount, 1); // 涨跌家数比
    const upRatio      = mStats.up_count / Math.max(totalCount, 1); // 上涨比例

    // 市场波动率
    let marketVol = 0;
    const recentBench = this.db.prepare(`SELECT change_percent FROM stock_history
       WHERE code='000001' ORDER BY date DESC LIMIT 20`).all().reverse();
    if (recentBench.length >= 2) {
      const rets = recentBench.map(r => r.change_percent / 100);
      marketVol = std(rets);
    }

    // 实时涨跌数据
    const rtMap = new Map(
      this.db.prepare(`SELECT code, change_percent, volume, amount, price FROM stock_realtime`).all()
        .map(r => [r.code, r])
    );

    return l1Pool.map(stock => {
      const rt   = rtMap.get(stock.code) || {};
      const rtCp = rt.change_percent || 0;
      const rtVol= rt.volume || 0;

      // 5日均成交额
      const hist5d = this.db.prepare(`SELECT amount FROM stock_history
         WHERE code=? ORDER BY date DESC LIMIT 5`).all([stock.code]
      );
      const avg5dAmount = mean(hist5d.map(h => h.amount));

      // 20日动量子特征
      const hist20d = this.db.prepare(`SELECT change_percent FROM stock_history
         WHERE code=? ORDER BY date DESC LIMIT 20`).all([stock.code]
      ).reverse();
      const ret20d   = hist20d.map(h => h.change_percent / 100);
      const maxDraw  = this._maxDrawdown(ret20d);
      const momentum20d = cagr(ret20d);

      // 短期爆发系数（当日涨幅 vs 20日波动）
      const dailyVol = hist20d.length >= 2 ? std(ret20d) : 0;
      const burstFactor = dailyVol > 0 ? Math.abs(rtCp / 100) / dailyVol : 0;

      return {
        ...stock,
        // 【修复2026-05-19】从rtMap获取price，确保_complianceFilter能过滤停牌/退市股
        price: rt.price || 0,
        // L1因子特征（已归一化分）
        value_score:        stock.value_score     || 0,
        size_score:         stock.size_score      || 0,
        momentum_score:     stock.momentum_score  || 0,
        quality_score:      stock.quality_score   || 0,
        volatility_score:   stock.volatility_score || 0,
        // 市场特征
        breadth_ratio:      breadthRatio,
        market_volatility:  marketVol,
        up_ratio:           upRatio,
        // 个股实时特征
        rt_change_pct:      rtCp,
        rt_volume:          rtVol,
        avg5d_amount:       avg5dAmount,
        momentum20d,
        max_drawdown:       maxDraw,
        burst_factor:       burstFactor,
        // 动量子特征
        rel_return_120d:    stock.relative_return_120d || 0,
        price_strength_20d: stock.price_strength_20d || 0,

        // ── ML特征补充（_extractMLFeatures 需要）──────────────────
        change_percent: rt.change_percent || 0,
        high: rt.high || stock.price || 0,
        low:  rt.low  || stock.price || 0,
        close: stock.price || 0,
        volatility_20d: ret20d.length >= 2 ? Math.max(0.001, std(ret20d)) * 20 : 0.01,
        avg_return_5d: hist5d.length >= 1 ? (rt.change_percent || 0) / 100 : 0,
        volume_ratio: rtVol > 0 && avg5dAmount > 0 ? rtVol / avg5dAmount : 1,
        // Always calculate industry from stock code (don't rely on database which may be overwritten)
        industry_factor: (!stock.code) ? 0.2 : (
              stock.code.charCodeAt(0) === 54 ? 0.6 :
              stock.code.charCodeAt(0) === 48 ? 0.3 :
              stock.code.charCodeAt(0) === 51 ? 0.4 : 0.2
            ),
        // 占位字段（将由批量指标计算替换）
        rsi_14: 50,
        macd_hist: 0,
        bollinger_upper: 0,
        bollinger_lower: 0,
        kdj_k: 50,
        macd: 0,
        macd_signal: 0,
      };
    });
  }

  // 批量计算所有股票技术指标（一次性SQL，减少数据库压力）
  _batchComputeIndicators(stockCodes) {
    const result = new Map();
    for (const c of stockCodes) result.set(c, null);
    if (stockCodes.length === 0) return result;
    const ph = stockCodes.map(() => '?').join(',');
    const sql = 'SELECT code, date, close, change_percent, volume FROM stock_history WHERE code IN (' + ph + ') ORDER BY code, date DESC';
    const rows = this.db.prepare(sql).all(...stockCodes);
    const byCode = new Map();
    for (const r of rows) {
      if (!byCode.has(r.code)) byCode.set(r.code, []);
      byCode.get(r.code).push(r);
    }
    for (const [code, hist] of byCode) {
      if (hist.length < 5) continue;
      hist.reverse();
      const closes = hist.map(h => h.close);
      const changes = hist.map(h => h.change_percent / 100);
      const rsi = calcRSI(changes, 14);
      const macdObj = calcMACD(closes);
      const boll = calcBOLL(closes);
      const kdj = calcKDJ(closes);
      result.set(code, {
        rsi_14: Math.round(rsi * 10) / 10,
        macd_hist: Math.round(macdObj.hist * 100) / 100,
        bollinger_upper: Math.round(boll.upper * 100) / 100,
        bollinger_lower: Math.round(boll.lower * 100) / 100,
        kdj_k: kdj.k,
        macd: Math.round(macdObj.macd * 100) / 100,
        macd_signal: Math.round(macdObj.signal * 100) / 100,
      });
    }
    return result;
  }

  /**
   * 最大回撤计算
   */
  _maxDrawdown(returns) {
    if (!returns || returns.length === 0) return 0;
    let peak = 1;
    let maxDD = 0;
    let nav = 1;
    for (const r of returns) {
      nav *= (1 + r);
      if (nav > peak) peak = nav;
      const dd = (peak - nav) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
  }

  // =========================================
  // 模型训练入口
  // =========================================

  /**
   * 训练所有模型（Base Learners + Meta Learner）
   * 实际训练在各预测方法中按需执行
   */
  async _trainModels(features) {
    Logger.info('[L2] 触发模型训练');

    // 【P1优化】为每个stock注入舜帝真实交易标签，避免GBDT用momentum_score趋同
    try {
      const db = this.db;
      // 从舜帝回测获取各分支真实胜率
      const branchPerf = db.all(`
        SELECT strategy, total_trades, win_rate, avg_profit, max_drawdown
        FROM strategy_backtest_stats WHERE total_trades >= 3
      `) || [];
      const avgWinRate = branchPerf.reduce((s, b) => s + (b.win_rate || 0), 0) / Math.max(1, branchPerf.length);

      // 从平仓记录获取平均收益率质量
      const closedPerf = db.get(`
        SELECT
          COUNT(*) as cnt,
          AVG(profit_percent) as avg_pct,
          COUNT(*) * 1.0 / NULLIF((SELECT COUNT(*) FROM shundi_backtest_history WHERE trade_type='sell'),0) as ratio
        FROM shundi_backtest_history WHERE trade_type='sell'
      `) || {};

      const returnQuality = Math.min(100, Math.max(0, (closedPerf.avg_pct || 0) * 50 + 50));

      for (const f of features) {
        // 策略匹配：找同策略或同类型的分支表现
        const matched = branchPerf.find(b =>
          f.strategy && b.strategy && b.strategy.includes(f.strategy.slice(0, 6))
        );
        f.real_win_rate = matched ? matched.win_rate : avgWinRate;
        f.return_quality = returnQuality;
      }
      Logger.info('[L2] 真实标签注入完成，avgWinRate=' + avgWinRate.toFixed(1) + '%, returnQuality=' + returnQuality.toFixed(1));
    } catch(e) {
      Logger.warn('[L2] 真实标签注入失败:', e.message);
    }

    this._predictGBDT(features);
    this._predictHistGBDT(features);
    this._predictCategoryBoost(features);
    this.isTrained = true;
    Logger.info('[L2] 模型训练完成');
  }

  // =========================================
  // Base Learner 1: 梯度提升树 (GBDT) — 简化版
  // =========================================

  /**
   * 纯JS实现的简易GBDT
   * 使用CART回归树作为基学习器
   */
  _predictGBDT(features) {
    if (!this.models.gbdt) {
      this.models.gbdt = this._trainGBDT(features);
    }
    // 兼容：支持裸数组（训练返回）和对象（反序列化加载）
    const trees = Array.isArray(this.models.gbdt) ? this.models.gbdt : (this.models.gbdt.trees || []);
    const lr = (this.models.gbdt.learningRate) ?? 0.1;

    return features.map(f => {
      let pred = 0;
      for (const tree of trees) {
        pred += lr * this._predictTree(tree, f);
      }
      // Sigmoid映射到 [0,1]
      return 1 / (1 + Math.exp(-pred));
    });
  }

  _trainGBDT(features) {
    if (features.length < 10) return [{ type: 'leaf', value: 0.5, trees: [] }];

    const numTrees   = 30;  // 【修复】5→30棵树，增强拟合能力
    const maxDepth   = 5;   // 【修复】3→5，增加非线性表达能力
    const lr         = 0.08;// 学习率微调
    const subsample  = 0.7; // 行采样比例

    // 【修复】目标变量：用多因子综合评分替代趋同的回测标签
    const X = this._selectGBDTFeatures(features);
    // 目标 = L1多因子加权 + 动量爆发 + 价值安全边际，产生真实区分度
    const y = features.map(f => {
      const winR  = (f.real_win_rate  || 0) / 100;
      const retQ  = (f.return_quality || 0) / 100;
      // 多因子目标：L1因子(40%) + 爆发因子(30%) + 真实回测(30%)
      const factorScore = (
        (f.value_score || 50) * 0.25 +
        (f.momentum_score || 50) * 0.30 +
        (f.quality_score || 50) * 0.25 +
        (f.volatility_score || 50) * 0.20
      ) / 100;
      const burstScore = Math.min(1, Math.max(0, (f.burst_factor || 0) * 0.5 + 0.5));
      return factorScore * 0.40 + burstScore * 0.30 + (winR * 0.6 + retQ * 0.4) * 0.30;
    });

    let preds     = y.map(() => 0);
    let trees     = [];
    let residuals = [...y];

    for (let t = 0; t < numTrees; t++) {
      // 采样
      const sampleSize = Math.max(10, Math.floor(X.length * subsample));
      const indices = this._bootstrapSample(X.length, sampleSize);
      const Xs = indices.map(i => X[i]);
      const rs = indices.map(i => residuals[i]);

      // 构建回归树
      const tree = this._buildRegressionTree(Xs, rs, maxDepth, 0);
      trees.push(tree);

      // 更新预测和残差
      preds = X.map((x, i) => preds[i] + lr * this._predictTree(tree, x));
      residuals = y.map((yi, i) => yi - preds[i]);
    }

    // 返回结构化对象（与反序列化格式一致）
    const model = { trees, learningRate: lr, maxDepth, numTrees, minLeafSize: 5, featureImportance: {} };
    this.models.gbdt = model;
    return model;
  }

  _selectGBDTFeatures(f) {
    // 【修复】扩展特征：6维→12维，增加区分度
    return f.map(s => ({
      value_score:      s.value_score     || 0,
      momentum_score:   s.momentum_score  || 0,
      quality_score:    s.quality_score    || 0,
      size_score:       s.size_score      || 0,
      volatility_score: s.volatility_score || 0,
      market_volatility: s.market_volatility || 0,
      breadth_ratio:    s.breadth_ratio    || 1,
      momentum20d:       s.momentum20d     || 0,
      burst_factor:      s.burst_factor    || 0,
      max_drawdown:      s.max_drawdown    || 0,
      rt_change_pct:     s.rt_change_pct   || 0,
      volume_ratio:      s.volume_ratio    || 1
    }));
  }

  _buildRegressionTree(X, y, maxDepth, depth = 0) {
    // 安全检查：防止无限递归
    if (depth >= maxDepth || X.length < 5 || X.length === 0) {
      return { type: 'leaf', value: y.length > 0 ? mean(y) : 0 };
    }

    const split = this._findBestSplit(X, y);
    const { feature, threshold, leftX, leftY, rightX, rightY } = split;

    // 无法分裂时返回叶子节点
    if (!feature || leftX.length === 0 || rightX.length === 0) {
      return { type: 'leaf', value: mean(y) };
    }

    // 防止分裂后数据量不变（无限递归）
    if (leftX.length >= X.length || rightX.length >= X.length) {
      return { type: 'leaf', value: mean(y) };
    }

    return {
      type: 'split',
      feature,
      threshold,
      left:  this._buildRegressionTree(leftX,  leftY,  maxDepth, depth + 1),
      right: this._buildRegressionTree(rightX, rightY, maxDepth, depth + 1)
    };
  }

  _findBestSplit(X, y) {
    const features = Object.keys(X[0] || {});
    let bestMse = Infinity;
    let bestSplit = null;

    for (const feat of features) {
      const vals = X.map(x => x[feat]).filter(v => isFinite(v));
      if (vals.length < 3) continue;

      // 候选切分点：取几个百分位
      for (const pct of [25, 50, 75]) {
        const threshold = percentile(vals, pct);
        const leftX = [], leftY = [], rightX = [], rightY = [];
        X.forEach((x, i) => {
          if (x[feat] <= threshold) { leftX.push(x); leftY.push(y[i]); }
          else                       { rightX.push(x); rightY.push(y[i]); }
        });
        if (leftY.length < 2 || rightY.length < 2) continue;

        const mse = this._weightedMSE(leftY, rightY);
        if (mse < bestMse) {
          bestMse = mse;
          bestSplit = { feature: feat, threshold, leftX, leftY, rightX, rightY };
        }
      }
    }
    return bestSplit || {};
  }

  _weightedMSE(leftY, rightY) {
    const m1 = mean(leftY),  m2 = mean(rightY);
    const n  = leftY.length + rightY.length;
    const mse1 = leftY.reduce((s, v) => s + (v - m1) ** 2, 0) / leftY.length;
    const mse2 = rightY.reduce((s, v) => s + (v - m2) ** 2, 0) / rightY.length;
    return (leftY.length / n) * mse1 + (rightY.length / n) * mse2;
  }

  _predictTree(tree, x) {
    // 兼容两种格式：(1)CART格式 {type:'leaf'/'split'} (2)序列化格式 {value,feature,threshold,left,right}
    // 叶子节点判断：显式type='leaf' 或 left/right为undefined/数字（序列化后叶子直接是值）
    if (tree.type === 'leaf' || typeof tree.left === 'number' || typeof tree.right === 'number' ||
        tree.type === undefined && (tree.value !== undefined && tree.feature === undefined)) {
      return tree.value ?? 0;
    }
    const val = x[tree.feature];
    if (val <= tree.threshold) return this._predictTree(tree.left, x);
    return this._predictTree(tree.right, x);
  }

  _buildDummyTree(features) {
    const avgScore = mean(features.map(f => (f.momentum_score || 0)));
    return { type: 'leaf', value: avgScore / 100 };
  }

  _bootstrapSample(n, size) {
    const indices = [];
    for (let i = 0; i < size; i++) {
      indices.push(Math.floor(Math.random() * n));
    }
    return indices;
  }

  // =========================================
  // Base Learner 2: 直方图GBDT — 短线爆发
  // =========================================

  /**
   * 直方图GBDT：分箱离散化加速，对短线爆发特征更敏感
   */
  _predictHistGBDT(features) {
    if (!this.models.histgbdt) {
      this.models.histgbdt = this._trainHistGBDT(features);
    }
    // 兼容：支持裸数组（训练返回）和对象（反序列化加载）
    const trees = Array.isArray(this.models.histgbdt) ? this.models.histgbdt : (this.models.histgbdt.trees || []);
    const lr = (this.models.histgbdt.learningRate) ?? 0.15;

    return features.map(f => {
      let pred = 0;
      for (const tree of trees) {
        pred += lr * this._predictTree(tree, f);
      }
      return 1 / (1 + Math.exp(-pred));
    });
  }

  _trainHistGBDT(features) {
    if (features.length < 10) return [{ type: 'leaf', value: 0.5, trees: [] }];

    const numTrees = 20;  // 【修复】4→20
    const maxDepth = 5;    // 【修复】4→5
    const lr = 0.1;

    // 短线爆发特征
    const X = features.map(f => ({
      burst_factor:      Math.min(f.burst_factor || 0, 10),
      rt_change_pct:      (f.rt_change_pct || 0) / 10,
      max_drawdown:       (f.max_drawdown  || 0) * 10,
      price_strength_20d: f.price_strength_20d || 0,
      momentum20d:        (f.momentum20d || 0) * 10,
      volatility_score:   f.volatility_score || 0,
      rel_return_120d:    (f.relative_return_120d || 0) * 10
    }));

    const y = features.map(f => {
      // 代理目标：当日涨幅 × 波动率（捕捉短线爆发）
      return ((f.rt_change_pct || 0) * (f.burst_factor || 0)) / 100;
    });

    let residuals = [...y];
    let trees = [];

    for (let t = 0; t < numTrees; t++) {
      const tree = this._buildRegressionTree(X, residuals, maxDepth, 0);
      trees.push(tree);
      residuals = X.map((x, i) => residuals[i] - lr * this._predictTree(tree, x));
    }

    // 返回结构化对象（与反序列化格式一致）
    const model = { trees, learningRate: lr, maxDepth: 4, numBins: 256, numTrees, featureImportance: {} };
    this.models.histgbdt = model;
    return model;
  }

  // =========================================
  // Base Learner 3: 类别增强模型 — 行业/板块处理
  // =========================================

  /**
   * 类别增强：对不同板块赋予不同权重boost
   * 模拟行业轮动效应
   */
  _predictCategoryBoost(features) {
    // 防护：categoryBoost 必须是 Map（每次运行时计算），反序列化后可能是对象/null
    const stored = this.models.categoryBoost;
    if (!stored || !(stored instanceof Map)) {
      this.models.categoryBoost = this._calcCategoryBoost(features);
    }
    const boostMap = this.models.categoryBoost;

    // 动态板块权重（根据市场环境微调）- 调整为更合理的范围
    const envBoost = {
      bull:    { GEM: 1.15, KCB: 1.10, SH: 1.05, SZ_MAIN: 1.0, SME: 0.95, BEI: 0.90, OTHER: 1.0 },
      bear:    { SH: 1.10, SZ_MAIN: 1.05, GEM: 0.90, KCB: 0.85, SME: 0.95, BEI: 0.80, OTHER: 1.0 },
      neutral: { SH: 1.0, SZ_MAIN: 1.0, GEM: 1.02, KCB: 1.0, SME: 1.0, BEI: 0.95, OTHER: 1.0 }
    };
    const env = this._detectMarketEnv();
    const envWeights = envBoost[env] || envBoost.neutral;

    // 计算所有feature的质量分位数，用于相对排名
    const qualityScores = features.map(f => f.quality_score || 0);
    const sortedQuality = [...qualityScores].sort((a, b) => a - b);

    return features.map((f, idx) => {
      const sector = f.sector_code || 'OTHER';
      const baseBoost = boostMap.get(sector) || 1.0;
      const envMult   = envWeights[sector] || 1.0;
      
      // 【FIX】使用相对质量排名而非绝对值，确保区分度
      const qualityScore = f.quality_score || 0;
      const qualityRank = sortedQuality.indexOf(qualityScore);
      const qualityPercentile = qualityRank / Math.max(sortedQuality.length - 1, 1);
      const qualityMult = 0.6 + qualityPercentile * 0.4; // 0.6~1.0

      // 综合boost - 不再强制限制为[0,1]，允许差异
      const rawBoost = baseBoost * envMult * qualityMult;
      // 使用sigmoid映射到[0.3, 0.95]区间，保持区分度
      const normalizedBoost = 0.3 + 0.65 / (1 + Math.exp(-5 * (rawBoost - 1)));
      return normalizedBoost;
    });
  }

  _calcCategoryBoost(features) {
    const sectorScores = new Map();
    for (const f of features) {
      const s = f.sector_code || 'OTHER';
      if (!sectorScores.has(s)) sectorScores.set(s, []);
      sectorScores.get(s).push(f.momentum_score || 0);
    }

    const boostMap = new Map();
    const avgAll = mean(features.map(f => f.momentum_score || 0));

    for (const [sector, scores] of sectorScores) {
      const avgSector = mean(scores);
      boostMap.set(sector, Math.max(0.5, Math.min(1.5, avgSector / Math.max(avgAll, 1))));
    }

    return boostMap;
  }

  _detectMarketEnv() {
    // 简单环境检测 - 使用better-sqlite3正确API
    try {
      const bench = this.db.prepare(
        `SELECT change_percent FROM stock_history
         WHERE code='000001' ORDER BY date DESC LIMIT 5`
      ).all().reverse();
      if (!bench || bench.length < 3) return 'neutral';

      const recentReturns = bench.map(b => (b.change_percent || 0) / 100);
      const avgReturn = mean(recentReturns);
      const vol = std(recentReturns);

      if (avgReturn > 0.005 && vol < 0.02) return 'bull';
      if (avgReturn < -0.005 || vol > 0.03)  return 'bear';
    } catch (e) {
      // 查询失败时默认neutral
    }
    return 'neutral';
  }

  // =========================================
  // Meta Learner: ElasticNet 弹性网络回归
  // =========================================

  /**
   * ElasticNet: L1+L2正则化线性融合
   * alpha: 正则化强度, l1_ratio: L1/L2比例
   */
  /**
   * Meta Learner: 多头排列强度驱动融合（替代自监督ElasticNet）
   *
   * 【FIX】原 _metaElasticNet 使用自监督（用GBDT预测自己），导致 w1≈w2≈w3=1/3
   * 所有L2股票得到完全相同的分数(0.5975)，完全失去区分度。
   *
   * 新方案：以三个模型的【多头排列一致性】为权重依据
   * - 三模型均看多 → 高权重给GBDT（全局因子模型）
   * - 三模型均看空 → 保守
   * - 混合信号 → 平均
   * - 单边极端 → 对应模型主导
   */

  _computeMLEnsembleScore(mlScore) {
    if (mlScore === null || mlScore === undefined) return 0.5;
    return (typeof mlScore === 'object' && mlScore !== null)
      ? (mlScore.score !== undefined ? mlScore.score : (mlScore.mlScore || 0.5))
      : Math.max(0, Math.min(1, mlScore));
  }

  // 从ai_ml_model表加载ML模型参数（替代不存在的ml_models表）
  _loadMLModels() {
    if (!this._mlCache) this._mlCache = new Map();
    if (this._mlCache.size > 0) return this._mlCache;
    try {
      const rows = this.db.prepare('SELECT id, data FROM ai_ml_model').all();
      for (const row of rows) {
        try {
          const d = JSON.parse(row.data);
          if (d.success !== false) {
            this._mlCache.set(row.id, d);
          }
        } catch(e) { /* skip malformed */ }
      }
      console.log('[ML-LOAD] 从ai_ml_model加载', this._mlCache.size, '个模型:',
        [...this._mlCache.keys()].join(','));
    } catch(e) { console.log('[ML-LOAD] 加载失败:', e.message); }
    return this._mlCache;
  }

  async _predictWithMLModels(featureMatrix) {
    try {
      // 【P0修复】优先使用预加载的模块缓存，消除运行时 import() 阻塞
      let ML_MODELS;
      if (this._mlModCache) {
        ML_MODELS = this._mlModCache.ML_MODELS;
      } else {
        const mod = await import('./ml_models.mjs');
        ML_MODELS = mod.ML_MODELS;
      }
      const modelParams = this._loadMLModels();
      const scores = [];
      const modelScores = {};  // Store individual model scores
      const modelIds = ['linear', 'xgboost', 'lightgbm', 'rf', 'svm', 'catboost',
                        'arima', 'garch', 'autoencoder', 'lstm', 'gru',
                        'cnn', 'transformer', 'gnn', 'bayesian', 'rl'];

      // 15维特征名称映射（_extractMLFeatures 返回顺序）
      const CANONICAL_FEATURES = [
        'avgReturn', 'volatility', 'lastChange', 'range', 'volRatio',
        'rsi', 'macdHist', 'bollPosition', 'kdjK', 'macdCross',
        'volumeSpike', 'mom5', 'mom10', 'mom20', 'industry'
      ];
      // 特征名别名映射（训练函数可能用不同名称）
      const FEATURE_ALIASES = {
        'avgReturn': ['avgReturn', 'avgRet', 'avg_return_5d'],
        'volatility': ['volatility', 'returnVol', 'vol20', 'volatility_20d'],
        'lastChange': ['lastChange', 'lastChg', 'change_percent'],
        'range': ['range'],
        'volRatio': ['volRatio', 'volume_ratio'],
        'rsi': ['rsi', 'rsi_14'],
        'macdHist': ['macdHist', 'macd_hist'],
        'bollPosition': ['bollPosition', 'bollPos'],
        'kdjK': ['kdjK', 'kdj_k'],
        'macdCross': ['macdCross'],
        'volumeSpike': ['volumeSpike', 'volSpike'],
        'mom5': ['mom5', 'price_momentum_5d'],
        'mom10': ['mom10', 'avg_return_10d'],
        'mom20': ['mom20', 'avg_return_20d'],
        'industry': ['industry', 'industry_factor'],
      };

      // 为每个模型构建特征映射：model.featureNames[i] → canonical index
      function buildFeatureMap(modelFeatureNames) {
        if (!modelFeatureNames || modelFeatureNames.length === 0) return null;
        const aliasToCanonical = {};
        for (const [canonical, aliases] of Object.entries(FEATURE_ALIASES)) {
          for (const alias of aliases) aliasToCanonical[alias.toLowerCase()] = CANONICAL_FEATURES.indexOf(canonical);
        }
        return modelFeatureNames.map(fn => {
          const idx = aliasToCanonical[fn.toLowerCase()];
          return idx !== undefined ? idx : -1;
        });
      }

      // 缓存特征映射
      const featureMapCache = new Map();

      // ── Phase 1: 收集所有股票×所有模型的raw scores ──
      const n = featureMatrix.length;
      const rawScores = new Map(); // modelId → [score_per_stock]
      const stockModelScores = [];  // [stock_idx → Map(modelId → score)]

      for (let si = 0; si < n; si++) {
        // 【P0修复】每处理一只股票后yield一次，防止768次同步ML预测阻塞事件循环
        if (si > 0) await new Promise(resolve => setImmediate(resolve));

        const stock = featureMatrix[si];
        const features = this._extractMLFeatures(stock);
        const sms = new Map();

        for (const modelId of modelIds) {
          const handler = ML_MODELS[modelId];
          if (!handler?.predict) continue;
          try {
            const md = modelParams.get(modelId);
            if (!md) continue;
            if (md.success === false) continue;
            const p = md.params || {};
            // 特征映射：对于内部用 tree.feature 做索引的模型（lightgbm），
            // 不做映射，直接传15维特征（predict函数内部处理越界）
            let modelFeatures = features;
            const noRemapModels = new Set(['lightgbm']);
            if (md.featureNames && md.featureNames.length > 0 && !noRemapModels.has(modelId)) {
              let fmap = featureMapCache.get(modelId);
              if (!fmap) {
                fmap = buildFeatureMap(md.featureNames);
                featureMapCache.set(modelId, fmap);
              }
              if (fmap) modelFeatures = fmap.map(idx => idx >= 0 ? features[idx] : 0);
            }
            const score = handler.predict(p, modelFeatures);
            if (score === null || !isFinite(score)) continue;
            sms.set(modelId, score);
            if (!rawScores.has(modelId)) rawScores.set(modelId, []);
            rawScores.get(modelId).push(score);
          } catch(e) {
            // 【修复】移除require('fs')，ESM环境下不可用
            if (process.env.L2_ML_DEBUG) console.log(`[L2-DBG] ${modelId} predict err: ${e.message}`);
          }
        }
        stockModelScores.push(sms);
      }

      // ── Phase 2: 计算每个模型的min-max归一化参数 ──
      const normParams = new Map(); // modelId → {min, max, range}
      for (const [modelId, vals] of rawScores) {
        if (vals.length < 2) { normParams.set(modelId, null); continue; }
        const mn = Math.min(...vals);
        const mx = Math.max(...vals);
        const rng = mx - mn;
        normParams.set(modelId, { min: mn, max: mx, range: rng });
        if (process.env.L2_ML_DEBUG) console.log(`[L2-NORM] ${modelId} raw=[${mn.toFixed(4)}, ${mx.toFixed(4)}] range=${rng.toFixed(4)} n=${vals.length}`);
      }

      // ── Phase 3: 加权平均归一化后的分数 ──
      // 计算每个模型的预测方差（range），用于过滤无区分度模型
      // 【修复】过滤准确率<53%的垃圾模型和ARIMA/GARCH虚假模型
      // 【Phase1进化 2026-07-06】排除4个天花板模型: CatBoost(37.06%)/CNN(49.24%)/GRU(49.35%)/Transformer(51.93%)
      // 原JUNK已排除: arima/garch/autoencoder/bayesian/gru/lstm/rl/transformer
      // 新增排除: catboost/cnn
      const JUNK_MODELS = new Set([
        'arima', 'garch', 'autoencoder', 'bayesian', 'gru', 'lstm', 'rl', 'transformer',
        'catboost', 'cnn', 'bayesian', 'autoencoder'  // 【Phase1进化】天花板模型排除
      ]);
      const modelStdMap = new Map();
      for (const [modelId, vals] of rawScores) {
        if (vals.length < 2) { modelStdMap.set(modelId, 0); continue; }
        // 用max-min作为粗略std proxy，要求 >1%
        const rng = normParams.get(modelId)?.range || 0;
        modelStdMap.set(modelId, rng > 0.01 ? rng : 0);
      }
      for (let si = 0; si < n; si++) {
        const sms = stockModelScores[si];
        let sumW = 0, sumWS = 0, valid = 0;
        for (const [modelId, rawScore] of sms) {
          // 【修复】跳过垃圾模型
          if (JUNK_MODELS.has(modelId)) continue;
          const np = normParams.get(modelId);
          if (!np) continue;
          const normed = np.range > 1e-8 ? (rawScore - np.min) / np.range : 0.5;
          const std = modelStdMap.get(modelId) || 0;
          if (std < 0.01) continue; // 方差<1%→无区分度→跳过
          const md = modelParams.get(modelId);
          const rawAcc = md?.accuracy || 0.5;
          // 【Phase5进化 2026-07-07】优化权重公式
          // 原公式: 0.3 + 0.4 / (1 + exp(-12*(acc-0.55)))
          // 新公式: 分段幂函数，更激进地奖励高准确率模型
          // acc<55%: 权重=0.3
          // 55-62%: 权重=0.3+(acc-0.55)*4 (线性增长)
          // 62-70%: 权重=0.3+0.28+(acc-0.62)^1.5 (幂函数加速)
          // acc>70%: 权重=1.0 (封顶)
          let accWeight;
          if (rawAcc < 0.55) {
            accWeight = 0.3;
          } else if (rawAcc < 0.62) {
            accWeight = 0.3 + (rawAcc - 0.55) * 4;
          } else if (rawAcc < 0.70) {
            accWeight = 0.3 + 0.28 + Math.pow(rawAcc - 0.62, 1.5) * 3;
          } else {
            accWeight = 1.0;
          }
          const weight = accWeight * (std / (std + 0.05));
          sumWS += normed * weight;
          sumW += weight;
          valid++;
        }
        if (valid === 0 && process.env.L2_ML_DEBUG) console.log(`[L2-DBG] stock=${featureMatrix[si]?.code || '?'} 无有效ML模型`);
        scores.push(sumW > 0 ? Math.max(0, Math.min(1, sumWS / sumW)) : 0.5);
      }
      return { scores, stockModelScores };
    } catch(e) {
      console.log('[L2] ML预测异常，回退0.5:', e.message);
      return { scores: featureMatrix.map(() => 0.5), stockModelScores: [] };
    }
  }

  _extractMLFeatures(stock) {
    // 扩展到25维特征（原15维 + 新增10维）
    const prices = stock.prices || [];
    const rsi = (stock.rsi_14 || stock.rsi || 50) / 100;
    const macd = stock.macd ? stock.macd / 100 : 0;
    const macdHist = stock.macd_hist || 0;
    const bollPos = (stock.bollinger_upper && stock.bollinger_lower)
      ? Math.max(0, Math.min(1, (stock.close - stock.bollinger_lower) / (stock.bollinger_upper - stock.bollinger_lower + 1e-10)))
      : 0.5;
    const kdjK = (stock.kdj_k || 50) / 100;
    const macdCross = (stock.macd || 0) > (stock.macd_signal || 0) ? 0.5 : -0.5;
    const volRatio = stock.volume_ratio || stock.vol_ratio || 1;
    const avgRet = (stock.avg_return_5d || 0) / 10;
    const vol20 = (stock.volatility_20d || 0) / 20;
    const lastChg = (stock.change_percent || 0) / 100;
    const high_ = stock.high || stock.close || 0;
    const low_ = stock.low || stock.close || 0;
    const range = high_ > 0 ? (high_ - low_) / high_ : 0.01;
    const volSpike = Math.abs((volRatio - 1)) * 5;
    const mom5 = (stock.price_momentum_5d || 0) / 10;
    const mom10 = (stock.avg_return_10d || 0) / 20;
    const mom20 = (stock.avg_return_20d || 0) / 20;
    const industry = stock.industry_factor || 0;
    
    // ── 新增特征（10维）──
    // 16. 主力资金流强度 (mainStrength: -1~1)
    const mainStrength = Math.max(-1, Math.min(1, (stock.main_strength || stock.main_ratio || 0) / 100));
    // 17. 板块联动强度 (sectorCorr: -1~1)
    const sectorCorr = Math.max(-1, Math.min(1, stock.sector_correlation || 0));
    // 18. 量价背离度 (vpDivergence: 价涨量缩=负值, 价跌量涨=正值)
    const vpDivergence = lastChg > 0 && volRatio < 1 ? -0.5 * (1 - volRatio)  // 价涨量缩=看跌信号
                       : lastChg < 0 && volRatio > 1 ? 0.5 * (volRatio - 1)   // 价跌量涨=看涨信号
                       : 0;
    // 19. 北向资金净流入 (northFlow: -1~1)
    const northFlow = Math.max(-1, Math.min(1, (stock.north_inflow || 0) / 1e9)); // 亿元归一化
    // 20. 融资余额变化 (marginChange: -1~1)
    const marginChange = Math.max(-1, Math.min(1, (stock.margin_change || 0) * 10));
    // 21. 换手率 (turnover: 0~1)
    const turnover = Math.min(1, (stock.turnover_rate || 0) / 20); // 20%为上限
    // 22. 流市值比 (floatRatio: 0~1)
    const floatRatio = Math.min(1, (stock.float_ratio || 0.5));
    // 23. 涨停板距离 (limitDist: 0~1)
    const limitDist = stock.close > 0 && stock.limit_up > 0 
                    ? Math.max(0, (stock.limit_up - stock.close) / stock.close)
                    : 0.1;
    // 24. 跌停板距离 (limitDownDist: 0~1)
    const limitDownDist = stock.close > 0 && stock.limit_down > 0 
                        ? Math.max(0, (stock.close - stock.limit_down) / stock.close)
                        : 0.1;
    // 25. 市值因子 (capFactor: 0~1, log scale)
    const capFactor = stock.market_cap > 0 
                    ? Math.min(1, Math.log10(stock.market_cap) / 5) // 10^5亿=万亿封顶
                    : 0.5;
    
    return [avgRet, vol20, lastChg, range, volRatio, rsi, macdHist, bollPos, kdjK, macdCross, 
            volSpike, mom5, mom10, mom20, industry,
            mainStrength, sectorCorr, vpDivergence, northFlow, marginChange,
            turnover, floatRatio, limitDist, limitDownDist, capFactor];
  }

  _metaElasticNet(base1, base2, base3, mlScores) {
    const n = base1.length;
    const scores = [];

    for (let i = 0; i < n; i++) {
      const b1 = base1[i];
      const b2 = base2[i];
      const b3 = base3[i];
      const mlScore = this._computeMLEnsembleScore(mlScores ? mlScores[i] : null);

      // ── Step 1: 三模型一致性 ──
      const consensus = ((b1 > 0.5 ? 1 : 0) + (b2 > 0.5 ? 1 : 0) + (b3 > 0.5 ? 1 : 0)) / 3;

      // ── Step 2: Base Learner 动态权重 ──
      const marketEnv = this._detectMarketEnv();
      const cfg = {
        bull:    { w1: 0.50, w2: 0.30, w3: 0.20 },
        bear:    { w1: 0.40, w2: 0.20, w3: 0.40 },
        neutral: { w1: 0.40, w2: 0.35, w3: 0.25 },
      }[marketEnv] || { w1: 0.40, w2: 0.35, w3: 0.25 };

      const baseScore = cfg.w1 * b1 + cfg.w2 * b2 + cfg.w3 * b3;
      const consensusBonus = (consensus - 0.5) * 0.1;
      const burstBonus = b2 > 0.6 ? (b2 - 0.6) * 0.15 : 0;

      // ── Step 3: ML集成得分融合（Base×50% + ML×50%）──
      let rawScore = baseScore + consensusBonus + burstBonus;
      // 【修复 2026-05-19】提高ML权重：25%→50%，rf(79%)/gnn(69.6%)等6个模型有效
      const mlWeight = Math.min(0.50, Math.max(0.05, (mlScore - 0.5) * 2 + 0.05));
      const baseWeight = 1 - mlWeight;
      rawScore = baseWeight * rawScore + mlWeight * mlScore;
      scores.push(Math.max(0, Math.min(1, rawScore)));
    }

    // ── Step 4: 相对排名归一化 ──
    // 【修复】当绝对分数同质化时，排名是唯一区分度来源，权重反转：排名50%+绝对50%
    const sorted = [...scores].sort((a, b) => a - b);
    return scores.map(s => {
      const rank = sorted.indexOf(s);
      const normalizedRank = rank / Math.max(n - 1, 1);
      // 检测同质化：如果scores标准差<0.05，增加排名权重
      const scoreStd = Math.sqrt(scores.reduce((sum, v) => sum + (v - scores.reduce((a,b)=>a+b,0)/n) ** 2, 0) / n);
      const rankWeight = scoreStd < 0.05 ? 0.50 : 0.15; // 同质化时排名权重大幅提升
      return Math.max(0, Math.min(1, s * (1 - rankWeight) + normalizedRank * rankWeight));
    });
  }

  /**
   * 计算L3信号置信度（贝叶斯多因子模型）
   *
   * 【FIX】原 _computeConfidence 只看 base learner 一致性，
   * 当 L2 同质化时（所有l2≈0.5975）std≈0 → confidence≈l2_score≈0.48，
   * 导致所有L3信号置信度固定，无法区分优质信号。
   *
   * 新方案（多因子贝叶斯信心）：
   * 因子1: 一致性因子 — base learner 预测方向一致
   * 因子2: 强度因子   — l2_score 的绝对值（在top50中的位置）
   * 因子3: 市场因子   — 当前市场情绪（情绪高时置信度提升）
   * 因子4: Kelly因子  — 凯利仓位比例（仓位高→信号强→置信度高）
   */
  _computeConfidence(b1, b2, b3, stockData = {}) {
    const mean_ = (b1 + b2 + b3) / 3;
    const variance = ((b1 - mean_) ** 2 + (b2 - mean_) ** 2 + (b3 - mean_) ** 2) / 3;
    const std_ = Math.sqrt(variance);

    // 因子1: 一致性因子 — 模型越一致置信度越高
    const consensusFactor = Math.max(0.2, 1.0 - std_ * 5);
    // 因子2: 强度因子 — sigmoid映射让l2_score有更好区分度
    const l2Score = stockData.l2Score || mean_;
    // 【修复】sigmoid映射: l2_score 0.3→0.35, 0.5→0.50, 0.7→0.68, 0.8→0.79
    const strengthFactor = 1 / (1 + Math.exp(-8 * (l2Score - 0.5)));
    // 因子3: 市场情绪因子
    const marketEnv = this._detectMarketEnv();
    const marketFactor = marketEnv === 'bull' ? 1.15
                      : marketEnv === 'bear'  ? 0.85
                      : 1.0;
    // 因子4: ML集成因子 — ml_ensemble_score偏离0.5越多，置信度越高
    // 【修复】降低ML偏差因子影响 0.3→0.15
    const mlScore = stockData.mlEnsembleScore || 0.5;
    const mlDeviation = Math.abs(mlScore - 0.5) * 2; // 0~1, 偏离0.5越远越可信
    const mlFactor = 1.0 + mlDeviation * 0.15; // 1.0~1.15

    // 综合贝叶斯信心（加权融合）
    let confidence = consensusFactor * 0.4 + strengthFactor * 0.6;
    confidence *= marketFactor;
    confidence *= mlFactor;

    return Math.max(0.15, Math.min(0.95, confidence));  // 返回小数(0-1),舜帝舜帝舜帝*100舜帝
  }

  /**
   * 简单准确率评估（代理指标）
   */
  _evaluateModel(top50) {
    if (top50.length < 5) return 0;
    // 代理指标：L2得分与L1得分的相关性（作为模型一致性参考）
    // 过滤无效值，防止NaN导致负值
    const pairs = top50
      .map(s => ({ l1: s.l1_total_score || 0, l2: s.l2_score || 0 }))
      .filter(p => isFinite(p.l1) && isFinite(p.l2) && p.l1 !== 0 && p.l2 !== 0);
    if (pairs.length < 5) return 0;
    const corr = pearsonCorr(pairs.map(p => p.l1), pairs.map(p => p.l2));
    // 防御：相关性应在[-1,1]，负值说明模型与L1反向（异常）
    return (isFinite(corr) && corr >= 0) ? corr : 0;
  }

  /**
   * 【Phase3】多周期技术信号计算
   * RSI(6/12/24)多周期共振 + MACD金叉死叉背离 + KDJ极值 + BOLL位置
   * @param {string} code 股票代码
   * @param {Object} db 数据库实例
   * @returns {Object} { signal: 'strong_buy'|'buy'|'neutral'|'sell', score: 0-100, details: {} }
   */
  calculateMultiPeriodTechSignal(code, db) {
    try {
      // 获取最近60日K线数据
      const bars = db.prepare(`
        SELECT date, open, high, low, close, volume
        FROM stock_history
        WHERE code = ?
        ORDER BY date DESC
        LIMIT 60
      `).all(code);
      
      if (bars.length < 30) {
        return { signal: 'neutral', score: 50, details: { error: '数据不足' } };
      }
      
      // 反转为时间升序
      const closes = bars.reverse().map(b => b.close);
      const highs = bars.map(b => b.high);
      const lows = bars.map(b => b.low);
      const volumes = bars.map(b => b.volume);
      
      const details = {};
      let totalScore = 50; // 基准分
      let buySignals = 0;
      let sellSignals = 0;
      
      // 1. RSI 多周期(6/12/24)
      const calcRSI = (data, period) => {
        if (data.length < period + 1) return null;
        let gains = 0, losses = 0;
        for (let i = data.length - period; i < data.length; i++) {
          const change = data[i] - data[i - 1];
          if (change > 0) gains += change;
          else losses -= change;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
      };
      
      const rsi6 = calcRSI(closes, 6);
      const rsi12 = calcRSI(closes, 12);
      const rsi24 = calcRSI(closes, 24);
      details.rsi = { rsi6, rsi12, rsi24 };
      
      // RSI 超卖共振(<30买入信号, >70卖出信号)
      let rsiBuyCount = 0, rsiSellCount = 0;
      if (rsi6 < 30) rsiBuyCount++;
      if (rsi12 < 30) rsiBuyCount++;
      if (rsi24 < 30) rsiBuyCount++;
      if (rsi6 > 70) rsiSellCount++;
      if (rsi12 > 70) rsiSellCount++;
      if (rsi24 > 70) rsiSellCount++;
      
      if (rsiBuyCount >= 2) { buySignals++; totalScore += 10; }
      if (rsiSellCount >= 2) { sellSignals++; totalScore -= 10; }
      
      // 2. MACD(12,26,9)
      const calcMACD = (data) => {
        if (data.length < 35) return null;
        const ema12 = [], ema26 = [], macd = [], signal = [], hist = [];
        const calcEMA = (arr, period) => {
          const k = 2 / (period + 1);
          const emaArr = [arr[0]];
          for (let i = 1; i < arr.length; i++) {
            emaArr.push(arr[i] * k + emaArr[i - 1] * (1 - k));
          }
          return emaArr;
        };
        const e12 = calcEMA(data, 12);
        const e26 = calcEMA(data, 26);
        for (let i = 0; i < data.length; i++) {
          macd.push(e12[i] - e26[i]);
        }
        const sig = calcEMA(macd, 9);
        for (let i = 0; i < macd.length; i++) {
          hist.push(macd[i] - sig[i]);
        }
        return { macd: macd[macd.length - 1], signal: sig[sig.length - 1], hist: hist[hist.length - 1], histPrev: hist[hist.length - 2] };
      };
      
      const macdData = calcMACD(closes);
      if (macdData) {
        details.macd = macdData;
        // 金叉(柱状图从负转正)
        if (macdData.histPrev < 0 && macdData.hist > 0) {
          buySignals++; totalScore += 8;
        }
        // 死叉(柱状图从正转负)
        if (macdData.histPrev > 0 && macdData.hist < 0) {
          sellSignals++; totalScore -= 8;
        }
        // 顶背离(价格新高但MACD未新高)
        if (closes[closes.length - 1] > closes[closes.length - 5] && macdData.macd < (macdData.macd * 0.9)) {
          sellSignals++; totalScore -= 5;
        }
      }
      
      // 3. KDJ(9,3,3)
      const calcKDJ = (highs, lows, closes) => {
        if (closes.length < 15) return null;
        const period = 9;
        const rsvs = [];
        for (let i = period - 1; i < closes.length; i++) {
          const highN = Math.max(...highs.slice(i - period + 1, i + 1));
          const lowN = Math.min(...lows.slice(i - period + 1, i + 1));
          const rsv = highN === lowN ? 50 : ((closes[i] - lowN) / (highN - lowN)) * 100;
          rsvs.push(rsv);
        }
        const kArr = [50], dArr = [50];
        for (let i = 1; i < rsvs.length; i++) {
          kArr.push((2 / 3) * kArr[i - 1] + (1 / 3) * rsvs[i]);
          dArr.push((2 / 3) * dArr[i - 1] + (1 / 3) * kArr[i]);
        }
        return { k: kArr[kArr.length - 1], d: dArr[dArr.length - 1], j: 3 * kArr[kArr.length - 1] - 2 * dArr[dArr.length - 1] };
      };
      
      const kdj = calcKDJ(highs, lows, closes);
      if (kdj) {
        details.kdj = kdj;
        // 超卖(J<20买入)
        if (kdj.j < 20) {
          buySignals++; totalScore += 7;
        }
        // 超买(J>80卖出)
        if (kdj.j > 80) {
          sellSignals++; totalScore -= 7;
        }
      }
      
      // 4. BOLL(20,2)
      const calcBOLL = (data) => {
        if (data.length < 20) return null;
        const period = 20;
        const recent = data.slice(-period);
        const ma = recent.reduce((a, b) => a + b, 0) / period;
        const std = Math.sqrt(recent.reduce((sum, v) => sum + Math.pow(v - ma, 2), 0) / period);
        return { upper: ma + 2 * std, mid: ma, lower: ma - 2 * std, current: data[data.length - 1] };
      };
      
      const boll = calcBOLL(closes);
      if (boll) {
        details.boll = boll;
        // 接近下轨(买入)
        if (boll.current <= boll.lower * 1.02) {
          buySignals++; totalScore += 6;
        }
        // 接近上轨(卖出)
        if (boll.current >= boll.upper * 0.98) {
          sellSignals++; totalScore -= 6;
        }
      }
      
      // 共振检测：多个信号同向
      if (buySignals >= 3) totalScore += 10;
      else if (buySignals >= 2) totalScore += 5;
      if (sellSignals >= 3) totalScore -= 10;
      else if (sellSignals >= 2) totalScore -= 5;
      
      // 强制规则：卖出信号多于买入信号时强制为sell
      if (sellSignals > buySignals && sellSignals >= 2) {
        totalScore = Math.min(totalScore, 35);
      }
      
      // 分数clamp
      totalScore = Math.max(0, Math.min(100, totalScore));
      
      // 信号分级
      let signal = 'neutral';
      if (totalScore >= 70) signal = 'strong_buy';
      else if (totalScore >= 60) signal = 'buy';
      else if (totalScore < 40) signal = 'sell';
      
      return { signal, score: totalScore, details, buySignals, sellSignals };
    } catch (e) {
      return { signal: 'neutral', score: 50, details: { error: e.message } };
    }
  }

  /**
   * 保存L2缓存
   */
  _saveCache(top50, modelAccuracy) {
    const rows = top50.map(s => ({
      code:            s.code,
      name:            s.name        || '',  // 【修复 2026-05-19】保存股票名称
      l2_score:        s.l2_score    || 0,
      confidence:      s.confidence  || 0,
      gbdt_pred:       s.gbdt_pred   || 0,
      histgbdt_pred:   s.histgbdt_pred || 0,
      category_boost:  s.category_boost || 0,
      meta_pred:       s.meta_pred   || 0,
      ml_ensemble_score: s.ml_ensemble_score || 0,
      model_scores:   s.modelScores ? JSON.stringify(s.modelScores) : null,  // 混合方案：存储所有模型分数
      win_rate:        s.win_rate    || modelAccuracy || 0,
      updated_at:      bjISO()
    }));
    // 【修复 2026-05-09】清理旧缓存，避免积压
    const del2 = this.db.prepare('DELETE FROM yaodi_l2_cache').run();
    this.db.batchUpsert('yaodi_l2_cache', rows, 'code');
    Logger.info('[L2] 缓存已写入', { deleted: del2.changes, inserted: rows.length });
  }
}

// ============================================================
// L3: 三重防御风控引擎
// ============================================================

/**
 * L3 三重防御风控引擎
 * Top 50 → 最终信号 + 风控拦截
 * 
 * 三重防线:
 *   1. 政审合规: 质押率过滤 + 流动性闸门
 *   2. 凯利仓位: 风险溢价 + L2置信度 → 最优仓位 + ATR止损
 *   3. 环境熔断: 胜率偏差监控 + 大盘跌停拦截
 */
class L3Engine {
  constructor(db) {
    this.db = db;
    // 状态机状态
    this.schedulerState = 'normal';
    // 历史胜率记录（用于熔断）
    this.winRateHistory = [];
    this.maxDrawdownHistory = [];
    // 拦截历史（用于风控日志展示）
    this.blockedHistory = [];
    // 演化投票缓存（避免重复查询）
    this.topBranchesCache = null;
    this.cacheExpiry = 0;
  }

  /**
   * 主入口: L3风控过滤
   * @param {Array} l2Pool Top50精排池
   * @param {Array} holdings 当前持仓
   * @param {Object} marketState 市场状态
   */
  async run(l2Pool, holdings = [], marketState = {}) {
    const startTime = Date.now();
    Logger.info(`[L3] 开始L3风控过滤，候选=${l2Pool.length}，持仓=${holdings.length}`);

    try {
      // Step 1: 政审合规过滤
      const { passed: compliancePassed, blocked: complianceBlocked } =
        this._complianceFilter(l2Pool);

      // Step 2: 凯利仓位计算
      const kellySignals = this._kellyPositioning(compliancePassed, holdings, marketState);

      // Step 2.5: 演化模型投票（阶段一：观察模式，不影响决策）
      for (const signal of kellySignals) {
        signal.evolution_votes = this._getEvolutionPrediction(signal);
        // 【观察模式】暂不启用演化过滤
        // if (signal.evolution_votes.evolutionScore < -0.3) {
        //   signal.signal_status = 'watch';
        //   signal.block_reason = '演化看空';
        // }
      }
      
      // 保存演化投票记录
      this._saveEvolutionVotes(kellySignals);

      // Step 3: 环境熔断检查
      const { signals, circuitBroken } = this._circuitBreaker(
        kellySignals, complianceBlocked, marketState
      );

      // Step 4: 记录拦截历史（真正的blocked）
      this.blockedHistory = signals
        .filter(s => s.signal_status === 'blocked')
        .map(s => ({
          code: s.code,
          name: s.name,
          reason: s.block_reason,
          layer: s.block_layer || 'L3',
          time: bjISO(),
        }));

      // Step 5: 持久化拦截记录到 yaodi_risk_blocks 表（使用经过熔断处理的signals）
      this._saveBlockedRecords(complianceBlocked, signals);

      // Step 6: 写入信号表（使用经过熔断处理的signals）
      this._saveSignals(signals);

      const runTime = Date.now() - startTime;
      Logger.info(`[L3] 完成，信号=${signals.length}，拦截=${this.blockedHistory.length}，熔断=${circuitBroken}`);

      return { signals, blocked: this.blockedHistory, runTime };
    } catch (err) {
      Logger.error('[L3] L3运行异常', { error: err.message });
      throw err;
    }
  }

  // =========================================
  // 第一重: 政审合规过滤
  // =========================================

  /**
   * 政审合规过滤
   * 规则:
   *   - 质押率 > 80% → 直接剔除
   *   - 5日均成交额 < 1000万 → 流动性不足剔除
   *   - ST/*ST → 剔除
   *   - 科创板/北交所市值限制（可选）
   */
  _complianceFilter(pool) {
    const passed  = [];
    const blocked = [];

    for (const stock of pool) {
      const reason = [];
      // 【暴力诊断】打印每只股票的price和name
      if (stock.price === undefined || stock.price === null || stock.price === 0 || stock.price === '-') {
        Logger.info('[L3-DIAG] 零价股进入政审', { code: stock.code, name: stock.name, price: stock.price, priceType: typeof stock.price, hasPrice: 'price' in stock });
      }

      // 1. 价格有效性检查（停牌/退市股price=0/空/'-'，禁止进入信号）
      const rawPrice = stock.price;
      const price = (rawPrice === '-' || rawPrice === null || rawPrice === undefined) ? 0 : Number(rawPrice) || 0;
      if (!price || price <= 0) {
        reason.push(`停牌/退市(价格=${rawPrice})`);
      }

      // 2. 质押率检查
      const pledgeRatio = stock.pledge_ratio || 0;
      if (pledgeRatio > 80) {
        reason.push(`质押率${pledgeRatio.toFixed(1)}%>80%`);
      }

      // 3. 流动性闸门: 当日成交量 > 10万股（~1万手）
      // 非交易时段/批处理时volume可能为undefined，此时跳过流动性检查
      const dailyVol = stock.volume;
      if (dailyVol != null && dailyVol < 1e5) {
        reason.push(`流动性不足(当日${(dailyVol/1e4).toFixed(1)}万股<10万股)`);
      }

      // 3. ST/*ST过滤（名字含ST）
      const name = stock.name || '';
      if (name.includes('ST') || name.includes('退')) {
        reason.push('ST/*ST/退市');
      }

      // 4. 涨停板当日不可追入（可选规则）
      const rtCp = stock.rt_change_pct;
      if (rtCp != null && rtCp >= 9.9) {
        reason.push(`已涨停(${rtCp.toFixed(2)}%)`);
      }

      if (reason.length > 0) {
        blocked.push({ ...stock, block_reason: reason.join(' | ') });
      } else {
        passed.push(stock);
      }
    }

    // 【诊断】追踪 price=0 的股票是否被正确拦截
    const zeroPriceBlocked = blocked.filter(s => s.price === 0 || s.price == null);
    if (zeroPriceBlocked.length > 0) {
      Logger.info(`[L3-政审-DIAG] price=0股已拦截`, { codes: zeroPriceBlocked.map(s => s.code).slice(0,5) });
    }
    // 【诊断】检查 L2 pool 中 price=0 的股票（如果通过了政审）
    const zeroPricePassed = passed.filter(s => (s.price === 0 || s.price == null));
    if (zeroPricePassed.length > 0) {
      Logger.warn(`[L3-政审-DIAG] ⚠️ price=0股穿透了政审!`, { codes: zeroPricePassed.map(s => s.code) });
    }
    Logger.info(`[L3-政审] 通过=${passed.length}，拦截=${blocked.length}`);
    return { passed, blocked };
  }

  // =========================================
  // 演化模型投票（阶段一：观察模式）
  // =========================================

  /**
   * 获取演化分支预测
   * @param {Object} stock 股票数据
   * @returns {Object} 演化投票结果
   */
  _getEvolutionPrediction(stock) {
    try {
      // 使用缓存避免频繁查询（缓存5分钟）
      const now = Date.now();
      if (!this.topBranchesCache || now > this.cacheExpiry) {
        this.topBranchesCache = this.db.prepare(`
          SELECT id, name, accuracy, win_rate, strategy, best_environment
          FROM yaodi_branch
          WHERE active = 1 AND accuracy > 80
          ORDER BY accuracy DESC
          LIMIT 20
        `).all();
        this.cacheExpiry = now + 5 * 60 * 1000; // 5分钟缓存
        Logger.info(`[L3-演化] 已缓存 ${this.topBranchesCache.length} 个高分分支`);
      }

      const branches = this.topBranchesCache;
      if (branches.length === 0) {
        return { evolutionScore: 0, upVotes: 0, downVotes: 0, neutralVotes: 0, totalBranches: 0 };
      }

      // 获取技术指标（从stock_history实时计算）
      const indicators = this._getIndicators(stock.code);
      // 注入到stock对象（供_simulateBranchSignal使用）
      Object.assign(stock, indicators);

      let upVotes = 0, downVotes = 0, neutralVotes = 0;
      const votedBranches = [];

      for (const branch of branches) {
        const signal = this._simulateBranchSignal(branch, stock);
        votedBranches.push({ branchId: branch.id, branchName: branch.name, signal });
        
        if (signal === 'up') upVotes++;
        else if (signal === 'down') downVotes++;
        else neutralVotes++;
      }

      const evolutionScore = (upVotes - downVotes) / branches.length;

      return {
        evolutionScore,
        upVotes,
        downVotes,
        neutralVotes,
        totalBranches: branches.length,
        votedBranches,
        stockCode: stock.code
      };
    } catch (err) {
      Logger.error('[L3-演化] 获取演化预测失败', { error: err.message, stock: stock.code });
      return { evolutionScore: 0, upVotes: 0, downVotes: 0, neutralVotes: 0, totalBranches: 0 };
    }
  }

  /**
   * 计算股票技术指标（从stock_history实时计算）
   * @param {string} code 股票代码
   * @returns {Object} 技术指标对象
   */
  _getIndicators(code) {
    try {
      const rows = this.db.prepare(`
        SELECT date, close, volume FROM stock_history
        WHERE code=? ORDER BY date DESC LIMIT 30
      `).all([code]);

      if (rows.length < 5) {
        return { rsi_14: 50, macd: 0, macd_signal: 0, ma_5: 0, ma_20: 0, price: 0, volume: 0, avg_volume_5d: 0 };
      }

      // 反转数组： oldest first
      const bars = rows.reverse();
      const closes = bars.map(r => r.close);
      const volumes = bars.map(r => r.volume);
      const currentPrice = closes[closes.length - 1];
      const currentVolume = volumes[volumes.length - 1];

      // === RSI-14 ===
      let rsi = 50;
      if (closes.length >= 15) {
        let avgGain = 0, avgLoss = 0;
        for (let i = 1; i <= 14; i++) {
          const diff = closes[i] - closes[i - 1];
          if (diff > 0) avgGain += diff;
          else avgLoss += Math.abs(diff);
        }
        avgGain /= 14;
        avgLoss /= 14;
        if (avgLoss > 0) {
          const rs = avgGain / avgLoss;
          rsi = 100 - (100 / (1 + rs));
        } else {
          rsi = 100;
        }
      }

      // === MACD (EMA-12, EMA-26, Signal-9) ===
      const ema = (arr, period) => {
        if (arr.length === 0) return 0;
        let e = arr[0];
        const k = 2 / (period + 1);
        for (let i = 1; i < arr.length; i++) {
          e = arr[i] * k + e * (1 - k);
        }
        return e;
      };
      const ema12 = ema(closes.slice(-12), 12);
      const ema26 = ema(closes.slice(-26), 26);
      const macdLine = ema12 - ema26;

      // 计算 MACD Signal (9日EMA of MACD)
      const macdHist = [];
      for (let i = 26; i < closes.length; i++) {
        const e12 = ema(closes.slice(Math.max(0, i - 11), i + 1), 12);
        const e26 = ema(closes.slice(Math.max(0, i - 25), i + 1), 26);
        macdHist.push(e12 - e26);
      }
      const macdSignal = ema(macdHist.slice(-9), 9);

      // === MA5 / MA20 ===
      const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, closes.length);
      const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);

      // === 5日均量 ===
      const avgVol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, volumes.length);

      return {
        rsi_14: Math.round(rsi * 10) / 10,
        macd: Math.round(macdLine * 100) / 100,
        macd_signal: Math.round(macdSignal * 100) / 100,
        ma_5: Math.round(ma5 * 100) / 100,
        ma_20: Math.round(ma20 * 100) / 100,
        price: Math.round(currentPrice * 100) / 100,
        volume: currentVolume,
        avg_volume_5d: avgVol5,
      };
    } catch (err) {
      // 出错时返回默认值
      return { rsi_14: 50, macd: 0, macd_signal: 0, ma_5: 0, ma_20: 0, price: 0, volume: 0, avg_volume_5d: 0 };
    }
  }

  /**
   * 模拟分支信号（根据策略类型）
   * @param {Object} branch 演化分支
   * @param {Object} stock 股票数据
   * @returns {string} 'up' | 'down' | 'neutral'
   */
  _simulateBranchSignal(branch, stock) {
    try {
      const strategy = branch.strategy || '';
      const name = branch.name || '';
      
      // RSI指标策略
      if (strategy.includes('RSI') || name.includes('RSI')) {
        const rsi = stock.rsi_14 || stock.rsi || 50;
        if (rsi < 30) return 'up';      // 超卖反弹
        if (rsi > 70) return 'down';     // 超买回落
        return 'neutral';
      }
      
      // MACD策略
      if (strategy.includes('MACD') || name.includes('MACD')) {
        const macd = stock.macd || 0;
        const macdSignal = stock.macd_signal || 0;
        if (macd > macdSignal && macd > 0) return 'up';
        if (macd < macdSignal && macd < 0) return 'down';
        return 'neutral';
      }
      
      // 均线系统策略
      if (strategy.includes('均线') || name.includes('均线') || strategy.includes('MA')) {
        const ma5 = stock.ma_5 || stock.price;
        const ma20 = stock.ma_20 || stock.price;
        const price = stock.price || 0;
        if (price > ma5 && ma5 > ma20) return 'up';
        if (price < ma5 && ma5 < ma20) return 'down';
        return 'neutral';
      }
      
      // 趋势跟踪策略
      if (strategy.includes('趋势') || name.includes('趋势')) {
        const changePct = stock.change_percent || stock.rt_change_pct || 0;
        const volume = stock.volume || 0;
        const avgVolume = stock.avg_volume_5d || volume;
        if (changePct > 2 && volume > avgVolume) return 'up';
        if (changePct < -2 && volume > avgVolume) return 'down';
        return 'neutral';
      }
      
      // ATR指标策略
      if (strategy.includes('ATR') || name.includes('ATR')) {
        const atr = stock.atr || 0;
        const price = stock.price || 1;
        const atrPct = atr / price;
        if (atrPct < 0.02) return 'up';  // 波动率低，趋势稳定
        if (atrPct > 0.05) return 'neutral'; // 波动率过高，观望
        return 'neutral';
      }
      
      // VR成交量策略
      if (strategy.includes('VR') || name.includes('成交量') || name.includes('VR')) {
        const volume = stock.volume || 0;
        const avgVolume = stock.avg_volume_5d || stock.volume || 1;
        const vr = volume / avgVolume;
        if (vr > 1.5) return 'up';   // 放量上涨
        if (vr < 0.5) return 'down'; // 缩量下跌
        return 'neutral';
      }
      
      // 默认：基于置信度的随机投票（模拟演化不确定性）
      const confidence = stock.confidence || 0.5;
      const random = Math.random();
      if (confidence > 0.7 && random < 0.6) return 'up';
      if (confidence < 0.3 && random < 0.6) return 'down';
      return 'neutral';
      
    } catch (err) {
      return 'neutral';
    }
  }

  /**
   * 保存演化投票记录
   * @param {Array} signals 带演化投票信息的信号列表
   */
  _saveEvolutionVotes(signals) {
    try {
      // 确保表存在
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS yaodi_evolution_votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stock_code TEXT NOT NULL,
          stock_name TEXT,
          branch_ids TEXT NOT NULL,
          up_votes INTEGER DEFAULT 0,
          down_votes INTEGER DEFAULT 0,
          neutral_votes INTEGER DEFAULT 0,
          vote_score REAL DEFAULT 0,
          signal_status TEXT DEFAULT 'pending',
          created_at TEXT DEFAULT (datetime('now','localtime'))
        )
      `).run();

      const rows = signals
        .filter(s => s.evolution_votes && s.evolution_votes.totalBranches > 0)
        .map(s => ({
          stock_code: s.code,
          stock_name: s.name,
          branch_ids: JSON.stringify(s.evolution_votes.votedBranches.map(b => b.branchId)),
          up_votes: s.evolution_votes.upVotes,
          down_votes: s.evolution_votes.downVotes,
          neutral_votes: s.evolution_votes.neutralVotes,
          vote_score: s.evolution_votes.evolutionScore,
          signal_status: s.signal_status || 'pending'
        }));

      if (rows.length === 0) return;

      const insert = this.db.prepare(`
        INSERT INTO yaodi_evolution_votes
        (stock_code, stock_name, branch_ids, up_votes, down_votes, neutral_votes, vote_score, signal_status)
        VALUES (@stock_code, @stock_name, @branch_ids, @up_votes, @down_votes, @neutral_votes, @vote_score, @signal_status)
      `);

      for (const row of rows) insert.run(row);

      Logger.info(`[L3-演化] 已保存 ${rows.length} 条演化投票记录`);
    } catch (err) {
      Logger.error('[L3-演化] 保存投票记录失败', { error: err.message });
    }
  }

  // =========================================
  // 第二重: 凯利仓位管理
  // =========================================

  /**
   * 凯利仓位公式:
   *   f* = (bp - q) / b
   *   其中: b=赔率(盈亏比), p=胜率, q=1-p
   * 
   * 改进版:
   *   kelly_pct = min(10%, confidence * risk_factor * kelly_ratio)
   *   风险溢价系数: 根据市场波动率和PE分位数调整
   *   单只上限: 10%，行业合计上限: 20%
   */
  _kellyPositioning(passed, holdings, marketState) {
    if (passed.length === 0) return [];

    // 【修复】L2分数门槛：低于0.4的不生成信号，避免低分股被推荐（如689009 l2_score=0.34）
    const L2_SCORE_MIN = 0.5; // 【修复】L2门槛从0.4提高到0.5，只有中等以上L2分数才生成信号
    const passedFiltered = passed.filter(s => {
      const score = s.l2_score || 0;
      if (score < L2_SCORE_MIN) {
        Logger.debug('[L3-凯利] L2分数过低过滤', { code: s.code, score });
        return false;
      }
      return true;
    });
    if (passedFiltered.length < passed.length) {
      Logger.info(`[L3-凯利] L2分数<${L2_SCORE_MIN}过滤`, { removed: passed.length - passedFiltered.length, remaining: passedFiltered.length });
    }
    passed = passedFiltered;
    if (passed.length === 0) return [];

    // 风险溢价系数（市场风险越高，系数越低）
    const riskFactor = this._calcRiskFactor(marketState);

    // 持仓市值映射
    const holdingMap = new Map(holdings.map(h => [h.code, h]));

    // 14日ATR止损线
    const atrMap = new Map();
    for (const stock of passed) {
      const bars = this.db.prepare(`SELECT high, low, close FROM stock_history
         WHERE code=? ORDER BY date DESC LIMIT 20`).all([stock.code]
      ).reverse();
      const atr = calcATR(bars, 14);
      atrMap.set(stock.code, atr);
    }

    // 行业分组（用于20%行业上限）
    const sectorGroups = new Map();
    for (const stock of passed) {
      const s = stock.sector_code || 'OTHER';
      if (!sectorGroups.has(s)) sectorGroups.set(s, []);
      sectorGroups.get(s).push(stock);
    }

    const signals = [];
    for (const stock of passed) {
      const confidence = stock.confidence || 0.5;
      const l2Score    = stock.l2_score   || 0.5;

      // 赔率估算（简化：用L2得分的非线性映射）
      const b = 1 + (l2Score - 0.5) * 3; // 盈亏比
      const p = Math.min(0.9, Math.max(0.3, confidence * 0.8 + 0.2)); // 胜率
      const q = 1 - p;

      // 凯利比例（原始）
      let kelly = p > 0 && b > 1 ? (b * p - q) / b : 0;
      kelly = Math.max(0, Math.min(kelly, 0.5)); // 限制在0-50%

      // 调整因子
      kelly = kelly * riskFactor * (0.6 + confidence * 0.4);

      // 【BUGFIX 2026-05-08】上限从10%调整为30%,高胜率信号允许更大仓位
      // 原硬编码0.10上限导致154条L3信号kelly_pct全部=10,失去了差异化意义
      kelly = Math.min(0.30, kelly);

      // ATR止损线：atr存的是绝对价格(如0.18元)，止损% = (k * atr / price)
      // 【BUGFIX 2026-05-07】price不能取rt_change_pct(涨跌幅)，必须用真实价格，否则会导致止损线极度放大
      // 从stock_realtime读取真实价格，兜底用0(此时用默认止损)
      const rtRow = this.db.prepare('SELECT price FROM stock_realtime WHERE code=?').get([stock.code]);
      const price = rtRow?.price > 0 ? rtRow.price : 0;
      const atr = atrMap.get(stock.code) || 0;
      const atrStopLossRatio = atr > 0 && price > 0
        ? Math.max(0.01, Math.min(0.20, 2.0 * atr / price)) // 限制在1-20%
        : 0.08; // 无价格数据时默认8%止损

      signals.push({
        ...stock,
        confidence:     stock.confidence || 0.5,  // 【修复】确保confidence被传递
        kelly_pct:       kelly * 100,       // 转为百分比
        risk_factor:     riskFactor,
        b_ratio:         b,
        win_rate:        p,
        atr:             atr,
        stop_loss_pct:   Math.min(atrStopLossRatio * 100, 15.0), // 上限15%，防止异常值
        take_profit_pct:  Math.min(Math.max(5, atrStopLossRatio * 100 * 2.5), 35.0), // 上限35%
        signal_status:   kelly >= 0.02 ? 'buy' : 'watch',
        block_reason:    stock.signal_status === 'blocked'
          ? stock.block_reason  // 保持原有拦截原因
          : [  // 通过信号：生成决策依据
              kelly >= 0.02 ? '买入信号' : '观望',
              `凯利${(kelly * 100).toFixed(1)}%`,
              `置信${((confidence || 0.5) * 100).toFixed(0)}%`,
              `止损${(atrStopLossRatio * 100).toFixed(1)}%`,
              `止盈${Math.max(5, atrStopLossRatio * 100 * 2.5).toFixed(1)}%`,
              stock.l2_rank ? `L2#${stock.l2_rank}` : null
            ].filter(Boolean).join(' · ')
      });
    }

    // 行业上限: 合计≤20%
    for (const [sector, stocks] of sectorGroups) {
      const totalKelly = stocks.reduce((s, st) => s + (st.kelly_pct / 100), 0);
      if (totalKelly > 0.20) {
        const scale = 0.20 / totalKelly;
        for (const st of stocks) {
          st.kelly_pct *= scale;
        }
      }
    }

    return signals;
  }

  /**
   * 计算风险溢价系数
   * 市场波动率高 + PE估值高 → 系数低
   */
  _calcRiskFactor(marketState) {
    const mStats = this.db.get(`SELECT * FROM market_stats ORDER BY rowid DESC LIMIT 1`) || {};

    // 市场情绪分数
    const sentiment = mStats.sentiment_score || 0.5;
    // 市场波动率
    const benchHist = this.db.prepare(`SELECT change_percent FROM stock_history
       WHERE code='000001' ORDER BY date DESC LIMIT 20`).all().reverse();
    const marketVol = benchHist.length >= 2 ? std(benchHist.map(h => h.change_percent / 100)) : 0.01;

    // 全市场PE分位数
    const pes = this.db.prepare(`SELECT pe_ttm FROM stock_fundamentals_v2 WHERE pe_ttm > 0 AND pe_ttm < 500`).all()
      .map(r => r.pe_ttm);
    const avgPE = mean(pes);
    const peFactor = Math.max(0.3, Math.min(1.5, 15 / Math.max(avgPE, 1)));

    // 综合风险因子
    let riskFactor = peFactor * (1 - marketVol * 5) * sentiment;
    riskFactor = Math.max(0.1, Math.min(1.0, riskFactor));

    Logger.debug('[L3-凯利] 风险系数', { riskFactor: riskFactor.toFixed(3), peFactor: peFactor.toFixed(2), marketVol: marketVol.toFixed(4) });

    return riskFactor;
  }

  // =========================================
  // 第三重: 环境熔断
  // =========================================

  /**
   * 环境熔断检查
   * 规则:
   *   1. 连续胜率偏差 > 10% → 禁用模型
   *   2. 大盘跌幅 > 10% → 全部拦截（跌停日）
   */
  _circuitBreaker(signals, blocked, marketState) {
    let circuitBroken = false;
    const output = [];
    // 建立blocked集合（政审拦截）
    const blockedSet = new Set(blocked.map(s => s.code));

    // 诊断日志：输入信号状态分布
    const statusCount = {};
    for (const s of signals) statusCount[s.signal_status] = (statusCount[s.signal_status] || 0) + 1;
    Logger.info('[L3-诊断] _circuitBreaker输入', { total: signals.length, statusCount });

    // 1. 大盘跌停熔断
    const benchToday = this.db.get(
      `SELECT change_percent FROM stock_history
       WHERE code='000001' ORDER BY date DESC LIMIT 1`
    );
    const benchCp = benchToday?.change_percent || 0;

    if (benchCp <= -10) {
      Logger.warn('[L3-熔断] 大盘跌停，拦截全部信号', { benchCp });
      circuitBroken = true;
      return {
        signals: [],
        circuitBroken: true
      };
    }

    // 2. 胜率偏差熔断
    const winRateDev = this._calcWinRateDeviation();
    if (winRateDev > 0.10) {
      Logger.warn('[L3-熔断] 胜率偏差超限，暂停开仓', { winRateDev });
      circuitBroken = true;
      // 允许持有，但不允许新开仓
      return {
        signals: signals.map(s => ({ ...s, signal_status: 'hold_only' })),
        circuitBroken: true
      };
    }

    // 3. 市场情绪过差熔断
    const mStats = this.db.get(`SELECT sentiment_score FROM market_stats ORDER BY rowid DESC LIMIT 1`);
    const sentiment = mStats?.sentiment_score || 0.5;
    if (sentiment < 0.2) {
      Logger.warn('[L3-熔断] 市场情绪极差', { sentiment });
      circuitBroken = true;
      return {
        signals: signals.filter(s => s.kelly_pct < 3).map(s => ({ ...s, signal_status: 'restricted' })),
        circuitBroken: true
      };
    }

    // 4. 胜率记录更新
    // 注意：不应在信号生成时自动更新胜率，应该在交易结果确认后更新
    // 目前暂时跳过自动更新，等待舜帝交易结果反馈
    // this._updateWinRate(signals);

    // 政审拦截的股票 → 标记为 blocked
    const finalSignals = signals.map(s =>
      blockedSet.has(s.code)
        ? { ...s, signal_status: 'blocked', block_reason: s.block_reason || '政审拦截' }
        : s
    );

    return { signals: finalSignals, circuitBroken: false };
  }

  /**
   * 计算历史胜率偏差
   * 记录最近20次信号的结果，更新滚动胜率
   */
  _calcWinRateDeviation() {
    Logger.info('[L3-诊断] winRateHistory', { length: this.winRateHistory.length, history: this.winRateHistory.slice(-10) });
    if (this.winRateHistory.length < 5) return 0;
    const recent = this.winRateHistory.slice(-20);
    const avgWinRate = mean(recent);
    const expected   = 0.55; // 预期胜率基准
    return Math.abs(avgWinRate - expected);
  }

  /**
   * 更新胜率记录（模拟，真实场景需对接交易结果）
   */
  _updateWinRate(signals) {
    for (const s of signals) {
      // 简化：置信度高于0.7且信号为buy的记录为"胜"
      if (s.signal_status === 'buy' && s.confidence > 0.7) {
        this.winRateHistory.push(1);
      } else if (s.signal_status === 'buy') {
        this.winRateHistory.push(0);
      }
    }
    // 保持最近50条记录
    if (this.winRateHistory.length > 50) {
      this.winRateHistory = this.winRateHistory.slice(-50);
    }
  }

  /**
   * 保存信号到数据库
   */
  /**
   * 持久化被拦截的股票到 yaodi_risk_blocks 表
   */
  _saveBlockedRecords(complianceBlocked, kellySignals) {
    try {
      // 确保表存在
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS yaodi_risk_blocks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL,
          name TEXT,
          confidence REAL DEFAULT 0,
          block_reason TEXT,
          block_layer TEXT DEFAULT 'L3',
          l2_rank INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','localtime'))
        )
      `).run();

      // 从 complianceBlocked（政审拦截）和 kellySignals 中真正被拦截的（signal_status === 'blocked'）
      const allBlocked = [
        ...complianceBlocked.map(s => ({
          code: s.code,
          name: s.name,
          confidence: s.confidence || 0,
          block_reason: s.block_reason,
          block_layer: '政审合规',
          l2_rank: s.l2_rank || 0,
        })),
        ...kellySignals.filter(s => s.signal_status === 'blocked').map(s => ({
          code: s.code,
          name: s.name,
          confidence: s.confidence || 0,
          block_reason: s.block_reason,
          block_layer: '仓位风控',
          l2_rank: s.l2_rank || 0,
        })),
      ];

      if (allBlocked.length === 0) return;

      const insert = this.db.prepare(`
        INSERT INTO yaodi_risk_blocks (code, name, confidence, block_reason, block_layer, l2_rank)
        VALUES (@code, @name, @confidence, @block_reason, @block_layer, @l2_rank)
      `);
      for (const item of allBlocked) insert.run(item);

      Logger.info(`[L3] 拦截记录已持久化: ${allBlocked.length} 条`);
    } catch (err) {
      Logger.error('[L3] 拦截记录持久化失败', { error: err.message });
    }
  }

  _saveSignals(signals) {
    const rows = signals.map(s => ({
      code:           s.code,
      name:           s.name,
      kelly_pct:      s.kelly_pct   || 0,
      stop_loss_pct:  s.stop_loss_pct || 0,
      atr:            s.atr        || 0,
      confidence:     s.confidence || 0,  // 【修复】添加confidence字段
      signal_status:  s.signal_status || 'pending',
      // action字段在表里没有（signal_status已包含同样语义），移除避免column错误
      block_reason:   s.block_reason || null,
      sector_code:    s.sector_code || 'OTHER',
      l2_rank:        s.l2_rank     || 0,
      updated_at:     bjISO()
    }));
    // 【修复 2026-05-09】清理旧信号，避免积压
    const del3 = this.db.prepare('DELETE FROM yaodi_l3_signals').run();
    this.db.batchUpsert('yaodi_l3_signals', rows, 'code');
    Logger.info('[L3] 信号已写入', { deleted: del3.changes, inserted: rows.length });
  }
}

// ============================================================
// 调度器 (Scheduler)
// ============================================================

/**
 * 调度状态机
 *   normal       (1分钟): 常规运行
 *   alert        (5秒):  异动告警
 *   circuit_break:      熔断停止
 */
const SCHEDULER_STATES = {
  NORMAL:        'normal',
  ALERT:         'alert',
  CIRCUIT_BREAK: 'circuit_break'
};

/**
 * 调度器: 管理L1/L2/L3的定时执行
 */
class Scheduler {
  constructor(core) {
    this.core   = core;
    this.state  = SCHEDULER_STATES.NORMAL;
    this.interval = null;
    this.alertInterval = null;
    this.isRunning = false;
    this._running = false; // 防重入锁
  }

  /**
   * 启动调度器
   * @param {Object} options
   *   normalMs:   normal状态的轮询间隔（默认60000ms）
   *   alertMs:    alert状态的轮询间隔（默认5000ms）
   */
  start(options = {}) {
    // 优先从数据库读取调度间隔，无则用配置文件值
    const _ms = (key, fallback) => {
      try {
        const row = this.db.prepare("SELECT value FROM yaodi_config WHERE key=?").get(key);
        return row ? parseInt(row.value, 10) : fallback;
      } catch { return fallback; }
    };
    const normalMs = 60000; // 1min（确保不遗漏5分钟早盘窗口）
    const alertMs = 30000; // 变盘态30秒 硬编码

    // 保存供 getEngineStatus() 读取真实 interval
    this.normalMs = normalMs;
    this.alertMs = alertMs;

    this.isRunning = true;
    this._scheduleNext(normalMs, alertMs);
    Logger.info(`[Scheduler] 调度器已启动，状态=${this.state}，间隔=${normalMs}ms`);
  }

  _scheduleNext(normalMs, alertMs) {
    if (!this.isRunning) return;

    const interval = this.state === SCHEDULER_STATES.ALERT ? alertMs : normalMs;

    if (this.interval) clearTimeout(this.interval);
    this.interval = setTimeout(async () => {
      if (!this.isRunning) return;
      await this._runTick();
      this._scheduleNext(normalMs, alertMs);
    }, interval);
  }

  async _runTick() {
    try {
      if (this.state === SCHEDULER_STATES.CIRCUIT_BREAK) {
        Logger.debug('[Scheduler] 熔断中，跳过本轮');
        return;
      }

      // 防重入：如果上一轮还没跑完，跳过
      if (this._running) {
        Logger.debug('[Scheduler] 上一轮仍在执行，跳过');
        return;
      }
      this._running = true;

      // 检测是否需要升序为alert
      await this._checkAlertConditions();

      // ════════════════════════════════════════════════════════
      // 【时段互斥规则】
      //  交易时段(9:30-11:30 / 13:00-15:00, 周一至五): 执行 L1/L2/L3
      //  非交易时段(非交易日 / 盘中休市): 跳过 L1/L2/L3，由 ML训练/演化接管
      // ════════════════════════════════════════════════════════
      const now = toBeijingTime();
      const dow = now.getDay();   // 0=Sun, 1=Mon, ..., 6=Sat
      const h   = now.getUTCHours() + 8;  // 北京时间小时
      const m   = now.getUTCMinutes();
      const isWeekday = dow >= 1 && dow <= 5;
      const inMorning = (h === 9) || (h === 10) || (h === 11 && m < 30);
      const inAfternoon = (h === 13) || (h === 14) || (h === 15 && m === 0);
      const isTradingHours = isWeekday && (inMorning || inAfternoon);

      if (isTradingHours) {
        Logger.info(`[Scheduler] 交易时段: ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} → 执行 L1/L2/L3`);
        await this.core.runRealtimeScan();
      } else {
        const ts = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        if (isWeekday) {
          Logger.debug(`[Scheduler] ${ts} 非交易时段(盘中休市) → 跳过 L1/L2/L3`);
        } else {
          Logger.debug(`[Scheduler] ${ts} 非交易日(周末) → 跳过 L1/L2/L3`);
        }
      }

      // 检测是否需要降序（连续正常则降为normal）
      await this._checkNormalConditions();

    } catch (err) {
      Logger.error('[Scheduler] 轮次执行异常', { error: err.message });
      this.state = SCHEDULER_STATES.ALERT;
    } finally {
      this._running = false;
    }
  }

  async _checkAlertConditions() {
    const mStats = this.db?.get?.(`SELECT sentiment_score FROM market_stats ORDER BY rowid DESC LIMIT 1`);
    const bench  = this.db?.get?.(`SELECT change_percent FROM stock_history WHERE code='000001' ORDER BY date DESC LIMIT 1`);

    if (!mStats || !bench) return;

    // 触发alert条件：市场情绪<0.35 或 大盘涨跌>3% 或 <-3%
    const sentiment = mStats.sentiment_score || 0.5;
    const benchCp   = bench.change_percent  || 0;

    if (sentiment < 0.35 || Math.abs(benchCp) > 3) {
      this.state = SCHEDULER_STATES.ALERT;
      Logger.warn(`[Scheduler] 升序为ALERT (sentiment=${sentiment.toFixed(3)}, benchCp=${benchCp.toFixed(2)})`);
    }
  }

  async _checkNormalConditions() {
    // 连续3轮正常则降序为normal（简化）
    // 实际应统计最近N次扫描的成功率
    this.state = SCHEDULER_STATES.NORMAL;
  }

  /**
   * 手动设置调度器状态
   */
  setState(state) {
    if (state === SCHEDULER_STATES.CIRCUIT_BREAK) {
      Logger.warn('[Scheduler] 手动触发熔断！');
    }
    this.state = state;
    Logger.info(`[Scheduler] 状态切换为 ${state}`);
  }

  stop() {
    this.isRunning = false;
    if (this.interval) {
      clearTimeout(this.interval);
      this.interval = null;
    }
    Logger.info('[Scheduler] 调度器已停止');
  }

  getState() {
    return this.state;
  }
}

// ============================================================
// 尧帝2.0 核心引擎 (YaodiV2 Core)
// ============================================================

/**
 * 尧帝2.0 核心选股引擎
 * 统一封装L1+L2+L3三层引擎，提供完整API
 */
export class YaodiV2Core {
  /**
   * @param {string} dbPath SQLite数据库路径，默认使用项目内stocks.db
   */
  constructor(dbPath) {
    const defaultPath = path.join(process.cwd(), 'database', 'stocks.db');
    this.dbPath = dbPath || defaultPath;
    this.db = null;
    this.l1Pool    = [];   // L1候选池缓存
    this.l2Pool    = [];   // L2精排池缓存
    this.l3Signals = [];   // L3信号缓存
    loadPools(this); // 启动时从磁盘恢复池数据
    this.status    = 'idle'; // idle | running | error
    this.lastRun   = null;
    this.l2LastRunTime = null; // L2上次扫描时间
    this.l2ScanCount   = 0;    // L2累计扫描次数
    this.scheduler = null;
    this._onSignal = null;  // 信号回调（推送到舜帝等外部系统）
    // 引擎参数（由尧帝智能根据市场情况自动调参）
    // 从数据库 yaodi_config 读取参数，无则用默认值
    const _cfg = (key, fallback) => {
      try {
        const row = this.db.prepare("SELECT value FROM yaodi_config WHERE key=?").get(key);
        return row ? parseFloat(row.value) : fallback;
      } catch { return fallback; }
    };
    this._params = {
      l1TopN:        Math.round(_cfg('l1_top_n', 300)),
      l2TopN:        Math.round(_cfg('l2_top_n', 50)),
      kellyCap:      _cfg('v2_kelly_cap', 0.25),
      industryCap:   _cfg('v2_industry_cap', 25),
      atrMultiplier: _cfg('v2_atr_multiplier', 2.0),
      minConfidence: _cfg('v2_min_confidence', 0.6),
      lastAdjusted:  null,
      reason:        null,
    };
    this._init();
  }

  /** 获取当前引擎参数（供前端展示） */
  getParams() {
    return { ...this._params };
  }

  /** 尧帝智能内部调参（前端不可直接调用） */
  _adjustParams(updates, reason = null) {
    Object.assign(this._params, updates, { lastAdjusted: bjISO(), reason });
    Logger.info('[Core] 尧帝调参', { params: this._params, reason });
  }

  _init() {
    try {
      this.db = new Database(this.dbPath);
      // 传递 Database 包装类给引擎（提供 batchUpsert 等方法）
      this.l1Engine = new L1Engine(this.db);
      this.l2Engine = new L2Engine(this.db);
      this.l3Engine = new L3Engine(this.db);
      // 初始化增量学习配置
      initLearningConfig();
      // 【V2闭环】暴露增量学习接口给舜帝
      this.incrementalLearning = {
        recordSignalOutcome: (code, outcome) => {
          try {
            const result = recordOutcome(code, outcome);
            if (result) {
              Logger.info('[Core] 增量学习记录成功', { code, outcome: outcome.outcome, returnPct: outcome.returnPct });
            } else {
              Logger.warn('[Core] 增量学习记录未找到对应信号', { code });
            }
          } catch (e) {
            Logger.warn('[Core] 增量学习记录失败', { code, error: e.message });
          }
        },
        getFactorWeights: () => getFactorWeights(),
        getLearningStatus: () => getLearningStatus(),
        evaluateFactors: () => evaluateFactorPerformance(),
        adjustWeights: () => adjustFactorWeights(),
      };
      // 尝试从磁盘加载已保存的 L2 模型（增量学习）
      const loaded = loadModels(this.l2Engine, 'latest');
      if (loaded) {
        Logger.info('[Core] 从磁盘恢复 L2 模型完成', { timestamp: loaded.timestamp });
      } else {
        Logger.info('[Core] 未找到已保存模型，将从头训练');
      }
      
      // 【修复】从数据库加载L1/L2/L3缓存数据
      this.loadL1FromCache();
      this.loadL2FromCache();
      this.loadL3FromCache?.();
      Logger.info('[Core] 从缓存加载数据完成', { l1: this.l1Pool.length, l2: this.l2Pool.length, l3: this.l3Signals.length });
      
      this.status   = 'ready';
      // 【P0修复】预加载ML模型，消除运行时同步阻塞
      setImmediate(() => this.l2Engine?._preloadMLModels?.());
      Logger.info('[Core] 尧帝2.0引擎初始化完成');
    } catch (err) {
      this.status = 'error';
      Logger.error('[Core] 引擎初始化失败', { error: err.message });
      throw err;
    }
  }

  // =========================================
  // L1: 多维因子共振
  // =========================================

  /**
   * 运行L1层（全市场 → Top300）
   * @param {string} marketEnv 市场环境: 'bull' | 'bear' | 'neutral'
   * @returns {Promise<{top300, factorStats, runTime, marketEnv}>}
   */
  async runL1(marketEnv) {
    this.status = 'running:l1';
    const startTime = Date.now();

    try {
      const result = await this.l1Engine.run(marketEnv);
      this.l1Pool = result.top300;
    savePools(this); // 保存L1池
      this.l1LastRunTime = bjISO();
      this.lastRun = { layer: 'L1', time: this.l1LastRunTime, ms: Date.now() - startTime };
      // 【P1修复】同步写入 yaodi_main.l1_last_run_time，进程重启后可读
      try { this.db.prepare("UPDATE yaodi_main SET l1_last_run_time=? WHERE id=1").run(this.l1LastRunTime); } catch(e) {}

      // 记录运行日志
      this._logRun('L1', result.top300.length, marketEnv, 'success', null, Date.now() - startTime);
      this.status = 'ready';
      return result;
    } catch (err) {
      this.status = 'error';
      this._logRun('L1', 0, marketEnv, 'error', err.message, Date.now() - startTime);
      Logger.error('[Core] L1运行失败', { error: err.message });
      throw err;
    }
  }

  // =========================================
  // L2: Stacking集成精排
  // =========================================

  /**
   * 运行L2层（Top300 → Top50）
   * @param {Array} l1Pool L1候选池（可选，默认使用缓存）
   * @param {Object} realtimeData 实时行情
   * @param {Object} marketMetrics 市场指标
   */
  async runL2(l1Pool, realtimeData = {}, marketMetrics = {}) {
    this.status = 'running:l2';
    const startTime = Date.now();

    try {
      const pool = l1Pool || this.l1Pool;
      assert.ok(pool.length > 0, 'L1池为空，请先运行runL1()');

      const result = await this.l2Engine.run(pool, realtimeData, marketMetrics);
      // 诊断：打印result的关键字段
      Logger.info('[Core-DIAG] runL2结果', { top50Length: result.top50?.length, predictionsLength: result.predictions?.length, modelAccuracy: result.modelAccuracy });
      this.l2Pool = result.top50;
    savePools(this); // 保存L2池
      const now = bjISO();
      this.l2LastRunTime = now;
      this.l2ScanCount = (this.l2ScanCount || 0) + 1;
      this.lastRun = { layer: 'L2', time: now, ms: Date.now() - startTime };
      // 持久化到 yaodi_main（进程重启后可读）
      try {
        this.db.prepare("UPDATE yaodi_main SET l2_last_run_time=?, l2_scan_count=? WHERE id=1").run(now, this.l2ScanCount);
      } catch(e) {}

      this._logRun('L2', result.top50.length, null, 'success', null, Date.now() - startTime);
      this.status = 'ready';
      return result;
    } catch (err) {
      this.status = 'error';
      this._logRun('L2', 0, null, 'error', err.message, Date.now() - startTime);
      Logger.error('[Core] L2运行失败', { error: err.message });
      throw err;
    }
  }

  // =========================================
  // L3: 三重防御风控
  // =========================================

  /**
   * 运行L3层（Top50 → 最终信号）
   * @param {Array} l2Pool L2精排池（可选，默认使用缓存）
   * @param {Array} holdings 当前持仓
   * @param {Object} marketState 市场状态
   */
  async runL3(l2Pool, holdings = [], marketState = {}) {
    this.status = 'running:l3';
    const startTime = Date.now();

    try {
      const pool = l2Pool || this.l2Pool;
      assert.ok(pool.length > 0, 'L2池为空，请先运行runL2()');

      const result = await this.l3Engine.run(pool, holdings, marketState);
      // 诊断：检查返回的信号状态
      const beforeStatus = {};
      for (const s of result.signals) beforeStatus[s.signal_status] = (beforeStatus[s.signal_status] || 0) + 1;
      Logger.info('[L3-诊断] runL3收到result', { total: result.signals.length, status: beforeStatus });
      this.l3Signals = result.signals;
      // 诊断：检查赋值后的状态
      const afterStatus = {};
      for (const s of this.l3Signals) afterStatus[s.signal_status] = (afterStatus[s.signal_status] || 0) + 1;
      Logger.info('[L3-诊断] 赋值后l3Signals', { total: this.l3Signals.length, status: afterStatus });
    savePools(this); // 保存L3信号
      // 诊断：savePools后的状态
      const afterSave = {};
      for (const s of this.l3Signals) afterSave[s.signal_status] = (afterSave[s.signal_status] || 0) + 1;
      Logger.info('[L3-诊断] savePools后', { total: this.l3Signals.length, status: afterSave });
      this.lastRun = { layer: 'L3', time: bjISO(), ms: Date.now() - startTime };

      // 增量学习：记录 L3 信号供后续收益回填
      for (const signal of result.signals) {
        const factorScores = {
          value_score: signal.value_score,
          quality_score: signal.quality_score,
          growth_score: signal.growth_score,
          momentum_score: signal.momentum_score,
          size_score: signal.size_score,
          totalScore: signal.l2_score || signal.confidence || 0,
        };
        const factorRaw = {
          value: signal.raw_pe || signal.raw_value,
          quality: signal.raw_roe,
          growth: signal.raw_revenue_growth,
          momentum: signal.raw_momentum,
          size: signal.raw_size,
        };
        logSignal({
          stockCode: signal.code,
          action: (signal.action || signal.signal_status || 'unknown'),
          confidence: signal.confidence || 0,
          factorScores,
          factorRaw,
          marketEnv: marketState?.marketEnv || 'neutral',
        });
      }

      this._logRun('L3', result.signals.length, null, 'success', null, Date.now() - startTime);
      this.status = 'ready';
      // 推送L3信号到外部系统（如舜帝）—— 仅推送 signal_status='buy' 的活跃信号
      const activeSignals = result.signals.filter(s => s.signal_status === 'buy');
      if (this._onSignal && activeSignals.length > 0) {
        try { this._onSignal(activeSignals); } catch (e) { Logger.warn('[Core] 信号回调异常', { error: e.message }); }
      }
      if (result.signals.length !== activeSignals.length) {
        Logger.info('[L3] 过滤非buy信号', { total: result.signals.length, active: activeSignals.length, filtered: result.signals.length - activeSignals.length });
      }
      return result;
    } catch (err) {
      this.status = 'error';
      this._logRun('L3', 0, null, 'error', err.message, Date.now() - startTime);
      Logger.error('[Core] L3运行失败', { error: err.message });
      throw err;
    }
  }

  // =========================================
  // 完整批处理流程
  // =========================================

  /**
   * 每日完整批处理（供晚间/早间定时任务调用）
   * 执行: L1 → L2 → L3 完整流程
   */
  async runDailyBatch() {
    this.status = 'running:daily';
    const startTime = Date.now();

    Logger.info('[Core] ========== 开始每日批处理 ==========');

    try {
      // Step 1: L1 — 判断市场环境
      const env = this._detectMarketEnvironment();
      Logger.info(`[Core] 检测市场环境: ${env}`);
      const l1Result = await this.runL1(env);

      // Step 2: L2 — 精排（无实时数据，用最后收盘价）
      const rtData = {};
      const mMetrics = this._getMarketMetrics();
      const l2Result = await this.runL2(l1Result.top300, rtData, mMetrics);

      // Step 3: L3 — 风控过滤
      const l3Result = await this.runL3(l2Result.top50, [], mMetrics);

      const totalTime = Date.now() - startTime;
      Logger.info(`[Core] ========== 批处理完成，总耗时${totalTime}ms ==========`);

      return {
        l1: l1Result,
        l2: l2Result,
        l3: l3Result,
        totalTime,
        marketEnv: env
      };
    } catch (err) {
      this.status = 'error';
      Logger.error('[Core] 批处理失败', { error: err.message });
      throw err;
    }
  }

  /**
   * 盘中实时扫描（L2+L3联合执行）
   * 适用于盘中定时任务（1分钟/5秒）
   */
  async runRealtimeScan() {
    // 防止重叠扫描阻塞事件循环
    if (this._scanning) {
      Logger.debug('[Core] 扫描重叠，跳过');
      return;
    }
    this._scanning = true;
    this.status = 'running:realtime';
    const startTime = Date.now();

    try {
      // 若L1池为空，先执行L1
      if (this.l1Pool.length === 0) {
        Logger.info('[Core] L1池为空，先执行L1批处理');
        await this.runDailyBatch();
        this._scanning = false;
        return;
      }

      // 实时行情
      const realtimeData = {};
      const realtimeRows = this.db.prepare(`SELECT code, change_percent, volume, amount, price FROM stock_realtime`).all();
      for (const r of realtimeRows) {
        realtimeData[r.code] = r;
      }

      const marketMetrics = this._getMarketMetrics();

      // L2 + L3
      const l2Result = await this.runL2(this.l1Pool, realtimeData, marketMetrics);
      const l3Result = await this.runL3(l2Result.top50, [], marketMetrics);

      const runTime = Date.now() - startTime;
      Logger.info(`[Core] 盘中扫描完成，信号${l3Result.signals.length}个，耗时${runTime}ms`);

      this.status = 'ready';
      // 【BUGFIX 2026-05-08】盘中扫描后也要推送L3信号到舜帝，否则_schedulerTick永远不触发_onSignal
      // 【修复】仅推送 signal_status='buy' 的活跃信号，watch/blocked不推送
      const activeSignals = l3Result.signals.filter(s => s.signal_status === 'buy');
      if (this._onSignal && activeSignals.length > 0) {
        try { this._onSignal(activeSignals); } catch (e) { Logger.warn('[Core] 盘中信号回调异常', { error: e.message }); }
      }

      return { ...l2Result, ...l3Result, runTime };
    } catch (err) {
      this.status = 'error';
      Logger.error('[Core] 盘中扫描失败', { error: err.message });
      throw err;
    }
  }

  // =========================================
  // 辅助方法
  // =========================================

  /**
   * 检测市场环境（牛/熊/震荡）
   */
  _detectMarketEnvironment() {
    const bench = this.db.prepare(`SELECT change_percent FROM stock_history
       WHERE code='000001' ORDER BY date DESC LIMIT 20`).all().reverse();

    if (bench.length < 10) return 'neutral';

    const returns = bench.map(b => b.change_percent / 100);
    const avg     = mean(returns);
    const volatility = std(returns);

    // 均线系统
    const ma5  = mean(bench.slice(-5).map(b => b.change_percent));
    const ma20 = mean(bench.map(b => b.change_percent));

    if (avg > 0.003 && ma5 > ma20 && volatility < 0.02) return 'bull';
    if (avg < -0.003 || volatility > 0.025) return 'bear';
    return 'neutral';
  }

  /**
   * 获取市场综合指标
   */
  _getMarketMetrics() {
    const mStats = this.db.get(`SELECT * FROM market_stats ORDER BY rowid DESC LIMIT 1`);
    return mStats || {};
  }

  /**
   * 记录引擎运行日志
   */
  _logRun(layer, stockCount, marketEnv, status, errorMsg, durationMs) {
    try {
      this.db.run(
        `INSERT INTO yaodi_engine_log (layer, run_at, duration_ms, stock_count, market_env, status, error_msg)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [layer, bjISO(), durationMs, stockCount, marketEnv, status, errorMsg]
      );
    } catch (err) {
      Logger.warn('[Core] 日志写入失败', { error: err.message });
    }
  }

  // =========================================
  // 状态查询
  // =========================================

  /** 获取L1候选池 */
  getL1Pool() {
    return [...this.l1Pool];
  }

  /** 获取L2精排池 */
  getL2Pool() {
    // 动态注入win_rate：如果item没有win_rate，使用L3引擎的全局胜率或modelAccuracy
    const globalWinRate = this.l3Engine?.winRateHistory?.length >= 5
      ? this.l3Engine.winRateHistory.slice(-30).reduce((a,b)=>a+b,0) / this.l3Engine.winRateHistory.length
      : null;
    const enriched = this.l2Pool.map(item => ({
      ...item,
      win_rate: item.win_rate > 0 ? item.win_rate : (globalWinRate ?? this.l3Engine?.modelAccuracy ?? 0.5)
    }));
    return enriched;
  }

  /** 获取L3信号 */
  getL3Signals() {
    // 动态注入 win_rate：优先取历史均值，不足5条则用 modelAccuracy 兜底
    const histLen = this.l3Engine?.winRateHistory?.length || 0;
    const globalWinRate = histLen >= 5
      ? this.l3Engine.winRateHistory.slice(-30).reduce((a, b) => a + b, 0) / Math.min(histLen, 30)
      : this.l3Engine?.modelAccuracy || 0.5;
    
    // 【2026-05-20】按 ml_ensemble_score 排序(预测未来3天涨幅最大的排前面)
    const sortedSignals = [...this.l3Signals].sort((a, b) => {
      const scoreA = a.ml_ensemble_score || 0.5;
      const scoreB = b.ml_ensemble_score || 0.5;
      return scoreB - scoreA; // 降序排列
    });
    
    return sortedSignals.map(item => ({
      ...item,
      // win_rate: DB值为0表示尚未确认真实胜率，用全局胜率兜底
      win_rate: item.win_rate > 0 ? item.win_rate : globalWinRate,
    }));
  }

  /** 获取风控拦截日志 */
  getRiskLog() {
    return this.l3Engine ? [...this.l3Engine.blockedHistory] : [];
  }

  /** 获取引擎当前状态 */
  getEngineStatus() {
    // 优先从 lastRun 读取，若仍为 null 则从 yaodi_main.l1_last_run_time 兜底
    let l1LastRunTime = this.l1LastRunTime || null;
    if (!l1LastRunTime && this.l1Pool.length > 0) {
      l1LastRunTime = (this.lastRun?.layer === 'L1' && this.lastRun?.time)
        ? this.lastRun.time
        : (this.lastRun?.time || null);
    }
    // 双重兜底：从 yaodi_main 表读取 l1_last_run_time（每日批处理时会更新）
    if (!l1LastRunTime) {
      try {
        const row = this.db.prepare("SELECT l1_last_run_time FROM yaodi_main WHERE id=1").get();
        if (row && row.l1_last_run_time) l1LastRunTime = row.l1_last_run_time;
      } catch {}
    }

    // 推断引擎状态（this.status 用于内部状态机，前端展示用 dataHealth）
    const allLoaded   = this.l1Pool.length > 0 && this.l2Pool.length > 0;
    const hasSignals  = this.l3Signals.length > 0;
    const dataHealth  = allLoaded ? (hasSignals ? 'ok' : 'warning') : 'error';
    // 调度器模式详情
    const schedulerRaw   = this.scheduler ? this.scheduler.getState() : null;
    const schedulerMode = typeof schedulerRaw === 'string'
      ? { mode: schedulerRaw, interval: schedulerRaw === 'ALERT' ? (this.alertMs || 30000) : (this.normalMs || 1800000), label: schedulerRaw === 'ALERT' ? '变盘态' : schedulerRaw === 'CIRCUIT_BREAK' ? '熔断态' : '正常态' }
      : schedulerRaw;

    // L2扫描计数和最后时间（优先内存，兜底DB）
    let l2LastRunTime = this.l2LastRunTime || null;
    let l2ScanCount   = this.l2ScanCount   || 0;
    if (!l2LastRunTime) {
      try {
        const row = this.db.prepare("SELECT l2_last_run_time, l2_scan_count FROM yaodi_main WHERE id=1").get();
        if (row) {
          if (row.l2_last_run_time) l2LastRunTime = row.l2_last_run_time;
          if (row.l2_scan_count     > 0)           l2ScanCount   = row.l2_scan_count;
        }
      } catch {}
    }

    return {
      status:   'ok',
      dataHealth,
      l1Count:  this.l1Pool.length,
      l2Count:  this.l2Pool.length,
      l3Count:  this.l3Signals.length,
      l3BlockedCount: this.l3Engine ? this.l3Engine.blockedHistory.length : 0,
      l1LastRunTime,
      l2LastRunTime,
      l2ScanCount,
      lastRun:  this.lastRun,
      params:   this.getParams(),
      schedulerMode,
    };
  }

  /** 获取调度器状态 */
  getSchedulerState() {
    return this.scheduler ? this.scheduler.getState() : null;
  }

  /** 舜帝卖出结果反馈到增量学习（公开API） */
  recordOutcome(code, outcome) {
    return this.incrementalLearning.recordSignalOutcome(code, outcome);
  }

  /** 设置调度器状态 */
  setSchedulerState(state) {
    if (!this.scheduler) {
      this.scheduler = new Scheduler(this);
    }
    this.scheduler.setState(state);
  }

  /** 启动自动调度 */
  startScheduler(options) {
    if (!this.scheduler) {
      this.scheduler = new Scheduler(this);
    }
    this.scheduler.start(options);
  }

  /** 停止调度 */
  stopScheduler() {
    if (this.scheduler) {
      this.scheduler.stop();
    }
  }

  /** 从缓存加载最近一次L1结果 */
  loadL1FromCache() {
    try {
      // this.db 是 Database 包装类，使用其 all() 方法
      const rows = this.db.all(
        `SELECT * FROM yaodi_l1_cache ORDER BY l1_score DESC LIMIT 300`
      );
      this.l1Pool = rows;
      Logger.info('[Core] 从缓存加载L1数据', { count: rows.length });
      return rows;
    } catch (err) {
      Logger.warn('[Core] 加载L1缓存失败', { error: err.message });
      return [];
    }
  }

  /** 从缓存加载最近一次L2结果 */
  loadL2FromCache() {
    try {
      const rows = this.db.all(
        `SELECT l2.code, l2.l2_score, l2.confidence, l2.gbdt_pred, l2.histgbdt_pred, l2.category_boost, l2.meta_pred,
                l2.ml_ensemble_score, l2.model_scores,
                COALESCE(l1.name, l2.name) as name, l1.l1_score, rt.amount, rt.change_percent as rt_change_pct,
                rt.price, rt.change_percent, rt.volume,
                l2.industry
         FROM yaodi_l2_cache l2
         LEFT JOIN yaodi_l1_cache l1 ON l2.code = l1.code
         LEFT JOIN stock_realtime rt ON l2.code = rt.code
         ORDER BY l2.l2_score DESC LIMIT 50`
      );
      this.l2Pool = rows;
      Logger.info('[Core] 从缓存加载L2数据', { count: rows.length });
      return rows;
    } catch (err) {
      Logger.warn('[Core] 加载L2缓存失败', { error: err.message });
      return [];
    }
  }

  /** 从缓存加载最近一次L3结果 */
  loadL3FromCache() {
    try {
      const rows = this.db.all(
        `SELECT l3.code, l3.name, l3.kelly_pct, l3.stop_loss_pct, l3.take_profit_pct, l3.atr, l3.confidence,
                l3.signal_status, l3.block_reason, l3.sector_code, l3.l2_rank,
                l3.win_rate,
                l1.l1_score, l2.l2_score, rt.price, rt.change_percent,
                l3.signal_status as signal
         FROM yaodi_l3_signals l3
         LEFT JOIN yaodi_l1_cache l1 ON l3.code = l1.code
         LEFT JOIN yaodi_l2_cache l2 ON l3.code = l2.code
         LEFT JOIN stock_realtime rt ON l3.code = rt.code
         ORDER BY l3.kelly_pct DESC`
      );
      this.l3Signals = rows;
      Logger.info('[Core] 从缓存加载L3数据', { count: rows.length });
      return rows;
    } catch (err) {
      Logger.warn('[Core] 加载L3缓存失败', { error: err.message });
      return [];
    }
  }

  /** 销毁引擎，关闭数据库连接 */
  destroy() {
    this.stopScheduler();
    if (this.db) this.db.close();
    this.status   = 'destroyed';
    Logger.info('[Core] 引擎已销毁');
  }
}

// ============================================================
// 模块导出 (类已在前方用 export class 导出，无需重复)
// ============================================================
