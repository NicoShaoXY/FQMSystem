
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
 * FQMSystem 安全防火墙系统 v1.0.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 功能：
 * 1. 入侵检测与防御 (IDS/IPS)
 * 2. 访问控制与身份验证
 * 3. 操作审计与日志
 * 4. 异常行为监控
 * 5. 自动威胁响应
 * 6. 数据加密保护
 * 
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 放开所有文件修改权限，但必须通过安全防火墙验证
 * ─────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

// ═══════════════════════════════════════════════════════════════
// 安全配置
// ═══════════════════════════════════════════════════════════════

const SECURITY_CONFIG = {
  // 防火墙状态
  enabled: true,
  strictMode: true,
  
  // 入侵检测
  intrusionDetection: {
    enabled: true,
    maxFailedAttempts: 5,
    blockDuration: 300000, // 5分钟
    suspiciousPatterns: [
      /eval\s*\(/gi,
      /Function\s*\(/gi,
      /require\s*\(\s*['"]child_process/gi,
      /exec\s*\(/gi,
      /spawn\s*\(/gi,
      /process\.exit/gi,
      /fs\.rm\s*-/gi,
      /rm\s+-rf/gi,
      /curl.*\|.*sh/gi,
      /wget.*\|.*bash/gi,
    ]
  },
  
  // 访问控制
  accessControl: {
    allowedOrigins: ['localhost', '127.0.0.1', '::1'],
    allowedIPs: ['127.0.0.1', '::1', '192.168.*', '10.*', '172.16.*'],
    maxRequestSize: 10 * 1024 * 1024, // 10MB
    rateLimit: {
      windowMs: 60000,
      maxRequests: 1000
    }
  },
  
  // 文件操作安全
  fileSecurity: {
    allowAllModifications: true, // 放开所有文件修改
    requireAudit: true,          // 但需要审计
    maxFileSize: 100 * 1024 * 1024, // 100MB
    allowedExtensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.css', '.html', '.py', '.sh'],
    backupBeforeModify: true,
    encryptSensitive: true
  },
  
  // 敏感数据保护（加密存储）
  sensitiveProtection: {
    patterns: [
      /password\s*[:=]\s*['"]?([^'"\s]+)/gi,
      /api_key\s*[:=]\s*['"]?([^'"\s]+)/gi,
      /secret\s*[:=]\s*['"]?([^'"\s]+)/gi,
      /token\s*[:=]\s*['"]?([^'"\s]+)/gi,
    ],
    encryptionAlgorithm: 'aes-256-gcm',
    keyDerivationIterations: 100000
  },
  
  // 自动响应
  autoResponse: {
    blockOnThreat: true,
    notifyOnSuspicious: true,
    rollbackOnCorruption: true,
    quarantineOnMalware: true
  },
  
  // 审计日志
  audit: {
    logAllOperations: true,
    logRetentionDays: 90,
    logPath: '.security/audit.log',
    alertChannels: ['console', 'file']
  }
};

// ═══════════════════════════════════════════════════════════════
// 安全防火墙类
// ═══════════════════════════════════════════════════════════════

class SecurityFirewall extends EventEmitter {
  constructor() {
    super();
    this.config = SECURITY_CONFIG;
    this.state = {
      enabled: true,
      threatLevel: 0, // 0-100
      blockedIPs: new Map(),
      failedAttempts: new Map(),
      auditLog: [],
      activeThreats: [],
      lastCheck: null
    };
    this.encryptionKey = null;
    this.initialize();
  }
  
  // ─────────────────────────────────────────────────────────────
  // 初始化
  // ─────────────────────────────────────────────────────────────
  
  initialize() {
    // 创建安全目录
    const securityDir = path.join(process.cwd(), '.security');
    if (!fs.existsSync(securityDir)) {
      fs.mkdirSync(securityDir, { recursive: true });
    }
    
    // 生成或加载加密密钥
    this.loadOrGenerateKey();
    
    // 启动定期扫描
    this.startPeriodicScan();
    
    console.log('🛡️ 安全防火墙已初始化');
    this.log('SECURITY', '防火墙系统启动', { level: 'INFO' });
  }
  
  loadOrGenerateKey() {
    const keyPath = path.join(process.cwd(), '.security', 'firewall.key');
    if (fs.existsSync(keyPath)) {
      this.encryptionKey = fs.readFileSync(keyPath);
    } else {
      this.encryptionKey = crypto.randomBytes(32);
      fs.writeFileSync(keyPath, this.encryptionKey, { mode: 0o600 });
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // 核心安全检查
  // ─────────────────────────────────────────────────────────────
  
  /**
   * 检查文件修改请求
   * @param {string} filePath - 文件路径
   * @param {string} content - 文件内容
   * @param {object} context - 上下文（来源、操作者等）
   * @returns {object} - { allowed: boolean, reason: string, sanitized: string }
   */
  checkFileModification(filePath, content, context = {}) {
    const result = { allowed: true, reason: '', sanitized: content, warnings: [] };
    
    // 1. 恶意代码检测
    const maliciousCheck = this.detectMaliciousCode(content);
    if (maliciousCheck.detected) {
      result.allowed = false;
      result.reason = `检测到恶意代码: ${maliciousCheck.patterns.join(', ')}`;
      this.reportThreat('MALICIOUS_CODE', { filePath, patterns: maliciousCheck.patterns });
      return result;
    }
    
    // 2. 敏感数据检测
    const sensitiveCheck = this.detectSensitiveData(content);
    if (sensitiveCheck.detected && this.config.fileSecurity.encryptSensitive) {
      result.warnings.push(`检测到敏感数据，建议加密存储`);
      result.sanitized = this.encryptSensitiveContent(content, sensitiveCheck.matches);
    }
    
    // 3. 操作审计
    this.auditOperation('FILE_MODIFY', {
      filePath,
      size: content.length,
      context,
      warnings: result.warnings
    });
    
    // 4. 创建备份
    if (this.config.fileSecurity.backupBeforeModify && fs.existsSync(filePath)) {
      this.createBackup(filePath);
    }
    
    return result;
  }
  
  /**
   * 检测恶意代码
   */
  detectMaliciousCode(content) {
    const patterns = [];
    for (const pattern of this.config.intrusionDetection.suspiciousPatterns) {
      if (pattern.test(content)) {
        patterns.push(pattern.source);
      }
    }
    return { detected: patterns.length > 0, patterns };
  }
  
  /**
   * 检测敏感数据
   */
  detectSensitiveData(content) {
    const matches = [];
    for (const pattern of this.config.sensitiveProtection.patterns) {
      const found = content.match(pattern);
      if (found) {
        matches.push({ pattern: pattern.source, value: found[1] });
      }
    }
    return { detected: matches.length > 0, matches };
  }
  
  /**
   * 加密敏感内容
   */
  encryptSensitiveContent(content, matches) {
    // 简化实现：替换敏感值为加密标记
    let sanitized = content;
    for (const match of matches) {
      const encrypted = this.encrypt(match.value);
      sanitized = sanitized.replace(match.value, `[ENCRYPTED:${encrypted.substring(0, 16)}...]`);
    }
    return sanitized;
  }
  
  /**
   * 加密
   */
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.config.sensitiveProtection.encryptionAlgorithm,
      this.encryptionKey,
      iv
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }
  
  /**
   * 解密
   */
  decrypt(encrypted) {
    const parts = encrypted.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    const [ivHex, authTagHex, data] = parts;
    const decipher = crypto.createDecipheriv(
      this.config.sensitiveProtection.encryptionAlgorithm,
      this.encryptionKey,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
  
  // ─────────────────────────────────────────────────────────────
  // 入侵检测与防御
  // ─────────────────────────────────────────────────────────────
  
  /**
   * 检查请求是否合法
   */
  checkRequest(req) {
    const ip = this.getClientIP(req);
    const result = { allowed: true, reason: '' };
    
    // 检查IP是否被封禁
    if (this.state.blockedIPs.has(ip)) {
      const blockInfo = this.state.blockedIPs.get(ip);
      if (Date.now() < blockInfo.until) {
        result.allowed = false;
        result.reason = `IP已被封禁，剩余${Math.ceil((blockInfo.until - Date.now()) / 1000)}秒`;
        return result;
      } else {
        this.state.blockedIPs.delete(ip);
      }
    }
    
    // 检查请求大小
    const contentLength = parseInt(req.headers['content-length'] || 0);
    if (contentLength > this.config.accessControl.maxRequestSize) {
      result.allowed = false;
      result.reason = '请求体过大';
      this.recordFailedAttempt(ip);
      return result;
    }
    
    // 检查Origin
    const origin = req.headers.origin || req.headers.host;
    if (origin && !this.isAllowedOrigin(origin)) {
      result.allowed = false;
      result.reason = '非法来源';
      this.recordFailedAttempt(ip);
      return result;
    }
    
    return result;
  }
  
  getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.socket?.remoteAddress ||
           'unknown';
  }
  
  isAllowedOrigin(origin) {
    for (const allowed of this.config.accessControl.allowedOrigins) {
      if (origin.includes(allowed)) return true;
    }
    return false;
  }
  
  recordFailedAttempt(ip) {
    const attempts = (this.state.failedAttempts.get(ip) || 0) + 1;
    this.state.failedAttempts.set(ip, attempts);
    
    if (attempts >= this.config.intrusionDetection.maxFailedAttempts) {
      this.blockIP(ip, attempts);
    }
  }
  
  blockIP(ip, attempts) {
    const until = Date.now() + this.config.intrusionDetection.blockDuration;
    this.state.blockedIPs.set(ip, { until, attempts, reason: '多次失败尝试' });
    this.reportThreat('IP_BLOCKED', { ip, attempts });
    console.log(`🚫 IP ${ip} 已被封禁 ${this.config.intrusionDetection.blockDuration / 1000} 秒`);
  }
  
  // ─────────────────────────────────────────────────────────────
  // 威胁报告与响应
  // ─────────────────────────────────────────────────────────────
  
  reportThreat(type, details) {
    const threat = {
      id: crypto.randomUUID(),
      type,
      details,
      timestamp: bjISO(),
      handled: false
    };
    
    this.state.activeThreats.push(threat);
    this.state.threatLevel = Math.min(100, this.state.threatLevel + 10);
    
    // 自动响应
    if (this.config.autoResponse.blockOnThreat) {
      this.handleThreat(threat);
    }
    
    this.emit('threat', threat);
    this.log('THREAT', `威胁检测: ${type}`, { level: 'WARNING', details });
    
    return threat;
  }
  
  handleThreat(threat) {
    switch (threat.type) {
      case 'MALICIOUS_CODE':
        // 阻止代码执行，记录到黑名单
        this.log('SECURITY', `恶意代码已被拦截`, { level: 'ERROR', threatId: threat.id });
        break;
      case 'IP_BLOCKED':
        // IP已自动封禁
        break;
      case 'UNAUTHORIZED_ACCESS':
        // 记录并可能触发更严格的安全模式
        this.state.threatLevel = Math.min(100, this.state.threatLevel + 20);
        break;
    }
    threat.handled = true;
  }
  
  // ─────────────────────────────────────────────────────────────
  // 审计日志
  // ─────────────────────────────────────────────────────────────
  
  auditOperation(type, details) {
    const entry = {
      timestamp: bjISO(),
      type,
      details,
      sessionId: process.pid
    };
    
    this.state.auditLog.push(entry);
    
    // 写入文件
    if (this.config.audit.logAllOperations) {
      const logPath = path.join(process.cwd(), this.config.audit.logPath);
      const logLine = JSON.stringify(entry) + '\n';
      fs.appendFileSync(logPath, logLine);
    }
    
    return entry;
  }
  
  log(category, message, meta = {}) {
    const logEntry = {
      timestamp: bjISO(),
      category,
      message,
      ...meta
    };
    console.log(`[SECURITY] [${category}] ${message}`, meta.level || '');
  }
  
  // ─────────────────────────────────────────────────────────────
  // 备份与恢复
  // ─────────────────────────────────────────────────────────────
  
  createBackup(filePath) {
    if (!fs.existsSync(filePath)) return null;
    
    const backupDir = path.join(process.cwd(), '.security', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const timestamp = bjISO().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `${path.basename(filePath)}.${timestamp}.bak`);
    
    fs.copyFileSync(filePath, backupPath);
    this.log('BACKUP', `文件备份: ${filePath}`, { backupPath });
    
    return backupPath;
  }
  
  restoreFromBackup(filePath) {
    const backupDir = path.join(process.cwd(), '.security', 'backups');
    if (!fs.existsSync(backupDir)) return false;
    
    const baseName = path.basename(filePath);
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith(baseName))
      .sort()
      .reverse();
    
    if (backups.length === 0) return false;
    
    const latestBackup = path.join(backupDir, backups[0]);
    fs.copyFileSync(latestBackup, filePath);
    this.log('RESTORE', `文件恢复: ${filePath}`, { from: latestBackup });
    
    return true;
  }
  
  // ─────────────────────────────────────────────────────────────
  // 定期扫描
  // ─────────────────────────────────────────────────────────────
  
  startPeriodicScan() {
    // 每5分钟扫描一次
    setInterval(() => {
      this.performSecurityScan();
    }, 5 * 60 * 1000);
  }
  
  performSecurityScan() {
    this.state.lastCheck = bjISO();
    
    // 1. 清理过期封禁
    for (const [ip, info] of this.state.blockedIPs) {
      if (Date.now() > info.until) {
        this.state.blockedIPs.delete(ip);
      }
    }
    
    // 2. 重置失败计数
    this.state.failedAttempts.clear();
    
    // 3. 降低威胁等级
    this.state.threatLevel = Math.max(0, this.state.threatLevel - 5);
    
    // 4. 清理旧威胁记录
    const oneHourAgo = Date.now() - 3600000;
    this.state.activeThreats = this.state.activeThreats.filter(
      t => new Date(t.timestamp).getTime() > oneHourAgo
    );
    
    this.log('SCAN', '安全扫描完成', { 
      threatLevel: this.state.threatLevel,
      activeThreats: this.state.activeThreats.length 
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // 状态报告
  // ─────────────────────────────────────────────────────────────
  
  getStatus() {
    return {
      enabled: this.state.enabled,
      threatLevel: this.state.threatLevel,
      blockedIPs: this.state.blockedIPs.size,
      activeThreats: this.state.activeThreats.length,
      lastCheck: this.state.lastCheck,
      config: {
        allowAllModifications: this.config.fileSecurity.allowAllModifications,
        intrusionDetectionEnabled: this.config.intrusionDetection.enabled,
        strictMode: this.config.strictMode
      }
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 导出单例
// ═══════════════════════════════════════════════════════════════

const securityFirewall = new SecurityFirewall();
export default securityFirewall;
export { SecurityFirewall, SECURITY_CONFIG };
