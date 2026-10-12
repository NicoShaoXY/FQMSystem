/**
 * FQMSystem API服务 - 完整连接后端
 * 连接所有后端API到前端
 */

let API_BASE = 'http://localhost:8769/api';

// ========== 通用请求函数 ==========

async function request(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`API请求错误 [${endpoint}]:`, error);
    throw error;
  }
}

// ========== 尧帝智能体API ==========

export const yaodiAPI = {
  // 获取尧帝状态
  getStatus: () => request('/yaodi'),
  
  // 获取详细状态
  getState: () => request('/yaodi/state'),
  
  // 获取分支列表
  getBranches: (page = 1, limit = 50) => request(`/yaodi/branches?page=${page}&limit=${limit}`),
  
  // 获取进化历史
  getEvolution: () => request('/yaodi/evolution'),
};

// ========== 对抗防御API ==========

export const defenseAPI = {
  // 获取防御状态
  getStatus: () => request('/defense/status'),
  
  // 获取防御日志
  getLogs: (limit = 50) => request(`/defense/logs?limit=${limit}`),
  
  // 获取防御统计
  getStats: () => request('/defense/stats'),
  
  // 验证输入
  validate: (data) => request('/defense/validate', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  // 检测异常
  detect: (data) => request('/defense/detect', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  // 分析模式
  analyze: (data) => request('/defense/analyze', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};

// ========== 情绪分析API ==========

export const sentimentAPI = {
  // 获取整体情绪
  getSentiment: () => request('/sentiment'),
  
  // 获取新闻情绪
  getNews: () => request('/sentiment/news'),
  
  // 获取社交情绪
  getSocial: () => request('/sentiment/social'),
  
  // 获取情绪预测
  getPrediction: (code) => request(`/sentiment/prediction?code=${code}`),
  
  // 获取舆情热点
  getHotspot: () => request('/sentiment/hotspot'),
  
  // 获取情绪指数
  getIndex: () => request('/sentiment/index'),
  
  // 获取单只股票情绪
  getStockSentiment: (code) => request(`/sentiment/stock/${code}`),
};

// ========== 投资组合API ==========

export const portfolioAPI = {
  // 获取组合
  getPortfolio: () => request('/portfolio'),
  
  // 获取资产配置
  getAllocations: () => request('/portfolio/allocations'),
  
  // 获取风险评估
  getRisk: () => request('/portfolio/risk'),
  
  // 获取业绩表现
  getPerformance: (period = '1M') => request(`/portfolio/performance?period=${period}`),
  
  // 执行再平衡
  rebalance: () => request('/portfolio/rebalance', {
    method: 'POST',
  }),
};

// ========== 回测API ==========

export const backtestAPI = {
  // 获取回测列表
  getList: () => request('/backtest'),
  
  // 运行回测
  run: (params) => request('/backtest/run', {
    method: 'POST',
    body: JSON.stringify(params),
  }),
  
  // 获取回测结果
  getResult: (id) => request(`/backtest/${id}`),
};

// ========== 通知API ==========

export const notificationAPI = {
  // 获取通知列表
  getList: (limit = 50) => request(`/notifications?limit=${limit}`),
  
  // 发送通知
  send: (data) => request('/notifications/send', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  // 获取配置
  getConfig: () => request('/notifications/config'),
  
  // 更新配置
  updateConfig: (config) => request('/notifications/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  }),
};

// ========== 风险API ==========

export const riskAPI = {
  // 获取风险状态
  getStatus: () => request('/risk/status'),
  
  // 获取风险告警
  getAlerts: (limit = 50) => request(`/risk/alerts?limit=${limit}`),
  
  // 执行风险评估
  assess: (data) => request('/risk/assess', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  
  // 获取风险限额
  getLimits: () => request('/risk/limits'),
};

// ========== 市场API ==========

export const marketAPI = {
  // 获取市场统计
  getStats: () => request('/stats'),
  
  // 获取指数
  getIndices: () => request('/indices'),
  
  // 获取股票列表
  getStocks: (limit = 100, market = 'ALL') => request(`/stocks?limit=${limit}&market=${market}`),
  
  // 获取单只股票
  getStock: (code) => request(`/stock/${code}`),
  
  // 获取收藏股
  getStockPool: () => request('/stock-pool'),
};

// ========== 导出所有API ==========

export default {
  yaodi: yaodiAPI,
  defense: defenseAPI,
  sentiment: sentimentAPI,
  portfolio: portfolioAPI,
  backtest: backtestAPI,
  notification: notificationAPI,
  risk: riskAPI,
  market: marketAPI,
};

// ========== 主力资金API ==========

export const mainFlowAPI = {
  getHistory: (code, days = 30) => request(`/main-flow/${code}?days=${days}`),
  getMinFlow: (code) => request(`/main-flow/${code}/min`),
  sync: (codes = []) => request("/main-flow/sync", { method: "POST", body: JSON.stringify({ codes }) }),
};
