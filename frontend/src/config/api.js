/**
 * API配置 - 完整版
 */
export const API_BASE = 'http://localhost:8769/api';

/**
 * 统一API调用函数
 */
export async function apiCall(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
// 数据源 API
// ═══════════════════════════════════════════════════════════════
export const datasourceAPI = {
  getStatus: () => apiCall('/datasource/status'),
  getStats: () => apiCall('/datasource/stats'),
  test: () => apiCall('/datasource/test', { method: 'POST' }),
  enable: (key) => apiCall(`/datasource/enable/${key}`, { method: 'POST' }),
  disable: (key) => apiCall(`/datasource/disable/${key}`, { method: 'POST' }),
  reset: (key) => apiCall(`/datasource/reset/${key}`, { method: 'POST' }),
  refresh: () => apiCall('/datasource/refresh', { method: 'POST' }),
};

// ═══════════════════════════════════════════════════════════════
// 舜帝 API
// ═══════════════════════════════════════════════════════════════
export const redqueenAPI = {
  getStatus: () => apiCall('/redqueen/status'),
  getQTable: () => apiCall('/redqueen/qtable'),
};

// ═══════════════════════════════════════════════════════════════
// Q-Learning API
// ═══════════════════════════════════════════════════════════════
export const learningAPI = {
  getQTable: () => apiCall('/learning/qtable'),
  train: (state, action, reward, nextState) => apiCall('/learning/train', {
    method: 'POST',
    body: JSON.stringify({ state, action, reward, nextState })
  }),
  decide: (state) => apiCall(`/learning/decide?state=${state}`),
  getHistory: () => apiCall('/learning/history'),
  getOnlineStatus: () => apiCall('/online/learning/status'),
};

// ═══════════════════════════════════════════════════════════════
// 决策 API
// ═══════════════════════════════════════════════════════════════
export const decisionAPI = {
  getEnvironment: () => apiCall('/decision/environment'),
  predict: (code) => apiCall(`/decision/predict/${code}`),
  getAutonomous: () => apiCall('/decision/autonomous'),
};

// ═══════════════════════════════════════════════════════════════
// 舆情与仓位 API
// ═══════════════════════════════════════════════════════════════
export const sentimentAPI = {
  getRadar: () => apiCall('/sentiment/radar'),
  getNews: () => apiCall('/sentiment/news'),
  getSocial: () => apiCall('/sentiment/social'),
};

export const positionAPI = {
  getEngine: () => apiCall('/position/engine'),
};

// ═══════════════════════════════════════════════════════════════
// 持仓管理 API
// ═══════════════════════════════════════════════════════════════
export const holdingAPI = {
  // 用户持仓列表（仅用户自选的 mock_holdings）
  getList: () => apiCall('/holding/list'),
  getStats: () => apiCall('/holding/stats'),
  add: (code, name, shares, costPrice) => apiCall('/holding/add', {
    method: 'POST',
    body: JSON.stringify({ code, name, shares, cost_price: costPrice })
  }),
  remove: (code, currentShares) => apiCall('/holding/remove', {
    method: 'POST',
    body: JSON.stringify({ code })
  }),
  update: (code, updates) => apiCall('/holding/update', {
    method: 'POST',
    body: JSON.stringify({ code, ...updates })
  }),
  getRiskAnalysis: () => apiCall('/holding/risk-analysis'),
};

// ═══════════════════════════════════════════════════════════════
// 股票 API
// ═══════════════════════════════════════════════════════════════
export const stockAPI = {
  get: (code) => apiCall(`/stock/${code}`),
  search: (query, limit = 20) => apiCall(`/search?q=${encodeURIComponent(query)}&limit=${limit}`),
  getAll: () => apiCall('/stocks'),
};

// ═══════════════════════════════════════════════════════════════
// 历史数据 API
// ═══════════════════════════════════════════════════════════════
export const historyAPI = {
  get: (code, days = 100) => apiCall(`/history/${code}?days=${days}`),
  getStats: () => apiCall('/history/stats'),
};

// ═══════════════════════════════════════════════════════════════
// 技术指标 API
// ═══════════════════════════════════════════════════════════════
export const indicatorAPI = {
  get: (code) => apiCall(`/indicator/${code}`),
};

// ═══════════════════════════════════════════════════════════════
// 尧帝/演化 API
// ═══════════════════════════════════════════════════════════════
export const yaodiAPI = {
  get: (page = 1, pageSize = 50, lightweight = false) => apiCall(`/yaodi?page=${page}&pageSize=${pageSize}${lightweight ? '&lightweight=1' : ''}`),
  getTech: () => apiCall('/yaodi?tech=1&pageSize=1'),
  getStrategy: () => apiCall('/yaodi?strategy=1&pageSize=1'),
  getSummary: () => apiCall('/yaodi/summary'),
  save: (branch) => apiCall('/yaodi/save', {
    method: 'POST',
    body: JSON.stringify(branch)
  }),
  getConfidence: (ids) => apiCall(`/yaodi/confidence?ids=${ids.join(',')}`),
  getVersionHistory: () => apiCall('/yaodi/version-history'),
  analyzeStock: (code) => apiCall(`/quant/voting?code=${encodeURIComponent(code)}`),
  branchAction: (branchId, action) => apiCall(`/yaodi/branch/${branchId}/${action}`, { method: 'POST' }),
};

export const evolutionAPI = {
  getStatus: () => apiCall('/evolution/status'),
  getLogs: () => apiCall('/evolution/logs'),
  getStats: () => apiCall('/evolution/stats'),
  getComprehensive: () => apiCall('/evolution/comprehensive'),
  getMasters: () => apiCall('/evolution/masters'),
  getEnvReport: () => apiCall('/evolution/env-report'),
  start: () => apiCall('/evolution/start', { method: 'POST' }),
  stop: () => apiCall('/evolution/stop', { method: 'POST' }),
  restart: () => apiCall('/evolution/restart', { method: 'POST' }),
  setSpeed: (speed) => apiCall('/evolution/speed', {
    method: 'POST',
    body: JSON.stringify({ speed })
  }),
  crossover: (ids) => apiCall('/evolution/crossover', {
    method: 'POST',
    body: JSON.stringify({ branchIds: ids })
  }),
  distill: () => apiCall('/evolution/distill', { method: 'POST' }),
  simulate: (params) => apiCall('/evolution/simulate', {
    method: 'POST',
    body: JSON.stringify(params)
  }),
  getPerformance: () => apiCall('/evolution/performance'),
  getRealLogs: () => apiCall('/evolution/real-logs'),
  getAdversarialReport: () => apiCall('/evolution/adversarial/report'),
  getOpsStatus: () => apiCall('/evolution/ops/status'),
  optimize: (params) => apiCall('/evolution/optimize', {
    method: 'POST',
    body: JSON.stringify(params)
  }),
  getAdaptive: () => apiCall('/evolution/adaptive'),
  cycle: () => apiCall('/evolution/cycle', { method: 'POST' }),
};

export const branchAPI = {
  validate: (id) => apiCall(`/branch/validate/${id}`),
  validateAll: () => apiCall('/branch/validate_all', { method: 'POST' }),
  cleanup: () => apiCall('/branch/cleanup', { method: 'POST' }),
  getDisabled: () => apiCall('/branch/disabled'),
  get: (id) => apiCall(`/evolution/branch/${id}`),
  evolve: (id) => apiCall('/branch/evolve', {
    method: 'POST',
    body: JSON.stringify({ branchId: id })
  }),
  disable: (id) => apiCall('/branch/disable', {
    method: 'POST',
    body: JSON.stringify({ branchId: id })
  }),
};

// ═══════════════════════════════════════════════════════════════
// API_收藏股
// ═══════════════════════════════════════════════════════════════
export const poolAPI = {
  getList: () => apiCall('/pool/list'),
  add: (code, name, reason) => apiCall('/pool/add', {
    method: 'POST',
    body: JSON.stringify({ code, name, reason })
  }),
  remove: (code) => apiCall('/pool/remove', {
    method: 'POST',
    body: JSON.stringify({ code })
  }),
  moveToTop: (code) => apiCall('/pool/move-to-top', {
    method: 'POST',
    body: JSON.stringify({ code })
  }),
  analyze: () => apiCall('/pool/analyze'),
  getPrices: () => apiCall('/pool/prices'),
  // 【新增 2026-05-11】收藏股实时价格+主力资金实时百分比(交易时段自动包含主力资金)
  getRealtime: () => apiCall('/pool/realtime'),
  dismissBlackSwan: (id) => apiCall(`/blackswan/dismiss?id=${encodeURIComponent(id)}`),
};

// ═══════════════════════════════════════════════════════════════
// 选股 API
// ═══════════════════════════════════════════════════════════════
export const selectionAPI = {
  save: (stocks) => apiCall('/selection/save', {
    method: 'POST',
    body: JSON.stringify({ stocks })
  }),
  load: (type, date) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (date) params.set('date', date);
    const qs = params.toString();
    return apiCall(`/selection/load${qs ? '?' + qs : ''}`);
  },
  getHistory: () => apiCall('/selection/history'),
  init: () => apiCall('/selection/init', { method: 'POST' }),
};

// ═══════════════════════════════════════════════════════════════
// 信号 API
// ═══════════════════════════════════════════════════════════════
export const signalAPI = {
  getList: () => apiCall('/signals/list'),
};

// ═══════════════════════════════════════════════════════════════
// 资金管理 API
// ═══════════════════════════════════════════════════════════════
export const capitalAPI = {
  getConfig: () => apiCall('/capital/config'),
  setConfig: (config) => apiCall('/capital/config', {
    method: 'POST',
    body: JSON.stringify(config)
  }),
  reset: () => apiCall('/capital/reset', { method: 'POST' }),
};

// ═══════════════════════════════════════════════════════════════
// 舜帝模拟盘独立API - 完全独立于持仓管理
// 初始资金5万，由舜帝自己掌控
// ═══════════════════════════════════════════════════════════════
export const shundiAPI = {
  // 资金配置
  getCapital: () => apiCall('/shundi/capital'),
  setCapital: (config) => apiCall('/shundi/capital', {
    method: 'POST',
    body: JSON.stringify(config)
  }),
  reset: () => apiCall('/shundi/reset', { method: 'POST' }),
  
  // 持仓管理
  getHoldings: () => apiCall('/shundi/holdings'),
  
  // 交易
  trade: (params) => apiCall('/shundi/trade', {
    method: 'POST',
    body: JSON.stringify(params)
  }),
  
  // 交易记录
  getTrades: (limit = 50) => apiCall(`/shundi/trades?limit=${limit}`),
  
  // 统计
  getStats: () => apiCall('/shundi/stats'),
  
  // 引擎控制（新增）
  startEngine: () => apiCall('/shundi/engine/start', { method: 'POST' }),
  stopEngine: () => apiCall('/shundi/engine/stop', { method: 'POST' }),
  getEngineStatus: () => apiCall('/shundi/engine/status'),
};

// ═══════════════════════════════════════════════════════════════
// 执行器 API
// ═══════════════════════════════════════════════════════════════
export const executorAPI = {
  getConfig: () => apiCall('/executor/config'),
  auto: () => apiCall('/executor/auto', { method: 'POST' }),
  stopLoss: (code) => apiCall('/executor/stoploss', {
    method: 'POST',
    body: JSON.stringify({ code })
  }),
  takeProfit: (code) => apiCall('/executor/takeprofit', {
    method: 'POST',
    body: JSON.stringify({ code })
  }),
};

// ═══════════════════════════════════════════════════════════════
// 智能分析 API
// ═══════════════════════════════════════════════════════════════
export const smartAPI = {
  getPrediction: () => apiCall('/smart/prediction'),
  getTiming: () => apiCall('/smart/timing'),
  getRL: () => apiCall('/smart/rl'),
  getCrossMarket: () => apiCall('/smart/crossmarket'),
};

// ═══════════════════════════════════════════════════════════════
// 黑天鹅事件 API
// ═══════════════════════════════════════════════════════════════
export const blackswanAPI = {
  getEvents: (code) => apiCall(code ? `/blackswan/events?code=${code}` : '/blackswan/events'),
  getStatus: () => apiCall('/blackswan/status'),
  dismiss: (eventId) => apiCall('/blackswan/dismiss', { method: 'POST', body: JSON.stringify({ eventId }) }),
  getHistory: (limit = 50, severity = '', type = '') => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (severity && severity !== 'ALL') params.set('severity', severity);
    if (type && type !== 'ALL') params.set('type', type);
    return apiCall(`/blackswan/history?${params.toString()}`);
  },
  trigger: () => apiCall('/blackswan/trigger', { method: 'POST' }),
  // 【修复BUG】StockSelection.jsx 调用了 getEventsForStock，添加此方法
  getEventsForStock: (code) => apiCall(`/blackswan/events?code=${code}`),
};

// ═══════════════════════════════════════════════════════════════
// 对抗训练 API
// ═══════════════════════════════════════════════════════════════
export const adversarialAPI = {
  generate: () => apiCall('/evolution/adversarial/generate', { method: 'POST' }),
  train: () => apiCall('/evolution/adversarial/train', { method: 'POST' }),
  getReport: () => apiCall('/evolution/adversarial/report'),
  test: (id) => apiCall(`/evolution/adversarial/test/${id}`),
  getTypes: () => apiCall('/evolution/adversarial/types'),
};

// ═══════════════════════════════════════════════════════════════
// 分布式演化 API
// ═══════════════════════════════════════════════════════════════
export const distributedAPI = {
  getStatus: () => apiCall('/distributed/status'),
  start: () => apiCall('/distributed/start', { method: 'POST' }),
  stop: () => apiCall('/distributed/stop', { method: 'POST' }),
  dispatch: (params) => apiCall('/distributed/dispatch', {
    method: 'POST',
    body: JSON.stringify(params || {})
  }),
  clear: () => apiCall('/distributed/clear', { method: 'POST' }),
};

// ═══════════════════════════════════════════════════════════════
// ML模型 API
// ═══════════════════════════════════════════════════════════════
export const mlModelsAPI = {
  get: () => apiCall('/ml/models'),
  getModel: (id) => apiCall(`/ml/model/${id}`),
};

// ═══════════════════════════════════════════════════════════════
// 组合优化 API
// ═══════════════════════════════════════════════════════════════
export const portfolioAPI = {
  optimize: () => apiCall('/portfolio/optimize'),
  runOptimize: (params) => apiCall('/portfolio/optimize', {
    method: 'POST',
    body: JSON.stringify(params)
  }),
};

// ═══════════════════════════════════════════════════════════════
// 系统管理 API
// ═══════════════════════════════════════════════════════════════
export const systemAPI = {
  healthCheck: () => apiCall('/system/health_check'),
  selfHeal: () => apiCall('/system/self_heal', { method: 'POST' }),
  validateData: () => apiCall('/data/validate'),
};

// ═══════════════════════════════════════════════════════════════
// 演化引擎 API（SystemManagement.jsx 直接导入 evolutionAPI）
// ═══════════════════════════════════════════════════════════════
// 注: evolutionAPI 已在下方定义，此处仅为注释说明

// ═══════════════════════════════════════════════════════════════
// 市场数据 API
// ═══════════════════════════════════════════════════════════════
export const marketAPI = {
  getStats: () => apiCall('/market/stats'),
  getIndices: () => apiCall('/indices'),
  fetch: () => apiCall('/fetch'),
};

// ═══════════════════════════════════════════════════════════════
// 验证 API
// ═══════════════════════════════════════════════════════════════
export const validationAPI = {
  getHistory: () => apiCall('/validation/history'),
  getSSE: () => apiCall('/validation/sse'),
  getSZSE: () => apiCall('/validation/szse'),
};

// ═══════════════════════════════════════════════════════════════
// 健康检查 API
// ═══════════════════════════════════════════════════════════════
export const healthAPI = {
  get: () => apiCall('/health'),
};

// ═══════════════════════════════════════════════════════════════
// 批量置信度 API
// ═══════════════════════════════════════════════════════════════
export const batchConfidenceAPI = {
  get: () => apiCall('/yaodi/batch_confidence'),
  getForCode: (code, change = 0) => apiCall(`/yaodi/confidence?code=${encodeURIComponent(code)}&change=${change}`),
};
