/**
 * 真实数据服务层
 * 统一管理所有前端数据源,替代 mockData
 */
import { bjISO } from '../utils/beijingTime';

let API_BASE = 'http://localhost:8769/api';

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

export const formatNumber = (num, decimals = 2) => {
  if (num === null || num === undefined) return '--';
  return Number(num).toFixed(decimals);
};

export const formatPercent = (num) => {
  if (num === null || num === undefined) return '--';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${Number(num).toFixed(2)}%`;
};

export const formatWan = (num) => {
  if (num === null || num === undefined) return '--';
  if (Math.abs(num) >= 100000000) return (num / 100000000).toFixed(2) + '亿';
  if (Math.abs(num) >= 10000) return (num / 10000).toFixed(2) + '万';
  return num.toFixed(0);
};

export const formatYi = (num) => {
  if (num === null || num === undefined) return '--';
  if (Math.abs(num) >= 100000000) return (num / 100000000).toFixed(2) + '亿';
  if (Math.abs(num) >= 10000) return (num / 10000).toFixed(0) + '万';
  return num.toString();
};

export const getPriceColor = (change) => {
  if (change > 0) return '#f5222d';
  if (change < 0) return '#52c41a';
  return '#8c8c8c';
};

export const getSentimentLevel = (score) => {
  if (score < 20) return { label: '极度低迷', color: '#52c41a', bg: 'rgba(82,196,26,0.15)' };
  if (score < 40) return { label: '低迷', color: '#95de64', bg: 'rgba(149,222,100,0.15)' };
  if (score < 60) return { label: '中性', color: '#faad14', bg: 'rgba(250,173,20,0.15)' };
  if (score < 80) return { label: '活跃', color: '#ff7a45', bg: 'rgba(255,122,69,0.15)' };
  return { label: '极度狂热', color: '#f5222d', bg: 'rgba(245,34,45,0.15)' };
};

// ═══════════════════════════════════════════════════════════════
// 市场数据 API
// ═══════════════════════════════════════════════════════════════

/**
 * 获取市场统计数据
 */
export async function fetchMarketStats() {
  try {
    const response = await fetch(`${API_BASE}/stats`);
    const data = await response.json();
    if (data.success) {
      return {
        total: data.stats.total,
        limitUp: data.stats.limitUp,
        limitDown: data.stats.limitDown,
        up: data.stats.up,
        down: data.stats.down,
        flat: data.stats.flat,
        sentiment: data.stats.sentiment,
        northFlow: data.stats.northFlow,
      };
    }
    return null;
  } catch (e) {
    console.error('获取市场统计失败:', e);
    return null;
  }
}

/**
 * 获取三大指数数据
 */
export async function fetchIndices() {
  try {
    const response = await fetch(`${API_BASE}/indices`);
    const data = await response.json();
    if (data.success && data.indices) {
      return data.indices.map(idx => ({
        code: idx.code,
        name: idx.name,
        price: idx.price,
        change: idx.change,
        changePercent: idx.changePercent || (idx.preClose ? ((idx.price - idx.preClose) / idx.preClose * 100) : 0),
        volume: idx.volume,
        amount: idx.amount,
        preClose: idx.preClose,
        high: idx.high,
        low: idx.low,
        open: idx.open,
      }));
    }
    return null;
  } catch (e) {
    console.error('获取指数数据失败:', e);
    return null;
  }
}

/**
 * 获取个股涨跌分布（真实数据）
 */
export async function fetchStockDistribution() {
  try {
    const response = await fetch(`${API_BASE}/market/distribution`);
    const data = await response.json();
    if (data.success) {
      const dist = data.distribution;
      return {
        limitUp: dist.limitUp || 0,
        up7: dist.up7 || 0,
        up3to7: dist.up3to7 || 0,
        up0to3: dist.up0to3 || 0,
        down0to3: dist.down0to3 || 0,
        down3to7: dist.down3to7 || 0,
        down7: dist.down7 || 0,
        limitDown: dist.limitDown || 0,
        upDownCount: data.upDownCount
      };
    }
    return null;
  } catch (e) {
    console.error('获取涨跌分布失败:', e);
    return null;
  }
}

/**
 * 获取北向资金数据
 */
export async function fetchNorthFlow() {
  try {
    const response = await fetch(`${API_BASE}/capital/flow`);
    const data = await response.json();
    if (data.success) {
      return {
        northNetIn: data.north?.netIn || 0,
        northForce: data.north?.force || '观望',
        southNetIn: data.south?.netIn || 0,
        southForce: data.south?.force || '观望',
      };
    }
    // 降级从stats获取
    const statsRes = await fetch(`${API_BASE}/stats`);
    const statsData = await statsRes.json();
    if (statsData.success) {
      return {
        northNetIn: statsData.stats.northFlow || 0,
        northForce: '数据加载中',
        southNetIn: 0,
        southForce: '数据加载中',
      };
    }
    return null;
  } catch (e) {
    console.error('获取北向资金失败:', e);
    return null;
  }
}

/**
 * 获取板块数据
 */
export async function fetchSectors() {
  try {
    const response = await fetch(`${API_BASE}/sectors`);
    const data = await response.json();
    if (data.success && data.sectors) {
      return data.sectors.map(s => ({
        name: s.name,
        change: s.change || s.avgChange || 0,
        stocks: s.stockCount || s.count || 0,
        leader: s.leader || '',
        amount: s.amount || 0,
      }));
    }
    return null;
  } catch (e) {
    console.error('获取板块数据失败:', e);
    return null;
  }
}

/**
 * 获取涨幅榜
 */
export async function fetchTopGainers(limit = 20) {
  try {
    const response = await fetch(`${API_BASE}/stocks?sort=change&order=desc&limit=${limit}`);
    const data = await response.json();
    if (data.success && data.stocks) {
      return data.stocks.map(s => ({
        code: s.code,
        name: s.name,
        price: s.price,
        changePercent: s.changePercent || s.change,
        volume: s.volume,
        amount: s.amount,
        turnover: s.turnoverRate || s.turnover,
        high: s.high,
        low: s.low,
        open: s.open,
        preClose: s.preClose,
      }));
    }
    return [];
  } catch (e) {
    console.error('获取涨幅榜失败:', e);
    return [];
  }
}

/**
 * 获取跌幅榜
 */
export async function fetchTopLosers(limit = 20) {
  try {
    const response = await fetch(`${API_BASE}/stocks?sort=change&order=asc&limit=${limit}`);
    const data = await response.json();
    if (data.success && data.stocks) {
      return data.stocks.map(s => ({
        code: s.code,
        name: s.name,
        price: s.price,
        changePercent: s.changePercent || s.change,
        volume: s.volume,
        amount: s.amount,
        turnover: s.turnoverRate || s.turnover,
      }));
    }
    return [];
  } catch (e) {
    console.error('获取跌幅榜失败:', e);
    return [];
  }
}

/**
 * 获取换手率榜
 */
export async function fetchTopTurnover(limit = 20) {
  try {
    const response = await fetch(`${API_BASE}/stocks?sort=turnover&order=desc&limit=${limit}`);
    const data = await response.json();
    if (data.success && data.stocks) {
      return data.stocks.map(s => ({
        code: s.code,
        name: s.name,
        price: s.price,
        changePercent: s.changePercent || s.change,
        turnover: s.turnoverRate || s.turnover,
        volume: s.volume,
      }));
    }
    return [];
  } catch (e) {
    console.error('获取换手率榜失败:', e);
    return [];
  }
}

/**
 * 获取振幅榜
 */
export async function fetchTopAmplitude(limit = 20) {
  try {
    const response = await fetch(`${API_BASE}/stocks?sort=amplitude&order=desc&limit=${limit}`);
    const data = await response.json();
    if (data.success && data.stocks) {
      return data.stocks.map(s => ({
        code: s.code,
        name: s.name,
        price: s.price,
        changePercent: s.changePercent || s.change,
        amplitude: s.amplitude,
        high: s.high,
        low: s.low,
      }));
    }
    return [];
  } catch (e) {
    console.error('获取振幅榜失败:', e);
    return [];
  }
}

/**
 * 获取股票列表
 */
export async function fetchStockList(page = 1, pageSize = 50) {
  try {
    const response = await fetch(`${API_BASE}/stocks?page=${page}&limit=${pageSize}`);
    const data = await response.json();
    if (data.success) {
      return {
        stocks: data.stocks || [],
        total: data.total || 0,
        page: data.page || page,
        pageSize: data.pageSize || pageSize,
      };
    }
    return { stocks: [], total: 0, page, pageSize };
  } catch (e) {
    console.error('获取股票列表失败:', e);
    return { stocks: [], total: 0, page, pageSize };
  }
}

/**
 * 获取单只股票详情
 */
export async function fetchStockDetail(code) {
  try {
    const response = await fetch(`${API_BASE}/stock/${code}`);
    const data = await response.json();
    if (data.success) {
      return data.stock || data; // 兼容两种返回格式：data.stock 或顶层对象
    }
    return null;
  } catch (e) {
    console.error('获取股票详情失败:', e);
    return null;
  }
}

/**
 * 获取股票分时数据
 */
export async function fetchIntradayData(code) {
  try {
    const response = await fetch(`${API_BASE}/stock/${code}/intraday`);
    const data = await response.json();
    if (data.success) {
      return data.data || [];
    }
    return [];
  } catch (e) {
    console.error('获取分时数据失败:', e);
    return [];
  }
}

/**
 * 获取K线数据
 */
export async function fetchKlineData(code, period = 'day', count = 60) {
  try {
    const response = await fetch(`${API_BASE}/stock/${code}/kline?period=${period}&count=${count}`);
    const data = await response.json();
    if (data.success) {
      return data.data || [];
    }
    return [];
  } catch (e) {
    console.error('获取K线数据失败:', e);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 用户数据 API
// ═══════════════════════════════════════════════════════════════

/**
 * 获取用户持仓
 */
export async function fetchUserHoldings() {
  try {
    const response = await fetch(`${API_BASE}/holding/list`);
    const data = await response.json();
    if (data.success) {
      return data.holdings || [];
    }
    return [];
  } catch (e) {
    console.error('获取持仓失败:', e);
    return [];
  }
}

/**
 * 获取用户资金配置
 */
export async function fetchCapitalConfig() {
  try {
    const response = await fetch(`${API_BASE}/capital/config`);
    const data = await response.json();
    if (data.success) {
      return data.config;
    }
    return null;
  } catch (e) {
    console.error('获取资金配置失败:', e);
    return null;
  }
}

/**
 * 获取股票池
 */
export async function fetchStockPool() {
  try {
    const response = await fetch(`${API_BASE}/pool/list`);
    const data = await response.json();
    if (data.success) {
      return data.pool || [];
    }
    return [];
  } catch (e) {
    console.error('获取股票池失败:', e);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 尧帝智能体 API
// ═══════════════════════════════════════════════════════════════

/**
 * 获取尧帝摘要
 */
export async function fetchYaodiSummary() {
  try {
    const response = await fetch(`${API_BASE}/yaodi/summary`);
    const data = await response.json();
    if (data.success) {
      return {
        main: data.main,
        summary: data.summary,
        adversarial: data.adversarial,
      };
    }
    return null;
  } catch (e) {
    console.error('获取尧帝摘要失败:', e);
    return null;
  }
}

/**
 * 获取尧帝分支列表
 */
export async function fetchYaodiBranches(page = 1, pageSize = 20, type = 'all') {
  try {
    const response = await fetch(`${API_BASE}/yaodi/branches?page=${page}&pageSize=${pageSize}&type=${type}`);
    const data = await response.json();
    if (data.success) {
      return {
        branches: data.branches || [],
        total: data.total || 0,
        page: data.page || page,
        pageSize: data.pageSize || pageSize,
      };
    }
    return { branches: [], total: 0, page, pageSize };
  } catch (e) {
    console.error('获取尧帝分支失败:', e);
    return { branches: [], total: 0, page, pageSize };
  }
}

/**
 * 获取尧帝分析结果
 * 【BUG-09 FIX】原 /api/yaodi/analyze/{code} 不存在,改为调用 /api/quant/voting
 * (基于真实历史数据 + 尧帝分支投票,结果更准确)
 */
export async function fetchYaodiAnalysis(code) {
  try {
    const response = await fetch(`${API_BASE}/quant/voting?code=${encodeURIComponent(code)}`);
    const data = await response.json();
    if (data.success) {
      return {
        success: true,
        code: data.code,
        signal: data.final_signal,
        confidence: data.final_confidence,
        total_votes: data.total_votes,
        buy_votes: data.buy_votes,
        sell_votes: data.sell_votes,
        votes: data.votes,
        meta: data.meta,
      };
    }
    return { success: false, error: data.error || '分析失败' };
  } catch (e) {
    console.error('获取尧帝分析失败:', e);
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 选股系统 API
// ═══════════════════════════════════════════════════════════════

/**
 * 获取选股结果
 */
export async function fetchStockSelection(strategy = 'default') {
  try {
    const response = await fetch(`${API_BASE}/stock-selection/results?strategy=${strategy}`);
    const data = await response.json();
    if (data.success) {
      return data.results || [];
    }
    return [];
  } catch (e) {
    console.error('获取选股结果失败:', e);
    return [];
  }
}

/**
 * 执行选股
 */
export async function runStockSelection(params) {
  try {
    const response = await fetch(`${API_BASE}/stock-selection/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await response.json();
    return data;
  } catch (e) {
    console.error('执行选股失败:', e);
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 系统数据 API
// ═══════════════════════════════════════════════════════════════

/**
 * 获取系统状态
 */
export async function fetchSystemStatus() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();
    return {
      status: data.status,
      timestamp: data.timestamp,
      isPeakHour: data.isPeakHour,
    };
  } catch (e) {
    console.error('获取系统状态失败:', e);
    return { status: 'error', timestamp: bjISO() };
  }
}

/**
 * 获取数据源状态
 */
export async function fetchDataSourceStatus() {
  try {
    const response = await fetch(`${API_BASE}/datasource/status`);
    const data = await response.json();
    if (data.success) {
      return data.sources || [];
    }
    return [];
  } catch (e) {
    console.error('获取数据源状态失败:', e);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 综合市场情绪分析
// ═══════════════════════════════════════════════════════════════

/**
 * 获取市场情绪综合数据
 */
export async function fetchMarketSentiment() {
  try {
    const [statsRes, indicesRes, northRes] = await Promise.all([
      fetchMarketStats(),
      fetchIndices(),
      fetchNorthFlow(),
    ]);

    const sentiment = statsRes?.sentiment || 50;
    const level = getSentimentLevel(sentiment);

    return {
      score: sentiment,
      level: level.label,
      color: level.color,
      marketStats: statsRes ? {
        limitUp: statsRes.limitUp,
        limitDown: statsRes.limitDown,
        up: statsRes.up,
        down: statsRes.down,
        flat: statsRes.flat,
      } : null,
      indices: indicesRes,
      northFlow: northRes,
    };
  } catch (e) {
    console.error('获取市场情绪失败:', e);
    return null;
  }
}

// 导出默认对象
export default {
  // 工具函数
  formatNumber,
  formatPercent,
  formatWan,
  formatYi,
  getPriceColor,
  getSentimentLevel,

  // 市场数据
  fetchMarketStats,
  fetchIndices,
  fetchStockDistribution,
  fetchNorthFlow,
  fetchSectors,
  fetchTopGainers,
  fetchTopLosers,
  fetchTopTurnover,
  fetchTopAmplitude,
  fetchStockList,
  fetchStockDetail,
  fetchIntradayData,
  fetchKlineData,
  fetchMarketSentiment,

  // 用户数据
  fetchUserHoldings,
  fetchCapitalConfig,
  fetchStockPool,

  // 尧帝
  fetchYaodiSummary,
  fetchYaodiBranches,
  fetchYaodiAnalysis,

  // 选股
  fetchStockSelection,
  runStockSelection,

  // 系统
  fetchSystemStatus,
  fetchDataSourceStatus,
};
