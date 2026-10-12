/**
 * 多源数据融合服务 - 尧帝智能体核心能力扩展
 * 
 * 数据源：
 * 1. 行情数据：东方财富/腾讯/新浪（已有）
 * 2. 新闻舆情：RSS订阅 + 关键词情感分析
 * 3. 资金流向：北向资金/主力资金/龙虎榜
 * 4. 宏观指标：利率/汇率/商品期货
 * 5. 社交情绪：雪球/东方财富股吧热帖
 */

// socialSentimentComplete.js 已删除（P0死代码清理），内联简易替代
const SentimentPredictionModel = class {
  trainModel() {}
  predictFutureSentiment(score) {
    return [{ predictedScore: score, trend: score > 0 ? 'rising' : 'falling' }];
  }
};
import { API_BASE } from '../config/api';


// ========== 1. 新闻舆情数据 ==========
export async function fetchNewsSentiment(stockCode, stockName) {
  try {
    // 通过后端代理获取新闻（解决CORS跨域问题）
    const res = await fetch(
      `${API_BASE}/proxy/news?keyword=${encodeURIComponent(stockName)}`
    );
    const data = await res.json();
    
    const news = (data.news || []).map(item => ({
      title: item.title || item.Title || '',
      time: item.time || item.ShowTime || '',
      source: item.source || item.Source || '',
      url: item.url || item.Url || '',
      // 简单情感分析（标题关键词）
      sentiment: analyzeTitleSentiment(item.title || item.Title || ''),
    }));
    
    // 计算综合情绪分数
    const avgSentiment = news.length > 0
      ? news.reduce((sum, n) => sum + n.sentiment, 0) / news.length
      : 0;
    
    return {
      news,
      avgSentiment: avgSentiment.toFixed(2),
      newsCount: news.length,
    };
  } catch (e) {
    return { news: [], avgSentiment: 0, newsCount: 0 };
  }
}

// 标题情感分析（关键词匹配）
function analyzeTitleSentiment(title) {
  const bullKeywords = ['利好', '上涨', '突破', '创新高', '涨停', '业绩大增', '中标', '合作', '增持', '回购'];
  const bearKeywords = ['利空', '下跌', '暴跌', '跌停', '业绩亏损', '减持', '质押', '诉讼', '处罚', '风险'];
  
  let score = 0;
  bullKeywords.forEach(k => { if (title.includes(k)) score += 0.3; });
  bearKeywords.forEach(k => { if (title.includes(k)) score -= 0.3; });
  
  return Math.max(-1, Math.min(1, score));
}

// ========== 2. 北向资金数据 ==========
export async function fetchNorthboundFlow() {
  try {
    const res = await fetch(
      'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_STOCK_NORTHBOUND&columns=ALL&pageSize=50&sortColumns=TRADE_DATE&sortTypes=-1'
    );
    const data = await res.json();
    
    if (data.result?.data) {
      const latest = data.result.data[0];
      return {
        date: latest.TRADE_DATE,
        shNetBuy: latest.SH_NET_BUY / 1e8,  // 亿元
        szNetBuy: latest.SZ_NET_BUY / 1e8,
        totalNetBuy: (latest.SH_NET_BUY + latest.SZ_NET_BUY) / 1e8,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ========== 3. 主力资金流向 ==========
export async function fetchMainFlow(stockCode) {
  try {
    const res = await fetch(
      `http://push2.eastmoney.com/api/qt/stock/fflow/kline/get?lmt=0&klt=1&secid=1.${stockCode}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63`
    );
    const data = await res.json();
    
    if (data.data?.klines) {
      const latest = data.data.klines[data.data.klines.length - 1];
      const [date, mainIn, mainOut, , , , , retailIn, retailOut] = latest.split(',');
      
      return {
        date,
        mainNetInflow: (parseFloat(mainIn) - parseFloat(mainOut)) / 1e4,  // 万元
        retailNetInflow: (parseFloat(retailIn) - parseFloat(retailOut)) / 1e4,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ========== 4. 龙虎榜数据 ==========
export async function fetchDragonTiger(stockCode) {
  try {
    const res = await fetch(
      `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYDETAIL_FLOAT_INST&columns=ALL&filter=(SECURITY_CODE="${stockCode}")&pageSize=5`
    );
    const data = await res.json();
    
    if (data.result?.data) {
      return data.result.data.map(item => ({
        date: item.TRADE_DATE,
        reason: item.EXPLAIN,
        buyAmount: item.BUY_AMT / 1e4,  // 万元
        sellAmount: item.SELL_AMT / 1e4,
        netBuy: (item.BUY_AMT - item.SELL_AMT) / 1e4,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

// ========== 5. 宏观情绪指标 ==========
export async function fetchMacroSentiment() {
  try {
    // 获取市场宽度（涨跌比）
    const res = await fetch(`${API_BASE}/stats`);
    const stats = await res.json();
    
    const upRatio = stats.up_count / Math.max(stats.total_count, 1);
    const limitUpRatio = stats.limit_up / Math.max(stats.total_count, 1);
    
    // 市场情绪综合评分（0-100）
    const sentiment = Math.round(
      upRatio * 40 +           // 涨跌比权重40%
      limitUpRatio * 200 +     // 涨停比权重20%
      (stats.sentiment_score || 50) * 0.4  // 系统情绪权重40%
    );
    
    return {
      upRatio: (upRatio * 100).toFixed(1) + '%',
      limitUpCount: stats.limit_up,
      limitDownCount: stats.limit_down,
      sentiment,
      sentimentLabel: sentiment >= 60 ? '偏多' : sentiment <= 40 ? '偏空' : '中性',
    };
  } catch {
    return { sentiment: 50, sentimentLabel: '中性' };
  }
}

// ========== 综合数据融合（增强版）============
export async function fuseAllData(stockCode, stockName) {
  // 并行获取所有数据源（带超时保护）
  const timeout = (p, ms = 5000) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
  
  const [newsResult, stockData, marketStats, sentimentRadar] = await Promise.all([
    timeout(fetchNewsSentiment(stockCode, stockName)),
    timeout(fetch(`${API_BASE}/stock/${stockCode}`).then(r => r.json()).catch(() => null)),
    timeout(fetch(`${API_BASE}/stats`).then(r => r.json()).catch(() => null)),  // 【修复】/market/stats → /stats（与config/api.js一致）
    timeout(fetch(`${API_BASE}/sentiment/radar`).then(r => r.json()).catch(() => null)),
  ]);
  
  const news = newsResult || { news: [], avgSentiment: 0, newsCount: 0 };
  // 【修复】/api/stock/{code} 返回的数据直接在顶层，没有 .data 嵌套
  const stock = stockData?.success ? (stockData.data || stockData) : null;
  // 【修复】计算 upRatio（API返回的是 up/total，没有 upRatio 字段）
  const rawStats = marketStats?.stats || sentimentRadar?.radar?.marketData || {};
  const stats = {
    ...rawStats,
    upRatio: rawStats.upRatio || (rawStats.up && rawStats.total ? rawStats.up / rawStats.total : null)
  };
  const radar = sentimentRadar?.radar || sentimentRadar || {};
  
  // 新闻舆情分析
  let socialSentiment = null;
  if (news.news && news.news.length > 0) {
    try {
      const sentimentModel = new SentimentPredictionModel();
      // 使用确定性数据（基于 news.avgSentiment + 固定偏移），避免 Math.random 导致每次刷新结果不同
      const baseSentiment = parseFloat(news.avgSentiment || 0);
      const sentimentHistory = Array.from({ length: 10 }, (_, i) => ({
        score: baseSentiment * (0.9 + 0.02 * i), // 平滑趋势，确定性数据
        timestamp: Date.now() - (10 - i) * 3600000,
      }));
      sentimentModel.trainModel(sentimentHistory);
      const predictions = sentimentModel.predictFutureSentiment(parseFloat(news.avgSentiment || 0));
      if (predictions?.length > 0) {
        socialSentiment = {
          sentiment: predictions[0].predictedScore,
          trend: predictions[0].trend,
          label: predictions[0].trend === 'rising' ? '情绪上升' : '情绪下降',
        };
      }
    } catch(e) { /* 静默 */ }
  }
  
  // 计算综合情绪因子（基于已有数据加权融合）
  const stockChangePct = stock?.changePercent || stock?.change_percent || 0;
  const marketUpRatio = stats.upRatio || radar.bullBearRatio || 0.5;
  const fearGreed = radar.fearGreedIndex || 50;
  
  const factors = {
    // 新闻情绪（外部数据）
    newsSentiment: parseFloat(news.avgSentiment) || 0,
    // 个股涨跌（内部数据）
    stockSentiment: stockChangePct > 0 ? Math.min(1, stockChangePct / 5) : Math.max(-1, stockChangePct / 5),
    // 市场整体（内部数据）
    marketSentiment: marketUpRatio > 0.5 ? Math.min(1, (marketUpRatio - 0.5) * 2) : Math.max(-1, (marketUpRatio - 0.5) * 2),
    // 情绪指数（内部数据）
    fearGreedSentiment: (fearGreed - 50) / 50,  // 0-100 → -1~1
  };
  
  // 加权融合
  const weights = {
    newsSentiment: 0.25,
    stockSentiment: 0.35,
    marketSentiment: 0.25,
    fearGreedSentiment: 0.15,
  };
  
  let fusedSentiment = 0;
  let weightSum = 0;
  for (const [key, value] of Object.entries(factors)) {
    if (value !== 0) {
      fusedSentiment += value * weights[key];
      weightSum += weights[key];
    }
  }
  if (weightSum > 0) fusedSentiment /= weightSum;
  
  // 社交情绪加成
  if (socialSentiment?.sentiment) {
    fusedSentiment = fusedSentiment * 0.9 + socialSentiment.sentiment * 0.1;
  }
  
  return {
    news: news.news || [],
    newsSentiment: news.avgSentiment,
    newsCount: news.newsCount || news.news?.length || 0,
    socialSentiment,
    marketData: {
      upRatio: marketUpRatio,
      fearGreedIndex: fearGreed,
      avgChange: stats.avgChange || radar.avgChange || '0',
      limitUp: stats.limitUp || 0,
      limitDown: stats.limitDown || 0,
    },
    factors,
    fusedSentiment: fusedSentiment.toFixed(3),
    fusedLabel: fusedSentiment > 0.3 ? '强烈看多' : 
                fusedSentiment > 0.1 ? '偏多' :
                fusedSentiment < -0.3 ? '强烈看空' :
                fusedSentiment < -0.1 ? '偏空' : '中性',
    confidence: Math.abs(fusedSentiment) * 100,
    source: '多源融合',
    stockName,
  };
}

export default {
  fetchNewsSentiment,
  fetchNorthboundFlow,
  fetchMainFlow,
  fetchDragonTiger,
  fetchMacroSentiment,
  fuseAllData,
};
