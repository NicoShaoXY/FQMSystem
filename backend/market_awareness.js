/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 市场感知模块 (Market Awareness Module)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 核心功能：
 * 1. 实时感知市场状态（牛/熊/震荡）
 * 2. 分析市场情绪和风险偏好
 * 3. 为尧帝决策提供市场环境参数
 * 4. 自动调整系统运行参数
 * 
 * 与尧帝大脑集成点：
 * - yaodi_brain.js 调用本模块获取市场环境
 * - self_evolution_engine.js 根据市场环境调整演化策略
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════
// 市场状态定义
// ═══════════════════════════════════════════════════════════════

const MARKET_STATES = {
  STRONG_BULL: { name: '强势牛市', code: 1, riskLevel: 'high', strategy: 'aggressive' },
  BULL: { name: '牛市', code: 2, riskLevel: 'medium-high', strategy: 'growth' },
  WEAK_BULL: { name: '弱牛市', code: 3, riskLevel: 'medium', strategy: 'balanced' },
  SIDEWAYS: { name: '震荡市', code: 4, riskLevel: 'medium', strategy: 'neutral' },
  WEAK_BEAR: { name: '弱熊市', code: 5, riskLevel: 'medium-low', strategy: 'defensive' },
  BEAR: { name: '熊市', code: 6, riskLevel: 'low', strategy: 'conservative' },
  STRONG_BEAR: { name: '强势熊市', code: 7, riskLevel: 'very-low', strategy: 'cash' },
  CRASH: { name: '崩盘', code: 8, riskLevel: 'minimal', strategy: 'exit' },
};

const SENTIMENT_LEVELS = {
  EXTREME_GREED: { name: '极度贪婪', code: 1, signal: '反向卖出' },
  GREED: { name: '贪婪', code: 2, signal: '谨慎' },
  NEUTRAL: { name: '中性', code: 3, signal: '观望' },
  FEAR: { name: '恐慌', code: 4, signal: '寻找机会' },
  EXTREME_FEAR: { name: '极度恐慌', code: 5, signal: '反向买入' },
};

// ═══════════════════════════════════════════════════════════════
// 市场感知状态
// ═══════════════════════════════════════════════════════════════

let marketState = {
  // 当前市场状态
  current: {
    state: MARKET_STATES.SIDEWAYS,
    sentiment: SENTIMENT_LEVELS.NEUTRAL,
    confidence: 0.5,
  },
  
  // 市场数据
  data: {
    indices: [],           // 主要指数
    breadth: null,         // 市场宽度
    limitUpDown: null,     // 涨跌停
    volume: null,          // 成交量
    turnover: null,        // 换手率
    northbound: null,      // 北向资金
  },
  
  // 技术指标
  indicators: {
    maTrend: 'neutral',    // MA趋势: up/down/neutral
    macdSignal: 'neutral', // MACD信号: bullish/bearish/neutral
    rsi: 50,               // RSI值
    kdj: { k: 50, d: 50 }, // KDJ值
    bollingerPos: 'middle', // 布林带位置: upper/middle/lower
  },
  
  // 风险评估
  risk: {
    overall: 50,           // 综合风险分数 0-100
    market: 50,            // 市场风险
    liquidity: 50,         // 流动性风险
    systemic: 50,          // 系统性风险
  },
  
  // 系统参数调整建议
  adjustments: {
    tradingEnabled: true,
    maxPositionRatio: 1.0,
    strategyPreference: 'balanced',
    riskTolerance: 'medium',
    evolutionSpeed: 50,
  },
  
  // 历史记录
  history: [],
  
  // 最后更新时间
  lastUpdate: null,
};

// 数据文件路径
const DATA_DIR = path.join(__dirname, '..', 'data');
const MARKET_HISTORY_FILE = path.join(DATA_DIR, 'market_history.json');

// ═══════════════════════════════════════════════════════════════
// 核心功能函数
// ═══════════════════════════════════════════════════════════════

/**
 * 更新市场数据
 * @param {Object} marketData - 从外部获取的市场数据
 */
function updateMarketData(marketData) {
  const now = new Date();
  
  // 更新原始数据
  if (marketData.indices) {
    marketState.data.indices = marketData.indices;
  }
  if (marketData.breadth) {
    marketState.data.breadth = marketData.breadth;
  }
  if (marketData.limitUpDown) {
    marketState.data.limitUpDown = marketData.limitUpDown;
  }
  
  // 分析市场状态
  analyzeMarketState();
  
  // 计算风险
  calculateRisk();
  
  // 生成调整建议
  generateAdjustments();
  
  // 更新时间戳
  marketState.lastUpdate = bjISO();
  
  // 记录历史（每5分钟记录一次）
  if (!marketState.history.length || 
      now - new Date(marketState.history[marketState.history.length - 1].timestamp) > 300000) {
    marketState.history.push({
      timestamp: bjISO(),
      state: marketState.current.state.code,
      sentiment: marketState.current.sentiment.code,
      risk: marketState.risk.overall,
    });
    
    // 保留最近288条记录（24小时）
    if (marketState.history.length > 288) {
      marketState.history.shift();
    }
    
    // 保存到文件
    saveHistory();
  }
  
  return marketState;
}

/**
 * 分析市场状态
 */
function analyzeMarketState() {
  const { indices, breadth, limitUpDown } = marketState.data;
  
  if (!indices || indices.length === 0) {
    return;
  }
  
  // 1. 分析指数涨跌
  let totalChange = 0;
  let weightedChange = 0;
  let totalWeight = 0;
  
  const WEIGHTS = {
    '000001': 3,  // 上证指数
    '399001': 2,  // 深证成指
    '399006': 2,  // 创业板指
    '000300': 2,  // 沪深300
    '000688': 1,  // 科创50
  };
  
  for (const idx of indices) {
    const weight = WEIGHTS[idx.code] || 1;
    totalChange += idx.changePercent || 0;
    weightedChange += (idx.changePercent || 0) * weight;
    totalWeight += weight;
  }
  
  const avgChange = totalChange / indices.length;
  const weightedAvg = weightedChange / totalWeight;
  
  // 2. 分析市场宽度
  let breadthScore = 50;
  if (breadth) {
    const upRatio = (breadth.upCount || 0) / Math.max(1, (breadth.upCount || 0) + (breadth.downCount || 0));
    breadthScore = upRatio * 100;
  }
  
  // 3. 分析涨跌停
  let limitScore = 50;
  if (limitUpDown) {
    const upLimit = limitUpDown.upLimit || 0;
    const downLimit = limitUpDown.downLimit || 0;
    const total = upLimit + downLimit;
    if (total > 0) {
      limitScore = (upLimit / total) * 100;
    }
  }
  
  // 4. 综合判断市场状态
  const compositeScore = (weightedAvg * 10) + (breadthScore - 50) + (limitScore - 50);
  
  let newState;
  if (compositeScore > 30) {
    newState = MARKET_STATES.STRONG_BULL;
  } else if (compositeScore > 15) {
    newState = MARKET_STATES.BULL;
  } else if (compositeScore > 5) {
    newState = MARKET_STATES.WEAK_BULL;
  } else if (compositeScore > -5) {
    newState = MARKET_STATES.SIDEWAYS;
  } else if (compositeScore > -15) {
    newState = MARKET_STATES.WEAK_BEAR;
  } else if (compositeScore > -30) {
    newState = MARKET_STATES.BEAR;
  } else if (compositeScore > -50) {
    newState = MARKET_STATES.STRONG_BEAR;
  } else {
    newState = MARKET_STATES.CRASH;
  }
  
  marketState.current.state = newState;
  marketState.current.confidence = Math.min(1, Math.abs(compositeScore) / 30);
  
  // 5. 分析市场情绪（基于波动率和涨跌停比例）
  analyzeSentiment(avgChange, limitUpDown);
}

/**
 * 分析市场情绪
 */
function analyzeSentiment(avgChange, limitUpDown) {
  const upLimit = limitUpDown?.upLimit || 0;
  const downLimit = limitUpDown?.downLimit || 0;
  const limitRatio = upLimit / Math.max(1, upLimit + downLimit);
  
  let sentiment;
  
  if (avgChange > 2 && limitRatio > 0.8) {
    sentiment = SENTIMENT_LEVELS.EXTREME_GREED;
  } else if (avgChange > 1 && limitRatio > 0.6) {
    sentiment = SENTIMENT_LEVELS.GREED;
  } else if (avgChange < -2 && limitRatio < 0.2) {
    sentiment = SENTIMENT_LEVELS.EXTREME_FEAR;
  } else if (avgChange < -1 && limitRatio < 0.4) {
    sentiment = SENTIMENT_LEVELS.FEAR;
  } else {
    sentiment = SENTIMENT_LEVELS.NEUTRAL;
  }
  
  marketState.current.sentiment = sentiment;
}

/**
 * 计算风险
 */
function calculateRisk() {
  const state = marketState.current.state;
  const sentiment = marketState.current.sentiment;
  
  // 市场风险（基于市场状态）
  const marketRiskMap = {
    1: 70,  // 强势牛市 - 高风险（可能回调）
    2: 60,  // 牛市
    3: 50,  // 弱牛市
    4: 50,  // 震荡市
    5: 60,  // 弱熊市
    6: 70,  // 熊市
    7: 80,  // 强势熊市
    8: 95,  // 崩盘
  };
  
  marketState.risk.market = marketRiskMap[state.code] || 50;
  
  // 流动性风险（基于成交量）
  const indices = marketState.data.indices || [];
  let totalVolume = 0;
  for (const idx of indices) {
    totalVolume += idx.volume || 0;
  }
  
  // 假设正常成交量为某个基准值
  const normalVolume = 100000000000; // 1000亿
  const volumeRatio = totalVolume / normalVolume;
  
  if (volumeRatio < 0.5) {
    marketState.risk.liquidity = 70; // 低流动性，高风险
  } else if (volumeRatio > 1.5) {
    marketState.risk.liquidity = 40; // 高流动性，低风险
  } else {
    marketState.risk.liquidity = 50;
  }
  
  // 系统性风险（基于波动率）
  let volatility = 0;
  for (const idx of indices) {
    volatility += Math.abs(idx.changePercent || 0);
  }
  volatility = volatility / Math.max(1, indices.length);
  
  marketState.risk.systemic = Math.min(100, volatility * 20);
  
  // 综合风险
  marketState.risk.overall = Math.round(
    marketState.risk.market * 0.4 +
    marketState.risk.liquidity * 0.2 +
    marketState.risk.systemic * 0.4
  );
}

/**
 * 生成系统参数调整建议
 */
function generateAdjustments() {
  const state = marketState.current.state;
  const risk = marketState.risk.overall;
  
  // 交易开关
  marketState.adjustments.tradingEnabled = state.code !== 8; // 崩盘时停止交易
  
  // 仓位比例
  const positionRatioMap = {
    1: 0.9,   // 强势牛市 - 高仓位
    2: 0.8,   // 牛市
    3: 0.7,   // 弱牛市
    4: 0.5,   // 震荡市
    5: 0.3,   // 弱熊市
    6: 0.2,   // 熊市
    7: 0.1,   // 强势熊市
    8: 0,     // 崩盘
  };
  marketState.adjustments.maxPositionRatio = positionRatioMap[state.code] || 0.5;
  
  // 策略偏好
  marketState.adjustments.strategyPreference = state.strategy;
  
  // 风险容忍度
  const riskToleranceMap = {
    1: 'high',
    2: 'medium-high',
    3: 'medium',
    4: 'medium',
    5: 'low',
    6: 'low',
    7: 'very-low',
    8: 'minimal',
  };
  marketState.adjustments.riskTolerance = riskToleranceMap[state.code] || 'medium';
  
  // 演化速度（市场好时快，市场差时慢）
  marketState.adjustments.evolutionSpeed = Math.max(10, Math.min(100, 100 - risk));
}

/**
 * 获取市场状态摘要
 */
function getMarketSummary() {
  return {
    state: marketState.current.state.name,
    stateCode: marketState.current.state.code,
    sentiment: marketState.current.sentiment.name,
    sentimentCode: marketState.current.sentiment.code,
    confidence: marketState.current.confidence,
    risk: marketState.risk.overall,
    riskBreakdown: {
      market: marketState.risk.market,
      liquidity: marketState.risk.liquidity,
      systemic: marketState.risk.systemic,
    },
    adjustments: marketState.adjustments,
    lastUpdate: marketState.lastUpdate,
    indices: marketState.data.indices.slice(0, 3).map(i => ({
      name: i.name,
      price: i.price,
      change: i.changePercent,
    })),
  };
}

/**
 * 获取完整的调整建议
 */
function getAdjustments() {
  return {
    marketState: marketState.current.state.name,
    riskLevel: marketState.risk.overall,
    recommendations: {
      tradingEnabled: marketState.adjustments.tradingEnabled,
      maxPositionRatio: marketState.adjustments.maxPositionRatio,
      strategyType: marketState.adjustments.strategyPreference,
      riskLevel: marketState.adjustments.riskTolerance,
      evolutionSpeed: marketState.adjustments.evolutionSpeed,
    },
    reasons: generateAdjustmentReasons(),
  };
}

/**
 * 生成调整原因说明
 */
function generateAdjustmentReasons() {
  const reasons = [];
  const state = marketState.current.state;
  const sentiment = marketState.current.sentiment;
  
  reasons.push(`当前市场状态: ${state.name}`);
  reasons.push(`市场情绪: ${sentiment.name}`);
  
  if (state.code <= 3) {
    reasons.push(`建议: 积极参与，适当提高仓位`);
  } else if (state.code === 4) {
    reasons.push(`建议: 谨慎参与，保持中性仓位`);
  } else {
    reasons.push(`建议: 防守为主，降低仓位`);
  }
  
  if (sentiment.code >= 4) {
    reasons.push(`情绪面偏恐慌，可能是逆向布局时机`);
  } else if (sentiment.code <= 2) {
    reasons.push(`情绪面偏贪婪，注意风险控制`);
  }
  
  return reasons;
}

/**
 * 为尧帝大脑提供市场环境参数
 */
function getEnvironmentParams() {
  return {
    // 市场状态
    marketState: marketState.current.state.code,
    marketStateName: marketState.current.state.name,
    
    // 风险参数
    riskLevel: marketState.risk.overall,
    marketRisk: marketState.risk.market,
    
    // 情绪参数
    sentiment: marketState.current.sentiment.code,
    sentimentName: marketState.current.sentiment.name,
    
    // 决策参数
    tradingEnabled: marketState.adjustments.tradingEnabled,
    maxPositionRatio: marketState.adjustments.maxPositionRatio,
    strategyType: marketState.adjustments.strategyPreference,
    
    // 置信度
    confidence: marketState.current.confidence,
    
    // 时间戳
    timestamp: marketState.lastUpdate,
  };
}

/**
 * 保存历史记录
 */
function saveHistory() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(MARKET_HISTORY_FILE, JSON.stringify(marketState.history, null, 2));
  } catch (e) {
    console.error('[MarketAwareness] 保存历史失败:', e.message);
  }
}

/**
 * 加载历史记录
 */
function loadHistory() {
  try {
    if (fs.existsSync(MARKET_HISTORY_FILE)) {
      const data = fs.readFileSync(MARKET_HISTORY_FILE, 'utf-8');
      marketState.history = JSON.parse(data);
      console.log(`[MarketAwareness] 加载历史: ${marketState.history.length} 条记录`);
    }
  } catch (e) {
    console.error('[MarketAwareness] 加载历史失败:', e.message);
  }
}

/**
 * 初始化
 */
function initialize() {
  loadHistory();
  console.log('[MarketAwareness] 市场感知模块已初始化');
}

// ═══════════════════════════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════════════════════════

export {
  MARKET_STATES,
  SENTIMENT_LEVELS,
  updateMarketData,
  getMarketSummary,
  getAdjustments,
  getEnvironmentParams,
  initialize,
};

export default {
  MARKET_STATES,
  SENTIMENT_LEVELS,
  updateMarketData,
  getMarketSummary,
  getAdjustments,
  getEnvironmentParams,
  initialize,
};
