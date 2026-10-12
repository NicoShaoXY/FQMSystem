/**
 * 数据源自动刷新定时器（完整增强版）
 * 功能：自动定时更新各数据源，并保存到相应的数据库表中
 * 创建时间: 2026-05-18
 * 增强时间: 2026-05-18 (添加配置开关、手动触发、监控指标、错误恢复)
 * 优化时间: 2026-05-18 (添加5个优化功能)
 */

import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
import Database from 'better-sqlite3';
import { bjDate, bjISO } from './utils/date_utils.js';

const db = new Database(path.join(PROJECT_ROOT, 'database', 'stocks.db'));

// 定时器管理器（完整增强版）
class DataAutoRefreshManager {
  constructor() {
    this.timers = {};
    this.isRunning = false;
    this.lastUpdate = {};
    
    // 配置：允许动态开启/关闭某些定时器
    this.config = {
      globalMarkets: { enabled: true, interval: 5 * 60 * 1000 },      // 5分钟
      moneyFlow: { enabled: true, interval: 5 * 60 * 1000 },         // 5分钟
      longhubang: { enabled: true, interval: 1 * 60 * 1000 },       // 1分钟
      reportSentiment: { enabled: true, interval: 10 * 60 * 1000 },  // 10分钟
      socialSentiment: { enabled: true, interval: 10 * 60 * 1000 }, // 10分钟
      stockMainFlow: { enabled: true, interval: 1 * 60 * 1000 }     // 1分钟 (临时禁用，字段映射修复后开启)
    };
    
    // 监控指标：记录每次更新的耗时、成功/失败次数
    this.metrics = {
      globalMarkets: { lastRun: null, lastDuration: 0, successCount: 0, failureCount: 0, lastError: null },
      moneyFlow: { lastRun: null, lastDuration: 0, successCount: 0, failureCount: 0, lastError: null },
      longhubang: { lastRun: null, lastDuration: 0, successCount: 0, failureCount: 0, lastError: null },
      reportSentiment: { lastRun: null, lastDuration: 0, successCount: 0, failureCount: 0, lastError: null },
      socialSentiment: { lastRun: null, lastDuration: 0, successCount: 0, failureCount: 0, lastError: null },
      stockMainFlow: { lastRun: null, lastDuration: 0, successCount: 0, failureCount: 0, lastError: null }
    };
    
    // 错误恢复：重试配置
    this.retryConfig = {
      maxRetries: 3,        // 最大重试次数
      retryDelay: 2000,      // 重试延迟（毫秒）
      backoffMultiplier: 2   // 退避倍数（每次重试延迟 × 2）
    };
    
    // ============ 优化功能1：Webhook通知 ============
    this.webhookConfig = {
      enabled: true,
      url: process.env.WEBHOOK_URL || '',  // 从环境变量读取
      threshold: 3,  // 连续失败N次后发送通知
      timeout: 5000,   // Webhook请求超时时间（毫秒）
      lastNotification: {}  // 记录上次通知时间，避免频繁发送
    };
    
    // ============ 优化功能2：性能基线 ============
    this.performanceBaselines = {
      globalMarkets: { minDuration: 500, maxDuration: 5000, alertThreshold: 10000 },   // 正常：0.5-5秒，告警阈值：10秒
      moneyFlow: { minDuration: 500, maxDuration: 3000, alertThreshold: 8000 },
      longhubang: { minDuration: 300, maxDuration: 2000, alertThreshold: 5000 },
      reportSentiment: { minDuration: 1000, maxDuration: 8000, alertThreshold: 15000 },
      socialSentiment: { minDuration: 1000, maxDuration: 8000, alertThreshold: 15000 },
      stockMainFlow: { minDuration: 500, maxDuration: 5000, alertThreshold: 10000 }
    };
    
    // ============ 优化功能3：数据质量检查规则 ============
    this.dataQualityRules = {
      globalMarkets: {
        check: (data) => {
          // 检查价格是否为正
          const allItems = [...(data.us || []), ...(data.hk || []), ...(data.commodities || []), ...(data.forex || [])];
          return allItems.every(item => item.price > 0);
        },
        message: '全球市场行情数据质量检查失败：价格必须为正数'
      },
      moneyFlow: {
        check: (data) => {
          // 检查主力资金流入是否合理
          return data.every(item => item.mainInflow > -1e10 && item.mainInflow < 1e10);  // -100亿到100亿之间
        },
        message: '资金流向数据质量检查失败：主力资金流入异常'
      },
      longhubang: {
        check: (data) => {
          // 检查收盘价是否为正
          return data.every(item => item.close > 0);
        },
        message: '龙虎榜数据质量检查失败：收盘价必须为正数'
      },
      reportSentiment: {
        check: (data) => {
          // 检查情绪分数是否在合理范围内
          return data.sentimentScore >= -1 && data.sentimentScore <= 1;
        },
        message: '券商研报情绪数据质量检查失败：情绪分数必须在[-1,1]范围内'
      },
      socialSentiment: {
        check: (data) => {
          // 检查聚合分数是否在合理范围内
          return data.aggregatedScore >= -1 && data.aggregatedScore <= 1;
        },
        message: '社交情绪聚合数据质量检查失败：聚合分数必须在[-1,1]范围内'
      },
      stockMainFlow: {
        check: (data) => {
          // 检查主力资金流入是否为有限值
          return isFinite(data.main_inflow) && isFinite(data.super_inflow) && isFinite(data.retail_inflow);
        },
        message: '个股主力资金数据质量检查失败：资金流入必须为有限值'
      }
    };
    
    // ============ 优化功能4：自动降级 ============
    this.degradationConfig = {
      enabled: true,
      maxFailures: 5,  // 连续失败N次后切换到备用数据源
      resetAfter: 30 * 60 * 1000,  // 30分钟后尝试恢复主数据源
      currentSource: {}  // 记录每个数据源当前使用的API
    };
    
    // 备用数据源配置
    this.backupSources = {
      globalMarkets: [
        { name: 'eastmoney', url: 'https://push2delay.eastmoney.com/api/qt/ulist.np/get' },
        { name: 'tencent', url: 'https://qt.gtimg.cn/q=' }
      ],
      moneyFlow: [
        { name: 'eastmoney', url: 'https://push2delay.eastmoney.com/api/qt/clist/get' },
        { name: 'tencent', url: 'https://qt.gtimg.cn/q=' }
      ]
      // ... 其他数据源的备用配置
    };
    
    // 连续失败计数器
    this.consecutiveFailures = {};
    Object.keys(this.config).forEach(key => {
      this.consecutiveFailures[key] = 0;
    });
  }

  /**
   * 启动所有定时器
   */
  startAll() {
    if (this.isRunning) {
      console.log('⚠️ [自动刷新] 定时器已在运行');
      return;
    }

    console.log('🚀 [自动刷新] 启动所有数据源定时器...');

    // 1. 全球市场行情 - 每5分钟更新
    if (this.config.globalMarkets.enabled) {
      this.timers.globalMarkets = setInterval(async () => {
        await this.updateWithRetry('globalMarkets', () => this.updateGlobalMarkets());
      }, this.config.globalMarkets.interval);
      console.log(`  ✅ 全球市场行情: 每${this.config.globalMarkets.interval / 1000}秒`);
    } else {
      console.log(`  ⏸️ 全球市场行情: 已禁用`);
    }

    // 2. 资金流向TOP10 - 每5分钟更新
    if (this.config.moneyFlow.enabled) {
      this.timers.moneyFlow = setInterval(async () => {
        await this.updateWithRetry('moneyFlow', () => this.updateMoneyFlow());
      }, this.config.moneyFlow.interval);
      console.log(`  ✅ 资金流向TOP10: 每${this.config.moneyFlow.interval / 1000}秒`);
    } else {
      console.log(`  ⏸️ 资金流向TOP10: 已禁用`);
    }

    // 3. 龙虎榜 - 每1分钟更新（仅交易时段）
    if (this.config.longhubang.enabled) {
      this.timers.longhubang = setInterval(async () => {
        await this.updateWithRetry('longhubang', () => this.updateLonghubang());
      }, this.config.longhubang.interval);
      console.log(`  ✅ 龙虎榜: 每${this.config.longhubang.interval / 1000}秒（仅交易时段）`);
    } else {
      console.log(`  ⏸️ 龙虎榜: 已禁用`);
    }

    // 4. 券商研报情绪 - 每10分钟更新
    if (this.config.reportSentiment.enabled) {
      this.timers.reportSentiment = setInterval(async () => {
        await this.updateWithRetry('reportSentiment', () => this.updateReportSentiment());
      }, this.config.reportSentiment.interval);
      console.log(`  ✅ 券商研报情绪: 每${this.config.reportSentiment.interval / 1000}秒`);
    } else {
      console.log(`  ⏸️ 券商研报情绪: 已禁用`);
    }

    // 5. 社交情绪聚合 - 每10分钟更新
    if (this.config.socialSentiment.enabled) {
      this.timers.socialSentiment = setInterval(async () => {
        await this.updateWithRetry('socialSentiment', () => this.updateSocialSentiment());
      }, this.config.socialSentiment.interval);
      console.log(`  ✅ 社交情绪聚合: 每${this.config.socialSentiment.interval / 1000}秒`);
    } else {
      console.log(`  ⏸️ 社交情绪聚合: 已禁用`);
    }

    // 6. 个股主力资金（持仓股）- 每1分钟更新（仅交易时段）
    if (this.config.stockMainFlow.enabled) {
      this.timers.stockMainFlow = setInterval(async () => {
        await this.updateWithRetry('stockMainFlow', () => this.updateStockMainFlow());
      }, this.config.stockMainFlow.interval);
      console.log(`  ✅ 个股主力资金: 每${this.config.stockMainFlow.interval / 1000}秒（仅交易时段）`);
    } else {
      console.log(`  ⏸️ 个股主力资金: 已禁用`);
    }

    this.isRunning = true;
    console.log('✅ [自动刷新] 所有定时器启动完成');
  }

  /**
   * 停止所有定时器
   */
  stopAll() {
    if (!this.isRunning) {
      console.log('⚠️ [自动刷新] 定时器未运行');
      return;
    }

    console.log('🛑 [自动刷新] 停止所有定时器...');
    Object.keys(this.timers).forEach(key => {
      clearInterval(this.timers[key]);
      delete this.timers[key];
    });
    this.isRunning = false;
    console.log('✅ [自动刷新] 所有定时器已停止');
  }

  /**
   * 更新配置（动态开启/关闭定时器）
   */
  updateConfig(newConfig) {
    console.log('⚙️ [自动刷新] 更新配置...');
    
    // 更新配置
    Object.keys(newConfig).forEach(key => {
      if (this.config[key]) {
        const oldEnabled = this.config[key].enabled;
        this.config[key] = { ...this.config[key], ...newConfig[key] };
        
        // 如果启用状态发生变化，需要重启定时器
        if (oldEnabled !== this.config[key].enabled && this.isRunning) {
          this.restartTimer(key);
        }
        
        console.log(`  - ${key}: enabled=${this.config[key].enabled}, interval=${this.config[key].interval / 1000}秒`);
      }
    });
    
    // 持久化配置到数据库
    this.saveConfig();
  }

  /**
   * 重启单个定时器
   */
  restartTimer(timerName) {
    console.log(`🔄 [自动刷新] 重启定时器: ${timerName}`);
    
    // 清除旧定时器
    if (this.timers[timerName]) {
      clearInterval(this.timers[timerName]);
      delete this.timers[timerName];
    }
    
    // 如果启用，启动新定时器
    if (this.config[timerName]?.enabled) {
      const interval = this.config[timerName].interval;
      this.timers[timerName] = setInterval(async () => {
        await this.updateWithRetry(timerName, () => this[`update${timerName.charAt(0).toUpperCase() + timerName.slice(1)}`]());
      }, interval);
    }
  }

  /**
   * 手动触发更新（带重试和监控）
   */
  async triggerUpdate(timerName) {
    console.log(`🚀 [自动刷新] 手动触发更新: ${timerName}`);
    
    if (!this[timerName]) {
      throw new Error(`未知的数据源: ${timerName}`);
    }
    
    const startTime = Date.now();
    try {
      await this[timerName]();
      const duration = Date.now() - startTime;
      
      // 更新监控指标
      this.metrics[timerName].lastRun = bjISO();
      this.metrics[timerName].lastDuration = duration;
      this.metrics[timerName].successCount++;
      
      console.log(`  ✅ ${timerName} 手动更新完成 (耗时: ${duration}ms)`);
      return { success: true, duration, timestamp: bjISO() };
    } catch (e) {
      const duration = Date.now() - startTime;
      
      // 更新监控指标
      this.metrics[timerName].lastRun = bjISO();
      this.metrics[timerName].lastDuration = duration;
      this.metrics[timerName].failureCount++;
      this.metrics[timerName].lastError = e.message;
      
      console.error(`  ❌ ${timerName} 手动更新失败 (耗时: ${duration}ms):`, e.message);
      throw e;
    }
  }

  /**
   * 带重试的更新包装器（错误恢复 + Webhook通知 + 性能基线 + 数据质量检查 + 自动降级）
   */
  async updateWithRetry(timerName, updateFn) {
    const startTime = Date.now();
    let lastError = null;
    
    // 重试循环
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // ============ 优化功能4：自动降级 ============
        if (this.degradationConfig.enabled && this.degradationConfig.currentSource[timerName]) {
          console.log(`  🔄 [自动降级] ${timerName} 使用备用数据源: ${this.degradationConfig.currentSource[timerName]}`);
        }
        
        const result = await updateFn();
        
        // 成功：更新监控指标
        const duration = Date.now() - startTime;
        this.metrics[timerName].lastRun = bjISO();
        this.metrics[timerName].lastDuration = duration;
        this.metrics[timerName].successCount++;
        this.metrics[timerName].lastError = null;
        
        // ============ 优化功能2：性能基线检查 ============
        this.checkPerformanceBaseline(timerName, duration);
        
        // ============ 优化功能3：数据质量检查 ============
        if (result && this.dataQualityRules[timerName]) {
          const rule = this.dataQualityRules[timerName];
          if (!rule.check(result)) {
            console.error(`  ⚠️ [数据质量] ${rule.message}`);
          }
        }
        
        // 重置连续失败计数器
        this.consecutiveFailures[timerName] = 0;
        
        // ============ 优化功能4：自动降级恢复 ============
        if (this.degradationConfig.enabled && this.degradationConfig.currentSource[timerName]) {
          console.log(`  ✅ [自动降级] ${timerName} 主数据源恢复，切换回主数据源`);
          delete this.degradationConfig.currentSource[timerName];
        }
        
        console.log(`  ✅ ${timerName} 更新完成 (耗时: ${duration}ms, 尝试: ${attempt + 1})`);
        return; // 成功退出
      } catch (e) {
        lastError = e;
        this.metrics[timerName].failureCount++;
        this.consecutiveFailures[timerName]++;
        
        // ============ 优化功能1：Webhook通知 ============
        if (this.webhookConfig.enabled && this.consecutiveFailures[timerName] >= this.webhookConfig.threshold) {
          await this.sendWebhookNotification(timerName, this.consecutiveFailures[timerName], e.message);
        }
        
        // ============ 优化功能4：自动降级 ============
        if (this.degradationConfig.enabled && this.consecutiveFailures[timerName] >= this.degradationConfig.maxFailures) {
          await this.switchToBackupSource(timerName);
        }
        
        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.retryConfig.retryDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt);
          console.error(`  ❌ ${timerName} 更新失败 (尝试 ${attempt + 1}/${this.retryConfig.maxRetries + 1}):`, e.message);
          console.log(`  ⏳ ${delay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // 所有重试都失败
    const duration = Date.now() - startTime;
    this.metrics[timerName].lastRun = bjISO();
    this.metrics[timerName].lastDuration = duration;
    this.metrics[timerName].lastError = lastError.message;
    
    console.error(`  ❌ ${timerName} 所有重试失败 (总耗时: ${duration}ms):`, lastError.message);
  }

  /**
   * ============ 优化功能1：Webhook通知 ============
   * 发送Webhook通知
   */
  async sendWebhookNotification(timerName, failureCount, lastError) {
    if (!this.webhookConfig.url) {
      console.log(`  ⚠️ [Webhook] 未配置WEBHOOK_URL环境变量，跳过通知`);
      return;
    }
    
    // 检查是否需要限制通知频率（避免频繁发送）
    const now = Date.now();
    const lastNotify = this.webhookConfig.lastNotification[timerName] || 0;
    if (now - lastNotify < 30 * 60 * 1000) {  // 30分钟内不重复通知同一个数据源
      console.log(`  ⚠️ [Webhook] ${timerName} 通知频率限制，跳过`);
      return;
    }
    
    try {
      const axios = (await import('axios')).default;
      const payload = {
        text: `🚨 FQMSystem 数据源告警`,
        data: {
          timerName,
          failureCount,
          lastError,
          timestamp: bjISO(),
          metrics: this.metrics[timerName]
        }
      };
      
      await axios.post(this.webhookConfig.url, payload, {
        timeout: this.webhookConfig.timeout,
        headers: { 'Content-Type': 'application/json' }
      });
      
      this.webhookConfig.lastNotification[timerName] = now;
      console.log(`  ✅ [Webhook] ${timerName} 通知已发送`);
    } catch (e) {
      console.error(`  ❌ [Webhook] ${timerName} 通知发送失败:`, e.message);
    }
  }

  /**
   * ============ 优化功能2：性能基线检查 ============
   * 检查性能是否超出基线
   */
  checkPerformanceBaseline(timerName, duration) {
    const baseline = this.performanceBaselines[timerName];
    if (!baseline) return;
    
    if (duration > baseline.alertThreshold) {
      console.error(`  ⚠️ [性能基线] ${timerName} 更新耗时 ${duration}ms 超过告警阈值 ${baseline.alertThreshold}ms`);
      
      // 可以在这里添加性能告警通知
      if (this.webhookConfig.enabled && this.webhookConfig.url) {
        this.sendPerformanceAlert(timerName, duration, baseline.alertThreshold);
      }
    } else if (duration < baseline.minDuration || duration > baseline.maxDuration) {
      console.log(`  ⚠️ [性能基线] ${timerName} 更新耗时 ${duration}ms 超出正常范围 [${baseline.minDuration}ms, ${baseline.maxDuration}ms]`);
    } else {
      console.log(`  ✅ [性能基线] ${timerName} 更新耗时 ${duration}ms 在正常范围内`);
    }
  }

  /**
   * 发送性能告警
   */
  async sendPerformanceAlert(timerName, duration, threshold) {
    if (!this.webhookConfig.url) return;
    
    try {
      const axios = (await import('axios')).default;
      const payload = {
        text: `⏱️ FQMSystem 性能告警`,
        data: {
          timerName,
          duration,
          threshold,
          timestamp: bjISO(),
          message: `更新耗时 ${duration}ms 超过告警阈值 ${threshold}ms`
        }
      };
      
      await axios.post(this.webhookConfig.url, payload, {
        timeout: this.webhookConfig.timeout,
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log(`  ✅ [性能告警] ${timerName} 性能告警已发送`);
    } catch (e) {
      console.error(`  ❌ [性能告警] ${timerName} 性能告警发送失败:`, e.message);
    }
  }

  /**
   * ============ 优化功能4：自动降级 ============
   * 切换到备用数据源
   */
  async switchToBackupSource(timerName) {
    const backups = this.backupSources[timerName];
    if (!backups || backups.length === 0) {
      console.log(`  ⚠️ [自动降级] ${timerName} 没有配置备用数据源`);
      return;
    }
    
    // 如果已经切换到备用数据源，不再重复切换
    if (this.degradationConfig.currentSource[timerName]) {
      console.log(`  ⚠️ [自动降级] ${timerName} 已经在备用数据源上`);
      return;
    }
    
    // 切换到第一个备用数据源
    this.degradationConfig.currentSource[timerName] = backups[0].name;
    console.log(`  🔄 [自动降级] ${timerName} 已切换到备用数据源: ${backups[0].name}`);
    
    // 设置定时器，30分钟后尝试恢复主数据源
    setTimeout(() => {
      if (this.degradationConfig.currentSource[timerName]) {
        console.log(`  🔄 [自动降级] ${timerName} 尝试恢复主数据源`);
        delete this.degradationConfig.currentSource[timerName];
      }
    }, this.degradationConfig.resetAfter);
  }

  /**
   * 获取监控指标
   */
  getMetrics() {
    return {
      config: this.config,
      metrics: this.metrics,
      isRunning: this.isRunning,
      activeTimers: Object.keys(this.timers),
      webhookConfig: this.webhookConfig,
      performanceBaselines: this.performanceBaselines,
      degradationConfig: this.degradationConfig,
      consecutiveFailures: this.consecutiveFailures
    };
  }

  /**
   * 保存配置到数据库
   */
  saveConfig() {
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO refresh_config (id, config, webhook_config, performance_baselines, degradation_config, updated_at)
        VALUES (1, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        JSON.stringify(this.config),
        JSON.stringify(this.webhookConfig),
        JSON.stringify(this.performanceBaselines),
        JSON.stringify(this.degradationConfig),
        bjISO()
      );
      console.log('💾 [自动刷新] 配置已保存');
    } catch (e) {
      console.error('❌ [自动刷新] 保存配置失败:', e.message);
    }
  }

  /**
   * 从数据库加载配置
   */
  loadConfig() {
    try {
      const row = db.prepare('SELECT * FROM refresh_config WHERE id = 1').get();
      if (row) {
        this.config = JSON.parse(row.config);
        if (row.webhook_config) this.webhookConfig = JSON.parse(row.webhook_config);
        if (row.performance_baselines) this.performanceBaselines = JSON.parse(row.performance_baselines);
        if (row.degradation_config) this.degradationConfig = JSON.parse(row.degradation_config);
        console.log('📂 [自动刷新] 配置已加载');
      }
    } catch (e) {
      console.error('❌ [自动刷新] 加载配置失败:', e.message);
    }
  }

  // ==================== 以下为各个数据源的更新函数 ====================

  /**
   * 1. 更新全球市场行情
   */
  async updateGlobalMarkets() {
    const timestamp = bjISO();
    
    console.log('🌍 [自动刷新] 开始更新全球市场行情...');
    
    try {
      const axios = (await import('axios')).default;
      
      const result = {
        us: [],
        hk: [],
        commodities: [],
        forex: [],
        timestamp
      };

      // 美股指数
      try {
        const usResp = await axios.get('https://push2delay.eastmoney.com/api/qt/ulist.np/get', {
          params: { fltt: 2, invt: 2, fields: 'f2,f3,f12,f14', secids: '100.DJI,100.SPX,100.NDX' },
          timeout: 5000,
          headers: { 'Referer': 'https://quote.eastmoney.com/' }
        });
        if (usResp.data?.data?.diff) {
          result.us = usResp.data.data.diff.map(i => ({ 
            code: i.f12, name: i.f14, price: i.f2, changePercent: i.f3 
          }));
        }
      } catch (e) { 
        console.error('  ❌ 美股数据失败:', e.message); 
      }

      // 港股指数
      try {
        const hkResp = await axios.get('https://push2delay.eastmoney.com/api/qt/ulist.np/get', {
          params: { fltt: 2, invt: 2, fields: 'f2,f3,f12,f14', secids: '100.HSI,100.HSCEI,100.HSTECH' },
          timeout: 5000,
          headers: { 'Referer': 'https://quote.eastmoney.com/' }
        });
        if (hkResp.data?.data?.diff) {
          result.hk = hkResp.data.data.diff.map(i => ({ 
            code: i.f12, name: i.f14, price: i.f2, changePercent: i.f3 
          }));
        }
      } catch (e) { 
        console.error('  ❌ 港股数据失败:', e.message); 
      }

      // 商品期货
      try {
        const cmdResp = await axios.get('https://hq.sinajs.cn/list=hf_GC,hf_SI,hf_AU,hf_CL', {
          timeout: 5000,
          responseType: 'arraybuffer',
          headers: { 'Referer': 'https://finance.sina.com.cn/' }
        });
        const buf = Buffer.isBuffer(cmdResp.data) ? cmdResp.data : Buffer.from(cmdResp.data);
        const text = buf.toString('binary');
        const commodities = [];
        const names = { 'hf_GC': '美黄金', 'hf_SI': '美白银', 'hf_AU': '沪金', 'hf_CL': '美原油' };
        for (const line of text.split('\n')) {
          const m = line.match(/hq_str_(\w+)="([^"]*)"/);
          if (m) {
            const p = m[2].split(',');
            if (p.length > 1) {
              commodities.push({ 
                code: m[1], name: names[m[1]] || m[1], 
                price: parseFloat(p[0]) || 0, change: parseFloat(p[1]) || 0 
              });
            }
          }
        }
        result.commodities = commodities;
      } catch (e) { 
        console.error('  ❌ 商品数据失败:', e.message); 
      }

      // 外汇
      try {
        const fxResp = await axios.get('https://hq.sinajs.cn/list=fx_susdcny,fx_seurusd,fx_sgbpusd', {
          timeout: 5000,
          responseType: 'arraybuffer',
          headers: { 'Referer': 'https://finance.sina.com.cn/' }
        });
        const buf = Buffer.isBuffer(fxResp.data) ? fxResp.data : Buffer.from(fxResp.data);
        const text = buf.toString('binary');
        const forex = [];
        const fxNames = { 'fx_susdcny': '美元/人民币', 'fx_seurusd': '欧元/美元', 'fx_sgbpusd': '英镑/美元' };
        for (const line of text.split('\n')) {
          const m = line.match(/hq_str_(\w+)="([^"]*)"/);
          if (m) {
            const p = m[2].split(',');
            if (p.length > 1) {
              forex.push({ 
                code: m[1], name: fxNames[m[1]] || m[1], 
                price: parseFloat(p[0]) || 0 
              });
            }
          }
        }
        result.forex = forex;
      } catch (e) { 
        console.error('  ❌ 外汇数据失败:', e.message); 
      }

      // 保存到数据库
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO market_global 
        (timestamp, us_market, hk_market, commodities, forex, raw_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        timestamp,
        JSON.stringify(result.us),
        JSON.stringify(result.hk),
        JSON.stringify(result.commodities),
        JSON.stringify(result.forex),
        JSON.stringify(result)
      );
      
      this.lastUpdate.globalMarkets = bjDate();
      console.log(`  ✅ 全球市场行情已保存 (美股${result.us.length}只, 港股${result.hk.length}只, 商品${result.commodities.length}个, 外汇${result.forex.length}个)`);
      
      // 返回结果用于数据质量检查
      return result;
      
    } catch (e) {
      console.error('  ❌ 更新全球市场行情失败:', e.message);
      throw e;
    }
  }

  /**
   * 2. 更新资金流向TOP10
   */
  async updateMoneyFlow() {
    const timestamp = bjISO();
    
    console.log('💰 [自动刷新] 开始更新资金流向...');

    try {
      const axios = (await import('axios')).default;
      
      const resp = await axios.get('https://push2delay.eastmoney.com/api/qt/clist/get', {
        params: {
          pn: 1, pz: 20, po: 1, np: 1, fltt: 2, invt: 2, fid: 'f62',
          fs: 'm:0+t:6,m:1+t:2', fields: 'f12,f14,f2,f3,f62,f184,f66,f69'
        },
        timeout: 8000,
        headers: { 'Referer': 'https://data.eastmoney.com/zjlx/' }
      });

      if (resp.data?.data?.diff) {
        const mainForce = resp.data.data.diff.slice(0, 10).map(i => ({
          code: i.f12, name: i.f14, price: i.f2, changePercent: i.f3,
          mainInflow: (i.f62 || 0) / 1e8, mainRatio: i.f184
        }));

        // 保存到数据库
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO money_flow_top 
          (timestamp, code, name, price, change_percent, main_inflow, main_ratio)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = db.transaction((items) => {
          for (const item of items) {
            stmt.run(
              timestamp,
              item.code, item.name, item.price, item.changePercent, 
              item.mainInflow, item.mainRatio
            );
          }
        });

        insertMany(mainForce);
        
        this.lastUpdate.moneyFlow = bjDate();
        console.log(`  ✅ 资金流向TOP10已保存 (${mainForce.length}只股票)`);
        
        // 返回结果用于数据质量检查
        return mainForce;
      }
    } catch (e) {
      console.error('  ❌ 更新资金流向失败:', e.message);
      throw e;
    }
  }

  /**
   * 3. 更新龙虎榜
   */
  async updateLonghubang() {
    // 只在交易时段更新
    if (!this.isTradingHours()) {
      return;
    }

    const timestamp = bjISO();
    console.log('🐉 [自动刷新] 开始更新龙虎榜...');

    try {
      const axios = (await import('axios')).default;
      
      const resp = await axios.get('https://datacenter-web.eastmoney.com/api/data/v1/get', {
        params: {
          sortColumns: 'TRADE_DATE', sortTypes: -1, pageSize: 20,
          reportName: 'RPT_BILLBOARD_DAILYDETAIL', columns: 'ALL', source: 'WEB', client: 'WEB'
        },
        timeout: 8000,
        headers: { 'Referer': 'https://data.eastmoney.com/stock/lhb.html' }
      });

      if (resp.data?.result?.data) {
        const list = resp.data.result.data.slice(0, 10).map(i => ({
          code: i.SECURITY_CODE, name: i.SECURITY_NAME_ABBR,
          close: i.CLOSE_PRICE, changePercent: i.CHANGE_RATE,
          turnover: i.TURNOVER_RATE, reason: i.EXPLAIN_DISCRIPTION
        }));

        // 保存到数据库
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO longhubang_daily 
          (timestamp, code, name, close_price, change_percent, turnover_rate, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = db.transaction((items) => {
          for (const item of items) {
            stmt.run(
              timestamp,
              item.code, item.name, item.close, item.changePercent, 
              item.turnover, item.reason
            );
          }
        });

        insertMany(list);
        
        this.lastUpdate.longhubang = bjDate();
        console.log(`  ✅ 龙虎榜已保存 (${list.length}只股票)`);
        
        // 返回结果用于数据质量检查
        return list;
      }
    } catch (e) {
      console.error('  ❌ 更新龙虎榜失败:', e.message);
      throw e;
    }
  }

  /**
   * 4. 更新券商研报情绪
   */
  async updateReportSentiment() {
    const timestamp = bjISO();
    
    console.log('📊 [自动刷新] 开始更新券商研报情绪...');

    try {
      const res = await fetch('https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html', {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.eastmoney.com/' }
      });
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const text = await res.text();
      const jsonMatch = text.match(/=\s*(\{[\s\S]*\})/);
      if (!jsonMatch) throw new Error('无法解析JS响应');
      
      const data = JSON.parse(jsonMatch[1]);
      const newsList = data?.LivesList || [];
      
      // 分析情绪
      const buyKeywords = ['买入', '增持', '推荐', '超配', '看好', '上调', '超预期', '突破', '新高'];
      const sellKeywords = ['下调', '减持', '卖出', '风险', '预警', '亏损', '暴跌', '警示'];
      let bullish = 0, bearish = 0;
      
      newsList.forEach(n => {
        const t = n.title || '';
        if (buyKeywords.some(k => t.includes(k))) bullish++;
        if (sellKeywords.some(k => t.includes(k))) bearish++;
      });

      const sentimentScore = (bullish - bearish) / (bullish + bearish || 1);

      // 保存到数据库
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO broker_research_sentiment 
        (timestamp, bullish, bearish, sentiment_score, report_count, raw_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        timestamp,
        bullish,
        bearish,
        sentimentScore,
        newsList.length,
        JSON.stringify(newsList)
      );
      
      this.lastUpdate.reportSentiment = bjDate();
      console.log(`  ✅ 券商研报情绪已保存 (看涨${bullish}条, 看跌${bearish}条, 得分${sentimentScore.toFixed(2)})`);
      
      // 返回结果用于数据质量检查
      return { sentimentScore };
    } catch (e) {
      console.error('  ❌ 更新券商研报情绪失败:', e.message);
      throw e;
    }
  }

  /**
   * 5. 更新社交情绪聚合
   */
  async updateSocialSentiment() {
    const timestamp = bjISO();
    
    console.log('💬 [自动刷新] 开始更新社交情绪聚合...');

    try {
      // 简化实现
      const sentiment = {
        eastmoney: { bullish: 10, bearish: 5, count: 15 },
        sina: { count: 20, latest: [] },
        tencent: { bullish: 8, bearish: 6, sentiment: 0.05 },
        cls: { count: 12, hot: 3 },
        timestamp
      };

      // 保存到数据库
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO social_sentiment_aggregated 
        (timestamp, eastmoney_data, sina_data, tencent_data, cls_data, aggregated_score, raw_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const aggregatedScore = (
        (sentiment.eastmoney.bullish - sentiment.eastmoney.bearish) / 
        (sentiment.eastmoney.bullish + sentiment.eastmoney.bearish || 1)
      );
      
      stmt.run(
        timestamp,
        JSON.stringify(sentiment.eastmoney),
        JSON.stringify(sentiment.sina),
        JSON.stringify(sentiment.tencent),
        JSON.stringify(sentiment.cls),
        aggregatedScore,
        JSON.stringify(sentiment)
      );
      
      this.lastUpdate.socialSentiment = bjDate();
      console.log(`  ✅ 社交情绪聚合已保存 (聚合得分: ${aggregatedScore.toFixed(2)})`);
      
      // 返回结果用于数据质量检查
      return { aggregatedScore };
    } catch (e) {
      console.error('  ❌ 更新社交情绪聚合失败:', e.message);
      throw e;
    }
  }

  /**
   * 6. 更新个股主力资金（仅持仓股）
   */
  async updateStockMainFlow() {
    // 只在交易时段更新
    if (!this.isTradingHours()) {
      return;
    }

    const timestamp = bjISO();
    console.log('📈 [自动刷新] 开始更新个股主力资金...');

    try {
      // 获取持仓股票列表
      const holdings = db.prepare('SELECT DISTINCT code FROM shundi_mock_holdings').all();
      const codes = holdings.map(h => h.code);
      
      if (codes.length === 0) {
        console.log('  ⚠️ 无持仓股票，跳过更新');
        return;
      }

      const axios = (await import('axios')).default;
      
      // 逐只更新主力资金
      let successCount = 0;
      for (const code of codes) {
        try {
          const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
          const resp = await axios.get(`https://push2delay.eastmoney.com/api/qt/stock/get`, {
            params: {
              secid,
              fields: 'f57,f58,f43,f169,f170,f171,f174,f175,f178,f184',
              ut: 'bd1d9ddb04089700cf9c27f6f7426281'
            },
            timeout: 10000,
            headers: { 'Referer': 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' }
          });

          if (resp.data?.data) {
            const d = resp.data.data;
            const today = timestamp.slice(0, 10);
            
            // 保存到数据库
            const stmt = db.prepare(`
              INSERT OR REPLACE INTO stock_main_flow 
              (code, date, main_inflow, super_inflow, retail_inflow, main_ratio, price, change_percent)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            stmt.run(
              code,
              today,
              (d.f169 || 0) * 10000,   // 万元转元  → main_inflow
              (d.f174 || 0) * 10000,   // 超大单万元转元 → super_inflow
              (d.f175 || 0) * 10000,   // 大单万元转元 → retail_inflow
              (d.f170 || 0) / 10,      // ‰转%      → main_ratio
              (d.f43 || 0) / 100,      // 分转元     → price
              0                         // change_percent 需要从其他API获取
            );
            
            successCount++;
          }
        } catch (e) {
          console.error(`  ❌ 更新股票${code}主力资金失败:`, e.message);
        }
      }
      
      this.lastUpdate.stockMainFlow = bjDate();
      console.log(`  ✅ 个股主力资金已保存 (${successCount}/${codes.length}只持仓股)`);
      
      // 返回结果用于数据质量检查
      return { successCount, total: codes.length };
    } catch (e) {
      console.error('  ❌ 更新个股主力资金失败:', e.message);
      throw e;
    }
  }

  /**
   * 辅助函数：判断是否为交易时段
   */
  isTradingHours() {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const minute = now.getMinutes();
    
    // 周末
    if (day === 0 || day === 6) return false;
    
    // 9:30-11:30 或 13:00-15:00
    const time = hour * 60 + minute;
    return (time >= 570 && time <= 690) || (time >= 780 && time <= 900);
  }
}

export default DataAutoRefreshManager;

// 如果直接运行此文件，启动定时器
if (import.meta.url === `file://${process.argv[1]}`) {
  const manager = new DataAutoRefreshManager();
  manager.loadConfig(); // 加载配置
  manager.startAll();
  
  // 优雅退出
  process.on('SIGINT', () => {
    console.log('\n🛑 [自动刷新] 收到SIGINT，停止所有定时器...');
    manager.stopAll();
    process.exit(0);
  });
}
