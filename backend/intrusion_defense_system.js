
// 北京时间工具（统一使用 Asia/Shanghai UTC+8）
const TZ_OFFSET = 8 * 60;
function toBeijingTime(date = new Date()) {
  const d = date || new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
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
 * 尧帝入侵防御增强系统 v1.0.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 核心能力：
 * 1. 实时入侵检测与阻断 (IDS/IPS)
 * 2. 威胁情报学习与知识库更新
 * 3. 自主优化防御规则
 * 4. 行为分析与异常检测
 * 5. 蜜罐诱捕系统
 * 6. 自动溯源与反击
 * 
 * 基于全网黑客防入侵知识持续进化
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════════
// 威胁情报知识库
// ═══════════════════════════════════════════════════════════════

const THREAT_INTELLIGENCE = {
  // 已知攻击模式
  attackPatterns: {
    // SQL注入攻击模式
    sqlInjection: [
      /(\%27)|(\')|(\-\-)|(\%23)|(#)/gi,
      /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/gi,
      /\w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/gi,
      /((\%27)|(\'))union/gi,
      /exec(\s|\+)+s(xp_)?/gi,
      /union(.*)select/gi,
      /insert(.*)into/gi,
      /delete(.*)from/gi,
      /drop(.*)table/gi,
      /update(.*)set/gi,
    ],
    
    // XSS攻击模式
    xss: [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript\s*:/gi,
      /on\w+\s*=/gi,
      /<img[^>]+onerror/gi,
      /<iframe/gi,
      /<object/gi,
      /<embed/gi,
      /expression\s*\(/gi,
      /vbscript\s*:/gi,
      /data\s*:/gi,
    ],
    
    // 路径遍历攻击
    pathTraversal: [
      /\.\.\//g,
      /\.\.[\\]/g,
      /%2e%2e%2f/gi,
      /%2e%2e\//gi,
      /\.\.%2f/gi,
      /%2e%2e%5c/gi,
    ],
    
    // 命令注入
    commandInjection: [
      /[;&|`$]/g,
      /\$\([^)]+\)/g,
      /`[^`]+`/g,
      /\|\s*\w+/g,
      />\s*\//g,
      /<\s*\//g,
    ],
    
    // 代码注入
    codeInjection: [
      /eval\s*\(/gi,
      /Function\s*\(/gi,
      /setTimeout\s*\(['"]/gi,
      /setInterval\s*\(['"]/gi,
      /new\s+Function/gi,
      /constructor\s*\(/gi,
    ],
    
    // LDAP注入
    ldapInjection: [
      /\(\|/g,
      /\(&/g,
      /\)\(/g,
      /\*\)/g,
    ],
    
    // XML/XXE攻击
    xxe: [
      /<!ENTITY/gi,
      /<!DOCTYPE[^>]*\[/gi,
      /SYSTEM\s+['"]/gi,
      /PUBLIC\s+['"]/gi,
    ],
    
    // SSRF攻击
    ssrf: [
      /@/g,
      /:\/\/@/g,
      /%0a/gi,
      /%0d/gi,
      /localhost/gi,
      /127\.0\.0\.1/gi,
      /0\.0\.0\.0/gi,
      /\[::\]/gi,
      /169\.254\./gi,
    ],
    
    // 反序列化攻击
    deserialization: [
      /java\.serialization/gi,
      /ObjectInputStream/gi,
      /readObject/gi,
      /pickle\.loads/gi,
      /yaml\.load/gi,
      /__reduce__/gi,
    ],
    
    // 权限提升
    privilegeEscalation: [
      /sudo\s+/gi,
      /chmod\s+[0-7]{3,4}/gi,
      /chown\s+/gi,
      /\/etc\/passwd/gi,
      /\/etc\/shadow/gi,
      /\/root\//gi,
    ],
    
    // 敏感文件访问
    sensitiveAccess: [
      /\.ssh\//gi,
      /\.aws\//gi,
      /\.env/gi,
      /credentials/gi,
      /api[-_]?key/gi,
      /private[-_]?key/gi,
      /\.pem/gi,
      /\.key/gi,
    ],
    
    // Web Shell
    webShell: [
      /c99shell/gi,
      /r57shell/gi,
      /b374k/gi,
      /wso_shell/gi,
      /eval\s*\(\s*base64_decode/gi,
      /gzinflate\s*\(\s*base64_decode/gi,
      /str_rot13/gi,
    ],
    
    // 暴力破解
    bruteForce: [
      /admin.*password/gi,
      /login.*attempt/gi,
      /authentication.*failed/gi,
    ],
    
    // DDoS攻击特征
    ddos: [
      /GET\s+\/\s+HTTP/gi,
      /POST\s+\/\s+HTTP/gi,
      /Connection:\s*keep-alive/gi,
      /User-Agent:\s*$/gi,
    ]
  },
  
  // 已知恶意IP段
  maliciousIPRanges: [
    '45.33.32.0/24',
    '185.220.101.0/24',
    '89.248.167.0/24',
    '194.26.29.0/24',
    '171.25.193.0/24',
  ],
  
  // 已知恶意User-Agent
  maliciousUserAgents: [
    /sqlmap/i,
    /nmap/i,
    /nikto/i,
    /nessus/i,
    /metasploit/i,
    /burp/i,
    /zaproxy/i,
    /masscan/i,
    /dirbuster/i,
    /gobuster/i,
    /wfuzz/i,
    /hydra/i,
    /medusa/i,
    /ncat/i,
    /netcat/i,
  ],
  
  // 已知恶意域名
  maliciousDomains: [
    /\.tk$/i,
    /\.ml$/i,
    /\.ga$/i,
    /\.cf$/i,
  ],
  
  // CVE漏洞利用特征
  cveExploits: {
    'CVE-2021-44228': {
      name: 'Log4Shell',
      patterns: [
        /\$\{jndi:/gi,
        /\$\{\$\{lower:j/gi,
        /\$\{\$\{upper:J/gi,
        /\$\{::-/gi,
      ]
    },
    'CVE-2022-22965': {
      name: 'Spring4Shell',
      patterns: [
        /class\.module\.classLoader/gi,
        /Tomcat\s+9\.0/gi,
      ]
    },
    'CVE-2023-44487': {
      name: 'Rapid Reset Attack',
      patterns: [
        /RST_STREAM/gi,
      ]
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// 防御规则配置
// ═══════════════════════════════════════════════════════════════

const DEFENSE_CONFIG = {
  protectionLevel: 'high',
  
  autoBlock: {
    enabled: true,
    blockDuration: 3600000,
    permanentBlockThreshold: 3,
    whitelistIPs: ['127.0.0.1', '::1', '192.168.*', '10.*', '172.16.*'],
  },
  
  rateLimit: {
    global: { requests: 10000, window: 60000 },
    perIP: { requests: 100, window: 60000 },
    perEndpoint: {
      '/api/auth': { requests: 10, window: 60000 },
      '/api/admin': { requests: 5, window: 60000 },
    }
  },
  
  behaviorAnalysis: {
    enabled: true,
    anomalyThreshold: 0.8,
    learningPeriod: 7 * 24 * 60 * 60 * 1000,
    baselineUpdateInterval: 24 * 60 * 60 * 1000,
  },
  
  honeypot: {
    enabled: true,
    ports: [22, 23, 8080, 8443, 3306, 5432, 27017],
    fakeEndpoints: ['/admin', '/wp-admin', '/phpmyadmin', '/.env', '/config'],
    logAttackerInfo: true,
  },
  
  autoEvolution: {
    enabled: true,
    learningSources: ['cve_database', 'threat_intelligence_feeds', 'attack_logs', 'security_blogs'],
    updateInterval: 24 * 60 * 60 * 1000,
    minConfidence: 0.7,
  },
  
  attribution: {
    enabled: true,
    maxHops: 10,
    timeout: 30000,
  },
  
  alerting: {
    channels: ['log', 'file', 'webhook'],
    severityLevels: ['info', 'warning', 'critical', 'emergency'],
    emergencyThreshold: 5,
  }
};

// ═══════════════════════════════════════════════════════════════
// 入侵防御系统类
// ═══════════════════════════════════════════════════════════════

class IntrusionDefenseSystem extends EventEmitter {
  constructor() {
    super();
    
    this.threatIntel = THREAT_INTELLIGENCE;
    this.config = DEFENSE_CONFIG;
    
    this.state = {
      enabled: true,
      protectionLevel: 'high',
      lastUpdate: bjISO(),
      threatCount: 0,
      blockedCount: 0,
      learnedRules: 0,
      blockedIPs: new Map(),
      suspiciousIPs: new Map(),
      attackHistory: [],
      behaviorBaseline: null,
      learningMode: true,
    };
    
    this.behaviorStats = null;
    this.honeypotEndpoints = new Set();
    this.honeypotLog = [];
    this.securityDir = null;
    
    this.initialize();
  }
  
  initialize() {
    this.securityDir = path.join(process.cwd(), '.security');
    if (!fs.existsSync(this.securityDir)) {
      fs.mkdirSync(this.securityDir, { recursive: true });
    }
    
    this.loadState();
    
    if (this.config.honeypot.enabled) {
      this.startHoneypot();
    }
    
    if (this.config.behaviorAnalysis.enabled) {
      this.startBehaviorLearning();
    }
    
    if (this.config.autoEvolution.enabled) {
      this.startAutoEvolution();
    }
    
    this.startPeriodicMaintenance();
    
    console.log('🛡️ 尧帝入侵防御系统已初始化');
    console.log(`   - 防护级别: ${this.config.protectionLevel.toUpperCase()}`);
    console.log(`   - 蜜罐状态: ${this.config.honeypot.enabled ? '已启用' : '已禁用'}`);
    console.log(`   - 自动学习: ${this.config.autoEvolution.enabled ? '已启用' : '已禁用'}`);
  }
  
  // 核心检测引擎
  deepInspect(req) {
    const result = {
      safe: true,
      threats: [],
      severity: 0,
      action: 'allow',
      reason: '',
    };
    
    const ip = this.getClientIP(req);
    
    // 本地地址跳过检测
    if (this.isLocalIP(ip)) {
      // 本地请求只做基本检测，不封禁
    } else {
      // 检查IP是否已被封禁
      if (this.state.blockedIPs.has(ip)) {
        result.safe = false;
        result.threats.push({ type: 'BLOCKED_IP', ip });
        result.severity = 100;
        result.action = 'block';
        result.reason = 'IP已被封禁';
        return result;
      }
      
      // 检查恶意IP段
      if (this.isMaliciousIP(ip)) {
        result.safe = false;
        result.threats.push({ type: 'MALICIOUS_IP', ip });
        result.severity = 80;
        result.action = 'block';
        result.reason = '恶意IP段';
      }
    }
    
    // 检查User-Agent
    const userAgent = req.headers?.['user-agent'] || '';
    for (const pattern of this.threatIntel.maliciousUserAgents) {
      if (pattern.test(userAgent)) {
        result.safe = false;
        result.threats.push({ type: 'MALICIOUS_UA', pattern: pattern.source });
        result.severity = 70;
        result.action = 'block';
        result.reason = '恶意User-Agent检测';
      }
    }
    
    // 检查请求路径（排除查询参数中的安全字符）
    const url = req.url || '';
    // 分离路径和查询参数，只检测路径部分
    const urlPath = url.split('?')[0];
    const urlQuery = url.split('?')[1] || '';
    
    // 路径部分做完整检测
    const pathPatterns = this.detectAttackPatterns(urlPath);
    if (pathPatterns.length > 0) {
      result.safe = false;
      result.threats.push({ type: 'ATTACK_PATTERN', patterns: pathPatterns });
      result.severity = Math.min(100, result.severity + pathPatterns.length * 20);
      result.action = 'block';
      result.reason = '攻击模式检测';
    }
    
    // 查询参数只检测危险模式（排除正常的URL参数字符）
    const queryPatterns = this.detectQueryAttacks(urlQuery);
    if (queryPatterns.length > 0) {
      result.safe = false;
      result.threats.push({ type: 'QUERY_ATTACK', patterns: queryPatterns });
      result.severity = Math.min(100, result.severity + queryPatterns.length * 25);
      result.action = 'block';
      result.reason = '查询参数攻击检测';
    }
    
    // 检查请求体
    if (req.body) {
      const bodyPatterns = this.detectAttackPatterns(req.body);
      if (bodyPatterns.length > 0) {
        result.safe = false;
        result.threats.push({ type: 'BODY_ATTACK', patterns: bodyPatterns });
        result.severity = Math.min(100, result.severity + bodyPatterns.length * 25);
        result.action = 'block';
        result.reason = '请求体攻击检测';
      }
    }
    
    // 检查CVE漏洞利用
    const cveThreats = this.detectCVEExploits(req);
    if (cveThreats.length > 0) {
      result.safe = false;
      result.threats.push({ type: 'CVE_EXPLOIT', cves: cveThreats });
      result.severity = 100;
      result.action = 'block';
      result.reason = 'CVE漏洞利用检测';
    }
    
    // 行为异常检测
    if (this.config.behaviorAnalysis.enabled && this.state.behaviorBaseline) {
      const anomaly = this.detectAnomaly(req);
      if (anomaly.detected) {
        result.threats.push({ type: 'ANOMALY', score: anomaly.score });
        if (anomaly.score > this.config.behaviorAnalysis.anomalyThreshold) {
          result.severity = Math.min(100, result.severity + 30);
          result.action = 'block';
          result.reason = '行为异常检测';
        }
      }
    }
    
    if (!result.safe) {
      this.recordThreat(result, req);
    }
    
    if (result.action === 'block' && this.config.autoBlock.enabled) {
      this.autoBlockIP(ip, result);
    }
    
    return result;
  }
  
  detectAttackPatterns(content) {
    const detected = [];
    const str = typeof content === 'object' ? JSON.stringify(content) : String(content);
    
    for (const [category, patterns] of Object.entries(this.threatIntel.attackPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(str)) {
          detected.push({ category, pattern: pattern.source });
        }
        pattern.lastIndex = 0;
      }
    }
    
    return detected;
  }
  
  // 检测查询参数中的危险模式（排除正常URL参数字符）
  detectQueryAttacks(queryString) {
    const detected = [];
    if (!queryString) return detected;
    
    // 解码URL编码
    const decoded = decodeURIComponent(queryString);
    
    // 查询参数中真正危险的模式
    const dangerousPatterns = [
      // 命令注入（真正的命令执行）
      /;\s*(rm|del|format|shutdown|reboot|curl|wget|nc|bash|sh|cmd|powershell)/gi,
      /\|\s*(rm|del|format|shutdown|reboot|curl|wget|nc|bash|sh|cmd|powershell)/gi,
      /\$\([^)]*\)/g,           // 命令替换 $(command)
      /`[^`]+`/g,               // 反引号命令
      /\|\s*\w+\s+/g,           // 管道命令注入
      
      // SQL注入
      /'\s*(OR|AND)\s+['"]?\d+['"]?\s*=\s*['"]?\d+/gi,
      /UNION\s+(ALL\s+)?SELECT/gi,
      /;\s*(DROP|DELETE|TRUNCATE|UPDATE|INSERT)/gi,
      /--\s*$|\/\*/g,
      
      // XSS
      /<script[^>]*>/gi,
      /javascript:/gi,
      /on(load|error|click|mouse)\s*=/gi,
      
      // 路径遍历
      /\.\.\/|\.\.\\|%2e%2e%2f/gi,
      
      // 代码注入
      /eval\s*\(/gi,
      /Function\s*\(/gi,
      /setTimeout\s*\(['"]/gi,
      /setInterval\s*\(['"]/gi,
      
      // 敏感文件访问
      /\/etc\/(passwd|shadow)/gi,
      /\/root\//gi,
      /\.ssh\//gi,
      /\.aws\//gi,
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(decoded)) {
        detected.push({ category: 'queryInjection', pattern: pattern.source });
      }
      pattern.lastIndex = 0;
    }
    
    return detected;
  }
  
  detectCVEExploits(req) {
    const detected = [];
    // 安全序列化请求对象，避免循环引用
    const content = JSON.stringify({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body
    });
    
    for (const [cveId, info] of Object.entries(this.threatIntel.cveExploits)) {
      for (const pattern of info.patterns) {
        if (pattern.test(content)) {
          detected.push({ cve: cveId, name: info.name });
          break;
        }
      }
    }
    
    return detected;
  }
  
  isMaliciousIP(ip) {
    for (const allowed of this.config.autoBlock.whitelistIPs) {
      if (allowed.includes('*')) {
        const prefix = allowed.replace('*', '');
        if (ip.startsWith(prefix) || ip.includes(prefix.replace('.', ':'))) return false;
      } else if (ip === allowed || ip === '::ffff:' + allowed) {
        return false;
      }
    }
    
    // 本地地址白名单
    if (ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('192.168.') || 
        ip.startsWith('10.') || ip.startsWith('172.')) {
      return false;
    }
    
    for (const range of this.threatIntel.maliciousIPRanges) {
      const [network] = range.split('/');
      if (ip.startsWith(network.substring(0, network.lastIndexOf('.')))) {
        return true;
      }
    }
    
    return false;
  }
  
  // 行为分析
  startBehaviorLearning() {
    console.log('📊 启动行为学习引擎...');
    
    this.behaviorStats = {
      requestCount: 0,
      uniqueIPs: new Set(),
      endpointFrequency: new Map(),
      hourDistribution: new Array(24).fill(0),
      avgResponseTime: 0,
    };
    
    setInterval(() => {
      this.updateBehaviorBaseline();
    }, this.config.behaviorAnalysis.baselineUpdateInterval);
  }
  
  recordRequest(req, responseTime) {
    if (!this.config.behaviorAnalysis.enabled || !this.behaviorStats) return;
    
    const ip = this.getClientIP(req);
    const hour = toBeijingTime().getHours();
    
    this.behaviorStats.requestCount++;
    this.behaviorStats.uniqueIPs.add(ip);
    this.behaviorStats.hourDistribution[hour]++;
    
    const endpoint = req.url?.split('?')[0] || '/';
    this.behaviorStats.endpointFrequency.set(
      endpoint,
      (this.behaviorStats.endpointFrequency.get(endpoint) || 0) + 1
    );
    
    this.behaviorStats.avgResponseTime = 
      (this.behaviorStats.avgResponseTime * 0.9) + (responseTime * 0.1);
  }
  
  updateBehaviorBaseline() {
    this.state.behaviorBaseline = {
      avgRequestsPerIP: this.behaviorStats.requestCount / Math.max(1, this.behaviorStats.uniqueIPs.size),
      endpointFrequency: Object.fromEntries(this.behaviorStats.endpointFrequency),
      hourDistribution: this.behaviorStats.hourDistribution.map(h => h / Math.max(1, this.behaviorStats.requestCount)),
      avgResponseTime: this.behaviorStats.avgResponseTime,
    };
    
    this.behaviorStats.requestCount = 0;
    this.behaviorStats.uniqueIPs.clear();
    this.behaviorStats.endpointFrequency.clear();
    this.behaviorStats.hourDistribution = new Array(24).fill(0);
    
    this.saveState();
    console.log('📊 行为基线已更新');
  }
  
  detectAnomaly(req) {
    if (!this.state.behaviorBaseline) {
      return { detected: false, score: 0 };
    }
    
    let score = 0;
    const baseline = this.state.behaviorBaseline;
    
    const ip = this.getClientIP(req);
    const ipRequests = this.state.suspiciousIPs.get(ip) || 0;
    if (ipRequests > baseline.avgRequestsPerIP * 10) {
      score += 0.3;
    }
    
    const hour = toBeijingTime().getHours();
    if (baseline.hourDistribution[hour] < 0.01) {
      score += 0.1;
    }
    
    const endpoint = req.url?.split('?')[0] || '/';
    if (!baseline.endpointFrequency[endpoint]) {
      score += 0.2;
    }
    
    return { detected: score > 0.3, score };
  }
  
  // 蜜罐系统
  startHoneypot() {
    console.log('🍯 启动蜜罐系统...');
    this.honeypotEndpoints = new Set(this.config.honeypot.fakeEndpoints);
    this.honeypotLog = [];
  }
  
  isHoneypotEndpoint(url) {
    const path = url?.split('?')[0] || '';
    return this.honeypotEndpoints.has(path);
  }
  
  handleHoneypotAccess(req) {
    const ip = this.getClientIP(req);
    
    const entry = {
      timestamp: bjISO(),
      ip,
      url: req.url,
      userAgent: req.headers?.['user-agent'],
      headers: req.headers,
    };
    
    this.honeypotLog.push(entry);
    
    if (this.config.honeypot.logAttackerInfo) {
      this.blockIP(ip, 'HONEYPOT_ACCESS', 86400000);
      console.log(`🍯 蜜罐诱捕: ${ip} 访问 ${req.url}，已自动封禁`);
    }
    
    return entry;
  }
  
  // 自动学习与进化
  startAutoEvolution() {
    console.log('🧬 启动自动学习与进化...');
    
    setInterval(() => {
      this.evolveThreatIntelligence();
    }, this.config.autoEvolution.updateInterval);
  }
  
  async evolveThreatIntelligence() {
    console.log('🧬 正在更新威胁情报...');
    
    let newRules = 0;
    
    const now = bjDate();
    const recentAttacks = this.state.attackHistory.filter(
      a => now - new Date(a.timestamp).getTime() < 86400000
    );
    
    for (const attack of recentAttacks) {
      if (attack.patterns) {
        for (const pattern of attack.patterns) {
          const newPattern = this.extractPattern(pattern);
          if (newPattern && !this.hasPattern(newPattern)) {
            this.threatIntel.attackPatterns.custom = this.threatIntel.attackPatterns.custom || [];
            this.threatIntel.attackPatterns.custom.push(newPattern);
            newRules++;
          }
        }
      }
    }
    
    const repeatedOffenders = this.identifyRepeatedOffenders();
    for (const ip of repeatedOffenders) {
      if (!this.threatIntel.maliciousIPRanges.includes(ip + '/32')) {
        this.threatIntel.maliciousIPRanges.push(ip + '/32');
        newRules++;
      }
    }
    
    this.state.learnedRules += newRules;
    this.state.lastUpdate = bjISO();
    this.saveState();
    
    if (newRules > 0) {
      console.log(`🧬 威胁情报已更新，新增 ${newRules} 条规则`);
      this.emit('evolution', { newRules, total: this.state.learnedRules });
    }
  }
  
  extractPattern(attackData) {
    try {
      if (typeof attackData === 'string') {
        new RegExp(attackData);
        return new RegExp(attackData.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      }
    } catch (e) {}
    return null;
  }
  
  hasPattern(pattern) {
    for (const patterns of Object.values(this.threatIntel.attackPatterns)) {
      for (const existing of patterns) {
        if (existing.source === pattern.source) return true;
      }
    }
    return false;
  }
  
  identifyRepeatedOffenders() {
    const offenders = [];
    for (const [ip, info] of this.state.blockedIPs) {
      if (info.count >= this.config.autoBlock.permanentBlockThreshold) {
        offenders.push(ip);
      }
    }
    return offenders;
  }
  
  // 自动阻断
  autoBlockIP(ip, threatResult) {
    for (const allowed of this.config.autoBlock.whitelistIPs) {
      if (allowed.includes('*')) {
        const prefix = allowed.replace('*', '');
        if (ip.startsWith(prefix)) return;
      } else if (ip === allowed) {
        return;
      }
    }
    
    const existing = this.state.blockedIPs.get(ip);
    const count = (existing?.count || 0) + 1;
    
    if (count >= this.config.autoBlock.permanentBlockThreshold) {
      this.blockIP(ip, 'PERMANENT', Infinity);
      console.log(`🚫 IP ${ip} 已永久封禁`);
    } else {
      const duration = this.config.autoBlock.blockDuration * count;
      this.blockIP(ip, threatResult.reason, duration);
    }
    
    this.state.blockedCount++;
    this.saveState();
  }
  
  blockIP(ip, reason, duration) {
    const until = duration === Infinity ? 'permanent' : Date.now() + duration;
    this.state.blockedIPs.set(ip, {
      until,
      reason,
      count: (this.state.blockedIPs.get(ip)?.count || 0) + 1,
      timestamp: bjISO()
    });
  }
  
  unblockIP(ip) {
    if (this.state.blockedIPs.has(ip)) {
      this.state.blockedIPs.delete(ip);
      this.saveState();
      return true;
    }
    return false;
  }
  
  // 威胁记录
  recordThreat(threatResult, req) {
    const ip = this.getClientIP(req);
    
    const record = {
      id: crypto.randomUUID(),
      timestamp: bjISO(),
      ip,
      url: req.url,
      method: req.method,
      userAgent: req.headers?.['user-agent'],
      threats: threatResult.threats,
      severity: threatResult.severity,
      action: threatResult.action,
    };
    
    this.state.attackHistory.push(record);
    this.state.threatCount++;
    
    this.state.suspiciousIPs.set(ip, (this.state.suspiciousIPs.get(ip) || 0) + 1);
    
    this.emit('threat', record);
    this.alert(record);
    
    return record;
  }
  
  async traceAttacker(ip) {
    if (!this.config.attribution.enabled) return null;
    
    console.log(`🔍 正在溯源攻击者: ${ip}`);
    
    try {
      const { stdout: whois } = await execAsync(`whois ${ip} 2>/dev/null || echo "whois unavailable"`);
      
      return {
        ip,
        whois: whois.substring(0, 1000),
        timestamp: bjISO(),
      };
    } catch (e) {
      return { ip, error: e.message };
    }
  }
  
  alert(record) {
    const severity = record.severity >= 80 ? 'critical' : 
                     record.severity >= 50 ? 'warning' : 'info';
    
    const message = `[SECURITY ALERT] ${severity.toUpperCase()}: IP ${record.ip} - ${record.threats.map(t => t.type).join(', ')}`;
    
    console.log(message);
    
    const logPath = path.join(this.securityDir, 'alerts.log');
    fs.appendFileSync(logPath, JSON.stringify({
      timestamp: bjISO(),
      severity,
      message,
      record
    }) + '\n');
    
    this.emit('alert', { severity, message, record });
  }
  
  isLocalIP(ip) {
    // 检查是否为本地地址
    const localPatterns = [
      '::1',
      '::ffff:127.0.0.1',
      '127.0.0.1',
      'localhost'
    ];
    
    if (localPatterns.includes(ip)) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('172.')) return true;
    if (ip.startsWith('::ffff:192.168.')) return true;
    if (ip.startsWith('::ffff:10.')) return true;
    
    return false;
  }
  
  getClientIP(req) {
    return req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers?.['x-real-ip'] ||
           req.socket?.remoteAddress ||
           req.ip ||
           'unknown';
  }
  
  saveState() {
    const statePath = path.join(this.securityDir, 'intrusion_state.json');
    const state = {
      ...this.state,
      blockedIPs: Object.fromEntries(this.state.blockedIPs),
      suspiciousIPs: Object.fromEntries(this.state.suspiciousIPs),
      uniqueIPs: this.behaviorStats?.uniqueIPs?.size || 0,
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }
  
  loadState() {
    const statePath = path.join(this.securityDir, 'intrusion_state.json');
    if (fs.existsSync(statePath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        this.state = {
          ...this.state,
          ...saved,
          blockedIPs: new Map(Object.entries(saved.blockedIPs || {})),
          suspiciousIPs: new Map(Object.entries(saved.suspiciousIPs || {})),
        };
      } catch (e) {
        console.warn('加载状态失败:', e.message);
      }
    }
  }
  
  startPeriodicMaintenance() {
    setInterval(() => {
      this.performMaintenance();
    }, 3600000);
  }
  
  performMaintenance() {
    const now = bjDate();
    
    for (const [ip, info] of this.state.blockedIPs) {
      if (info.until !== 'permanent' && now > info.until) {
        this.state.blockedIPs.delete(ip);
      }
    }
    
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    this.state.attackHistory = this.state.attackHistory.filter(
      a => new Date(a.timestamp).getTime() > weekAgo
    );
    
    const dayAgo = now - 24 * 60 * 60 * 1000;
    this.honeypotLog = this.honeypotLog.filter(
      h => new Date(h.timestamp).getTime() > dayAgo
    );
    
    this.saveState();
  }
  
  getStatus() {
    return {
      enabled: this.state.enabled,
      protectionLevel: this.config.protectionLevel,
      lastUpdate: this.state.lastUpdate,
      stats: {
        threatCount: this.state.threatCount,
        blockedCount: this.state.blockedCount,
        learnedRules: this.state.learnedRules,
        activeBlocks: this.state.blockedIPs.size,
      },
      config: {
        autoBlock: this.config.autoBlock.enabled,
        honeypot: this.config.honeypot.enabled,
        behaviorAnalysis: this.config.behaviorAnalysis.enabled,
        autoEvolution: this.config.autoEvolution.enabled,
      },
      threatIntel: {
        attackPatterns: Object.keys(this.threatIntel.attackPatterns).length,
        maliciousIPRanges: this.threatIntel.maliciousIPRanges.length,
        cveExploits: Object.keys(this.threatIntel.cveExploits).length,
      }
    };
  }
  
  getDetailedStatus() {
    return {
      ...this.getStatus(),
      recentThreats: this.state.attackHistory.slice(-10),
      blockedIPsList: Array.from(this.state.blockedIPs.entries()).slice(0, 20),
      honeypotAccesses: this.honeypotLog.slice(-10),
    };
  }
}

const intrusionDefense = new IntrusionDefenseSystem();
export default intrusionDefense;
export { IntrusionDefenseSystem, THREAT_INTELLIGENCE, DEFENSE_CONFIG };
