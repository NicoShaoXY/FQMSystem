// backend/auto_train_config.js (ES module version)
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { cpus, totalmem, freemem } from 'os';
import { execSync } from 'child_process';

// === 自动训练配置持久化 ===
const autoTrainConfigPath = join(dirname(new URL(import.meta.url).pathname), 'config', 'auto_train.json');

export function loadAutoTrainConfig() {
  try {
    if (existsSync(autoTrainConfigPath)) {
      const configData = readFileSync(autoTrainConfigPath, 'utf8');
      Object.assign(global.xgboostAutoTrainConfig, JSON.parse(configData));
      console.log('[AutoTrain] 加载配置文件成功');
    } else {
      saveAutoTrainConfig();
    }
  } catch (e) {
    console.error('[AutoTrain] 加载配置失败:', e.message);
  }
}

export function saveAutoTrainConfig() {
  try {
    const configDir = dirname(autoTrainConfigPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeFileSync(autoTrainConfigPath, JSON.stringify(global.xgboostAutoTrainConfig, null, 2), 'utf8');
    console.log('[AutoTrain] 配置保存成功');
  } catch (e) {
    console.error('[AutoTrain] 保存配置失败:', e.message);
  }
}

// === 智能CPU阈值 ===
let lastCpuInfo = null;
let lastTime = null;
let _yieldCounter = 0;
let _lastYieldTime = 0;

// 获取CPU使用率（轻量级，不额外增加CPU负担）
export function getCpuUsage() {
  const currentCpuInfo = cpus();
  const currentTime = Date.now();
  
  if (!lastCpuInfo || !lastTime) {
    lastCpuInfo = currentCpuInfo;
    lastTime = currentTime;
    return 0;
  }

  let totalIdle = 0, totalTick = 0;
  for (let i = 0; i < currentCpuInfo.length; i++) {
    const last = lastCpuInfo[i].times;
    const current = currentCpuInfo[i].times;
    
    const idle = current.idle - last.idle;
    const tick = Object.values(current).reduce((a, b) => a + b, 0) - 
                 Object.values(last).reduce((a, b) => a + b, 0);
    
    totalIdle += idle;
    totalTick += tick;
  }

  const usage = totalTick === 0 ? 0 : 100 - (totalIdle / totalTick * 100);
  lastCpuInfo = currentCpuInfo;
  lastTime = currentTime;
  
  return parseFloat(usage.toFixed(2));
}

// 异步让步：每 N 次迭代检查一次，高CPU时自动sleep
// options.cpuThreshold: 阈值(默认80), yaodiControlled: 是否尧帝控制
let _pendingYield = false;

export function checkCpuAndYield(cpuThreshold, force = false) {
  _yieldCounter++;
  const now = Date.now();
  // 每50次迭代检查一次，或force强制检查
  if (_yieldCounter % 50 !== 0 && !force) return;
  
  const cpu = getCpuUsage();
  const memUsage = ((totalmem() - freemem()) / totalmem()) * 100;
  
  let effectiveThreshold = cpuThreshold || 80;
  if (yaodiControlled()) effectiveThreshold = getSmartCpuThreshold();
  if (memUsage > 80) effectiveThreshold = Math.min(effectiveThreshold, 60);
  
  if (cpu > effectiveThreshold || memUsage > 90) {
    const sleepMs = cpu > 90 ? 500 : cpu > 80 ? 200 : 100;
    const elapsed = now - _lastYieldTime;
    if (elapsed > sleepMs) {
      _pendingYield = true;
      _lastYieldTime = now;
    }
  }
}

export function shouldYield() {
  if (!_pendingYield) return false;
  _pendingYield = false;
  return true;
}

// 尧帝智能CPU阈值（从global.xgboostAutoTrainConfig读取）
export function yaodiControlled() {
  return typeof global !== 'undefined' && global.xgboostAutoTrainConfig?.autoTrain === true;
}

export function getSmartCpuThreshold() {
  const cpuUsage = getCpuUsage();
  const memUsage = ((totalmem() - freemem()) / totalmem()) * 100;
  
  let threshold = 80;
  try {
    const loadAvg = parseFloat(execSync('sysctl -n vm.loadavg').toString().trim().split(' ')[0]);
    const cpuCount = cpus().length;
    threshold = loadAvg > cpuCount * 0.7 ? 50 : 90;
  } catch (e) {
    // 使用默认阈值
  }

  if (memUsage > 80) threshold = Math.min(threshold, 60);
  if (cpuUsage > threshold) threshold = Math.max(30, threshold - 20);
  
  return threshold;
}
