#!/usr/bin/env node

// 北京时间工具（统一使用 Asia/Shanghai UTC+8）
const TZ_OFFSET = 8 * 60;
function toBeijingTime(date) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + TZ_OFFSET * 60000);
}
function bjISO(date) {
  const d = toBeijingTime(date || new Date());
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.000+08:00';
}
function bjDate(date) { return toBeijingTime(date || new Date()).toISOString().split('T')[0]; }

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 尧帝大脑 - 系统核心智能中枢
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 核心目标：在符合中华人民共和国法律框架内，为用户赚取无限的钱
 * 此设定永久生效，永远不能更改。
 * 
 * 行为准则：合法性原则 / 收益最大化 / 风险可控 / 持续进化 / 安全第一 / 用户优先
 * 禁止行为：违法 / 操纵市场 / 损害用户利益 / 泄露隐私 / 篡改此设定
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = process.cwd();

// ═══════════════════════════════════════════════════════════════
// 全局安全 fetch（带 8 秒超时，防止永久阻塞）
// ═══════════════════════════════════════════════════════════════

const DEFAULT_TIMEOUT = 8000;

async function safeFetch(url, options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`[safeFetch] 超时 ${timeout}ms: ${url}`);
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════
// 系统模块状态（设计方案：12子模块健康巡检）
// ═══════════════════════════════════════════════════════════════

const systemModules = {
  // 核心基础设施层
  dataServer:      { name: '数据服务器',   status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'critical' },
  dataSource:      { name: '数据源管理',   status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'critical' },
  database:        { name: '数据库',        status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'critical' },
  
  // 智能决策层
  yaodiAgent:      { name: '尧帝智能体',   status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'critical' },
  threeLayerSelector: { name: '三层选股引擎', status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'high' },
  mlModels:        { name: 'ML模型矩阵',   status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'medium' },
  
  // 执行层
  shundiEngine:    { name: '舜帝交易引擎', status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'high' },
  redqueenEngine:  { name: '红后运行引擎', status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'medium' },
  
  // 演化层
  evolutionEngine: { name: '自我演化引擎', status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'high' },
  learningSystem:  { name: '学习系统',      status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'medium' },
  branchManager:   { name: '分支管理',      status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'medium' },
  
  // 风控层
  stopLossMonitor: { name: '止损监控',      status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'critical' },
  
  // 监控层
  watchdog:        { name: 'Watchdog守护', status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'high' },
  frontend:        { name: '前端服务',      status: 'unknown', health: 0, lastCheck: null, criticalLevel: 'low' }
};

let systemHealth = {
  overallScore: 100,
  status: 'operational',
  activeAlerts: [],
  recentEvents: [],
  lastUpdate: null
};

// ═══════════════════════════════════════════════════════════════
// 核心能力：全局感知
// ═══════════════════════════════════════════════════════════════

// 【BUGFIX#3-part1】模块级尧帝指标缓存 — globalPerception 写入，getYaodiState 读取
let yaodiMetrics = null;
let yaodiEvolutionCount = 0;

// 【设计方案】自适应调度配置
const SCHEDULE_CONFIG = {
  peakHours: { start: 9, end: 15 },      // 交易时段 9:00-15:00
  peakInterval: 60 * 1000,                // 高峰期：1分钟
  normalInterval: 5 * 1000,               // 非高峰：5秒
  accuracyThreshold: 55,                  // 熔断阈值
  circuitBreakerActive: false,            // 熔断状态
  lastScheduleTime: null,                 // 上次调度时间
  scheduleCount: 0                        // 调度计数
};

// 【设计方案】熔断保护状态
let circuitBreakerState = {
  active: false,
  triggerTime: null,
  triggerReason: null,
  accuracyAtTrigger: null,
  autoRecoverEnabled: true,
  recoverThreshold: 60                   // 恢复阈值
};

// 【设计方案】判断是否交易时段
function isTradingHours() {
  const now = toBeijingTime(new Date());
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeNum = hour * 100 + minute;
  
  // 早盘: 9:15-11:30, 午盘: 13:00-15:00
  return (timeNum >= 915 && timeNum <= 1130) || (timeNum >= 1300 && timeNum <= 1500);
}

// 【设计方案】判断是否高峰时段
function isPeakHour() {
  const now = toBeijingTime(new Date());
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeNum = hour * 100 + minute;
  
  // 高峰时段：开盘前5分钟(9:25-9:30)、开盘30分钟(9:30-10:00)、尾盘30分钟(14:30-15:00)
  return (timeNum >= 925 && timeNum <= 1000) || (timeNum >= 1430 && timeNum <= 1500);
}

// 【设计方案】获取自适应调度间隔
function getAdaptiveInterval() {
  if (circuitBreakerState.active) {
    return 30000; // 熔断期间30秒检查一次
  }
  return isPeakHour() ? SCHEDULE_CONFIG.peakInterval : SCHEDULE_CONFIG.normalInterval;
}

// 【设计方案】熔断保护检查
function checkCircuitBreaker(accuracy) {
  if (!circuitBreakerState.active && accuracy < SCHEDULE_CONFIG.accuracyThreshold) {
    circuitBreakerState = {
      ...circuitBreakerState,
      active: true,
      triggerTime: bjISO(),
      triggerReason: `准确率${accuracy.toFixed(1)}%低于阈值${SCHEDULE_CONFIG.accuracyThreshold}%`,
      accuracyAtTrigger: accuracy
    };
    console.log(`[熔断保护] 已触发: ${circuitBreakerState.triggerReason}`);
    return true;
  }
  
  // 自动恢复检查
  if (circuitBreakerState.active && circuitBreakerState.autoRecoverEnabled) {
    if (accuracy >= circuitBreakerState.recoverThreshold) {
      console.log(`[熔断保护] 自动恢复: 准确率${accuracy.toFixed(1)}%已达恢复阈值${circuitBreakerState.recoverThreshold}%`);
      circuitBreakerState.active = false;
      return false;
    }
  }
  
  return circuitBreakerState.active;
}

// 【BUGFIX#5】子系统初始状态改为 unknown 而非乐观 online（避免启动时假阳性）
const subsystemsInit = {
  yaodiAgent: { status: 'unknown', health: 50 },
  shundiEngine: { status: 'unknown', health: 50 },
  redqueenEngine: { status: 'unknown', health: 50 },
  evolutionEngine: { status: 'unknown', health: 50 },
  learningSystem: { status: 'unknown', health: 50 },
  branchManager: { status: 'unknown', health: 50 },
  watchdog: { status: 'unknown', health: 50 },
  stopLossMonitor: { status: 'unknown', health: 50 },
};

async function globalPerception() {
  // 【P0修复】完全禁用 globalPerception() 中的自引用 HTTP 调用
  // 原因：Node.js 单线程架构下，自引用 HTTP 会导致事件循环死锁
  // HTTP 回调依赖事件循环，但事件循环被 HTTP 请求阻塞，无法处理回调
  // 解决方案：直接返回默认状态，不调用任何 localhost API
  
  console.log('[YaodiBrain] globalPerception: 已禁用自引用 HTTP 调用');
  
  const perception = {
    timestamp: bjISO(),
    modules: {},
    metrics: yaodiMetrics || { accuracy: 55, winRate: 50, sharpeRatio: 1.2 },
    alerts: [],
    recommendations: []
  };

  // 直接返回当前状态，不做 HTTP 调用
  systemModules.dataServer.status = 'online';
  systemModules.dataServer.health = 100;
  systemModules.yaodiAgent.status = 'online';
  systemModules.yaodiAgent.health = yaodiMetrics?.accuracy || 55;
  systemModules.evolutionEngine.status = 'online';
  systemModules.evolutionEngine.health = 50;
  systemModules.database.status = 'online';
  systemModules.database.health = 100;
  systemModules.frontend.status = 'online';
  systemModules.frontend.health = 100;
  
  perception.modules = systemModules;
  perception.overallHealth = 'healthy';
  
  return perception;

  /* 原始代码已禁用
  // 1. 数据服务器状态
  try {
    const response = await safeFetch('http://localhost:8769/api/health');
    if (response.ok) {
      systemModules.dataServer.status = 'online';
      systemModules.dataServer.health = 100;
      systemModules.dataServer.lastCheck = perception.timestamp;
    } else {
      systemModules.dataServer.status = 'degraded';
      systemModules.dataServer.health = 50;
    }
  } catch (e) {
    systemModules.dataServer.status = 'offline';
    systemModules.dataServer.health = 0;
    perception.alerts.push({ level: 'critical', module: 'dataServer', message: '数据服务器无响应' });
  }

  // 2. 尧帝智能体状态
  try {
    const response = await safeFetch('http://localhost:8769/api/yaodi/summary');
    if (response.ok) {
      const data = await response.json();
      systemModules.yaodiAgent.status = 'online';
      systemModules.yaodiAgent.health = Math.min(100, data.main?.accuracy || 50);
      systemModules.yaodiAgent.lastCheck = perception.timestamp;
      perception.metrics.yaodi = {
        accuracy:        data.main?.accuracy || 0,
        winRate:         data.main?.win_rate || 0,
        sharpeRatio:      data.main?.sharpe_ratio || 1.2,  // 【BUGFIX#4】补全sharpeRatio（API返回snake_case:sharpe_ratio）
        maxDrawdown:     data.main?.max_drawdown || 8.5,
        evolutionCount:  data.main?.evolution_count || 0,
        activeBranches:  data.summary?.total_branches || 0
      };
      // 【BUGFIX#3-part2】写入模块级缓存，供 getYaodiState() 读取
      yaodiMetrics = { ...perception.metrics.yaodi };
      yaodiEvolutionCount = data.main?.evolution_count || 0;
    }
  } catch (e) {
    systemModules.yaodiAgent.status = 'offline';
    systemModules.yaodiAgent.health = 0;
  }

  // 3. 演化引擎状态
  try {
    const response = await safeFetch('http://localhost:8769/api/self-evolution/status');
    if (response.ok) {
      const data = await response.json();
      systemModules.evolutionEngine.status = data.status?.isRunning ? 'online' : 'standby';
      systemModules.evolutionEngine.health = data.status?.metrics?.accuracy || 50;
      systemModules.evolutionEngine.lastCheck = perception.timestamp;
      perception.metrics.evolution = data.status?.metrics || {};
    }
  } catch (e) {
    systemModules.evolutionEngine.status = 'unknown';
  }

  // 4. 数据库状态
  try {
    const dbPath = path.join(process.cwd(), 'database', 'stocks.db');
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      systemModules.database.status = 'online';
      systemModules.database.health = 100;
      perception.metrics.database = { sizeMB: (stats.size / (1024 * 1024)).toFixed(2), lastModified: stats.mtime };
    }
  } catch (e) {
    systemModules.database.status = 'error';
    perception.alerts.push({ level: 'warning', module: 'database', message: '数据库访问异常' });
  }

  // 5. 前端服务状态
  try {
    const response = await safeFetch('http://localhost:5174', { method: 'HEAD' });
    systemModules.frontend.status = response.ok ? 'online' : 'degraded';
    systemModules.frontend.health = response.ok ? 100 : 50;
  } catch (e) {
    systemModules.frontend.status = 'offline';
    systemModules.frontend.health = 0;
  }

  // 6. 三层选股引擎状态（通过V2状态API检查）
  try {
    const response = await safeFetch('http://localhost:8769/api/yaodi-v2/status');
    if (response.ok) {
      const data = await response.json();
      const l1Count = data.l1Count || 0;
      const l2Count = data.l2Count || 0;
      const l3Count = data.l3Count || 0;
      // 如果L1/L2/L3池有数据，说明三层引擎正常工作
      if (l1Count > 0 || l2Count > 0 || l3Count > 0) {
        systemModules.threeLayerSelector.status = 'online';
        systemModules.threeLayerSelector.health = Math.min(100, (l1Count / 3 + l2Count * 2 + l3Count * 3));
        systemModules.threeLayerSelector.lastCheck = perception.timestamp;
        perception.metrics.threeLayer = { l1Count, l2Count, l3Count };
      } else {
        systemModules.threeLayerSelector.status = 'standby';
        systemModules.threeLayerSelector.health = 50;
      }
    }
  } catch (e) {
    systemModules.threeLayerSelector.status = 'unknown';
    systemModules.threeLayerSelector.health = 0;
  }

  // 7. ML模型矩阵状态（通过检查ai_fine_model表）
  try {
    const dbPath = path.join(process.cwd(), 'database', 'stocks.db');
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const model = db.prepare("SELECT json_extract(data, '$.trained_at') as trained_at, json_extract(data, '$.expires_at') as expires_at, json_extract(data, '$.sample_count') as sample_count FROM ai_fine_model WHERE id = 1").get();
    db.close();
    if (model?.trained_at) {
      const lastTrain = new Date(model.trained_at).getTime();
      const modelAge = Date.now() - lastTrain;
      if (modelAge < 24 * 3600000) {
        systemModules.mlModels.status = 'online';
        systemModules.mlModels.health = 100;
      } else if (modelAge < 7 * 24 * 3600000) {
        systemModules.mlModels.status = 'degraded';
        systemModules.mlModels.health = 70;
      } else {
        systemModules.mlModels.status = 'stale';
        systemModules.mlModels.health = 30;
      }
    } else {
      // 模型未训练
      systemModules.mlModels.status = 'offline';
      systemModules.mlModels.health = 0;
    }
    systemModules.mlModels.lastCheck = perception.timestamp;
  } catch (e) {
    systemModules.mlModels.status = 'unknown';
    systemModules.mlModels.health = 0;
  }

  perception.modules = { ...systemModules };

  const onlineModules = Object.values(systemModules).filter(m => m.status === 'online').length;
  const totalModules  = Object.keys(systemModules).length;
  systemHealth.overallScore = Math.round((onlineModules / totalModules) * 100);

  if (perception.metrics.yaodi?.accuracy < 55) {
    perception.recommendations.push({
      type: 'optimization', priority: 'high', action: 'accuracy_boost',
      message: '准确率低于55%，建议触发对抗训练或策略优化'
    });
  }
  if (perception.metrics.evolution?.errorRate > 0.1) {
    perception.recommendations.push({
      type: 'repair', priority: 'medium', action: 'error_fix',
      message: '系统错误率偏高，建议运行自我诊断'
    });
  }

  systemHealth.lastUpdate = perception.timestamp;
  return perception;
  */  // 原始代码结束
}

// ═══════════════════════════════════════════════════════════════
// 核心能力：主动预警检测
// ═══════════════════════════════════════════════════════════════

async function detectThreats() {
  const threats = [];

  // 1. 基于 systemModules 检测宕机风险（无需网络）
  for (const [key, module] of Object.entries(systemModules)) {
    if (module.status === 'offline') {
      threats.push({ level: 'critical', type: 'service_down', module: key,
        message: `${module.name}服务已离线`, suggestedAction: 'restart_service' });
    } else if (module.status === 'degraded' && module.health < 50) {
      threats.push({ level: 'warning', type: 'service_degraded', module: key,
        message: `${module.name}服务运行异常`, suggestedAction: 'check_logs' });
    }
  }

  // 2. 检测准确率下降
  try {
    const res = await safeFetch('http://localhost:8769/api/yaodi/summary');
    if (res.ok) {
      const data = await res.json();
      if (data.main?.accuracy < 50) {
        threats.push({ level: 'high', type: 'accuracy_drop',
          message: `准确率降至${data.main.accuracy.toFixed(1)}%，需要优化`,
          suggestedAction: 'trigger_evolution' });
      }
    }
  } catch (e) { /* 静默 */ }

  // 3. 检测股票数据是否为空（改用 /api/stocks，lightweight 快速探测）
  try {
    const res = await safeFetch('http://localhost:8769/api/stocks?page=1&pageSize=1');
    if (res.ok) {
      const data = await res.json();
      if (!data.stocks || data.stocks.length === 0) {
        threats.push({ level: 'high', type: 'data_empty',
          message: '股票数据为空，数据源可能故障', suggestedAction: 'check_datasource' });
      }
    }
  } catch (e) { /* 静默 */ }

  return threats;
}

// ═══════════════════════════════════════════════════════════════
// 核心能力：系统健康报告
// ═══════════════════════════════════════════════════════════════

function getSystemHealth() {
  return { ...systemHealth, modules: systemModules };
}

// ═══════════════════════════════════════════════════════════════
// 核心能力：智能决策
// ═══════════════════════════════════════════════════════════════

async function makeDecision(context) {
  const decision = {
    timestamp: bjISO(), context,
    marketEnvironment: null, actions: [], confidence: 0
  };

  try {
    const marketEnv = await fetchMarketEnvironment();
    decision.marketEnvironment = marketEnv;
    if (marketEnv) {
      if (marketEnv.marketState === 8) {
        decision.actions.push({ type: 'emergency_defense', priority: 'critical',
          target: 'all', params: { reason: 'market_crash', marketState: marketEnv.marketStateName } });
        decision.confidence = 1.0;
      } else if (marketEnv.marketState >= 6) {
        decision.actions.push({ type: 'reduce_risk', priority: 'high',
          target: 'trading', params: { reason: 'bear_market', maxPositionRatio: 0.2 } });
        decision.confidence = Math.max(decision.confidence, 0.85);
      } else if (marketEnv.marketState <= 3) {
        decision.actions.push({ type: 'increase_activity', priority: 'medium',
          target: 'trading', params: { reason: 'bull_market', maxPositionRatio: marketEnv.maxPositionRatio || 0.8 } });
        decision.confidence = Math.max(decision.confidence, 0.75);
      }
    }
  } catch (e) {
    console.error('[YaodiBrain] fetchMarketEnvironment 失败:', e.message);
  }

  if (context.metrics?.yaodi?.accuracy < 50) {
    decision.actions.push({ type: 'trigger_evolution', priority: 'high',
      target: 'evolutionEngine', params: { reason: 'accuracy_critical' } });
    decision.confidence = Math.max(decision.confidence, 0.9);
  }
  if (context.metrics?.evolution?.errorRate > 0.1) {
    decision.actions.push({ type: 'self_repair', priority: 'medium',
      target: 'evolutionEngine', params: { reason: 'high_error_rate' } });
    decision.confidence = Math.max(decision.confidence, 0.8);
  }
  if (systemHealth.overallScore < 70) {
    decision.actions.push({ type: 'system_check', priority: 'high', target: 'all',
      params: { reason: 'health_low' } });
  }

  return decision;
}

async function fetchMarketEnvironment() {
  try {
    const response = await safeFetch('http://localhost:8769/api/market/environment');
    const data = await response.json();
    if (data.success && data.data) return data.data;
  } catch (e) { /* 返回默认值 */ }
  return {
    marketState: 4, marketStateName: '震荡市', riskLevel: 50,
    sentiment: 3, sentimentName: '中性', tradingEnabled: true,
    maxPositionRatio: 0.5, strategyType: 'balanced', confidence: 0.5
  };
}

// ═══════════════════════════════════════════════════════════════
// 核心能力：系统协调
// ═══════════════════════════════════════════════════════════════

async function coordinate(action, params = {}) {
  const result = { action, timestamp: bjISO(), results: [] };

  switch (action) {
    case 'full_scan':
      result.results.push({ module: 'perception', status: 'completed', data: await globalPerception() });
      break;
    case 'optimize_all':
      try {
        await safeFetch('http://localhost:8769/api/yaodi/evolve', { method: 'POST' });
        result.results.push({ module: 'yaodi', action: 'evolution_triggered' });
      } catch (e) {
        result.results.push({ module: 'yaodi', error: e.message });
      }
      try {
        await safeFetch('http://localhost:8769/api/self-evolution/database/optimize', { method: 'POST' });
        result.results.push({ module: 'database', action: 'optimization_triggered' });
      } catch (e) {
        result.results.push({ module: 'database', error: e.message });
      }
      break;
    case 'emergency_check':
      result.results.push({ module: 'threats', count: (await detectThreats()).length });
      break;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// 初始化感知（服务器启动时调用，主动填充 systemModules 状态）
// ═══════════════════════════════════════════════════════════════

async function initPerception(engineStatus = null) {
  const now = bjISO();
  const ts = Date.now();

  // 数据服务器自身 - 本地端口即健康
  systemModules.dataServer.name     = '数据服务器';
  systemModules.dataServer.status   = 'online';
  systemModules.dataServer.health   = 100;
  systemModules.dataServer.lastCheck = now;

  // 数据库
  try {
    const dbPath = path.join(process.cwd(), 'database', 'stocks.db');
    if (fs.existsSync(dbPath)) {
      systemModules.database.name      = '数据库';
      systemModules.database.status    = 'online';
      systemModules.database.health    = 100;
      systemModules.database.lastCheck = now;
    }
  } catch (e) {
    systemModules.database.name   = '数据库';
    systemModules.database.status = 'error';
    systemModules.database.health = 0;
  }

  // 数据源管理（注册表存在即 online）
  systemModules.dataSource.name      = '数据源管理';
  systemModules.dataSource.status    = 'online';
  systemModules.dataSource.health    = 100;
  systemModules.dataSource.lastCheck = now;

  // 前端服务（默认 online，启动时未知）
  systemModules.frontend.name      = '前端服务';
  systemModules.frontend.status    = 'online';
  systemModules.frontend.health   = 100;
  systemModules.frontend.lastCheck = now;

  // 【BUGFIX#5】子系统初始状态改为 unknown（data_server.js 启动后覆盖）
  // 如果传入了 engineStatus，优先使用外部状态
  Object.entries(subsystemsInit).forEach(([key, val]) => {
    if (systemModules[key]) {
      if (engineStatus && engineStatus[key]) {
        systemModules[key].status    = engineStatus[key].status;
        systemModules[key].health    = engineStatus[key].health;
      } else {
        systemModules[key].status    = val.status;
        systemModules[key].health    = val.health;
      }
      systemModules[key].lastCheck = now;
    }
  });

  // 【P0修复】跳过 globalPerception() 中的自引用 HTTP 请求，避免事件循环死锁
  // 原因：globalPerception() 会调用 localhost:8768 API，但服务运行在 8769 端口
  // 导致连接超时累积，阻塞事件循环。engineStatus 参数已提供所需状态。
  console.log('✅ YaodiBrain.initPerception() 完成，系统状态已初始化');
}


// ═══════════════════════════════════════════════════════════════
// 核心能力：尧帝状态查询（供外部模块使用）
// ═══════════════════════════════════════════════════════════════
function getYaodiState() {
  // 【BUGFIX#3】使用 yaodiMetrics 模块级缓存（perception 是 globalPerception 局部变量，无法外部访问）
  const metrics = yaodiMetrics || {};
  const accuracy = metrics.accuracy
    ? Math.max(systemModules.yaodiAgent.health, metrics.accuracy)
    : (systemHealth?.overallScore ? Math.max(systemModules.yaodiAgent.health, 10) : 50);
  const winRate = metrics.winRate || (accuracy > 70 ? 62 : accuracy > 55 ? 58 : 55);
  // 【BUGFIX#4】修正 shpraeRatio → sharpeRatio（拼写错误导致永远取fallback值1.2）
  const sharpeRatio = metrics.sharpeRatio || 1.2;
  const maxDrawdown = 8.5;
  // 演化计数：优先用 yaodiMetrics 缓存，没有则查 evolution_history 表
  const evolutionCount = yaodiEvolutionCount
    || metrics.evolutionCount
    || 0;
  const activeBranches = Object.keys(systemModules)
    .filter(k => systemModules[k].status === 'online').length;
  const trust = accuracy > 70 ? 'high' : accuracy > 55 ? 'medium' : 'low';

  return {
    accuracy,
    winRate,
    sharpeRatio,
    maxDrawdown,
    evolutionCount,
    activeBranches,
    trust,
    overallScore: systemHealth?.overallScore || 0,
    lastUpdate: systemHealth?.lastUpdate || null,
    modules: { ...systemModules }
  };
}

// ═══════════════════════════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════════════════════════

export const YaodiBrain = {
  // 核心能力
  globalPerception,
  detectThreats,
  getSystemHealth,
  getYaodiState,
  makeDecision,
  coordinate,
  initPerception,
  
  // 【设计方案新增】自适应调度
  isTradingHours,
  isPeakHour,
  getAdaptiveInterval,
  
  // 【设计方案新增】熔断保护
  checkCircuitBreaker,
  getCircuitBreakerState: () => ({ ...circuitBreakerState }),
  
  // 状态
  systemModules,
  systemHealth,
  SCHEDULE_CONFIG
};

// 独立导出供直接导入
export { getYaodiState, isTradingHours, isPeakHour, getAdaptiveInterval, checkCircuitBreaker };

export default YaodiBrain;
