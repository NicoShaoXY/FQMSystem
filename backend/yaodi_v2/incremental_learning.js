/**
 * 增量学习模块 - 尧帝2.0持续进化引擎
 * 
 * 工作原理：
 * 1. 每个 batch 后记录信号与 N 日后收益的对应关系
 * 2. 积累足够样本后，评估因子有效性并动态调整权重
 * 3. 发现因子衰减时自动降权或替换
 * 4. 支持将学习成果写回 L1/L2 参数（闭环）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadModels, saveModels, listModelVersions } from './model_persistence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 本地 bjISO 辅助函数（避免循环依赖 data_server）
function bjISO(date) {
  const d = new Date(date || Date.now());
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const Logger = {
  info:  (...args) => console.log('[IncrementalLearning]', ...args),
  warn:  (...args) => console.warn('[IncrementalLearning]', ...args),
  error: (...args) => console.error('[IncrementalLearning]', ...args),
};

const LEARNING_DIR = path.join(__dirname, 'yaodi_v2', 'learning');
const SIGNAL_LOG_FILE = path.join(LEARNING_DIR, 'signal_log.json');
const FACTOR_PERF_FILE = path.join(LEARNING_DIR, 'factor_performance.json');
const ALPHA_ARCHIVE_FILE = path.join(LEARNING_DIR, 'alpha_archive.json');
const CONFIG_FILE = path.join(LEARNING_DIR, 'learning_config.json');

// 确保目录存在
function ensureDir() {
  if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });
}

// 五因子定义（与 L1Engine 对齐）
const FACTOR_NAMES = ['value', 'quality', 'growth', 'momentum', 'size'];

// 因子权重默认值
const DEFAULT_FACTOR_WEIGHTS = { value: 1.0, quality: 1.0, growth: 1.0, momentum: 1.0, size: 0.5 };

/** 初始化学习配置 */
function initConfig() {
  ensureDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    const config = {
      enabled: true,
      minSamples: 100,        // 最少样本量才触发权重更新
      decayWindow: 60,        // 因子有效性评估窗口（交易日）
      lookbackDays: 20,       // 信号 → 收益的回测窗口
      weightChangeCap: 0.2,   // 单次权重调整上限
      autoRetrainThreshold: 0.15, // 准确率跌破此值则触发模型重训
      lastRetrainAt: null,
      factorWeights: { ...DEFAULT_FACTOR_WEIGHTS },
      factorDecays: {},       // 各因子衰减率
      totalSignals: 0,
      totalUpdated: 0,
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

/** 保存学习配置 */
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

/** 获取信号日志（带截断上限防文件过大） */
function getSignalLog() {
  ensureDir();
  if (!fs.existsSync(SIGNAL_LOG_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(SIGNAL_LOG_FILE, 'utf8'));
    // 只保留最近 5000 条
    return Array.isArray(raw) ? raw.slice(-5000) : [];
  } catch { return []; }
}

/** 记录一笔信号（L3 产出时调用） */
function logSignal(signal) {
  const log = getSignalLog();
  log.push({
    ts: bjISO(),
    stockCode: signal.stockCode,
    layer: 'L3',
    action: signal.action,       // buy / hold / sell
    confidence: signal.confidence,
    // 信号时的因子得分快照（由调用方传入）
    factorScores: signal.factorScores || {},
    // 各因子当时的原始值（由调用方传入）
    factorRaw: signal.factorRaw || {},
    // 市场环境
    marketEnv: signal.marketEnv || 'neutral',
    // 标记是否已有收益回填
    rewardUpdated: false,
    reward: null,
  });
  fs.writeFileSync(SIGNAL_LOG_FILE, JSON.stringify(log, null, 2), 'utf8');

  const config = initConfig();
  config.totalSignals++;
  saveConfig(config);
}

/** 回填信号收益（定时调用） */
async function updateSignalRewards(db) {
  const config = initConfig();
  const lookback = config.lookbackDays || 20;
  const log = getSignalLog();
  let updated = 0;

  // 获取当前日期
  const now = toBeijingTime();
  const cutoff = new Date(now - lookback * 24 * 60 * 60 * 1000);

  for (const entry of log) {
    if (entry.rewardUpdated) continue;
    const signalTime = new Date(entry.ts);
    if (signalTime < cutoff) continue; // 太旧的跳过

    // 从数据库查 N 日后收益
    try {
      const ret = await queryReturn(db, entry.stockCode, bjDate(), lookback);
      if (ret !== null) {
        entry.reward = ret;
        entry.rewardUpdated = true;
        updated++;
      }
    } catch (e) { /* ignore */ }
  }

  if (updated > 0) {
    fs.writeFileSync(SIGNAL_LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
    config.totalUpdated = (config.totalUpdated || 0) + updated;
    saveConfig(config);
    Logger.info(`[IncrementalLearning] 回填 ${updated} 条信号收益`);
  }
  return updated;
}

/** 查询 N 日收益 */
function queryReturn(db, stockCode, signalDate, lookback) {
  const sql = `
    SELECT ROUND((close - open) / open, 4) as ret
    FROM stock_history
    WHERE code = ? AND date > ?
    ORDER BY date ASC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(stockCode, signalDate, lookback);
  if (!rows || rows.length === 0) return null;
  // 用累计收益
  return rows.reduce((acc, r) => acc * (1 + r.ret), 1) - 1;
}

/** 评估各因子有效性 */
function evaluateFactorPerformance() {
  const log = getSignalLog().filter(e => e.rewardUpdated);
  if (log.length < 20) return null;

  const config = initConfig();
  const window = config.decayWindow || 60;
  const recent = log.slice(-window); // 最近 window 天的信号

  const perf = {};
  for (const fname of FACTOR_NAMES) {
    // 分组：因子得分高 vs 低
    const withScore = recent.filter(e => e.factorRaw && e.factorRaw[fname] != null);
    if (withScore.length < 10) { perf[fname] = { ic: 0, count: 0 }; continue; }

    const median = _median(withScore.map(e => e.factorRaw[fname]));
    const highGroup = withScore.filter(e => e.factorRaw[fname] >= median);
    const lowGroup = withScore.filter(e => e.factorRaw[fname] < median);

    const avgHigh = _mean(highGroup.map(e => e.reward));
    const avgLow = _mean(lowGroup.map(e => e.reward));
    const ic = avgHigh - avgLow; // IC = 高分-低分

    perf[fname] = {
      ic: Math.round(ic * 10000) / 10000,
      avgRewardHigh: Math.round(avgHigh * 10000) / 10000,
      avgRewardLow: Math.round(avgLow * 10000) / 10000,
      count: withScore.length,
    };
  }

  // 保存
  fs.writeFileSync(FACTOR_PERF_FILE, JSON.stringify({
    timestamp: bjISO(),
    sampleSize: recent.length,
    performance: perf,
  }, null, 2), 'utf8');

  return perf;
}

function _mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function _median(arr) {
  if (!arr || arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 基于因子表现动态调整权重 */
function adjustFactorWeights(perf) {
  if (!perf) return null;
  const config = initConfig();
  const cap = config.weightChangeCap || 0.2;

  const newWeights = { ...config.factorWeights };
  let changed = false;

  for (const fname of FACTOR_NAMES) {
    const p = perf[fname];
    if (!p || p.count < 20) continue;
    const ic = p.ic;

    // IC > 0.02 → 权重增加，IC < -0.02 → 权重减少
    let adjustment = 0;
    if (Math.abs(ic) > 0.02) {
      adjustment = Math.max(-cap, Math.min(cap, ic * 2)); // ic 0.05 → +0.1
    } else {
      // 接近 0 的因子稍微衰减（避免因子库固化）
      adjustment = -0.02;
    }

    newWeights[fname] = Math.max(0.1, Math.min(3.0, (newWeights[fname] || 1.0) + adjustment));
    if (adjustment !== 0) changed = true;
  }

  if (changed) {
    config.factorWeights = newWeights;
    config.lastAdjusted = bjISO();
    config.adjustReason = perf;
    saveConfig(config);
    Logger.info('[IncrementalLearning] 因子权重调整', { weights: newWeights });
  }

  return changed ? newWeights : null;
}

/** 评估模型准确率（用已有 reward 的样本） */
function evaluateModelAccuracy(l2Engine) {
  const log = getSignalLog().filter(e => e.rewardUpdated);
  if (log.length < 30) return null;

  const correct = log.filter(e => {
    const score = e.factorScores?.totalScore || 0.5;
    const reward = e.reward;
    if (reward == null) return false;
    return (reward > 0 && score > 0.5) || (reward < 0 && score <= 0.5);
  }).length;

  const accuracy = correct / log.length;
  Logger.info(`[IncrementalLearning] 模型准确率: ${accuracy.toFixed(4)} (${correct}/${log.length})`);
  return accuracy;
}

/** 判断是否需要触发模型重训 */
function shouldRetrain(accuracy, config) {
  if (accuracy == null) return false;
  const threshold = config.autoRetrainThreshold || 0.15;
  return accuracy < (0.5 - threshold); // 准确率低于 0.35 才重训
}

/** 获取当前因子权重（供 L1 调用） */
function getFactorWeights() {
  const config = initConfig();
  return { ...config.factorWeights };
}

/** 获取学习状态（供前端展示） */
function getLearningStatus() {
  const config = initConfig();
  const perfFile = FACTOR_PERF_FILE;
  let factorPerf = null;
  try {
    if (fs.existsSync(perfFile)) {
      const raw = JSON.parse(fs.readFileSync(perfFile, 'utf8'));
      factorPerf = raw.performance;
    }
  } catch { /* ignore */ }

  let modelVersions = [];
  try { modelVersions = listModelVersions(); } catch { /* ignore */ }

  return {
    enabled: config.enabled,
    totalSignals: config.totalSignals,
    totalRewardUpdated: config.totalUpdated,
    factorWeights: config.factorWeights,
    factorPerformance: factorPerf,
    lastAdjusted: config.lastAdjusted,
    modelVersions: modelVersions.map(v => ({ tag: v.tag, timestamp: v.timestamp })),
    sampleCount: getSignalLog().filter(e => e.rewardUpdated).length,
  };
}

/**
 * 记录信号交易结果（舜帝反馈）
 * @param {string} code - 股票代码
 * @param {object} outcome - 交易结果 {outcome, returnPct, holdDays}
 */
function recordSignalOutcome(code, outcome) {
  const log = getSignalLog();
  
  // 找到最近一条该股票的待反馈信号记录
  const idx = log.findIndex(e => e.stockCode === code && !e.rewardUpdated);
  if (idx === -1) {
    Logger.warn(`[IncrementalLearning] 未找到 ${code} 的待反馈信号`);
    return false;
  }
  
  // 更新记录
  log[idx].reward = outcome.returnPct || 0;
  log[idx].rewardUpdated = true;
  log[idx].outcome = outcome.outcome; // 'win' or 'loss'
  log[idx].holdDays = outcome.holdDays || 1;
  log[idx].feedbackTime = bjISO();
  
  // 保存
  const logPath = path.join(LEARNING_DIR, 'signal_log.json');
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  
  Logger.info(`[IncrementalLearning] ${code} 反馈已记录: ${outcome.outcome}, 收益=${(outcome.returnPct || 0).toFixed(2)}%`);
  return true;
}

export {
  initConfig,
  logSignal,
  updateSignalRewards,
  evaluateFactorPerformance,
  adjustFactorWeights,
  evaluateModelAccuracy,
  shouldRetrain,
  getFactorWeights,
  getLearningStatus,
  recordSignalOutcome,
  FACTOR_NAMES,
};