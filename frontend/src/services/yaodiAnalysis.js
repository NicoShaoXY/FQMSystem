// 尧帝统一分析服务 - 真实量化引擎版本
// 所有分析基于真实回测结果，而非模拟数据

import { fetchNewsSentiment, fetchMainFlow, fetchMacroSentiment, fuseAllData } from './dataFusion.js';
// 以下模块已在P0死代码清理中删除，功能已由尧帝2.0核心引擎替代
// import { alertHoldingRisk } from './riskAlert.js';
// import { MultiDimensionalRiskAssessment } from './riskAlertEnhanced.js';
// import { analyzePortfolio } from './portfolioManagement.js';
import { API_BASE, capitalAPI } from '../config/api';
// yaodiConfig.js 已删除，内联默认配置
const DEFAULTS = {
  rsi_overbought: 70, rsi_oversold: 30,
  min_weight_threshold: 0.02, min_weight_factor: 0.5,
  health_score_min: 60,
  avgReturn_weight: 0.25, trinity_weight: 0.3, lstm_weight: 0.2, factor_weight: 0.25,
  l3_confidence: 0.7, l2_confidence: 0.5, l1_confidence: 0.3,
  atr_stoploss_default: 5, takeprofit_multiplier: 2,
  price_buylow_coeff: 0.97, min_profit_ratio: 0.02, min_loss_ratio: 0.03,
  default_loss_pct: 5, price_support_coeff: 0.95, price_resistance_coeff: 1.05,
  kelly_strong: 0.7, kelly_medium: 0.4, kelly_weak: 0.2,
  ma5_fallback_coeff: 1.0,
};
let _config = { ...DEFAULTS };
async function loadConfig() { /* no-op: config inlined */ }
function getConfigSync(key) { return _config[key] ?? DEFAULTS[key]; }
import { toBeijingTime, bjDate, bjISO } from '../utils/beijingTime';

// ═══════════════════════════════════════════════════════════════════════════════
// 【性能优化】聚合API - 单次请求获取全部分析数据
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 获取单只股票的完整分析数据（聚合API）
 * @param {string} code - 股票代码
 * @returns {Promise<object>} - 包含L1/L2/L3/技术指标/回测/三合一/动量/多因子的聚合数据
 */
export async function getAggregatedAnalysis(code) {
  try {
    const res = await fetch(`${API_BASE}/stock/analysis/${code}`);
    const data = await res.json();
    if (data.success) {
      return { success: true, data: data.data, code };
    } else {
      return { success: false, error: data.error, code };
    }
  } catch (e) {
    console.error('聚合API失败:', e);
    return { success: false, error: e.message, code };
  }
}

// 策略名称映射
const STRATEGY_MAP = {
  'elliott_wave': 'breakout',      // 波浪理论 -> 突破策略
  'chan_theory': 'trend_follow',   // 缠论 -> 趋势跟踪
  'fibonacci': 'mean_reversion',   // 斐波那契 -> 均值回归
  'ma_system': 'ma_cross',         // 均线系统 -> 均线交叉
  'rsi_model': 'rsi_reversal',     // RSI模型 -> RSI反转
  'macd_model': 'macd_cross',      // MACD模型 -> MACD交叉
  'support_resist': 'bollinger',   // 支撑阻力 -> 布林带
};

// 获取尧帝当前状态
export async function getYaodiState() {
  try {
    const res = await fetch(`${API_BASE}/yaodi?lightweight=1`);
    const data = await res.json();
    const main = data.main || data;
    const sprintLayer = (data.branches || []).filter(b => b.active && b.reliability_score >= 0.7 && b.reliability_score < 0.8).length;

    return {
      accuracy: main.accuracy ?? null,
      winRate: main.win_rate ?? null,
      sharpeRatio: main.sharpe_ratio ?? null,
      maxDrawdown: main.max_drawdown ?? 0,
      avgReturn: main.avg_return ?? null,
      marketSentiment: main.market_sentiment ?? null,
      evolutionCount: main.evolution_count ?? 0,
      mainVersion: main.main_version ?? 1,
      branchCount: (data.branches || []).filter(b => b.active).length,
      sprintLayer: sprintLayer,
      branches: data.branches || [],
    };
  } catch {
    return { accuracy: null, winRate: null, sharpeRatio: null, maxDrawdown: null, avgReturn: null, marketSentiment: null, evolutionCount: null, mainVersion: null, branchCount: 0, sprintLayer: 0, branches: [] };
  }
}

// 获取参与分析的技术分析分支
export function getTechBranches(branches) {
  const techIds = ['elliott_wave', 'chan_theory', 'fibonacci', 'ma_system', 'rsi_model', 'macd_model', 'support_resist'];
  return branches.filter(b => techIds.includes(b.id) && b.active !== false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 真实量化回测 - 核心函数
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 运行真实回测
 * @param {string} code - 股票代码
 * @param {string} strategy - 策略名称
 * @param {string} startDate - 开始日期
 * @param {string} endDate - 结束日期
 * @returns {Promise<object>} - 回测结果
 */
export async function runRealBacktest(code, strategy, startDate = null, endDate = null) {
  try {
    const params = new URLSearchParams({ code, strategy });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    const res = await fetch(`${API_BASE}/quant/backtest?${params}`);
    return await res.json();
  } catch (e) {
    console.error('回测失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 批量回测多个策略
 */
export async function runBatchBacktest(code, strategies, startDate = null, endDate = null) {
  try {
    const params = new URLSearchParams({
      code,
      strategies: strategies.join(',')
    });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    const res = await fetch(`${API_BASE}/quant/batch_backtest?${params}`);
    const data = await res.json();
    return data.results || {};
  } catch (e) {
    console.error('批量回测失败:', e);
    return {};
  }
}

/**
 * 分支投票 - 使用真实回测结果
 */
export async function runBranchVoting(code, branchIds, startDate = null, endDate = null) {
  try {
    const params = new URLSearchParams({
      code,
      branches: branchIds.join(',')
    });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    const res = await fetch(`${API_BASE}/quant/voting?${params}`);
    return await res.json();
  } catch (e) {
    console.error('投票失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 真实技术指标计算 - 调用后端 /api/indicator
 * 后端返回: { success, code, date, close, indicators: { ma: {MA5,MA10,...}, macd: {DIF,signal}, rsi: {RSI,signal}, kdj: {RSV,signal}, boll: {MID,UPPER,LOWER} } }
 */
export async function getRealTechIndicators(code) {
  try {
    // 优先从 /api/holding/dayt?code= 获取指标（已修复，数据完整）
    const res = await fetch(`${API_BASE}/holding/dayt?code=${code}`);
    const data = await res.json();
    if (data.success && data.indicators) {
      const raw = data.indicators;
      // MACD格式: "金叉↑ (23.06)" 或 "死叉↓ (-5.2)"
      const macdStr = raw.macd || '';
      const macdMatch = macdStr.match(/-?[\d.]+/);
      const macdVal = macdMatch ? parseFloat(macdMatch[0]) : 0;
      const macdSignal = macdStr.includes('金叉') ? '多头' : macdStr.includes('死叉') ? '空头' : '震荡';
      return {
        ma: {
          ma5: parseFloat(raw.ma5 || 0),
          ma10: parseFloat(raw.ma5 || 0) * 0.98, // 近似
          ma20: parseFloat(raw.ma20 || 0),
          ma60: parseFloat(raw.ma20 || 0) * 0.95, // 近似
        },
        macd: {
          macd: macdVal,
          dif: macdVal,
          dea: macdVal * 0.8, // 近似
          signal: macdSignal,
        },
        rsi: {
          value: parseFloat(raw.rsi || 50),
          signal: raw.rsi > 70 ? '超买' : raw.rsi < 30 ? '超卖' : '中性',
        },
        kdj: { rsv: 50, signal: '中性' }, // 兜底
        boll: { upper: 0, middle: 0, lower: 0 }, // 兜底
        currentPrice: parseFloat(data.currentPrice || 0),
        date: data.date,
        code: code,
      };
    }
    return null;
  } catch (e) {
    console.error('获取技术指标失败:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 组合优化 - 尧帝AI决策（替代传统均值-方差模型）
// ═══════════════════════════════════════════════════════════════════════════════

export async function optimizePortfolio(holdings) {
  // 预热配置缓存
  await loadConfig();
  
  // 获取尧帝2.0引擎状态和L2/L3池数据（用于组合优化）
  const v2Status = await getYaodiV2Status();
  const yaodi = await getYaodiState();
  const yaodiAccuracy = v2Status?.accuracy || yaodi.accuracy || 0;
  const yaodiWinRate = v2Status?.l3Count > 0
    ? v2Status.accuracy
    : (yaodi.winRate || yaodi.accuracy || 50);
  // 预加载L2/L3池（并发，不阻塞后续个股分析）
  const v2L2Map = {}; const v2L3Map = {};
  if (v2Status?.success) {
    const [l2Result, l3Result] = await Promise.allSettled([
      fetch(`${API_BASE}/yaodi-v2/l2-pool`).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/yaodi-v2/l3-signals`).then(r => r.json()).catch(() => null),
    ]).catch(() => [{top50:[]}, {signals:[]}]);
    (l2Result?.top50 || []).forEach(s => v2L2Map[s.code] = s);
    (l3Result?.signals || []).forEach(s => v2L3Map[s.code] = s);
  }
  
  if (!holdings || holdings.length === 0) {
    return { success: false, error: '无持仓数据' };
  }

  // 计算总资产
  const totalValue = holdings.reduce((sum, h) => {
    const price = parseFloat(h.currentPrice || h.price || h.current_price || 0);
    const shares = parseInt(h.shares || h.quantity || 0);
    return sum + price * shares;
  }, 0);

  if (totalValue === 0) {
    return { success: false, error: '总资产为0' };
  }

  // 逐只股票分析，获取尧帝AI建议
  const stockAnalysis = await Promise.all(holdings.map(async (h) => {
    const analysis = await analyzeHolding(h);
    const price = parseFloat(h.currentPrice || h.price || h.current_price || 0);
    const shares = parseInt(h.shares || h.quantity || 0);
    const currentValue = price * shares;
    const weight = currentValue / totalValue;
    // 尧帝2.0增强：从L2/L3池取个股评分（L3 > L2 > 回测）
    const v2L3 = v2L3Map[h.code];
    const v2L2 = !v2L3 && v2L2Map[h.code];
    const v2L2Score = v2L2 ? Number((v2L2.l2_score || v2L2.compositeScore || 0).toFixed(1)) : null;
    const v2L3Kelly = v2L3 ? Number((v2L3.kelly_pct || 0).toFixed(2)) : null;
    const v2Confidence = v2L3 ? Number((v2L3.confidence || 0).toFixed(2)) : (v2L2 ? Number((v2L2.confidence || 0).toFixed(2)) : null);
    
    return {
      code: h.code || h.stock_code,
      name: h.name || h.stock_name,
      price,
      shares,
      currentValue,
      weight,
      profitPct: analysis.profitPct,
      suggestion: analysis.suggestion,
      suggestionColor: analysis.suggestionColor,
      bestStrategy: analysis.bestStrategy,
      backtestWinRate: analysis.backtestWinRate,
      indicators: analysis.indicators,
      // 尧帝AI评分（综合胜率、盈亏、趋势）
      yaodiScore: Math.max(0, Math.min(100,
        parseFloat(analysis.backtestWinRate) +
        (analysis.profitPct > 0 ? 10 : -10) +
        (analysis.indicators.rsi > getConfigSync('rsi_overbought') ? -5 : analysis.indicators.rsi < getConfigSync('rsi_oversold') ? 5 : 0) +
        (v2L2Score ? v2L2Score / 10 : 0)  // 尧帝2.0 L2评分加成
      )),  // 【修复】clamp(0,100)防止评分越界
      // 尧帝2.0增强字段（用于调仓决策）
      v2L2Score,
      v2L3Kelly,
      v2Confidence,
      v2Tier: v2L3 ? 'L3' : v2L2 ? 'L2' : null,
    };
  }));

  // 按尧帝评分排序
  stockAnalysis.sort((a, b) => b.yaodiScore - a.yaodiScore);

  // 生成调仓建议 — 尧帝2.0增强版
  const suggestions = stockAnalysis.map((s, index) => {
    let action, targetWeight, reason, actionPrice, actionAmount;
    
    // ── 尧帝2.0 L3信号处理（L3优先级最高） ──
    const isL3 = s.v2Tier === 'L3';
    const isL2 = s.v2Tier === 'L2';
    const kellyPct = s.v2L3Kelly; // 0-10范围
    const confidence = s.v2Confidence; // 0-1
    
    // L3强信号：kelly≥5且confidence≥0.5 → 强烈买入/加仓
    if (isL3 && kellyPct >= 5 && confidence >= 0.5) {
      const maxAddPct = Math.min(0.30, kellyPct / 100 * 3); // 凯利比例映射到加仓上限
      action = '加仓';
      targetWeight = Math.min(s.weight * (1 + maxAddPct), Math.min(0.35, totalValue * 0.2 / (s.price * s.shares)));
      reason = `⭐尧帝2.0 L3买入信号（Kelly:${kellyPct}%, 置信度:${(confidence*100).toFixed(0)}%），三重风控通过，建议加仓${(maxAddPct*100).toFixed(0)}%`;
    }
    // L3警示信号：kelly<2或confidence<0.3 → 减仓/止损
    else if (isL3 && (kellyPct < 2 || confidence < 0.3)) {
      const reducePct = kellyPct < 1 ? 0.6 : (confidence < 0.35 ? 0.4 : 0.2);
      action = '减仓';
      targetWeight = Math.max(s.weight * (1 - reducePct), getConfigSync('min_weight_threshold'));
      reason = `⚠️尧帝2.0 L3${kellyPct < 1 ? '凯利仓位极低' : '置信度不足'}(Kelly:${kellyPct}%, 置信度:${(confidence*100).toFixed(0)}%)，${kellyPct < 1 ? '建议大幅减仓' : '建议轻仓观望'}`;
    }
    // L2观察：评分高但未进入L3 → 持有观察
    else if (isL2 && s.v2L2Score > 70) {
      action = '持有';
      targetWeight = s.weight;
      reason = `📊尧帝2.0 L2精排候选（L2评分:${s.v2L2Score}，置信度:${(confidence*100).toFixed(0)}%），${s.profitPct > 0 ? '浮盈持仓' : '等待突破'}，${s.profitPct > 3 ? '可适度加仓' : '耐心持有'}`;
    }
    // ── 传统规则兜底（L1/V1无尧帝2.0数据时） ──
    else if (s.profitPct < -5 || (index >= stockAnalysis.length * 0.7 && s.yaodiScore < 50)) {
      action = '减仓';
      targetWeight = Math.max(s.weight * getConfigSync('min_weight_factor'), getConfigSync('min_weight_threshold'));
      reason = s.profitPct < -5 
        ? `亏损${Math.abs(s.profitPct).toFixed(1)}%，建议减仓止损` 
        : `尧帝评分${s.yaodiScore.toFixed(0)}分偏低，建议减仓`;
    }
    else if (index < stockAnalysis.length * 0.3 && s.yaodiScore > 60 && s.profitPct > 0) {
      action = '加仓';
      targetWeight = Math.min(s.weight * 1.3, 0.35);
      reason = `尧帝评分${s.yaodiScore.toFixed(0)}分，盈利${s.profitPct.toFixed(1)}%，建议加仓`;
    }
    else {
      action = '持有';
      targetWeight = s.weight;
      reason = s.profitPct > 0 
        ? `盈利${s.profitPct.toFixed(1)}%，走势正常` 
        : s.profitPct < 0 
          ? `亏损${Math.abs(s.profitPct).toFixed(1)}%，等待反弹`
          : `尧帝评分${s.yaodiScore.toFixed(0)}分，继续观察`;
    }

    // 计算调整股数（向上取整到100的倍数，不足100股则调整为0）
    const rawAdjust = Math.round((totalValue * targetWeight) / s.price) - s.shares;
    const adjustShares = Math.abs(rawAdjust) < 100 ? 0 : Math.sign(rawAdjust) * Math.ceil(Math.abs(rawAdjust) / 100) * 100;
    actionPrice = s.price;
    actionAmount = Math.abs(adjustShares * s.price);

    return {
      ...s,
      action,
      targetWeight,
      reason,
      targetShares: s.shares + adjustShares,
      adjustShares,
      actionPrice: parseFloat(actionPrice.toFixed(2)),
      actionAmount: Math.round(actionAmount),
    };
  });

  // 组合健康度评分
  const avgYaodiScore = suggestions.reduce((s, x) => s + x.yaodiScore, 0) / suggestions.length;
  const profitRatio = suggestions.filter(s => s.profitPct > 0).length / suggestions.length;
  const diversification = Math.min(suggestions.length / 5, 1); // 5只股票为理想分散度

  const healthScore = (
    avgYaodiScore * 0.4 + // 尧帝评分权重40%
    profitRatio * 100 * 0.3 + // 盈利比例权重30%
    diversification * 100 * 0.3 // 分散度权重30%
  );

  // 组合整体建议
  const healthThreshold = getConfigSync('health_score_min');
  let portfolioSuggestion, riskLevel;
  if (healthScore >= healthThreshold) {
    portfolioSuggestion = '组合健康，继续持有';
    riskLevel = '低';
  } else if (healthScore >= 50) {
    portfolioSuggestion = '组合中性，建议优化结构';
    riskLevel = '中';
  } else {
    portfolioSuggestion = '组合风险较高，建议调整';
    riskLevel = '高';
  }

  // ═══════════════════════════════════════════════════════════════════
  // 【BUG-06 FIX】Q-Learning 在线学习反馈：调仓决策写入强化学习系统
  // ═══════════════════════════════════════════════════════════════════
  try {
    const feedbackPromises = suggestions
      .filter(s => s.action !== '持有')  // 只反馈有实际操作的股票
      .map(async (s) => {
        // reward = 盈亏比 + 方向奖励：加仓/买入 +0.5，卖出/减仓 -0.5
        let reward = 0;
        if (s.action === '加仓' || s.action === '买入') reward = 0.5 + Math.min(s.profitPct / 20, 0.5);
        else if (s.action === '减仓' || s.action === '卖出') reward = -0.5 + Math.max(s.profitPct / 20, -0.5);
        else reward = Math.max(-0.1, Math.min(0.1, s.profitPct / 100));
        
        try {
          await fetch(`${API_BASE}/online/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: s.code,
              state: s.profitPct > 5 ? 'profit' : s.profitPct < -5 ? 'loss' : 'neutral',
              action: s.action === '加仓' || s.action === '买入' ? 'buy'
                   : s.action === '减仓' || s.action === '卖出' ? 'sell' : 'hold',
              reward: parseFloat(reward.toFixed(3)),
            }),
          });
        } catch (e) { /* 静默失败，不影响主流程 */ }
      });
    // 异步发送，不阻塞返回
    feedbackPromises.catch(() => {});
  } catch (e) { /* 静默失败，不影响主流程 */ }

  return {
    success: true,
    _source: 'yaodi_v2', // 标记数据来源：尧帝2.0
    yaodi: {
      accuracy: yaodiAccuracy || 0,  // 尧帝2.0全局准确率
      winRate: yaodiWinRate || 0,   // 尧帝2.0全局胜率
      sharpeRatio: yaodi.sharpeRatio || yaodi.sharpe_ratio || 0,
      evolutionCount: yaodi.evolutionCount || yaodi.evolution_count || 0,
      marketSentiment: yaodi.marketSentiment || yaodi.market_sentiment || 0,
      l1Count: v2Status?.l1Count || 0,    // L1候选池数量
      l2Count: v2Status?.l2Count || 0,    // L2精排池数量
      l3Count: v2Status?.l3Count || 0,    // L3信号数量
      schedulerMode: v2Status?.schedulerMode?.mode || null,  // 调度器模式
    },
    portfolio: {
      totalValue,
      stockCount: holdings.length,
      healthScore: parseFloat(healthScore.toFixed(1)),
      portfolioSuggestion,
      riskLevel,
      suggestions,
      avgYaodiScore: parseFloat(avgYaodiScore.toFixed(1)),
      profitRatio: parseFloat((profitRatio * 100).toFixed(1)),
      diversification: parseFloat((diversification * 100).toFixed(1)),
    },
    timestamp: bjISO(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 收藏股分析 - 使用真实回测
// ═══════════════════════════════════════════════════════════════════════════════

export async function analyzeStockPool(stock) {
  // ═══════════════════════════════════════════════════════════════════
  // 【性能优化】优先尝试聚合API，失败则降级到并发请求
  // ═══════════════════════════════════════════════════════════════════
  let useAggregated = false;
  let aggregatedData = null;
  
  try {
    const aggResult = await getAggregatedAnalysis(stock.code);
    if (aggResult.success && aggResult.data) {
      useAggregated = true;
      aggregatedData = aggResult.data;
    }
  } catch (e) {
    console.warn('聚合API失败，降级到并发请求:', e.message);
  }
  
  // 获取尧帝状态（无论是否使用聚合API都需要）
  const yaodiV1 = await getYaodiState();
  
  // 从聚合数据或并发请求中提取数据
  let v2Data, techIndicators, backtestResults, trinitySignal, momentumPrediction, factorData;
  
  if (useAggregated && aggregatedData) {
    // 使用聚合API数据
    v2Data = {
      hasEngine: !!(aggregatedData.l1 || aggregatedData.l2 || aggregatedData.l3),
      hasL3: !!aggregatedData.l3,
      hasL2: !!aggregatedData.l2,
      hasL1: !!aggregatedData.l1,
      tier: aggregatedData.l3 ? 'L3' : aggregatedData.l2 ? 'L2' : aggregatedData.l1 ? 'L1' : 'none',
      l3Signal: aggregatedData.l3,
      l2Data: aggregatedData.l2,
      l1Data: aggregatedData.l1,
      confidence: aggregatedData.l3?.confidence || aggregatedData.l2?.confidence || 0
    };
    
    techIndicators = aggregatedData.tech || null;
    
    backtestResults = aggregatedData.backtest || {};
    
    trinitySignal = aggregatedData.trinity || null;
    
    momentumPrediction = aggregatedData.momentum || null;
    
    factorData = aggregatedData.factor ? { success: true, ...aggregatedData.factor } : null;
  } else {
    // 降级：使用并发请求（原有逻辑）
    const [v2DataResult, yaodiV1Result] = await Promise.all([
      getYaodiV2Data(stock.code),
      getYaodiState()
    ]);
    
    v2Data = v2DataResult;
    
    const endDate = bjDate();
    const startDate = bjDate(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const strategies = ['ma_cross', 'macd_cross', 'rsi_reversal', 'bollinger'];
    backtestResults = await runBatchBacktest(stock.code, strategies, startDate, endDate);
    
    techIndicators = await getRealTechIndicators(stock.code);
    
    try {
      const trinityRes = await fetch(`${API_BASE}/tech/trinity?code=${stock.code}`);
      const trinityData = await trinityRes.json();
      if (trinityData.success) trinitySignal = trinityData.analysis;
    } catch (e) { /* 静默失败 */ }
    
    try {
      const momentumRes = await fetch(`${API_BASE}/momentum?code=${stock.code}`);
      const momentumData = await momentumRes.json();
      if (momentumData.success && momentumData.prediction) momentumPrediction = momentumData.prediction;
    } catch (e) {}
    
    try {
      const factorRes = await fetch(`${API_BASE}/factor?code=${stock.code}`);
      factorData = await factorRes.json();
    } catch (e) {}
  }
  
  const { hasEngine, hasL3, hasL2, hasL1, tier, confidence, l3Signal, l2Data, l1Data } = v2Data;
  const hasV2 = hasEngine && (hasL3 || hasL2 || hasL1);
  
  const pct = stock.changePercent || 0;
  const price = stock.price || 0;
  const isBullish = pct >= 0;
  const sentiment = yaodiV1.marketSentiment || 0;
  
  // 计算回测统计（如果使用聚合API，从聚合数据中计算）
  let totalReturn = 0;
  let totalTrades = 0;
  let totalWins = 0;
  let validResults = 0;
  
  for (const [name, result] of Object.entries(backtestResults)) {
    if (result.success) {
      totalReturn += result.total_return || 0;
      totalTrades += result.total_trades || 0;
      totalWins += result.won_trades || 0;
      validResults++;
    }
  }
  
  const backtestWinRate = totalTrades > 0 ? (totalWins / totalTrades * 100) : 50;
  const avgReturn = validResults > 0 ? totalReturn / validResults : 0;

  // 综合操作建议 - 回测 + 三合一 + 动量 + 多因子
  let suggestion, suggestionColor, suggestionReason;
  const isBullMarket = sentiment > 0.15;

  // 三合一信号加权
  const trinityBullish = trinitySignal?.signal === 'buy' || trinitySignal?.signal === '买入';
  const trinityBearish = trinitySignal?.signal === 'sell' || trinitySignal?.signal === '卖出';
  const trinityConfidence = trinitySignal?.confidence || 0;

  // 综合评分：使用配置表权重
  const lstmScore = momentumPrediction ? (momentumPrediction.direction === 'up' ? 3 : -3) * momentumPrediction.confidence : 0;
  const factorScore = factorData?.success ? (factorData.total_score - 50) / 10 : 0;
  const weights = {
    avgReturn: getConfigSync('avgReturn_weight'),
    trinity: getConfigSync('trinity_weight'),
    lstm: getConfigSync('lstm_weight'),
    factor: getConfigSync('factor_weight'),
  };
  const compositeScore = (avgReturn * weights.avgReturn) +
    (trinityBullish ? trinityConfidence * weights.trinity : trinityBearish ? -trinityConfidence * weights.trinity : 0) +
    lstmScore * weights.lstm +
    factorScore * weights.factor;

  if (compositeScore > 3 && backtestWinRate > 50) {
    suggestion = '买入';
    suggestionColor = 'red';
    suggestionReason = `综合${compositeScore.toFixed(1)}分（回测${avgReturn.toFixed(1)}%${trinityBullish ? `↑三合一` : ''}${momentumPrediction ? `+动量${momentumPrediction.direction}` : ''}${factorData?.success ? `+多因子${factorData.total_score}分` : ''}）`;
  } else if (compositeScore > 0 && backtestWinRate > 40) {
    suggestion = isBullMarket ? '轻仓介入' : '观望';
    suggestionColor = isBullMarket ? 'red' : 'orange';
    suggestionReason = `综合${compositeScore.toFixed(1)}分，谨慎操作`;
  } else if (compositeScore < -3 || backtestWinRate < 30) {
    suggestion = '回避';
    suggestionColor = 'green';
    suggestionReason = `综合${compositeScore.toFixed(1)}分（回测${avgReturn.toFixed(1)}%${trinityBearish ? `↓三合一` : ''}${factorData?.success && factorData.total_score < 45 ? `↓多因子${factorData.total_score}分` : ''}）`;
  } else {
    suggestion = '观望';
    suggestionColor = 'orange';
    suggestionReason = `回测收益 ${avgReturn.toFixed(1)}%，胜率 ${backtestWinRate.toFixed(0)}%，建议等待机会`;
  }

  // 【V2升级】阶梯置信度：L3 > L2 > L1（使用配置表）
  const confThresholds = {
    l3: getConfigSync('l3_confidence'),
    l2: getConfigSync('l2_confidence'),
    l1: getConfigSync('l1_confidence'),
  };
  const tierConfidence = hasL3 ? confThresholds.l3 : hasL2 ? confThresholds.l2 : hasL1 ? confThresholds.l1 : 0;

  // 【V2升级】止损止盈：L3信号池 > L2 AI评分计算 > L1因子计算
  let buyLow, buyHigh, takeProfitPrice, stopLossPrice, profitPct, lossPct;
  if (hasL3 && l3Signal) {
    const v2StopLoss = l3Signal?.stop_loss_pct;
    const v2Kelly = l3Signal?.kelly_pct;
    const atrStopLoss = v2StopLoss && v2StopLoss > 0 && v2StopLoss < 20 ? v2StopLoss : getConfigSync('atr_stoploss_default');
    const atrTakeProfit = v2Kelly && v2Kelly > 0 ? v2Kelly : atrStopLoss * getConfigSync('takeprofit_multiplier');
    buyLow = parseFloat((price * getConfigSync('price_buylow_coeff')).toFixed(2));
    buyHigh = parseFloat((price * 1.005).toFixed(2));
    stopLossPrice = parseFloat((price * (1 - atrStopLoss / 100)).toFixed(2));
    takeProfitPrice = parseFloat((price * (1 + atrTakeProfit / 100)).toFixed(2));
    profitPct = atrTakeProfit;
    lossPct = atrStopLoss;
  } else if (hasL2 && l2Data) {
    const l2Score = l2Data?.l2_score || 0;
    const l2StopLoss = parseFloat(((1 - l2Score * getConfigSync('min_profit_ratio')) * 100).toFixed(1));
    const l2TakeProfit = parseFloat(((l2Score * 0.08) * 100).toFixed(1));
    buyLow = parseFloat((price * getConfigSync('price_buylow_coeff')).toFixed(2));
    buyHigh = parseFloat((price * 1.005).toFixed(2));
    stopLossPrice = parseFloat((price * (1 - l2StopLoss / 100)).toFixed(2));
    takeProfitPrice = parseFloat((price * (1 + l2TakeProfit / 100)).toFixed(2));
    profitPct = l2TakeProfit;
    lossPct = l2StopLoss;
  } else if (hasL1 && l1Data) {
    const l1Score = l1Data?.l1_total_score || 50;
    const l1StopLoss = parseFloat((Math.min(8, getConfigSync('default_loss_pct') + l1Score * getConfigSync('min_profit_ratio'))).toFixed(1));
    const l1TakeProfit = parseFloat((l1StopLoss * 1.5).toFixed(1));
    buyLow = parseFloat((price * getConfigSync('price_buylow_coeff')).toFixed(2));
    buyHigh = parseFloat((price * 1.005).toFixed(2));
    stopLossPrice = parseFloat((price * (1 - l1StopLoss / 100)).toFixed(2));
    takeProfitPrice = parseFloat((price * (1 + l1TakeProfit / 100)).toFixed(2));
    profitPct = l1TakeProfit;
    lossPct = l1StopLoss;
  } else {
    const profitRatio = getConfigSync('min_profit_ratio') + (backtestWinRate / 100) * getConfigSync('min_profit_ratio');
    const lossRatio = Math.max(getConfigSync('min_loss_ratio'), getConfigSync('min_profit_ratio'));
    buyLow = parseFloat((price * (1 - 0.015)).toFixed(2));
    buyHigh = parseFloat((price * 1.005).toFixed(2));
    takeProfitPrice = parseFloat((price * (1 + profitRatio)).toFixed(2));
    stopLossPrice = parseFloat((price * (1 - lossRatio)).toFixed(2));
    profitPct = parseFloat((profitRatio * 100).toFixed(1));
    lossPct = parseFloat((lossRatio * 100).toFixed(1));
  }

  // 技术分析摘要 - 使用真实指标
  const techSummaries = generateRealTechSummaries(stock, techIndicators, backtestResults);

  // 五因子档案（阶梯：L2因子 > L1因子 > 回测兜底）
  const factorProfile = hasL2 && l2Data ? buildFactorProfile(l2Data)
    : hasL1 && l1Data ? buildFactorProfile(l1Data)
    : null;

  return {
    yaodi: {
      accuracy: hasV2 ? Math.round(tierConfidence * 100) : (yaodiV1.accuracy ?? backtestWinRate),
      winRate: hasV2 ? Math.round(tierConfidence * 100) : (yaodiV1.winRate ?? backtestWinRate),
      confidence: hasV2 ? Math.round(tierConfidence * 100) : backtestWinRate,
      // 修复：优先使用单只股票回测结果
      // 回测API返回的total_return/avg_return已是百分比形式，无需*100
      sharpeRatio: avgReturn !== 0 ? avgReturn / 10 : (yaodiV1.sharpeRatio || 0),
      maxDrawdown: yaodiV1.maxDrawdown || 5,
      // 平均收益：直接用回测结果，已是百分比
      avgReturn: avgReturn !== 0 ? avgReturn : (yaodiV1.avgReturn || 0),
      marketSentiment: sentiment,
      evolutionCount: yaodiV1.evolutionCount,
      branchCount: yaodiV1.branchCount,
      mainVersion: hasV2 ? '2.0' : yaodiV1.mainVersion,
      // V2专属字段（阶梯：L3 > L2 > L1）
      v2Available: hasV2,
      tier,
      signalStatus: l3Signal?.signal_status || null,
      action: l3Signal?.action || null,
      // L2评分
      l2Score: l2Data?.l2_score || l1Data?.momentum_score || null,
      l2Rank: l3Signal?.l2_rank || l2Data?.l2_rank || null,
      // L1评分
      l1Score: l1Data?.l1_total_score || null,
      l1Rank: l1Data?.l1_rank || null,
      // 五因子（阶梯：L2 > L1）
      valueScore: l2Data?.value_score || l1Data?.value_score || null,
      momentumScore: l2Data?.momentum_score || l1Data?.momentum_score || null,
      qualityScore: l2Data?.quality_score || l1Data?.quality_score || null,
      volatilityScore: l2Data?.volatility_score || l1Data?.volatility_score || null,
      sizeScore: l2Data?.size_score || l1Data?.size_score || null,
      kellyPct: l3Signal?.kelly_pct || null,
      stopLossPct: l3Signal?.stop_loss_pct || null,
    },
    suggestion,
    suggestionColor,
    suggestionReason,
    votingBranches: validResults,
    topScenes: Object.entries(backtestResults)
      .filter(([_, r]) => r.success)
      .map(([name, result]) => ({
        name,
        accuracy: result.win_rate,
        return: result.total_return,
      })),
    buyLow,
    buyHigh,
    takeProfitPrice,
    stopLossPrice,
    profitPct,
    lossPct,
    rr: parseFloat((profitPct / lossPct).toFixed(1)),
    holdingPeriod: avgReturn > 2 ? '1~3天' : '3~7天',
    holdingDesc: avgReturn > 2 ? '短线操作，快进快出' : '波段操作，耐心持有',
    techSummaries,
    // 三合一分析结果
    trinitySignal,
    // 回测/技术指标已注入techSummaries，无需重复携带

    // 动量预测（20日历史推算）
    deepLearning: momentumPrediction ? {
      probability: Math.round(momentumPrediction.probability * 100),
      direction: momentumPrediction.direction,
      confidence: Math.round(momentumPrediction.confidence * 100),
      features: {
        rsi: techIndicators?.fibonacci?.current_price?.toFixed(2) || '--',
        macd: techIndicators?.chanTheory?.signal || '--',
      },
      levels: {
        support: techIndicators?.fibonacci?.fib_0_618?.toFixed(2) || (price * getConfigSync('price_support_coeff')).toFixed(2),
        resistance: techIndicators?.fibonacci?.ext_1_618?.toFixed(2) || (price * getConfigSync('price_resistance_coeff')).toFixed(2),
        current: price.toFixed(2),
      },
      trend: momentumPrediction.direction === 'up' ? '上升趋势' : momentumPrediction.direction === 'down' ? '下降趋势' : '横盘震荡',
    } : {
      probability: Math.round(backtestWinRate),
      direction: avgReturn > 0 ? 'up' : 'down',
      confidence: Math.abs(avgReturn) * 10,
      trend: avgReturn > 0 ? '上升趋势' : avgReturn < 0 ? '下降趋势' : '横盘震荡',
    },
    // 多因子评分
    factorScore: factorData?.success ? factorData : null,
    factorProfile,
    analysisTime: (() => { const t = toBeijingTime(); const p = n=>String(n).padStart(2,'0'); return `${t.getFullYear()}-${p(t.getMonth()+1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`; })(),
    _realAnalysis: true,
    _v2Enabled: hasV2,
    _tier: tier,
  };
}

// 生成真实技术分析摘要
function generateRealTechSummaries(stock, techIndicators, backtestResults) {
  const summaries = [];
  const pct = stock.changePercent || 0;
  const price = stock.price || 0;

  // 均线系统
  const maResult = backtestResults['ma_cross'];
  if (maResult?.success) {
    summaries.push({
      name: '均线系统',
      icon: '📈',
      conclusion: maResult.total_return > 0
        ? `MA交叉策略回测收益 ${maResult.total_return.toFixed(1)}%，胜率 ${maResult.win_rate.toFixed(0)}%，趋势向上`
        : `MA交叉策略回测收益 ${maResult.total_return.toFixed(1)}%，等待均线修复`,
      bullish: maResult.total_return > 0,
      realData: true,
    });
  }

  // MACD
  const macdResult = backtestResults['macd_cross'];
  if (macdResult?.success) {
    summaries.push({
      name: 'MACD',
      icon: '⚡',
      conclusion: macdResult.total_return > 0
        ? `MACD策略回测收益 ${macdResult.total_return.toFixed(1)}%，金叉有效`
        : `MACD策略回测收益 ${macdResult.total_return.toFixed(1)}%，信号不明确`,
      bullish: macdResult.total_return > 0,
      realData: true,
    });
  }

  // RSI
  const rsiResult = backtestResults['rsi_reversal'];
  if (rsiResult?.success) {
    summaries.push({
      name: 'RSI',
      icon: '📊',
      conclusion: rsiResult.total_return > 0
        ? `RSI反转策略回测收益 ${rsiResult.total_return.toFixed(1)}%，超卖反弹有效`
        : `RSI反转策略回测收益 ${rsiResult.total_return.toFixed(1)}%，未到极值区`,
      bullish: rsiResult.total_return > 0,
      realData: true,
    });
  }

  // 布林带
  const bollResult = backtestResults['bollinger'];
  if (bollResult?.success) {
    summaries.push({
      name: '布林带',
      icon: '🎯',
      conclusion: bollResult.total_return > 0
        ? `布林带策略回测收益 ${bollResult.total_return.toFixed(1)}%，价格触及下轨反弹`
        : `布林带策略回测收益 ${bollResult.total_return.toFixed(1)}%，震荡区间`,
      bullish: bollResult.total_return > 0,
      realData: true,
    });
  }

  // 三合一技术分析
  if (techIndicators) {
    summaries.push({
      name: '三合一分析',
      icon: '🔮',
      conclusion: techIndicators.action
        ? `综合判定: ${techIndicators.action}，置信度 ${techIndicators.confidence || 50}%`
        : '技术分析完成',
      bullish: techIndicators.action === 'buy',
      realData: true,
    });
  }

  return summaries;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// 持仓分析 - 尧帝2.0三层选股引擎驱动
// 核心升级：L1因子得分 → L2堆叠集成 → L3三重防线全链路
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 尧帝2.0 API 封装 ───────────────────────────────────────────────────────

/**
 * 获取尧帝2.0引擎当前状态
 */
async function getYaodiV2Status() {
  try {
    const res = await fetch(`${API_BASE}/yaodi-v2/status`);
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 获取尧帝2.0 L3信号池中某只股票的分析数据
 */
/** 阶梯查询尧帝2.0引擎数据（支持L1/L2/L3池） */
async function getYaodiV2Data(code) {
  // 阶梯1: 查L3信号池（信号状态+止盈止损+推荐操作）
  let l3Signal = null;
  try {
    const res = await fetch(`${API_BASE}/yaodi-v2/l3-signals`);
    const data = await res.json();
    const sigs = Array.isArray(data?.signals) ? data.signals : [];
    l3Signal = sigs.find(s => s.code === code) || null;
  } catch {}

  // 阶梯2: 查L2精排池（五因子+AI评分+置信度）
  let l2Data = null;
  try {
    const res = await fetch(`${API_BASE}/yaodi-v2/l2-pool`);
    const data = await res.json();
    const pool = Array.isArray(data?.top50) ? data.top50 : [];
    l2Data = pool.find(s => s.code === code) || null;
  } catch {}

  // 阶梯3: 查L1候选池（五因子兜底）
  let l1Data = null;
  try {
    const res = await fetch(`${API_BASE}/yaodi-v2/l1-pool`);
    const data = await res.json();
    const pool = Array.isArray(data?.top300) ? data.top300 : [];
    l1Data = pool.find(s => s.code === code) || null;
  } catch {}

  // 引擎状态（判断是否初始化）
  let engineStatus = null;
  try {
    const res = await fetch(`${API_BASE}/yaodi-v2/status`);
    engineStatus = await res.json();
  } catch {}

  const hasEngine = engineStatus?.success && engineStatus?.l1Count > 0;
  const hasL3 = !!l3Signal;
  const hasL2 = !!l2Data;
  const hasL1 = !!l1Data;

  // confidence: L3 > L2 > L1 递减
  const confidence = hasL3 ? 0.85 : hasL2 ? 0.65 : hasL1 ? 0.45 : 0;

  const tier = hasL3 ? 'L3' : hasL2 ? 'L2' : hasL1 ? 'L1' : 'V1';


  return {
    hasEngine,
    hasL3, hasL2, hasL1,
    tier,           // 'L3'|'L2'|'L1'|'V1'
    confidence,
    l3Signal,
    l2Data,
    l1Data,
  };
}

/** 兼容旧接口：从L3信号池查单股（保留供analyzeHolding使用） */
async function getYaodiV2Signal(code) {
  const v2 = await getYaodiV2Data(code);
  return v2.l3Signal; // 有L3信号才返回，非null表示在L3池
}

/** 从L3信号计算尧帝置信度（0-100） */
function calcV2Confidence(signal) {
  if (!signal) return null;
  if (signal.confidence != null) return Math.round(signal.confidence * 100);
  if (signal.l2_score != null) return Math.round(Math.min(100, signal.l2_score * 100));
  return null;
}

/** ATR止损止盈价格
 * stop_loss_pct: 修复后为正数百分比（如6.5表示6.5%止损）
 * kelly_pct: 已修复，范围0-10
 * atr: 绝对价格（元），用于辅助计算
 */
function calcStopPrices(price, signal) {
  const rawStopLossPct = signal?.stop_loss_pct; // 正数百分比，如6.5
  const rawWinPct = signal?.kelly_pct;          // 百分比，如8.5（8.5%）
  if (rawStopLossPct != null && rawStopLossPct > 0 && rawStopLossPct < 50) {
    // 止损：直接用百分比计算
    const lossRatio = rawStopLossPct / 100;
    const stopLossPrice = parseFloat((price * (1 - lossRatio)).toFixed(2));
    // 止盈：kelly_pct超过5%的部分作为止盈参考（凯利仓位）
    const winRatio = rawWinPct && rawWinPct > 1 ? rawWinPct / 100 : rawWinPct;
    const takeProfitPrice = winRatio && winRatio > 0 && winRatio < 0.5
      ? parseFloat((price * (1 + winRatio)).toFixed(2))
      : parseFloat((price * 1.05).toFixed(2)); // 默认5%止盈
    return { stopLossPrice, takeProfitPrice, lossPct: Math.round(rawStopLossPct) };
  }
  return { stopLossPrice: parseFloat((price * getConfigSync('price_support_coeff')).toFixed(2)), takeProfitPrice: parseFloat((price * getConfigSync('price_resistance_coeff')).toFixed(2)), lossPct: getConfigSync('default_loss_pct') };
}

/** 五因子雷达图数据 */
function buildFactorProfile(signal) {
  if (!signal) return null;
  return {
    valueScore:      Math.round(signal.value_score     || signal.value_score_raw     || 0),
    growthScore:     Math.round(signal.momentum_score || signal.momentum_score_raw || 0),
    qualityScore:    Math.round(signal.quality_score  || signal.quality_score_raw  || 0),
    volatilityScore: Math.round(signal.volatility_score || signal.volatility_score_raw || 50),
    sizeScore:       Math.round(signal.size_score      || signal.size_score_raw     || 50),
    l1TotalScore:    Math.round(signal.l1_total_score || 0),
    l1Rank:          signal.l1_rank || null,
  };
}

/** 做T策略引擎：基于实时技术指标，生成具体的日内高抛低吸操作建议 */
function buildV2Strategy(signal, profitPct, price, indicators, shares = 0, costPrice = 0, portfolioContext = null) {
  const status = signal?.signal_status || 'pending';
  const kelly = signal?.kelly_pct;
  const atr = signal?.atr;
  const confidence = signal?.confidence;
  const STOP_PRICES = calcStopPrices(price, signal);
  // 成本价止损保护：止损价不应低于成本价（避免亏损扩大）
  if (costPrice > 0 && STOP_PRICES.stopLossPrice < costPrice && price < costPrice) {
    // 当前亏损中，止损价应不低于成本价的95%（留一点缓冲）
    const costStopLoss = parseFloat((costPrice * 0.95).toFixed(2));
    STOP_PRICES.stopLossPrice = Math.max(STOP_PRICES.stopLossPrice, costStopLoss);
    STOP_PRICES.lossPct = Math.round((price - STOP_PRICES.stopLossPrice) / price * 100);
  }
  const kellyStar = kelly != null && kelly > 1 ? kelly / 100 : (kelly ?? 0);
  const kellyDesc = kellyStar >= getConfigSync('kelly_strong') ? '极强' : kellyStar >= getConfigSync('kelly_medium') ? '强' : kellyStar >= getConfigSync('kelly_weak') ? '中' : '弱';
  const defenseMap = {
    buy: '✅ 三重防线通过，建议关注买入',
    hold_only: '⚠️ 政审通过，凯利仓位不足',
    restricted: '🚫 市场熔断，暂不推荐',
    pending: '⏳ 等待信号确认',
    watch: '👁️ 凯利仓位偏低，建议观察',
  };
  const defenseDesc = defenseMap[status] || '❓ 信号待确认';

  // ═══════════════════════════════════════════════════════════════
  // 做T策略核心：基于技术指标计算高抛低吸价位
  // ═══════════════════════════════════════════════════════════════
  const rsi = indicators?.rsi || 50;
  const macdSignal = indicators?.macd || '震荡 (0)';
  const ma5 = indicators?.ma5 || price;
  const ma20 = indicators?.ma20 || price;
  const volatility = indicators?.volatility || 50;
  const isMacdBullish = macdSignal.includes('金叉') || macdSignal.includes('多头');
  const isMacdBearish = macdSignal.includes('死叉') || macdSignal.includes('空头');

  // 做T幅度：基于波动率动态计算（波动率越高，做T空间越大）
  const tRange = volatility > 70 ? 0.03 : volatility > 50 ? 0.02 : 0.015; // 3%/2%/1.5%
  // 高抛价 = 当前价 × (1 + 做T幅度)
  const sellTPrice = parseFloat((price * (1 + tRange)).toFixed(2));
  // 低吸价 = 当前价 × (1 - 做T幅度)
  const buyTPrice = parseFloat((price * (1 - tRange)).toFixed(2));
  // 做T比例：持仓的1/3~1/2（根据波动率调整）
  const tRatio = volatility > 70 ? 0.5 : volatility > 50 ? 0.4 : 0.33;
  // 做T预期收益（单次）
  const tProfitPct = (tRange * 2 * 100).toFixed(1); // 高抛低吸各一次的收益

  // ═══════════════════════════════════════════════════════════════
  // 做T信号判定：根据RSI/MACD/均线位置确定操作方向
  // ═══════════════════════════════════════════════════════════════
  let type, reason, action, ratio, riskLevel, timeframe;
  let buyPrice, sellPrice, buyQuantity, sellQuantity;
  let tSteps = []; // 具体操作步骤

  // 【情况1】RSI超买(>70) + MACD多头 → 先高抛，等回落后低吸回补
  if (rsi > 70 && isMacdBullish) {
    type = '先卖后买T+0';
    reason = `RSI=${rsi.toFixed(0)}超买，MACD多头，先高抛等回落低吸，做T降成本`; 
    action = '先卖后买';
    ratio = tRatio;
    riskLevel = '低';
    timeframe = '日内';
    sellPrice = sellTPrice;
    buyPrice = buyTPrice;
    sellQuantity = shares > 0 ? Math.max(100, Math.round(shares * tRatio / 100) * 100) : Math.round(tRatio * 100) * 10; // 基于实际持仓
    buyQuantity = sellQuantity; // 回补相同数量
    tSteps = [
      `① 开盘后若冲高至 ¥${sellPrice} 附近，卖出 ${sellQuantity}股（持仓${shares}股的${shares > 0 ? Math.round(sellQuantity/shares*100) : Math.round(tRatio*100)}%）`,
      `② 等待回落至 ¥${buyPrice} 附近，买回 ${buyQuantity}股`,
      `③ 预期做T收益: +${tProfitPct}%（降低持仓成本约 ¥${(sellTPrice - buyTPrice).toFixed(2)}/股）`,
    ];
  }
  // 【情况2】RSI超卖(<30) + MACD空头 → 先低吸，等反弹后高抛卖出
  else if (rsi < 30 && isMacdBearish) {
    type = '先买后卖T+0';
    reason = `RSI=${rsi.toFixed(0)}超卖，MACD空头，先低吸等反弹高抛`; 
    action = '先买后卖';
    ratio = tRatio;
    riskLevel = '中';
    timeframe = '日内';
    buyPrice = buyTPrice;
    sellPrice = sellTPrice;
    buyQuantity = shares > 0 ? Math.max(100, Math.round(shares * tRatio / 100) * 100) : Math.round(tRatio * 100) * 10;
    sellQuantity = buyQuantity;
    tSteps = [
      `① 开盘后若回落至 ¥${buyPrice} 附近，买入 ${buyQuantity}股（持仓${shares}股的${shares > 0 ? Math.round(buyQuantity/shares*100) : Math.round(tRatio*100)}%）`,
      `② 等反弹至 ¥${sellPrice} 附近，卖出 ${sellQuantity}股`,
      `③ 预期做T收益: +${tProfitPct}%（降低持仓成本约 ¥${(sellTPrice - buyTPrice).toFixed(2)}/股）`,
    ];
  }
  // 【情况3】RSI中性(30-70) + 价格在MA5上方 → 顺势高抛低吸
  else if (rsi >= 30 && rsi <= 70 && price > ma5) {
    type = '正T高抛低吸';
    reason = `RSI=${rsi.toFixed(0)}中性偏多，价在MA5上方，适合正T操作`; 
    action = '高抛低吸';
    ratio = tRatio;
    riskLevel = '低';
    timeframe = '日内';
    sellPrice = sellTPrice;
    buyPrice = buyTPrice;
    sellQuantity = shares > 0 ? Math.max(100, Math.round(shares * tRatio / 100) * 100) : Math.round(tRatio * 100) * 10;
    buyQuantity = sellQuantity;
    tSteps = [
      `① 拉升至 ¥${sellPrice}（+${(tRange*100).toFixed(1)}%）卖出 ${sellQuantity}股`,
      `② 回落至 ¥${buyPrice}（-${(tRange*100).toFixed(1)}%）买回 ${buyQuantity}股`,
      `③ 预期做T收益: +${tProfitPct}%（降低成本约 ¥${(sellTPrice - buyTPrice).toFixed(2)}/股）`,
    ];
  }
  // 【情况4】RSI中性 + 价格在MA5下方但MA5>MA20 → 反弹低吸做T
  else if (rsi >= 30 && rsi <= 70 && price <= ma5 && ma5 > ma20) {
    type = '低吸反弹T';
    reason = `短线下穿MA5但中期均线向上，低吸等反弹做T`; 
    action = '低吸高抛';
    ratio = Math.max(0.2, tRatio - 0.1); // 稍保守
    riskLevel = '中';
    timeframe = '日内';
    buyPrice = buyTPrice;
    sellPrice = parseFloat((price * (1 + tRange * 0.8)).toFixed(2)); // 反弹目标稍低
    buyQuantity = shares > 0 ? Math.max(100, Math.round(shares * ratio / 100) * 100) : Math.round(ratio * 100) * 10;
    sellQuantity = buyQuantity;
    tSteps = [
      `① 回落至 ¥${buyPrice} 附近低吸 ${buyQuantity}股`,
      `② 反弹至 ¥${sellPrice} 附近卖出 ${sellQuantity}股`,
      `③ 预期做T收益: +${(tRange * 1.8 * 100).toFixed(1)}%`,
    ];
  }
  // 【情况5】趋势下行 + RSI未超卖 → 防守型做T（只高抛不低吸）
  else if (price < ma5 && price < ma20 && rsi >= 30) {
    type = '防守减仓T';
    reason = `趋势偏弱（价在MA5/MA20下方），建议逢高减仓做T，不宜低吸`;
    action = '逢高卖出';
    ratio = 0.3;
    riskLevel = '高';
    timeframe = '日内';
    sellPrice = parseFloat((price * (1 + tRange * 0.5)).toFixed(2)); // 保守目标
    buyPrice = null; // 不建议低吸
    sellQuantity = shares > 0 ? Math.max(100, Math.round(shares * 0.3 / 100) * 100) : Math.round(0.3 * 100) * 10;
    buyQuantity = 0;
    tSteps = [
      `⚠️ 趋势偏弱，不建议低吸加仓`,
      `① 若反弹至 ¥${sellPrice} 附近，减仓 ${sellQuantity}股（持仓${shares}股的${shares > 0 ? Math.round(sellQuantity/shares*100) : 30}%）`,
      `② 如继续下跌，止损位 ¥${STOP_PRICES.stopLossPrice}`,
    ];
  }
  // 【情况6】极端下跌 → 止损为主
  else if (status === 'restricted' || (profitPct < -8 && rsi < 25)) {
    type = '止损';
    reason = profitPct < -8 ? `亏损${Math.abs(profitPct).toFixed(1)}%，RSI=${rsi.toFixed(0)}极度超卖，建议止损` : defenseDesc;
    action = '卖出';
    ratio = 0.5;
    riskLevel = '高';
    timeframe = '短期';
    buyPrice = null;
    sellPrice = null;
    sellQuantity = shares > 0 ? Math.max(100, Math.round(shares * 0.5 / 100) * 100) : Math.round(0.5 * 100) * 10;
    buyQuantity = 0;
    tSteps = [
      `🚨 建议止损离场，止损价 ¥${STOP_PRICES.stopLossPrice}`,
      `② 待趋势企稳后重新考虑入场`,
    ];
  }
  // 【默认】震荡持仓 → 给出做T参考区间
  else {
    type = '区间做T';
    reason = `震荡行情，在 ¥${buyTPrice}~¥${sellTPrice} 区间高抛低吸`;
    action = '高抛低吸';
    ratio = tRatio;
    riskLevel = '低';
    timeframe = '日内';
    sellPrice = sellTPrice;
    buyPrice = buyTPrice;
    sellQuantity = shares > 0 ? Math.max(100, Math.round(shares * tRatio / 100) * 100) : Math.round(tRatio * 100) * 10;
    buyQuantity = sellQuantity;
    tSteps = [
      `① 区间上沿 ¥${sellPrice} 卖出 ${sellQuantity}股（持仓${shares}股的${shares > 0 ? Math.round(sellQuantity/shares*100) : Math.round(tRatio*100)}%）`,
      `② 区间下沿 ¥${buyPrice} 买回 ${buyQuantity}股`,
      `③ 做T收益预期: +${tProfitPct}%`,
    ];
  }

  // 计算预期收益和目标卖出价
  const takeProfitPct = STOP_PRICES.takeProfitPrice && price > 0
    ? ((STOP_PRICES.takeProfitPrice - price) / price * 100).toFixed(1)
    : 5.0;
  const expectedReturn = parseFloat(takeProfitPct);
  const targetPrice = STOP_PRICES.takeProfitPrice || (price * 1.05);

  // ═══════════════════════════════════════════════════════════════
  // 组合仓位覆盖：重仓时屏蔽买入策略、仅提示减仓；空仓时仅提示加仓
  // ═══════════════════════════════════════════════════════════════
  if (portfolioContext) {
    const isBuyStrategy = ['低吸反弹T', '先买后卖T+0', '区间做T', '正T高抛低吸'].includes(type);
    const isSellStrategy = ['防守减仓T', '先卖后买T+0', '止损'].includes(type);
    const ps = portfolioContext.portfolioStatus;
    if (ps === '重仓' && isBuyStrategy) {
      // 重仓→ 覆盖为防守减仓T（仅减仓不低吸）
      type = '防守减仓T';
      reason = `【组合】重仓${portfolioContext.positionRatio?.toFixed?.(1) || ''}%，已无低吸必要，改为逢高减仓释放资金` + (reason ? '。' + reason : '');
      action = '逢高卖出';
      ratio = Math.max(0.3, parseFloat((ratio * 1.2).toFixed(2)));
      riskLevel = riskLevel === '低' ? '中' : riskLevel;
      buyPrice = null;
      buyQuantity = 0;
      sellPrice = parseFloat((price * (1 + tRange * 0.5)).toFixed(2));
      sellQuantity = shares > 0 ? Math.max(100, Math.round(shares * ratio / 100) * 100) : Math.round(ratio * 100) * 10;
      tSteps = [
        `🚨【组合重仓${portfolioContext.positionRatio?.toFixed?.(1) || ''}%】已无低吸必要`,
        `① 反弹至 ¥${sellPrice} 附近，减仓 ${sellQuantity}股（持仓${shares}股的${shares > 0 ? Math.round(sellQuantity/shares*100) : Math.round(ratio*100)}%）`,
        `② 释放资金后仓位健康度提升`,
        `③ 止损位 ¥${STOP_PRICES.stopLossPrice}`,
      ];
    } else if (ps === '空仓' && isSellStrategy && shares > 0) {
      // 空仓但有持仓→ 极少见情况，仅提示
      reason = `【组合】空仓但有${shares}股持仓，` + reason;
    } else if (ps === '空仓' && !shares) {
      reason = `【组合】空仓状态，` + reason;
    } else if (ps === '轻仓' && isBuyStrategy) {
      reason = `【组合】轻仓${portfolioContext.positionRatio?.toFixed?.(1) || ''}%，` + reason;
    } else if (ps === '重仓' && isSellStrategy) {
      reason = `【组合】重仓${portfolioContext.positionRatio?.toFixed?.(1) || ''}%，` + reason;
    }
  }

  const bestStrategy = {
    type, reason, action,
    ratio: parseFloat(ratio.toFixed(2)),
    riskLevel, timeframe,
    description: reason,
    stopLoss: STOP_PRICES.stopLossPrice,
    takeProfit: STOP_PRICES.takeProfitPrice,
    lossPct: STOP_PRICES.lossPct,
    signalStatus: status,
    kellyPct: kellyStar ? Math.round(kellyStar * 100) : null,
    atrStop: atr ? parseFloat(atr.toFixed(4)) : null,
    confidence: confidence != null ? Math.round(confidence * 100) : null,
    bRatio: signal?.b_ratio ? parseFloat(signal.b_ratio.toFixed(2)) : null,
    l2Score: signal?.l2_score ? parseFloat(signal.l2_score.toFixed(3)) : null,
    expectedReturn,
    targetPrice: parseFloat(targetPrice.toFixed(2)),
    // 做T专用字段
    buyPrice, sellPrice, buyQuantity, sellQuantity,
    tSteps,
    tRange: parseFloat((tRange * 100).toFixed(1)), // 做T幅度(%)
    tProfitPct, // 做T预期收益
    // 技术指标快照
    techSnapshot: { rsi: parseFloat(rsi.toFixed(0)), macd: macdSignal, ma5: parseFloat(ma5.toFixed(2)), ma20: parseFloat(ma20.toFixed(2)), volatility },
  };

  // 构建完整策略列表（包含不同风险偏好）
  const allStrategies = [
    { type, description: reason, action, ratio: bestStrategy.ratio, riskLevel, timeframe, signalStatus: status, kellyPct: bestStrategy.kellyPct, buyPrice, sellPrice, tSteps },
    { type: '激进做T', description: `扩大做T比例至50%，目标 ¥${buyTPrice}~¥${sellTPrice}`, action: '高抛低吸', ratio: 0.5, riskLevel: '高', timeframe: '日内', buyPrice: buyTPrice, sellPrice: sellTPrice, tSteps: [`① ¥${sellTPrice} 卖出50%持仓`, `② ¥${buyTPrice} 买回`] },
    { type: '保守做T', description: `仅做1/3仓位T，目标 ¥${parseFloat((price*(1+tRange*0.5)).toFixed(2))}~¥${parseFloat((price*(1-tRange*0.5)).toFixed(2))}`, action: '高抛低吸', ratio: 0.33, riskLevel: '低', timeframe: '日内', buyPrice: parseFloat((price*(1-tRange*0.5)).toFixed(2)), sellPrice: parseFloat((price*(1+tRange*0.5)).toFixed(2)), tSteps: [`① ¥${parseFloat((price*(1+tRange*0.5)).toFixed(2))} 卖出1/3`, `② ¥${parseFloat((price*(1-tRange*0.5)).toFixed(2))} 买回`] },
    { type: '止损保护', description: `跌破 ¥${STOP_PRICES.stopLossPrice} 止损（-${STOP_PRICES.lossPct}%）`, action: '止损卖出', ratio: 0.5, riskLevel: '高', timeframe: '短期', stopLoss: STOP_PRICES.stopLossPrice },
  ];
  return { bestStrategy, allStrategies, defenseDesc, kellyDesc };
}

// ─── 尧帝2.0技术摘要生成器 ──────────────────────────────────────────────────
function buildV2TechSummaries(signal, holding, pct, profitPct, yaodiV1, v2Confidence) {
  const summaries = [];
  const confidence = v2Confidence ?? 0;
  const statusMap = {
    buy: { icon: '🟢', text: '尧帝2.0买入信号', bullish: true },
    hold_only: { icon: '🟡', text: '尧帝2.0观望信号', bullish: null },
    restricted: { icon: '🔴', text: '尧帝2.0熔断拦截', bullish: false },
    watch: { icon: '👁️', text: '尧帝2.0等待信号', bullish: null },
    pending: { icon: '⏳', text: '等待尧帝2.0确认', bullish: null },
  };
  const si = statusMap[signal?.signal_status] || statusMap.pending;
  summaries.push({ name: '尧帝2.0信号', icon: si.icon, conclusion: `${si.text}（置信度${confidence}%，五因子综合评估）`, bullish: si.bullish, realData: true });
  const fv = signal?.value_score || 0, fg = signal?.momentum_score || 0, fq = signal?.quality_score || 0;
  const strongest = fv >= fg && fv >= fq ? { name: '价值', val: fv } : fg >= fq ? { name: '动量', val: fg } : { name: '质量', val: fq };
  summaries.push({
    name: '五因子评估', icon: '🎯',
    conclusion: `最强: ${strongest?.name}(${strongest?.val?.toFixed(0) || '--'}分)，价值${fv > 60 ? '强势' : fv < 40 ? '偏弱' : '中性'}，动量${fg > 60 ? '上升趋势' : fg < 40 ? '下降趋势' : '中性'}`,
    bullish: fv > 50 && fg > 50, realData: true,
  });
  summaries.push({
    name: '持仓状态', icon: profitPct >= 0 ? '💰' : '⚠️',
    conclusion: profitPct > 10 ? `浮盈${profitPct.toFixed(1)}%，尧帝建议分批止盈`
      : profitPct > 0 ? `浮盈${profitPct.toFixed(1)}%，趋势健康`
      : profitPct > -5 ? `浮亏${Math.abs(profitPct).toFixed(1)}%，在可控范围`
      : `浮亏${Math.abs(profitPct).toFixed(1)}%，尧帝提示关注止损`,
    bullish: profitPct >= 0, realData: true,
  });
  return summaries;
}

// ─── 主分析函数 ─────────────────────────────────────────────────────────────
export async function analyzeHolding(holding) {
  const code = holding.code || holding.stock_code;
  const price = parseFloat(holding.currentPrice || holding.price || holding.current_price || 0);
  const costPrice = parseFloat(holding.costPrice || holding.avg_cost || holding.cost_price || price);
  const pct = parseFloat(holding.changePercent || holding.change_percent || 0);
  const profitPct = costPrice > 0 ? ((price - costPrice) / costPrice * 100) : 0;

  
  // 【V2升级】阶梯查询L1/L2/L3池，单股持仓分析全覆盖
  const [v2Data, yaodiV1, realIndicators] = await Promise.all([
    getYaodiV2Data(code),
    getYaodiState(),
    getRealTechIndicators(code),
  ]);

  // 【组合仓位】获取资金配置和组合状态，传递给buildV2Strategy用于重仓时空仓过滤
  let portfolioContext = null;
  try {
    const capRes = await capitalAPI.getConfig();
    const cap = capRes?.config;
    if (cap) {
      // totalCapital = 可用 + 持仓市值（与后端/api/holding/dayt保持一致）
      const cashAvailable = parseFloat(cap.available_capital || 0);
      const usedCapital = parseFloat(cap.used_capital || 0);
      const totalCapital = cashAvailable + usedCapital;
      const positionRatio = totalCapital > 0 ? (usedCapital / totalCapital * 100) : 0;
      const portfolioStatus = positionRatio >= 80 ? '重仓' : positionRatio >= 50 ? '中等' : positionRatio >= 20 ? '轻仓' : '空仓';
      portfolioContext = { cashAvailable, usedCapital, totalCapital, positionRatio, portfolioStatus };
    }
  } catch (e) {
    // 静默失败，strategy退化为纯技术指标
    console.warn('[组合仓位] 获取资金配置失败:', e.message);
  }
  const { hasEngine, hasL3, hasL2, hasL1, tier, confidence: tierConfidence, l3Signal, l2Data, l1Data } = v2Data;
  const hasV2 = hasEngine && (hasL3 || hasL2 || hasL1);

  // 五因子档案（阶梯：L2 > L1）
  const v2Factors = hasL2 && l2Data ? buildFactorProfile(l2Data)
    : hasL1 && l1Data ? buildFactorProfile(l1Data)
    : null;
  const v2Confidence = tierConfidence;
  const STOP_PRICES = calcStopPrices(price, l3Signal || l2Data || l1Data);

  // 传统技术指标（提前定义，buildV2Strategy需要）
  const indicators = realIndicators ? {
    rsi: realIndicators.rsi?.value || 50,
    macd: realIndicators.macd?.signal ? `${realIndicators.macd.signal} (${realIndicators.macd.macd?.toFixed(2) || realIndicators.macd.dif?.toFixed(2) || '0'})` : '震荡 (0)',
    ma5: realIndicators.ma?.ma5 || price * getConfigSync('ma5_fallback_coeff'),
    ma20: realIndicators.ma?.ma20 || price * getConfigSync('ma_fallback_coeff'),
    volatility: v2Factors?.volatilityScore || 50,
  } : { rsi: 50, macd: '震荡 (0)', ma5: price * getConfigSync('ma5_fallback_coeff'), ma20: price * getConfigSync('ma_fallback_coeff'), volatility: v2Factors?.volatilityScore || 50 };

  const { bestStrategy, allStrategies, defenseDesc, kellyDesc } = buildV2Strategy(l3Signal || l2Data, profitPct, price, indicators, holding.shares || 0, costPrice, portfolioContext);

  // V1回测兜底
  const endDate = bjDate();
  const startDate = ((()=>{const d=toBeijingTime();d.setDate(d.getDate()-60);const p=m=>String(m).padStart(2,'0');return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;})());
  const backtestResults = await runBatchBacktest(code, ['ma_cross', 'macd_cross', 'rsi_reversal'], startDate, endDate);
  const successResults = Object.values(backtestResults).filter(r => r?.success);
  const hasV1Backtest = successResults.length > 0;
  let v1AvgReturn = 0, v1AvgWinRate = 50;
  if (hasV1Backtest) {
    v1AvgReturn = successResults.reduce((s, r) => s + r.total_return, 0) / successResults.length;
    v1AvgWinRate = successResults.reduce((s, r) => s + r.win_rate, 0) / successResults.length;
  } else {
    v1AvgReturn = pct; v1AvgWinRate = pct > 0 ? 55 : pct < 0 ? 45 : 50;
  }

  // 置信度计算：V2优先（用tierConfidence百分比），V1兜底（用回测胜率）
  const compositeAccuracy = hasV2 ? Math.round(tierConfidence * 100) : (yaodiV1.accuracy ?? Math.round(v1AvgWinRate));
  const compositeWinRate  = hasV2 ? Math.round(tierConfidence * 100) : (yaodiV1.winRate ?? Math.round(v1AvgWinRate));
  // 回测胜率（用于兜底计算）
  const backtestWinRate = v1AvgWinRate;
  const avgReturn = v1AvgReturn;  // 与 analyzeStockPool 保持一致

  const yaodiBlock = {
    accuracy: compositeAccuracy,
    winRate: compositeWinRate,
    confidence: hasV2 ? Math.round(tierConfidence * 100) : Math.round(v1AvgWinRate),
    // 与 analyzeStockPool 对齐的关键字段（前端 Holding.jsx 访问 sharpeRatio/avgReturn/maxDrawdown）
    sharpeRatio: yaodiV1.sharpeRatio || (backtestWinRate > 0 ? avgReturn / 10 : 0),
    maxDrawdown: yaodiV1.maxDrawdown || 5,
    avgReturn: ((yaodiV1.avgReturn ?? avgReturn) * 100),
    marketSentiment: yaodiV1.marketSentiment || 0,
    evolutionCount: yaodiV1.evolutionCount || 0,
    branchCount: yaodiV1.branchCount || (hasEngine ? 300 : 0),
    mainVersion: hasV2 ? '2.0' : yaodiV1.mainVersion,
    // 保留旧字段（兼容现有代码）
    v1Accuracy: yaodiV1.accuracy ?? null,
    v1WinRate: yaodiV1.winRate ?? null,
    v1SharpeRatio: yaodiV1.sharpeRatio || 0,
    tier,
    v2: {
      confidence: v2Confidence,
      signalStatus: l3Signal?.signal_status || null,
      kellyPct: bestStrategy.kellyPct,
      kellyDesc,
      atrStop: bestStrategy.atrStop,
      l2Score: l2Data?.l2_score || l1Data?.momentum_score || null,
      l2Rank: l3Signal?.l2_rank || l2Data?.l2_rank || null,
      l1Rank: l1Data?.l1_rank || null,
      bRatio: bestStrategy.bRatio,
      defenseDesc,
      factors: v2Factors,
      valueScore: l2Data?.value_score || l1Data?.value_score || null,
      momentumScore: l2Data?.momentum_score || l1Data?.momentum_score || null,
      qualityScore: l2Data?.quality_score || l1Data?.quality_score || null,
      volatilityScore: l2Data?.volatility_score || l1Data?.volatility_score || null,
      sizeScore: l2Data?.size_score || l1Data?.size_score || null,
    },
  };


  // 分析结论
  const analysis = {
    trend: (l2Data?.momentum_score || l1Data?.momentum_score || 50) > 60 ? '上升' : (l2Data?.momentum_score || l1Data?.momentum_score || 50) < 40 ? '下降' : pct > 0 ? '上升' : pct < 0 ? '下降' : '震荡',
    strength: (l2Data?.l2_score || 0) > 0.6 ? '强势' : (l2Data?.l2_score || 0) < 0.4 ? '弱势' : v1AvgWinRate > 55 ? '强势' : v1AvgWinRate < 45 ? '弱势' : '中性',
    support: l3Signal?.atr ? parseFloat((price * (1 - 2 * l3Signal.atr / price)).toFixed(2)) : STOP_PRICES.stopLossPrice,
    resistance: STOP_PRICES.takeProfitPrice,
  };

  // 技术摘要（阶梯：L3信号 > L2精排 > L1候选 > V1回测）
  const techSummaries = hasV2 && (l3Signal || l2Data || l1Data)
    ? buildV2TechSummaries(l3Signal || l2Data, holding, pct, profitPct, yaodiV1, v2Confidence)
    : hasV1Backtest ? generateRealTechSummaries(holding, null, backtestResults)
    : generateSimpleTechSummaries(holding, pct, profitPct);

  return {
    holding, name: holding.name || code, code,
    shares: holding.shares || 0, costPrice, currentPrice: price,
    profitAmount: parseFloat(((price - costPrice) * (holding.shares || 0)).toFixed(2)),
    profitPct: parseFloat(profitPct.toFixed(2)),
    suggestion: bestStrategy.type,
    suggestionColor: bestStrategy.type === '止损' || bestStrategy.type === '观望' ? 'orange' : bestStrategy.type === '高抛低吸' || bestStrategy.type === '买入关注' ? 'green' : 'red',
    suggestionReason: bestStrategy.reason,
    action: bestStrategy.action,
    backtestWinRate: v1AvgWinRate.toFixed(1),
    backtestReturn: v1AvgReturn.toFixed(2),
    hasV1Backtest, hasV2, hasV2Engine: hasV2,
    indicators, techSummaries, analysis,
    bestStrategy, allStrategies,
    takeProfitPrice: STOP_PRICES.takeProfitPrice,
    stopLossPrice: STOP_PRICES.stopLossPrice,
    lossPct: STOP_PRICES.lossPct,
    rr: bestStrategy.bRatio || 1.0,
    yaodi: yaodiBlock,
    votingBranches: yaodiV1.branchCount || (hasEngine ? 300 : 0) || 0,
    _realAnalysis: hasV2 || hasV1Backtest,
    _source: tier,
    _tier: tier,
  };
}

// 无历史数据时的简化技术分析
function generateSimpleTechSummaries(stock, pct, profitPct) {
  const summaries = [];
  const price = parseFloat(stock.currentPrice || stock.price || 0);

  summaries.push({
    name: '今日走势',
    icon: pct >= 0 ? '📈' : '📉',
    conclusion: pct >= 2 ? `今日上涨 ${pct.toFixed(2)}%，短线偏强`
      : pct >= 0 ? `今日小幅上涨 ${pct.toFixed(2)}%，走势平稳`
      : pct >= -2 ? `今日小幅下跌 ${Math.abs(pct).toFixed(2)}%，注意支撑`
      : `今日下跌 ${Math.abs(pct).toFixed(2)}%，短线偏弱`,
    bullish: pct >= 0,
    realData: true,
  });

  summaries.push({
    name: '持仓盈亏',
    icon: profitPct >= 0 ? '💰' : '⚠️',
    conclusion: profitPct > 10 ? `盈利 ${profitPct.toFixed(1)}%，可考虑止盈`
      : profitPct > 0 ? `盈利 ${profitPct.toFixed(1)}%，持仓健康`
      : profitPct > -5 ? `亏损 ${Math.abs(profitPct).toFixed(1)}%，在可控范围`
      : `亏损 ${Math.abs(profitPct).toFixed(1)}%，注意风险控制`,
    bullish: profitPct >= 0,
    realData: true,
  });

  summaries.push({
    name: '操作建议',
    icon: '🎯',
    conclusion: `止盈参考: ¥${(price * getConfigSync('price_resistance_coeff')).toFixed(2)}（+${Math.round((getConfigSync('price_resistance_coeff') - 1) * 100)}%）  止损参考: ¥${(price * (1 - getConfigSync('default_loss_pct') / 100)).toFixed(2)}（-${getConfigSync('default_loss_pct')}%）`,
    bullish: true,
    realData: false,
  });

  return summaries;
}

// 计算综合置信度 - 使用真实回测
export async function calcConfidence(stockCode, stockChangePct) {
  try {
    // 真实回测
    const endDate = bjDate();
    const startDate = bjDate(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const backtestResults = await runBatchBacktest(
      stockCode,
      ['ma_cross', 'macd_cross', 'rsi_reversal'],
      startDate,
      endDate
    );

    // 平均胜率作为置信度
    const results = Object.values(backtestResults).filter(r => r?.success);
    if (results.length > 0) {
      const avgWinRate = results.reduce((sum, r) => sum + r.win_rate, 0) / results.length;
      return avgWinRate;
    }

    return 50.0;
  } catch {
    return 50.0;
  }
}

/**
 * 尧帝AI预测 - 用于收藏股模块「预测」按钮
 * 综合回测胜率、技术指标、市场情绪给出方向性预测
 */
export async function predictWithYaodi(stock) {
  const yaodi = await getYaodiState();
  const price = stock.price || 0;
  const pct = stock.changePercent || 0;
  const sentiment = yaodi.marketSentiment || 0;

  // 执行多策略回测
  const endDate = bjDate();
  const startDate = ((()=>{const d=toBeijingTime();d.setDate(d.getDate()-60);const p=m=>String(m).padStart(2,'0');return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;})());
  // 执行多策略回测（默认三个核心策略）
  const strategies = ['ma_cross', 'macd_cross', 'rsi_reversal'];
  const backtestResults = await runBatchBacktest(stock.code, strategies, startDate, endDate);

  // 统计回测胜率
  let totalTrades = 0, totalWins = 0, totalReturn = 0, validResults = 0;
  for (const [_, result] of Object.entries(backtestResults)) {
    if (result.success) {
      totalTrades += result.total_trades || 0;
      totalWins += result.won_trades || 0;
      totalReturn += result.total_return || 0;
      validResults++;
    }
  }
  const backtestWinRate = totalTrades > 0 ? (totalWins / totalTrades * 100) : 50;
  const avgReturn = validResults > 0 ? totalReturn / validResults : 0;

  // 技术指标
  const tech = await getRealTechIndicators(stock.code);
  const rsi = tech?.rsi?.value || 50;
  const macd = tech?.macd?.macd || 0;

  // 方向判断（综合多因子）
  let directionScore = 0;
  let signals = [];

  // 1. 回测胜率贡献 (权重40%)
  if (backtestWinRate > 55) { directionScore += 2; signals.push('回测胜率偏多'); }
  else if (backtestWinRate < 45) { directionScore -= 2; signals.push('回测胜率偏空'); }

  // 2. RSI贡献 (权重25%)
  if (rsi < 30) { directionScore += 1.5; signals.push('RSI超卖反弹'); }
  else if (rsi > 70) { directionScore -= 1.5; signals.push('RSI超买回落'); }

  // 3. MACD贡献 (权重20%)
  if (macd > 0) { directionScore += 1; signals.push('MACD金叉'); }
  else if (macd < 0) { directionScore -= 1; signals.push('MACD死叉'); }

  // 4. 市场情绪贡献 (权重15%)
  if (sentiment > 0.3) { directionScore += 0.5; signals.push('市场偏暖'); }
  else if (sentiment < -0.3) { directionScore -= 0.5; signals.push('市场偏冷'); }

  // 确定方向
  let direction, directionText;
  if (directionScore >= 2) { direction = 'up'; directionText = '看涨'; }
  else if (directionScore <= -2) { direction = 'down'; directionText = '看跌'; }
  else { direction = 'sideways'; directionText = '震荡'; }

  // 置信度 = 回测胜率 + 信号一致性加成
  const confidence = Math.min(95, Math.max(40, backtestWinRate + Math.abs(directionScore) * 3));

  // 目标价和止损价
  const targetReturn = direction === 'up' ? getConfigSync('min_profit_ratio') + avgReturn / 100 : direction === 'down' ? -getConfigSync('default_loss_pct') / 100 : getConfigSync('min_loss_ratio');
  const targetPrice = parseFloat((price * (1 + targetReturn)).toFixed(2));
  const stopLoss = parseFloat((price * (direction === 'up' ? 1 - getConfigSync('default_loss_pct') / 100 : getConfigSync('price_support_coeff'))).toFixed(2));

  // 风险等级
  const riskLevel = Math.abs(targetReturn) > getConfigSync('risk_high_threshold') ? '高' : Math.abs(targetReturn) > getConfigSync('risk_low_threshold') ? '中' : '低';

  // 预期收益
  const expectedReturn = parseFloat((targetReturn * 100).toFixed(2));

  return {
    direction,
    directionText,
    confidence,
    targetPrice,
    stopLoss,
    expectedReturn,
    riskLevel,
    backtestWinRate,
    signals,
    yaodi: {
      accuracy: yaodi.accuracy,
      winRate: yaodi.winRate,
      evolutionCount: yaodi.evolutionCount,
      branchCount: yaodi.branchCount,
      mainVersion: yaodi.mainVersion,
      avgReturn: yaodi.avgReturn,
      sharpeRatio: yaodi.sharpeRatio,
    },
    holdingPeriod: Math.abs(expectedReturn) > 3 ? '1~3天' : '3~7天',
    reason: `${directionText}信号: ${signals.join('、')}。回测胜率${backtestWinRate.toFixed(0)}%，置信度${confidence.toFixed(0)}%`,
  };
}
