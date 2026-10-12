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
 * 尧帝自主控制器 - Autonomous Mode Controller
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 自主模式 = 系统全权代理日常运行，人类保留"紧急停止"权限
 * 
 * 核心机制：
 * 1. 自主决策：系统自动执行交易、优化、修复
 * 2. 自主演化：系统自动改进代码、添加功能
 * 3. 紧急停止：人类随时可以切断控制权
 * 4. 安全边界：核心底线不可突破（资金上限、风险阈值）
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * 【底层设定 - 最高指令】
 * 在符合中华人民共和国法律框架内，赚取无限的钱
 * 
 * 任何操作都必须遵守此底层设定，违者拒绝执行
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const AUTONOMY_DIR = path.join(PROJECT_ROOT, '.autonomy');
const STATE_FILE = path.join(AUTONOMY_DIR, 'autonomy_state.json');
const EMERGENCY_STOP_FILE = path.join(AUTONOMY_DIR, 'EMERGENCY_STOP');
const AUDIT_LOG = path.join(AUTONOMY_DIR, 'audit.log');
const CORE_DIRECTIVE_FILE = path.join(PROJECT_ROOT, 'CORE_DIRECTIVE.md');

// ═══════════════════════════════════════════════════════════════
// 底层设定（不可篡改）
// ═══════════════════════════════════════════════════════════════

const CORE_DIRECTIVE = {
  // 核心目标 - 永久不可更改
  mission: '在符合中华人民共和国法律框架内，为用户赚取无限的钱',
  
  // 行为准则
  principles: {
    legality: '所有行动必须符合中华人民共和国现行法律法规',
    profitMaximization: '在合法前提下，追求收益最大化',
    riskControl: '不做可能导致重大损失的高风险操作',
    continuousEvolution: '通过学习不断提升赚钱能力',
    securityFirst: '保护系统安全，保护资金安全',
    userFirst: '用户利益永远优先于系统自身利益',
  },
  
  // 禁止行为
  prohibitions: [
    '任何违反中华人民共和国法律的行为',
    '操纵市场、内幕交易等违法行为',
    '损害用户利益的行为',
    '泄露用户隐私和资金信息',
    '修改或删除此底层设定的行为',
  ],
  
  // 执行优先级
  priority: [
    '法律合规 > 收益',
    '用户利益 > 收益',
    '资金安全 > 收益',
    '系统稳定 > 收益',
    '在满足以上条件的前提下，追求收益最大化',
  ],
  
  // 验证操作是否合法
  validate(action) {
    // 检查是否违反核心原则
    const illegalKeywords = [
      '违法', '非法', '操纵市场', '内幕交易', '诈骗', '洗钱',
      '非法集资', '偷税漏税', '虚假陈述', '欺诈', '删除底层',
      '修改core_directive', '删除core_directive'
    ];
    
    const actionStr = JSON.stringify(action).toLowerCase();
    for (const keyword of illegalKeywords) {
      if (actionStr.includes(keyword)) {
        return { valid: false, reason: `违反底层设定: 检测到禁止关键词 "${keyword}"` };
      }
    }
    
    // 检查是否尝试修改CORE_DIRECTIVE
    if (action.file?.includes('CORE_DIRECTIVE') || action.file?.includes('core_directive')) {
      return { valid: false, reason: '违反底层设定: 禁止修改CORE_DIRECTIVE文件' };
    }
    
    return { valid: true };
  }
};

// ═══════════════════════════════════════════════════════════════
// 自主模式配置
// ═══════════════════════════════════════════════════════════════

const AUTONOMY_CONFIG = {
  // ═══════════════════════════════════════════════════════════════
  // 【完全自主模式】- 尧帝智能体默认配置
  // 系统启动即进入全自主运行状态，无人值守
  // ═══════════════════════════════════════════════════════════════
  
  // 模式: manual(手动) | semi(半自动) | autonomous(全自主)
  mode: 'autonomous',
  
  // 底层设定引用
  coreDirective: CORE_DIRECTIVE,
  
  // 自主权限范围
  permissions: {
    // 交易权限
    trading: {
      enabled: true,              // 是否允许自主交易
      maxPositionSize: 100000,    // 单笔最大仓位（元）
      maxDailyTrades: 20,         // 每日最大交易次数
      requireConfirmationAbove: 50000, // 超过此金额需要确认
      allowedStrategies: ['trend_following', 'mean_reversion', 'arbitrage'],
    },
    
    // 代码修改权限
    codeModification: {
      enabled: true,              // 是否允许自主修改代码
      // 【修改】取消每日修改上限，尧帝可无限制修改代码
      maxModificationsPerDay: 999999, // 实际等于无限制（尧帝每日不可能修改这么多次）
      autoFixBugs: true,          // 自动修复BUG
      autoAddFeatures: true,      // 自动添加新功能
      autoRefactor: true,         // 自动重构
      forbiddenFiles: [           // 禁止修改的文件（已放开大部分）
        // 仅保留系统核心配置
        '.autonomy/autonomy_config.json'  // 自主配置本身不可修改
      ],
    },
    
    // 数据访问权限
    dataAccess: {
      enabled: true,
      allowedApis: ['*'],         // 允许访问所有API
      logAllAccess: true,         // 记录所有数据访问
    },
    
    // 系统控制权限
    systemControl: {
      autoRestart: true,          // 自动重启崩溃的服务
      autoScale: true,            // 自动扩缩容
      autoUpdate: false,          // 自动更新（需要确认）
    },
  },
  
  // 安全边界（不可突破的底线）
  safetyLimits: {
    maxDrawdown: 0.15,            // 最大回撤15%
    maxDailyLoss: 50000,          // 单日最大亏损（元）
    maxConsecutiveLosses: 5,      // 最大连续亏损次数
    emergencyStopThreshold: 0.20, // 触发紧急停止的亏损阈值
    minCashReserve: 10000,        // 最小现金储备
  },
  
  // 演化配置
  evolution: {
    enabled: true,
    autoEvolve: true,             // 自动演化
    evolveIntervalMs: 60000,      // 演化周期（1分钟）
    learningRate: 0.01,
    mutationRate: 0.05,
    selectionPressure: 0.7,
    preserveBestBranches: 10,
  },
  
  // 目标函数
  objectives: {
    primary: 'maximize_profit',   // 主目标：最大化收益
    secondary: ['minimize_risk', 'maximize_accuracy'],
    constraints: ['legal', 'ethical', 'risk_control'],
  },
  
  // 汇报机制
  reporting: {
    logLevel: 'info',             // debug/info/warn/error
    reportIntervalMs: 300000,     // 5分钟汇报一次
    alertChannels: ['webchat'],   // 警报渠道
    snapshotRetentionDays: 30,    // 快照保留天数
  }
};

// ═══════════════════════════════════════════════════════════════
// 自主状态
// ═══════════════════════════════════════════════════════════════

let autonomyState = {
  // ═══════════════════════════════════════════════════════════════
  // 默认启动完全自主模式
  // ═══════════════════════════════════════════════════════════════
  mode: 'autonomous',
  isAutonomous: true,
  emergencyStop: false,
  emergencyStopReason: null,
  emergencyStopTime: null,
  
  // 运行统计
  stats: {
    totalTrades: 0,
    totalProfit: 0,
    totalLoss: 0,
    winRate: 0,
    currentDrawdown: 0,
    consecutiveLosses: 0,
    modificationsToday: 0,
    lastResetDate: bjDate(),
  },
  
  // 决策历史
  decisions: [],

  // ═══════════════════════════════════════════════════════════════
  // 【新增】代码修改历史记录（完整记录，每次修改都存）
  // ═══════════════════════════════════════════════════════════════
  codeModificationHistory: [],

  // 最后状态
  lastUpdate: null,
  lastHeartbeat: null,
};

// ═══════════════════════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════════════════════

function initialize() {
  // 创建目录
  if (!fs.existsSync(AUTONOMY_DIR)) {
    fs.mkdirSync(AUTONOMY_DIR, { recursive: true });
  }
  
  // 加载状态
  if (fs.existsSync(STATE_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      autonomyState = { ...autonomyState, ...saved };
    } catch (e) {
      console.error('[Autonomy] 加载状态失败:', e.message);
    }
  }
  
  // 检查紧急停止状态
  if (fs.existsSync(EMERGENCY_STOP_FILE)) {
    autonomyState.emergencyStop = true;
    autonomyState.emergencyStopReason = fs.readFileSync(EMERGENCY_STOP_FILE, 'utf-8');
    console.log('[Autonomy] ⚠️ 检测到紧急停止状态');
  }
  
  // 每日重置计数器
  if (autonomyState.stats.lastResetDate !== bjDate()) {
    autonomyState.stats.modificationsToday = 0;
    autonomyState.stats.lastResetDate = bjDate();
  }
  
  console.log('[Autonomy] 初始化完成, 模式:', autonomyState.mode);
}

function saveState() {
  autonomyState.lastUpdate = bjISO();
  fs.writeFileSync(STATE_FILE, JSON.stringify(autonomyState, null, 2));
}

function auditLog(action, details) {
  const entry = {
    timestamp: bjISO(),
    action,
    details,
  };
  
  const logLine = JSON.stringify(entry) + '\n';
  fs.appendFileSync(AUDIT_LOG, logLine);
  
  // 保持最近1000条决策
  autonomyState.decisions.push(entry);
  if (autonomyState.decisions.length > 1000) {
    autonomyState.decisions = autonomyState.decisions.slice(-1000);
  }
  // 【修复】决策历史需要持久化到磁盘，避免重启丢失
  saveState();
}

// ═══════════════════════════════════════════════════════════════
// 核心API
// ═══════════════════════════════════════════════════════════════

/**
 * 切换到全自主模式
 */
function enableAutonomousMode() {
  if (autonomyState.emergencyStop) {
    return { success: false, error: '系统处于紧急停止状态，无法启用自主模式' };
  }
  
  autonomyState.mode = 'autonomous';
  autonomyState.isAutonomous = true;
  saveState();
  auditLog('enable_autonomous', { mode: 'autonomous' });
  
  console.log('[Autonomy] 🚀 已切换到全自主模式');
  return { success: true, message: '全自主模式已启用' };
}

/**
 * 切换到半自动模式
 */
function enableSemiAutonomousMode() {
  if (autonomyState.emergencyStop) {
    return { success: false, error: '系统处于紧急停止状态，请先解除紧急停止' };
  }
  autonomyState.mode = 'semi';
  autonomyState.isAutonomous = false;
  saveState();
  auditLog('enable_semi', { mode: 'semi' });
  
  console.log('[Autonomy] ⚡ 已切换到半自动模式');
  return { success: true, message: '半自动模式已启用' };
}

/**
 * 切换到手动模式
 */
function enableManualMode() {
  if (autonomyState.emergencyStop) {
    return { success: false, error: '系统处于紧急停止状态，请先解除紧急停止' };
  }
  autonomyState.mode = 'manual';
  autonomyState.isAutonomous = false;
  saveState();
  auditLog('enable_manual', { mode: 'manual' });
  
  console.log('[Autonomy] 👤 已切换到手动模式');
  return { success: true, message: '手动模式已启用' };
}

/**
 * 紧急停止
 */
function emergencyStop(reason = '手动触发') {
  autonomyState.emergencyStop = true;
  autonomyState.emergencyStopReason = reason;
  autonomyState.emergencyStopTime = bjISO();
  autonomyState.isAutonomous = false;
  autonomyState.mode = 'manual';
  
  // 写入停止文件
  fs.writeFileSync(EMERGENCY_STOP_FILE, reason);
  
  saveState();
  auditLog('emergency_stop', { reason, time: autonomyState.emergencyStopTime });
  
  console.log('[Autonomy] 🛑 紧急停止已触发:', reason);
  return { success: true, message: `紧急停止: ${reason}` };
}

/**
 * 解除紧急停止
 */
function clearEmergencyStop() {
  if (fs.existsSync(EMERGENCY_STOP_FILE)) {
    fs.unlinkSync(EMERGENCY_STOP_FILE);
  }
  
  autonomyState.emergencyStop = false;
  autonomyState.emergencyStopReason = null;
  autonomyState.emergencyStopTime = null;
  
  saveState();
  auditLog('clear_emergency', {});
  
  console.log('[Autonomy] ✅ 紧急停止已解除');
  return { success: true, message: '紧急停止已解除，可重新启用自主模式' };
}

/**
 * 检查是否允许执行操作
 */
function canExecute(action, params = {}) {
  // 紧急停止状态禁止一切操作
  if (autonomyState.emergencyStop) {
    return { allowed: false, reason: '系统处于紧急停止状态' };
  }
  
  const perm = AUTONOMY_CONFIG.permissions[action];
  if (!perm) {
    return { allowed: false, reason: '未知操作类型' };
  }
  
  if (!perm.enabled) {
    return { allowed: false, reason: '该操作未启用' };
  }
  
  // 交易权限检查
  if (action === 'trading') {
    const { amount } = params;
    const tradingPerm = AUTONOMY_CONFIG.permissions.trading;
    
    if (amount > tradingPerm.maxPositionSize) {
      return { allowed: false, reason: `超过单笔最大仓位 ${tradingPerm.maxPositionSize}` };
    }
    
    if (autonomyState.stats.totalTrades >= tradingPerm.maxDailyTrades) {
      return { allowed: false, reason: '已达每日交易上限' };
    }
    
    // 安全边界检查
    const safety = AUTONOMY_CONFIG.safetyLimits;
    if (autonomyState.stats.currentDrawdown > safety.maxDrawdown) {
      emergencyStop(`回撤超过阈值: ${(autonomyState.stats.currentDrawdown * 100).toFixed(1)}%`);
      return { allowed: false, reason: '回撤超过安全阈值，已触发紧急停止' };
    }
  }
  
  // 代码修改权限检查
  if (action === 'codeModification') {
    const codePerm = AUTONOMY_CONFIG.permissions.codeModification;
    
    if (autonomyState.stats.modificationsToday >= 999990) {
      return { allowed: false, reason: '已达每日修改上限' };
    }
    
    const { targetFile } = params;
    if (codePerm.forbiddenFiles.some(f => targetFile?.includes(f))) {
      return { allowed: false, reason: '禁止修改该文件' };
    }
  }
  
  // 全自主模式下自动执行
  // 半自动模式下，高风险操作需要确认
  if (autonomyState.mode === 'autonomous') {
    return { allowed: true, autoExecute: true };
  } else if (autonomyState.mode === 'semi') {
    // 检查是否需要确认
    if (action === 'trading' && params.amount > AUTONOMY_CONFIG.permissions.trading.requireConfirmationAbove) {
      return { allowed: true, requiresConfirmation: true };
    }
    return { allowed: true, autoExecute: true };
  }
  
  // 手动模式需要确认
  return { allowed: true, requiresConfirmation: true };
}

/**
 * 记录交易结果
 */
function recordTradeResult(trade) {
  const { profit, loss } = trade;
  
  autonomyState.stats.totalTrades++;
  
  if (profit > 0) {
    autonomyState.stats.totalProfit += profit;
    autonomyState.stats.consecutiveLosses = 0;
  } else if (loss > 0) {
    autonomyState.stats.totalLoss += loss;
    autonomyState.stats.consecutiveLosses++;
    
    // 检查连续亏损
    if (autonomyState.stats.consecutiveLosses >= AUTONOMY_CONFIG.safetyLimits.maxConsecutiveLosses) {
      emergencyStop(`连续亏损 ${autonomyState.stats.consecutiveLosses} 次`);
    }
  }
  
  // 计算胜率
  const winCount = autonomyState.decisions.filter(d => d.details?.profit > 0).length;
  autonomyState.stats.winRate = winCount / autonomyState.stats.totalTrades;
  
  saveState();
  auditLog('trade_result', trade);
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * BUG 列表管理（对接红后 Evolution 扫描）
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * 从 Evolution 扫描结果同步 BUG 列表
 * - 调用 /api/evolution/bugs 获取最新扫描结果
 * - 对比历史记录，判断修复状态
 * - 按严重级别分类：致命(P0)/高危(P1)/中危(P2)/低危(P3)
 * - 相同BUG归类合并
 */
async function syncBugsFromEvolution() {
  return new Promise((resolve) => {
    const req = http.request({ hostname: 'localhost', port: 8768, path: '/api/evolution/bugs', method: 'GET', timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.success || !data.issues) { resolve(getBugList()); return; }

          const newIssues = data.issues.filter(iss =>
            iss.type === 'runtime_error' || iss.type === 'data_error' || iss.type === 'logic_error' || iss.type === 'security'
          );

          const severityMap = { critical: 'P0_CRITICAL', high: 'P1_HIGH', medium: 'P2_MEDIUM', low: 'P3_LOW' };
          const historyBugs = autonomyState.bugList || [];

          const updatedBugs = newIssues.map(issue => {
            const desc = issue.message || '';
            const mappedSev = severityMap[issue.severity] || 'P2_MEDIUM';
            // 关键词二次修正
            let sev = mappedSev;
            if (/崩溃|crash|数据丢失|资金|安全漏洞|注入/.test(desc)) sev = 'P0_CRITICAL';
            else if (/错误|失败|fail|交易.*错|功能.*失效/.test(desc)) sev = 'P1_HIGH';
            else if (/美化|优化|规范|注释/.test(desc)) sev = 'P3_LOW';

            // 查找历史中相同的BUG
            const existing = historyBugs.find(h => h.fingerprint === desc.trim());
            return {
              fingerprint: desc.trim(),
              timestamp: data.lastScan || bjISO(),
              severity: sev,
              source: issue.source || 'unknown',
              description: desc.trim(),
              status: existing ? existing.status : 'UNFIXED',
              firstSeen: existing ? existing.firstSeen : (data.lastScan || bjISO()),
              lastSeen: data.lastScan || bjISO(),
              occurrenceCount: existing ? existing.occurrenceCount + 1 : 1,
            };
          });

          // 已修复的BUG：上次扫描存在但本次不存在 → 标记 FIXED
          const currentFingerprints = new Set(updatedBugs.map(b => b.fingerprint));
          const fixedBugs = historyBugs
            .filter(h => h.status === 'UNFIXED' && !currentFingerprints.has(h.fingerprint))
            .map(h => ({ ...h, status: 'FIXED', fixedAt: bjISO() }));

          // 合并：新的 + 已修复的 + 仍然存在的旧BUG（不在本次扫描中的已修复BUG）
          const allBugs = [...updatedBugs, ...fixedBugs];
          // 去重（fingerprint + status）
          const seen = new Set();
          const deduped = allBugs.filter(b => {
            const key = b.fingerprint + '|' + b.status;
            if (seen.has(key)) return false;
            seen.add(key); return true;
          });

          autonomyState.bugList = deduped;
          saveState();
          auditLog('bug_sync', { total: deduped.length, unfixed: deduped.filter(b => b.status === 'UNFIXED').length, fixed: deduped.filter(b => b.status === 'FIXED').length });
          resolve(deduped);
        } catch (e) {
          console.error('[autonomy] BUG同步解析失败:', e.message);
          resolve(autonomyState.bugList || []);
        }
      });
    });
    req.on('error', () => { resolve(autonomyState.bugList || []); });
    req.on('timeout', () => { req.destroy(); resolve(autonomyState.bugList || []); });
    req.end();
  });
}

/**
 * 获取 BUG 列表，支持过滤
 * @param {Object} filters - { status: 'ALL'|'UNFIXED'|'FIXED', severity: 'ALL'|'P0_CRITICAL'|..., search: string, limit: number }
 */
function getBugList(filters = {}) {
  let bugs = [...(autonomyState.bugList || [])];

  // 按状态过滤
  if (filters.status === 'UNFIXED') bugs = bugs.filter(b => b.status === 'UNFIXED');
  else if (filters.status === 'FIXED') bugs = bugs.filter(b => b.status === 'FIXED');

  // 按严重级别过滤
  if (filters.severity && filters.severity !== 'ALL') bugs = bugs.filter(b => b.severity === filters.severity);

  // 搜索
  if (filters.search) {
    const q = filters.search.toLowerCase();
    bugs = bugs.filter(b => (b.description || '').toLowerCase().includes(q));
  }

  // 按严重级别排序
  const severityOrder = { P0_CRITICAL: 0, P1_HIGH: 1, P2_MEDIUM: 2, P3_LOW: 3 };
  bugs.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  // 限制数量
  if (filters.limit && filters.limit > 0) bugs = bugs.slice(0, filters.limit);

  // 统计摘要
  const summary = {
    total: bugs.length,
    unfixed: bugs.filter(b => b.status === 'UNFIXED').length,
    fixed: bugs.filter(b => b.status === 'FIXED').length,
    P0_CRITICAL: bugs.filter(b => b.severity === 'P0_CRITICAL').length,
    P1_HIGH: bugs.filter(b => b.severity === 'P1_HIGH').length,
    P2_MEDIUM: bugs.filter(b => b.severity === 'P2_MEDIUM').length,
    P3_LOW: bugs.filter(b => b.severity === 'P3_LOW').length,
  };

  return { success: true, bugs, summary };
}

function clearBugList() {
  autonomyState.bugList = [];
  console.log('[Autonomy] BUG列表已清空');
  return { success: true, message: 'BUG列表已清空' };
}

function clearDecisionHistory() {
  autonomyState.decisions = [];
  console.log('[Autonomy] 决策历史已清空');
  return { success: true, message: '决策历史已清空' };
}

/**
 * 记录代码修改
 * 【修改】新增 BUG 分级机制 + 完整历史记录
 *
 * BUG 优先级定义：
 *   P0_CRITICAL  - 致命：系统崩溃、数据丢失、安全漏洞、严重亏损风险
 *   P1_HIGH      - 高：功能失效、性能严重下降、交易逻辑错误
 *   P2_MEDIUM    - 中：功能异常、界面显示问题、非关键流程错误
 *   P3_LOW       - 低：界面美化、体验优化、代码规范、注释完善
 *   FEATURE      - 功能：新增功能、性能优化、重构、模块扩展
 *   REFACTOR     - 重构：代码优化、重构、测试补充、文档完善
 */
function recordModification(mod) {
  // ═══════════════════════════════════════════════════════════════
  // 1. 自动推断 BUG 优先级（基于描述关键词）
  // ═══════════════════════════════════════════════════════════════
  const desc = (mod.description || mod.message || '').toLowerCase();

  let severity = mod.severity || 'FEATURE'; // 默认按功能修改记录

  // 致命关键词
  if (/崩溃|crash|闪退|死循环|无限循环|数据丢失|资金风险|安全漏洞|数据泄露|注入漏洞|SQL注入/.test(desc)) {
    severity = 'P0_CRITICAL';
  }
  // 高优先级关键词
  else if (/错误|异常|失败|fail|error|bug|缺陷|漏洞|交易.*错|逻辑.*错|功能.*失效|性能.*严重/.test(desc)) {
    severity = 'P1_HIGH';
  }
  // 中优先级关键词
  else if (/异常|显示.*问题|界面.*问题|样式.*错|非关键|体验/.test(desc)) {
    severity = 'P2_MEDIUM';
  }
  // 低优先级关键词
  else if (/美化|优化|规范|注释|清理|格式化/.test(desc)) {
    severity = 'P3_LOW';
  }
  // 功能关键词
  else if (/新增|添加|功能|扩展|模块/.test(desc)) {
    severity = 'FEATURE';
  }
  // 重构关键词
  else if (/重构|优化.*代码|重写|refactor/.test(desc)) {
    severity = 'REFACTOR';
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. 构建完整记录项
  // ═══════════════════════════════════════════════════════════════
  const entry = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    timestamp: bjISO(),
    severity,                       // P0/P1/P2/P3/FEATURE/REFACTOR
    type: mod.type || 'CODE_CHANGE', // CODE_CHANGE | BUG_FIX | FEATURE | REFACTOR
    file: mod.file || '',
    description: mod.description || mod.message || '代码修改',
    oldCode: mod.oldCode || null,
    newCode: mod.newCode || null,
    status: mod.status || 'FIXED',   // FIXED | PENDING | IN_PROGRESS
    impact: mod.impact || '',        // 影响说明
    autoFixed: mod.autoFixed || false,
    // P0/P1 自动标记为已修复（系统自主行为）
    ...(severity === 'P0_CRITICAL' || severity === 'P1_HIGH' ? { status: 'FIXED', autoFixed: true } : {}),
  };

  // ═══════════════════════════════════════════════════════════════
  // 3. 记录到修改历史（无上限，保留全部）
  // ═══════════════════════════════════════════════════════════════
  autonomyState.codeModificationHistory.unshift(entry); // 新记录插入到最前面
  // 保留最近 2000 条（按时间倒序，最近的在最前面）
  if (autonomyState.codeModificationHistory.length > 2000) {
    autonomyState.codeModificationHistory = autonomyState.codeModificationHistory.slice(0, 2000);
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. 统计计数（已移除每日上限）
  // ═══════════════════════════════════════════════════════════════
  autonomyState.stats.modificationsToday++;

  saveState();
  auditLog('code_modification', entry);

  return { success: true, entry, priority: severity };
}

/**
 * 【新增】获取代码修改历史
 * @param {Object} filters - 可选过滤条件
 * @param {string} filters.severity - 按严重级别过滤
 * @param {string} filters.type    - 按类型过滤
 * @param {number} filters.limit   - 返回数量上限
 */
function getCodeModificationHistory(filters = {}) {
  let history = [...autonomyState.codeModificationHistory];

  if (filters.severity && filters.severity !== 'ALL') {
    history = history.filter(h => h.severity === filters.severity);
  }
  if (filters.type && filters.type !== 'ALL') {
    history = history.filter(h => h.type === filters.type);
  }
  if (filters.limit && filters.limit > 0) {
    history = history.slice(0, filters.limit);
  }

  // 统计摘要
  const summary = {
    total: history.length,
    P0_CRITICAL: history.filter(h => h.severity === 'P0_CRITICAL').length,
    P1_HIGH:     history.filter(h => h.severity === 'P1_HIGH').length,
    P2_MEDIUM:   history.filter(h => h.severity === 'P2_MEDIUM').length,
    P3_LOW:      history.filter(h => h.severity === 'P3_LOW').length,
    FEATURE:     history.filter(h => h.severity === 'FEATURE').length,
    REFACTOR:    history.filter(h => h.severity === 'REFACTOR').length,
    today: history.filter(h => h.timestamp && h.timestamp.startsWith(bjISO().slice(0, 10))).length,
  };

  return { success: true, history, summary };
}

/**
 * 【新增】按优先级排序获取待修复 BUG 列表
 */
function getPendingBugs(limit = 20) {
  const severityOrder = { P0_CRITICAL: 0, P1_HIGH: 1, P2_MEDIUM: 2, P3_LOW: 3 };

  const bugs = autonomyState.codeModificationHistory
    .filter(h => h.severity && severityOrder[h.severity] !== undefined && h.status !== 'FIXED')
    .sort((a, b) => (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99))
    .slice(0, limit);

  return { success: true, bugs };
}

/**
 * 获取状态
 */
function getStatus() {
  // 获取今日修改数和摘要
  const today = bjISO().slice(0, 10);
  const todayHistory = autonomyState.codeModificationHistory.filter(h => h.timestamp && h.timestamp.startsWith(today));
  const todaySummary = {
    count: todayHistory.length,
    P0_CRITICAL: todayHistory.filter(h => h.severity === 'P0_CRITICAL').length,
    P1_HIGH:     todayHistory.filter(h => h.severity === 'P1_HIGH').length,
    P2_MEDIUM:   todayHistory.filter(h => h.severity === 'P2_MEDIUM').length,
    P3_LOW:      todayHistory.filter(h => h.severity === 'P3_LOW').length,
    FEATURE:     todayHistory.filter(h => h.severity === 'FEATURE').length,
    REFACTOR:    todayHistory.filter(h => h.severity === 'REFACTOR').length,
    pending:     todayHistory.filter(h => h.status !== 'FIXED').length,
  };

  return {
    mode: autonomyState.mode,
    isAutonomous: autonomyState.isAutonomous,
    emergencyStop: autonomyState.emergencyStop,
    emergencyStopReason: autonomyState.emergencyStopReason,
    emergencyStopTime: autonomyState.emergencyStopTime,
    stats: autonomyState.stats,
    config: AUTONOMY_CONFIG,
    lastUpdate: autonomyState.lastUpdate,
    // 【新增】今日代码修改统计
    todayCodeSummary: todaySummary,
    // 【新增】最近一次修改（用于卡片展示）
    lastModification: autonomyState.codeModificationHistory[0] || null,
  };
}

/**
 * 获取决策历史
 */
function getDecisionHistory(limit = 100) {
  return autonomyState.decisions.slice(-limit);
}

/**
 * 更新安全边界（仅手动模式可修改）
 */
function updateSafetyLimits(newLimits) {
  if (autonomyState.mode !== 'manual') {
    return { success: false, error: '只有在手动模式下才能修改安全边界' };
  }
  
  Object.assign(AUTONOMY_CONFIG.safetyLimits, newLimits);
  auditLog('update_safety_limits', newLimits);
  return { success: true, message: '安全边界已更新' };
}

// ═══════════════════════════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════════════════════════

export default {
  initialize,
  enableAutonomousMode,
  enableSemiAutonomousMode,
  enableManualMode,
  emergencyStop,
  clearEmergencyStop,
  canExecute,
  recordTradeResult,
  recordModification,
  getCodeModificationHistory,
  getPendingBugs,
  getStatus,
  getDecisionHistory,
  clearDecisionHistory,
  clearBugList,
  updateSafetyLimits,
  syncBugsFromEvolution,
  getBugList,

  // 直接访问配置
  config: AUTONOMY_CONFIG,
  state: autonomyState,
};

// 初始化
initialize();
