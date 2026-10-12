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
 * 本地AI引擎 - LocalAI Engine v1.0.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 自给自足的AI代码生成引擎，无需外部API依赖。
 * 
 * 核心能力：
 * 1. 代码模板引擎 - 基于模式匹配生成代码
 * 2. 规则推理系统 - 基于尧帝代码库的规则推理
 * 3. 自我学习机制 - 从历史修改中学习最佳实践
 * 4. 代码智能补全 - 基于上下文的智能补全
 * 5. 错误诊断修复 - 自动诊断并修复常见错误
 * 
 * 底层设定：在符合中华人民共和国法律框架内，为用户赚取无限的钱
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // 知识库路径
  knowledgeBase: path.join(PROJECT_ROOT, '.ai_knowledge'),
  templatesPath: path.join(PROJECT_ROOT, '.ai_knowledge', 'templates'),
  rulesPath: path.join(PROJECT_ROOT, '.ai_knowledge', 'rules.json'),
  historyPath: path.join(PROJECT_ROOT, '.ai_knowledge', 'modifications.json'),
  learningPath: path.join(PROJECT_ROOT, '.ai_knowledge', 'learned_patterns.json'),
  
  // 生成配置
  maxCodeLength: 50000,
  temperature: 0.7, // 创造性程度 (0-1)
  
  // 自学习配置
  minSamplesForPattern: 3, // 形成模式需要的最小样本数
  maxPatterns: 1000, // 最大模式数量
};

// ═══════════════════════════════════════════════════════════════
// 核心数据结构
// ═══════════════════════════════════════════════════════════════

/**
 * 代码模板库 - 内置常见模式
 */
const CODE_TEMPLATES = {
  // ════════════════════════════════════════════════════════════
  // API路由模板
  // ════════════════════════════════════════════════════════════
  api_route: {
    pattern: /创建.*路由|添加.*API|新建.*接口|API.*endpoint/i,
    generate: (params) => `// ${params.description || 'API路由'}
router.${params.method || 'get'}('${params.path || '/api/endpoint'}', async (req, res) => {
  try {
    const ${params.dataVar || 'data'} = req.${params.method === 'post' ? 'body' : 'query'};
    
    // 参数验证
    if (!${params.dataVar || 'data'}${params.requiredField ? `.${params.requiredField}` : ''}) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    
    // 业务逻辑
    ${params.logic || '// TODO: 实现业务逻辑'}
    
    res.json({ success: true, ${params.resultVar || 'result'} });
  } catch (error) {
    console.error('[${params.name || 'API'}] 错误:', error);
    res.status(500).json({ error: error.message });
  }
});`,
    examples: [
      { description: '用户登录API', method: 'post', path: '/api/login', dataVar: 'credentials' },
      { description: '获取数据列表', method: 'get', path: '/api/data/list', dataVar: 'params' },
    ]
  },
  
  // ════════════════════════════════════════════════════════════
  // 数据库操作模板
  // ════════════════════════════════════════════════════════════
  db_query: {
    pattern: /数据库.*查询|DB.*操作|增删改查|CRUD/i,
    generate: (params) => `// 数据库操作 - ${params.operation || '查询'}
async function ${params.functionName || 'dbOperation'}(${params.params || 'params'}) {
  const db = new Database('${params.dbPath || './data.db'}');
  
  try {
    ${params.operation === 'insert' ? `
    const stmt = db.prepare(\`INSERT INTO ${params.table || 'table'} (${params.columns || 'columns'}) VALUES (${params.values || '?'})\`);
    const result = stmt.run(${params.data || 'data'});
    return { success: true, id: result.lastInsertRowid };
    ` : params.operation === 'update' ? `
    const stmt = db.prepare(\`UPDATE ${params.table || 'table'} SET ${params.setClause || 'field = ?'} WHERE ${params.whereClause || 'id = ?'}\`);
    const result = stmt.run(${params.data || 'data'});
    return { success: true, changes: result.changes };
    ` : params.operation === 'delete' ? `
    const stmt = db.prepare(\`DELETE FROM ${params.table || 'table'} WHERE ${params.whereClause || 'id = ?'}\`);
    const result = stmt.run(${params.id || 'id'});
    return { success: true, deleted: result.changes };
    ` : `
    const stmt = db.prepare(\`SELECT ${params.selectFields || '*'} FROM ${params.table || 'table'} WHERE ${params.whereClause || '1=1'}\`);
    const results = stmt.all(${params.bindings || ''});
    return results;
    `}
  } catch (error) {
    console.error('[DB] 操作失败:', error);
    throw error;
  } finally {
    db.close();
  }
}`,
    examples: [
      { operation: '查询', table: 'users', functionName: 'getUsers' },
      { operation: 'insert', table: 'trades', functionName: 'insertTrade' },
    ]
  },
  
  // ════════════════════════════════════════════════════════════
  // 错误处理模板
  // ════════════════════════════════════════════════════════════
  error_handler: {
    pattern: /错误处理|异常捕获|try.*catch|错误日志/i,
    generate: (params) => `// 错误处理 - ${params.context || '通用'}
class ${params.className || 'ErrorHandler'} {
  static handle(error, context = {}) {
    const errorInfo = {
      timestamp: bjISO(),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      context,
      severity: this.getSeverity(error)
    };
    
    // 记录错误日志
    this.log(errorInfo);
    
    // 根据错误类型决定处理方式
    if (error.code === 'ECONNREFUSED') {
      return { retry: true, message: '连接失败，将重试' };
    }
    if (error.code === 'SQLITE_ERROR') {
      return { retry: false, message: '数据库错误' };
    }
    
    return { retry: false, message: error.message };
  }
  
  static getSeverity(error) {
    if (error.code?.startsWith('E')) return 'CRITICAL';
    if (error.message?.includes('timeout')) return 'WARNING';
    return 'ERROR';
  }
  
  static log(errorInfo) {
    const logFile = '${params.logFile || './logs/errors.log'}';
    const logLine = JSON.stringify(errorInfo) + '\\n';
    fs.appendFileSync(logFile, logLine);
  }
}

// 全局异常处理
process.on('uncaughtException', (error) => {
  ErrorHandler.handle(error, { type: 'uncaughtException' });
});

process.on('unhandledRejection', (reason, promise) => {
  ErrorHandler.handle(new Error(reason), { type: 'unhandledRejection', promise });
});`,
    examples: [
      { context: 'API错误处理', className: 'APIErrorHandler' },
      { context: '交易系统错误处理', className: 'TradeErrorHandler' },
    ]
  },
  
  // ════════════════════════════════════════════════════════════
  // 定时任务模板
  // ════════════════════════════════════════════════════════════
  scheduler: {
    pattern: /定时.*任务|定时器|schedule|cron|周期.*执行/i,
    generate: (params) => `// 定时任务 - ${params.name || '定时执行'}
class ${params.className || 'Scheduler'} {
  constructor() {
    this.tasks = new Map();
    this.running = false;
  }
  
  /**
   * 添加定时任务
   * @param {string} name - 任务名称
   * @param {number} interval - 间隔时间(毫秒)
   * @param {Function} task - 任务函数
   */
  addTask(name, interval, task) {
    this.tasks.set(name, { interval, task, timer: null });
    console.log(\`[Scheduler] 添加任务: \${name}, 间隔: \${interval}ms\`);
  }
  
  /**
   * 启动所有任务
   */
  start() {
    if (this.running) return;
    this.running = true;
    
    for (const [name, task] of this.tasks) {
      task.timer = setInterval(async () => {
        try {
          console.log(\`[Scheduler] 执行任务: \${name}\`);
          await task.task();
        } catch (error) {
          console.error(\`[Scheduler] 任务执行失败 [\${name}]:\`, error);
        }
      }, task.interval);
    }
    
    console.log(\`[Scheduler] 已启动 \${this.tasks.size} 个任务\`);
  }
  
  /**
   * 停止所有任务
   */
  stop() {
    this.running = false;
    for (const [name, task] of this.tasks) {
      if (task.timer) {
        clearInterval(task.timer);
        task.timer = null;
      }
    }
    console.log('[Scheduler] 已停止所有任务');
  }
}

// 使用示例
const scheduler = new Scheduler();
scheduler.addTask('${params.taskName || 'dailyCheck'}', ${params.interval || '60000'}, async () => {
  ${params.taskLogic || '// TODO: 任务逻辑'}
});`,
    examples: [
      { name: '数据同步', interval: 300000, taskName: 'syncData' },
      { name: '健康检查', interval: 60000, taskName: 'healthCheck' },
    ]
  },
  
  // ════════════════════════════════════════════════════════════
  // 数据分析模板
  // ════════════════════════════════════════════════════════════
  data_analysis: {
    pattern: /数据分析|统计.*计算|指标.*计算|分析.*数据/i,
    generate: (params) => `// 数据分析 - ${params.name || '通用分析'}
class ${params.className || 'DataAnalyzer'} {
  /**
   * 计算移动平均
   */
  static movingAverage(data, period) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / period;
      result.push(avg);
    }
    return result;
  }
  
  /**
   * 计算标准差
   */
  static standardDeviation(data) {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const squareDiffs = data.map(value => Math.pow(value - mean, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / data.length;
    return Math.sqrt(avgSquareDiff);
  }
  
  /**
   * 计算涨跌幅
   */
  static changeRate(current, previous) {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }
  
  /**
   * 寻找极值点
   */
  static findExtremes(data, threshold = 2) {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const std = this.standardDeviation(data);
    
    return data.map((value, index) => ({
      index,
      value,
      isExtreme: Math.abs(value - mean) > threshold * std
    })).filter(item => item.isExtreme);
  }
  
  /**
   * 自定义分析: ${params.analysisName || '数据分析'}
   */
  static ${params.functionName || 'analyze'}(data) {
    ${params.analysisLogic || `
    const stats = {
      count: data.length,
      sum: data.reduce((a, b) => a + b, 0),
      mean: data.reduce((a, b) => a + b, 0) / data.length,
      min: Math.min(...data),
      max: Math.max(...data)
    };
    return stats;
    `}
  }
}`,
    examples: [
      { name: '股票数据分析', className: 'StockAnalyzer' },
      { name: '交易数据分析', className: 'TradeAnalyzer' },
    ]
  },
  
  // ════════════════════════════════════════════════════════════
  // 监控告警模板
  // ════════════════════════════════════════════════════════════
  monitor: {
    pattern: /监控|告警|alert|monitor|健康检查/i,
    generate: (params) => `// 系统监控 - ${params.name || '通用监控'}
class ${params.className || 'Monitor'} {
  constructor() {
    this.metrics = new Map();
    this.alerts = [];
    this.thresholds = ${JSON.stringify(params.thresholds || { cpu: 80, memory: 85, latency: 1000 })};
  }
  
  /**
   * 记录指标
   */
  recordMetric(name, value, tags = {}) {
    const metric = {
      name,
      value,
      tags,
      timestamp: Date.now()
    };
    
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name).push(metric);
    
    // 检查是否需要告警
    this.checkThreshold(name, value);
  }
  
  /**
   * 检查阈值
   */
  checkThreshold(name, value) {
    const threshold = this.thresholds[name];
    if (threshold && value > threshold) {
      this.alert({
        type: 'threshold_exceeded',
        metric: name,
        value,
        threshold,
        severity: 'WARNING'
      });
    }
  }
  
  /**
   * 发送告警
   */
  alert(alertInfo) {
    const alert = {
      ...alertInfo,
      timestamp: bjISO(),
      id: crypto.randomUUID()
    };
    
    this.alerts.push(alert);
    console.warn(\`[ALERT] \${alert.type}: \${alert.metric}=\${alert.value}\`);
    
    ${params.onAlert || '// TODO: 告警处理逻辑'}
  }
  
  /**
   * 获取系统健康状态
   */
  getHealth() {
    return {
      status: this.alerts.filter(a => a.severity === 'CRITICAL').length > 0 ? 'unhealthy' : 'healthy',
      metrics: Object.fromEntries(this.metrics),
      recentAlerts: this.alerts.slice(-10)
    };
  }
}`,
    examples: [
      { name: '服务监控', className: 'ServiceMonitor' },
      { name: '交易监控', className: 'TradeMonitor' },
    ]
  },
  
  // ════════════════════════════════════════════════════════════
  // 缓存模板
  // ════════════════════════════════════════════════════════════
  cache: {
    pattern: /缓存|cache|内存缓存|LRU/i,
    generate: (params) => `// 缓存管理 - ${params.name || '通用缓存'}
class ${params.className || 'Cache'} {
  constructor(maxSize = ${params.maxSize || 1000}, ttl = ${params.ttl || 3600000}) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl; // 默认缓存时间(毫秒)
    this.hits = 0;
    this.misses = 0;
  }
  
  /**
   * 获取缓存
   */
  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      this.misses++;
      return null;
    }
    
    // 检查是否过期
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    
    this.hits++;
    return item.value;
  }
  
  /**
   * 设置缓存
   */
  set(key, value, customTtl) {
    // 如果超过最大大小，删除最旧的
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, {
      value,
      expiry: Date.now() + (customTtl || this.ttl)
    });
  }
  
  /**
   * 删除缓存
   */
  delete(key) {
    return this.cache.delete(key);
  }
  
  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
  
  /**
   * 获取缓存统计
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : 'N/A'
    };
  }
}`,
    examples: [
      { name: 'API响应缓存', className: 'ResponseCache', maxSize: 500 },
      { name: '数据缓存', className: 'DataCache', ttl: 1800000 },
    ]
  },
  
  // ════════════════════════════════════════════════════════════
  // 工具函数模板
  // ════════════════════════════════════════════════════════════
  utils: {
    pattern: /工具.*函数|utils|helper|辅助函数/i,
    generate: (params) => `// 工具函数库
const Utils = {
  /**
   * 格式化日期
   */
  formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
    const d = new Date(date);
    const map = {
      'YYYY': d.getFullYear(),
      'MM': String(d.getMonth() + 1).padStart(2, '0'),
      'DD': String(d.getDate()).padStart(2, '0'),
      'HH': String(d.getHours()).padStart(2, '0'),
      'mm': String(d.getMinutes()).padStart(2, '0'),
      'ss': String(d.getSeconds()).padStart(2, '0')
    };
    return format.replace(/YYYY|MM|DD|HH|mm|ss/g, match => map[match]);
  },
  
  /**
   * 深拷贝
   */
  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
    
    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }
    return cloned;
  },
  
  /**
   * 防抖
   */
  debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },
  
  /**
   * 节流
   */
  throttle(fn, delay) {
    let lastTime = 0;
    return function(...args) {
      const now = bjDate();
      if (now - lastTime >= delay) {
        lastTime = now;
        return fn.apply(this, args);
      }
    };
  },
  
  /**
   * 生成唯一ID
   */
  generateId(prefix = '') {
    return prefix + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  },
  
  /**
   * 延迟执行
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  
  /**
   * 重试函数
   */
  async retry(fn, maxRetries = 3, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await this.sleep(delay * Math.pow(2, i));
      }
    }
  }
};

export default Utils;`,
    examples: []
  },
  
  // ════════════════════════════════════════════════════════════
  // 交易策略模板
  // ════════════════════════════════════════════════════════════
  trading_strategy: {
    pattern: /交易.*策略|买卖.*信号|策略.*实现|trading.*strategy/i,
    generate: (params) => `// 交易策略 - ${params.name || '基础策略'}
class ${params.className || 'TradingStrategy'} {
  constructor(config = {}) {
    this.config = {
      stopLoss: config.stopLoss || 0.05,      // 止损比例
      takeProfit: config.takeProfit || 0.1,   // 止盈比例
      maxPosition: config.maxPosition || 0.3,  // 最大仓位
      ...config
    };
    this.positions = new Map();
  }
  
  /**
   * 分析市场信号
   */
  analyzeSignal(marketData) {
    const { price, volume, ma5, ma20, rsi } = marketData;
    
    const signals = {
      buy: false,
      sell: false,
      strength: 0,
      reasons: []
    };
    
    // 均线交叉
    if (ma5 > ma20) {
      signals.buy = true;
      signals.reasons.push('MA5上穿MA20');
      signals.strength += 30;
    } else if (ma5 < ma20) {
      signals.sell = true;
      signals.reasons.push('MA5下穿MA20');
      signals.strength += 30;
    }
    
    // RSI指标
    if (rsi < 30) {
      signals.buy = true;
      signals.reasons.push('RSI超卖');
      signals.strength += 20;
    } else if (rsi > 70) {
      signals.sell = true;
      signals.reasons.push('RSI超买');
      signals.strength += 20;
    }
    
    ${params.customLogic || '// TODO: 添加自定义策略逻辑'}
    
    return signals;
  }
  
  /**
   * 计算仓位
   */
  calculatePosition(capital, price, risk) {
    const riskAmount = capital * risk;
    const position = Math.min(riskAmount / price, this.config.maxPosition * capital / price);
    return Math.floor(position);
  }
  
  /**
   * 检查止损止盈
   */
  checkStopLossTakeProfit(position, currentPrice) {
    const pnl = (currentPrice - position.entryPrice) / position.entryPrice;
    
    if (pnl <= -this.config.stopLoss) {
      return { action: 'stop_loss', pnl };
    }
    if (pnl >= this.config.takeProfit) {
      return { action: 'take_profit', pnl };
    }
    
    return { action: 'hold', pnl };
  }
}`,
    examples: [
      { name: '趋势跟踪策略', className: 'TrendFollowingStrategy' },
      { name: '均值回归策略', className: 'MeanReversionStrategy' },
    ]
  }
};

/**
 * 错误修复规则库
 */
const FIX_RULES = [
  // ════════════════════════════════════════════════════════════
  // JavaScript/Node.js 常见错误
  // ════════════════════════════════════════════════════════════
  {
    pattern: /TypeError:\s*(\w+)\s+is\s+not\s+a\s+function/i,
    diagnose: (match) => ({
      error: 'TYPE_ERROR_NOT_FUNCTION',
      variable: match[1],
      cause: '变量不是函数类型，可能是undefined或错误赋值',
      fix: '检查变量初始化，添加类型检查'
    }),
    fix: (code, match, diagnosis) => {
      return {
        suggestion: `// 在调用前检查变量类型
if (typeof ${diagnosis.variable} === 'function') {
  ${diagnosis.variable}();
} else {
  console.error('${diagnosis.variable} 不是函数');
}`,
        confidence: 0.9
      };
    }
  },
  
  {
    pattern: /ReferenceError:\s*(\w+)\s+is\s+not\s+defined/i,
    diagnose: (match) => ({
      error: 'REFERENCE_ERROR',
      variable: match[1],
      cause: '变量未定义或作用域问题',
      fix: '检查变量声明和作用域'
    }),
    fix: (code, match, diagnosis) => {
      return {
        suggestion: `// 确保变量已定义
const ${diagnosis.variable} = ${diagnosis.variable} || /* 默认值 */;
// 或者检查导入
// import { ${diagnosis.variable} } from '...';`,
        confidence: 0.85
      };
    }
  },
  
  {
    pattern: /Cannot\s+read\s+properties\s+of\s+undefined\s+\(reading\s+['"](\w+)['"]\)/i,
    diagnose: (match) => ({
      error: 'UNDEFINED_PROPERTY_ACCESS',
      property: match[1],
      cause: '访问了undefined对象的属性',
      fix: '添加空值检查'
    }),
    fix: (code, match, diagnosis) => {
      return {
        suggestion: `// 添加可选链操作符或空值检查
obj?.${diagnosis.property}
// 或
if (obj && obj.${diagnosis.property}) {
  // 安全访问
}`,
        confidence: 0.95
      };
    }
  },
  
  {
    pattern: /SyntaxError:\s*Unexpected\s+token/i,
    diagnose: (match) => ({
      error: 'SYNTAX_ERROR',
      cause: '语法错误，可能是括号不匹配、缺少逗号等',
      fix: '检查语法'
    }),
    fix: (code, match, diagnosis) => {
      return {
        suggestion: `// 检查以下常见问题:
// 1. 括号是否匹配
// 2. 对象/数组最后一项是否多了逗号
// 3. 字符串是否正确闭合
// 4. async/await是否成对出现`,
        confidence: 0.7
      };
    }
  },
  
  {
    pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i,
    diagnose: (match) => ({
      error: 'NETWORK_ERROR',
      cause: '网络连接失败',
      fix: '添加重试机制和错误处理'
    }),
    fix: (code, match, diagnosis) => {
      return {
        suggestion: `// 添加网络错误处理和重试
const maxRetries = 3;
let attempt = 0;
while (attempt < maxRetries) {
  try {
    const response = await fetch(url);
    return response;
  } catch (error) {
    attempt++;
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.log(\`网络错误，重试 \${attempt}/\${maxRetries}\`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    } else {
      throw error;
    }
  }
}`,
        confidence: 0.9
      };
    }
  },
  
  {
    pattern: /SQLITE_ERROR|database is locked/i,
    diagnose: (match) => ({
      error: 'DATABASE_ERROR',
      cause: '数据库操作错误或锁冲突',
      fix: '添加事务处理和重试'
    }),
    fix: (code, match, diagnosis) => {
      return {
        suggestion: `// 使用事务和错误处理
db.serialize(() => {
  db.run('BEGIN TRANSACTION');
  try {
    // 数据库操作
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
});`,
        confidence: 0.85
      };
    }
  },
  
  // ════════════════════════════════════════════════════════════
  // 内存泄漏
  // ════════════════════════════════════════════════════════════
  {
    pattern: /memory.*leak|内存泄漏|heap out of memory/i,
    diagnose: (match) => ({
      error: 'MEMORY_ISSUE',
      cause: '可能的内存泄漏',
      fix: '检查定时器和事件监听器'
    }),
    fix: (code, match, diagnosis) => {
      return {
        suggestion: `// 检查以下可能的内存泄漏源:
// 1. 未清理的定时器
clearInterval(timer);
clearTimeout(timer);

// 2. 未移除的事件监听器
eventEmitter.removeListener('event', handler);

// 3. 闭包中的循环引用
// 确保在不需要时释放引用`,
        confidence: 0.8
      };
    }
  }
];

/**
 * 代码优化规则库
 */
const OPTIMIZATION_RULES = [
  {
    name: 'async_await',
    description: '将回调地狱转换为async/await',
    pattern: /\.then\([\s\S]*?\.then\(/g,
    check: (code) => code.includes('.then(') && code.includes('.then('),
    optimize: (code) => {
      // 这是一个简化示例，实际转换需要更复杂的AST解析
      return {
        suggestion: `// 建议: 将Promise链转换为async/await
// 原代码:
fetch(url)
  .then(res => res.json())
  .then(data => processData(data))
  .catch(err => handleError(err));

// 优化后:
async function fetchData() {
  try {
    const res = await fetch(url);
    const data = await res.json();
    return processData(data);
  } catch (err) {
    handleError(err);
  }
}`,
        confidence: 0.85
      };
    }
  },
  
  {
    name: 'optional_chaining',
    description: '使用可选链替代冗长的条件判断',
    pattern: /if\s*\([^)]+&&\s*[^)]+\)\s*\{[^}]*\}/g,
    check: (code) => /if\s*\([^)]+&&\s*[^)]+\)/.test(code),
    optimize: (code) => {
      return {
        suggestion: `// 建议: 使用可选链操作符
// 原代码:
if (obj && obj.prop && obj.prop.nested) {
  return obj.prop.nested.value;
}

// 优化后:
return obj?.prop?.nested?.value;`,
        confidence: 0.9
      };
    }
  },
  
  {
    name: 'object_shorthand',
    description: '使用对象属性简写',
    pattern: /\{\s*\w+:\s*\w+\s*,/g,
    check: (code) => /\{\s*\w+:\s*\w+\s*,\s*\w+:\s*\w+/.test(code),
    optimize: (code) => {
      return {
        suggestion: `// 建议: 使用对象属性简写
// 原代码:
const obj = { name: name, age: age };

// 优化后:
const obj = { name, age };`,
        confidence: 0.95
      };
    }
  }
];

// ═══════════════════════════════════════════════════════════════
// 本地AI引擎核心类
// ═══════════════════════════════════════════════════════════════

class LocalAIEngine {
  constructor() {
    this.templates = CODE_TEMPLATES;
    this.fixRules = FIX_RULES;
    this.optimizationRules = OPTIMIZATION_RULES;
    this.learnedPatterns = [];
    this.modificationHistory = [];
    this.codeKnowledgeBase = new Map();
    
    this.init();
  }
  
  /**
   * 初始化引擎
   */
  init() {
    // 创建知识库目录
    [CONFIG.knowledgeBase, CONFIG.templatesPath].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // 加载历史数据
    this.loadLearnedPatterns();
    this.loadModificationHistory();
    
    // 分析现有代码库
    this.analyzeCodebase();
    
    console.log('[LocalAI] 引擎初始化完成');
    console.log(`[LocalAI] 模板数量: ${Object.keys(this.templates).length}`);
    console.log(`[LocalAI] 修复规则: ${this.fixRules.length}`);
    console.log(`[LocalAI] 已学习模式: ${this.learnedPatterns.length}`);
  }
  
  /**
   * 分析代码库，提取知识
   */
  analyzeCodebase() {
    const codeFiles = this.findCodeFiles(PROJECT_ROOT);
    
    for (const file of codeFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const knowledge = this.extractKnowledge(file, content);
        this.codeKnowledgeBase.set(file, knowledge);
      } catch (e) {
        // 忽略读取错误
      }
    }
    
    console.log(`[LocalAI] 已分析 ${this.codeKnowledgeBase.size} 个代码文件`);
  }
  
  /**
   * 查找代码文件
   */
  findCodeFiles(dir, files = []) {
    try {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        // 跳过隐藏目录、node_modules、应用包等
        if (item.startsWith('.') || item === 'node_modules' || item.endsWith('.app') || item.endsWith('.asar')) continue;
        
        const fullPath = path.join(dir, item);
        
        try {
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            this.findCodeFiles(fullPath, files);
          } else if (/\.(js|jsx|ts|tsx|py)$/.test(item)) {
            files.push(fullPath);
          }
        } catch (e) {
          // 忽略无法访问的文件/目录
        }
      }
    } catch (e) {
      // 忽略无法读取的目录
    }
    
    return files;
  }
  
  /**
   * 从代码中提取知识
   */
  extractKnowledge(filePath, content) {
    const ext = path.extname(filePath);
    const knowledge = {
      path: filePath,
      type: ext,
      size: content.length,
      functions: [],
      classes: [],
      imports: [],
      patterns: [],
      complexity: 0
    };
    
    if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
      // 提取函数
      const funcMatches = content.matchAll(/(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/g);
      for (const match of funcMatches) {
        knowledge.functions.push(match[1] || match[2]);
      }
      
      // 提取类
      const classMatches = content.matchAll(/class\s+(\w+)/g);
      for (const match of classMatches) {
        knowledge.classes.push(match[1]);
      }
      
      // 提取导入
      const importMatches = content.matchAll(/import\s+.*?from\s+['"]([^'"]+)['"]/g);
      for (const match of importMatches) {
        knowledge.imports.push(match[1]);
      }
      
      // 计算简单复杂度
      knowledge.complexity = (content.match(/if|for|while|switch|catch/g) || []).length;
    }
    
    return knowledge;
  }
  
  /**
   * 加载学习到的模式
   */
  loadLearnedPatterns() {
    try {
      if (fs.existsSync(CONFIG.learningPath)) {
        this.learnedPatterns = JSON.parse(fs.readFileSync(CONFIG.learningPath, 'utf-8'));
      }
    } catch (e) {
      this.learnedPatterns = [];
    }
  }
  
  /**
   * 保存学习到的模式
   */
  saveLearnedPatterns() {
    try {
      fs.writeFileSync(CONFIG.learningPath, JSON.stringify(this.learnedPatterns.slice(-CONFIG.maxPatterns), null, 2));
    } catch (e) {
      console.error('[LocalAI] 保存模式失败:', e.message);
    }
  }
  
  /**
   * 加载修改历史
   */
  loadModificationHistory() {
    try {
      if (fs.existsSync(CONFIG.historyPath)) {
        this.modificationHistory = JSON.parse(fs.readFileSync(CONFIG.historyPath, 'utf-8'));
      }
    } catch (e) {
      this.modificationHistory = [];
    }
  }
  
  /**
   * 保存修改历史
   */
  saveModificationHistory() {
    try {
      fs.writeFileSync(CONFIG.historyPath, JSON.stringify(this.modificationHistory.slice(-1000), null, 2));
    } catch (e) {
      console.error('[LocalAI] 保存历史失败:', e.message);
    }
  }
  
  // ════════════════════════════════════════════════════════════
  // 核心生成方法
  // ════════════════════════════════════════════════════════════
  
  /**
   * 根据自然语言生成代码
   * @param {string} prompt - 自然语言描述
   * @param {Object} context - 上下文信息
   */
  generate(prompt, context = {}) {
    console.log(`[LocalAI] 生成请求: ${prompt.slice(0, 100)}...`);
    
    // 1. 匹配模板
    for (const [name, template] of Object.entries(this.templates)) {
      if (template.pattern.test(prompt)) {
        console.log(`[LocalAI] 匹配模板: ${name}`);
        return {
          success: true,
          template: name,
          code: template.generate(context),
          confidence: 0.85,
          source: 'template'
        };
      }
    }
    
    // 2. 从学习模式中查找
    const similarPattern = this.findSimilarPattern(prompt);
    if (similarPattern) {
      console.log(`[LocalAI] 使用学习模式: ${similarPattern.name}`);
      return {
        success: true,
        pattern: similarPattern,
        code: this.applyPattern(similarPattern, context),
        confidence: similarPattern.confidence,
        source: 'learned'
      };
    }
    
    // 3. 从代码库中查找相似代码
    const similarCode = this.findSimilarCode(prompt, context);
    if (similarCode) {
      console.log(`[LocalAI] 找到相似代码: ${similarCode.file}`);
      return {
        success: true,
        code: similarCode.code,
        confidence: 0.7,
        source: 'codebase',
        reference: similarCode.file
      };
    }
    
    // 4. 返回通用建议
    return {
      success: false,
      message: '无法生成代码，请提供更具体的描述或选择以下模板:',
      availableTemplates: Object.keys(this.templates),
      suggestion: this.getSuggestion(prompt)
    };
  }
  
  /**
   * 查找相似的学习模式
   */
  findSimilarPattern(prompt) {
    const keywords = prompt.toLowerCase().split(/\s+/);
    
    for (const pattern of this.learnedPatterns) {
      const matchCount = keywords.filter(k => 
        pattern.keywords.some(pk => pk.includes(k))
      ).length;
      
      if (matchCount >= 2) {
        return pattern;
      }
    }
    
    return null;
  }
  
  /**
   * 应用学习模式
   */
  applyPattern(pattern, context) {
    let code = pattern.template;
    
    // 替换参数
    for (const [key, value] of Object.entries(context)) {
      code = code.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    
    return code;
  }
  
  /**
   * 从代码库中查找相似代码
   */
  findSimilarCode(prompt, context) {
    const keywords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const [file, knowledge] of this.codeKnowledgeBase) {
      let score = 0;
      
      // 匹配函数名
      for (const func of knowledge.functions) {
        const funcLower = func.toLowerCase();
        if (keywords.some(k => funcLower.includes(k))) {
          score += 3;
        }
      }
      
      // 匹配类名
      for (const cls of knowledge.classes) {
        const clsLower = cls.toLowerCase();
        if (keywords.some(k => clsLower.includes(k))) {
          score += 2;
        }
      }
      
      if (score > bestScore) {
        bestScore = score;
        try {
          const content = fs.readFileSync(file, 'utf-8');
          bestMatch = {
            file,
            code: content.slice(0, 2000),
            score
          };
        } catch (e) { /* 文件读取失败，跳过 */ }
      }
    }
    
    return bestMatch;
  }
  
  /**
   * 获取建议
   */
  getSuggestion(prompt) {
    const suggestions = [];
    
    // 分析关键词，给出建议
    if (/api|接口|路由/.test(prompt)) {
      suggestions.push('提示: 可以使用 "api_route" 模板创建API路由');
    }
    if (/数据库|db|查询/.test(prompt)) {
      suggestions.push('提示: 可以使用 "db_query" 模板创建数据库操作');
    }
    if (/错误|异常|处理/.test(prompt)) {
      suggestions.push('提示: 可以使用 "error_handler" 模板创建错误处理');
    }
    if (/定时|任务|schedule/.test(prompt)) {
      suggestions.push('提示: 可以使用 "scheduler" 模板创建定时任务');
    }
    if (/分析|统计|计算/.test(prompt)) {
      suggestions.push('提示: 可以使用 "data_analysis" 模板创建数据分析');
    }
    if (/监控|告警|alert/.test(prompt)) {
      suggestions.push('提示: 可以使用 "monitor" 模板创建监控');
    }
    if (/缓存|cache/.test(prompt)) {
      suggestions.push('提示: 可以使用 "cache" 模板创建缓存');
    }
    if (/交易|策略|买卖/.test(prompt)) {
      suggestions.push('提示: 可以使用 "trading_strategy" 模板创建交易策略');
    }
    
    return suggestions;
  }
  
  // ════════════════════════════════════════════════════════════
  // 错误诊断与修复
  // ════════════════════════════════════════════════════════════
  
  /**
   * 诊断错误
   * @param {string} errorMessage - 错误信息
   * @param {string} code - 相关代码
   */
  diagnoseError(errorMessage, code = '') {
    console.log(`[LocalAI] 诊断错误: ${errorMessage.slice(0, 100)}...`);
    
    const results = [];
    
    for (const rule of this.fixRules) {
      const match = errorMessage.match(rule.pattern);
      if (match) {
        const diagnosis = rule.diagnose(match);
        const fix = rule.fix(code, match, diagnosis);
        
        results.push({
          error: diagnosis.error,
          cause: diagnosis.cause,
          fix: fix.suggestion,
          confidence: fix.confidence,
          matched: match[0]
        });
      }
    }
    
    if (results.length === 0) {
      return {
        success: false,
        message: '未能识别此错误类型',
        suggestion: '请提供更详细的错误信息和相关代码'
      };
    }
    
    // 按置信度排序
    results.sort((a, b) => b.confidence - a.confidence);
    
    return {
      success: true,
      diagnoses: results
    };
  }
  
  /**
   * 自动修复错误
   * @param {string} filePath - 文件路径
   * @param {string} errorMessage - 错误信息
   */
  async autoFix(filePath, errorMessage) {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    
    const code = fs.readFileSync(filePath, 'utf-8');
    const diagnosis = this.diagnoseError(errorMessage, code);
    
    if (!diagnosis.success) {
      return diagnosis;
    }
    
    const bestDiagnosis = diagnosis.diagnoses[0];
    
    // 记录修改
    const modification = {
      id: `mod_${Date.now()}`,
      filePath,
      error: errorMessage,
      diagnosis: bestDiagnosis,
      timestamp: bjISO(),
      status: 'applied'
    };
    
    this.modificationHistory.push(modification);
    this.saveModificationHistory();
    
    // 从成功的修复中学习
    this.learnFromFix(filePath, errorMessage, bestDiagnosis);
    
    return {
      success: true,
      diagnosis: bestDiagnosis,
      modification,
      note: '请手动应用修复建议并验证'
    };
  }
  
  // ════════════════════════════════════════════════════════════
  // 自学习机制
  // ════════════════════════════════════════════════════════════
  
  /**
   * 从成功的修复中学习
   */
  learnFromFix(filePath, error, diagnosis) {
    // 提取关键词
    const keywords = [
      ...error.toLowerCase().split(/\s+/).filter(w => w.length > 2),
      ...diagnosis.cause.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    ];
    
    // 查找是否已有类似模式
    const existingPattern = this.learnedPatterns.find(p => 
      p.errorType === diagnosis.error
    );
    
    if (existingPattern) {
      // 增强现有模式
      existingPattern.count++;
      existingPattern.confidence = Math.min(0.95, existingPattern.confidence + 0.02);
      existingPattern.keywords = [...new Set([...existingPattern.keywords, ...keywords])];
    } else {
      // 创建新模式
      this.learnedPatterns.push({
        id: `pattern_${Date.now()}`,
        name: diagnosis.error,
        errorType: diagnosis.error,
        keywords,
        template: diagnosis.fix,
        confidence: 0.7,
        count: 1,
        createdAt: bjISO()
      });
    }
    
    this.saveLearnedPatterns();
    console.log(`[LocalAI] 已学习: ${diagnosis.error}`);
  }
  
  /**
   * 从成功的代码生成中学习
   */
  learnFromGeneration(prompt, generatedCode, success) {
    const keywords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    if (success) {
      // 记录成功的模式
      this.learnedPatterns.push({
        id: `pattern_${Date.now()}`,
        name: prompt.slice(0, 50),
        keywords,
        template: generatedCode,
        confidence: 0.75,
        count: 1,
        createdAt: bjISO()
      });
      
      this.saveLearnedPatterns();
    }
  }
  
  // ════════════════════════════════════════════════════════════
  // 代码优化
  // ════════════════════════════════════════════════════════════
  
  /**
   * 分析代码并提供优化建议
   */
  analyzeForOptimization(code) {
    const suggestions = [];
    
    for (const rule of this.optimizationRules) {
      if (rule.check(code)) {
        const optimization = rule.optimize(code);
        suggestions.push({
          rule: rule.name,
          description: rule.description,
          suggestion: optimization.suggestion,
          confidence: optimization.confidence
        });
      }
    }
    
    // 检查代码质量
    if (code.includes('console.log') && (code.match(/console\.log/g) || []).length > 5) {
      suggestions.push({
        rule: 'excessive_logging',
        description: '过多的console.log调用',
        suggestion: '建议使用统一的日志系统，移除调试用的console.log',
        confidence: 0.9
      });
    }
    
    if (code.includes('try {') && !code.includes('catch')) {
      suggestions.push({
        rule: 'incomplete_try_catch',
        description: 'try块缺少catch',
        suggestion: '添加catch块处理潜在错误',
        confidence: 0.95
      });
    }
    
    return {
      success: suggestions.length > 0,
      suggestions,
      summary: `发现 ${suggestions.length} 个优化点`
    };
  }
  
  // ════════════════════════════════════════════════════════════
  // 统计与报告
  // ════════════════════════════════════════════════════════════
  
  /**
   * 获取引擎状态
   */
  getStatus() {
    return {
      version: '1.0.0',
      templates: Object.keys(this.templates).length,
      fixRules: this.fixRules.length,
      optimizationRules: this.optimizationRules.length,
      learnedPatterns: this.learnedPatterns.length,
      codebaseFiles: this.codeKnowledgeBase.size,
      modificationHistory: this.modificationHistory.length
    };
  }
  
  /**
   * 获取学习进度
   */
  getLearningProgress() {
    const successfulFixes = this.modificationHistory.filter(m => m.status === 'success').length;
    const totalFixes = this.modificationHistory.length;
    
    return {
      totalModifications: totalFixes,
      successfulFixes,
      successRate: totalFixes > 0 ? (successfulFixes / totalFixes * 100).toFixed(1) + '%' : 'N/A',
      learnedPatterns: this.learnedPatterns.length,
      topPatterns: this.learnedPatterns
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(p => ({ name: p.name, count: p.count, confidence: p.confidence }))
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════════════════════════

const localAI = new LocalAIEngine();

export const LocalAI = {
  // 代码生成
  generate: (prompt, context) => localAI.generate(prompt, context),
  
  // 错误诊断
  diagnoseError: (error, code) => localAI.diagnoseError(error, code),
  autoFix: (filePath, error) => localAI.autoFix(filePath, error),
  
  // 代码优化
  analyzeForOptimization: (code) => localAI.analyzeForOptimization(code),
  
  // 自学习
  learnFromFix: (file, error, diagnosis) => localAI.learnFromFix(file, error, diagnosis),
  learnFromGeneration: (prompt, code, success) => localAI.learnFromGeneration(prompt, code, success),
  
  // 状态
  getStatus: () => localAI.getStatus(),
  getLearningProgress: () => localAI.getLearningProgress(),
  
  // 模板
  templates: CODE_TEMPLATES,
  fixRules: FIX_RULES
};

export default LocalAI;
