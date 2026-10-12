// backend/utils/system_status.js (CommonJS version)
const { cpus, totalmem, freemem } = require('os');
const { execSync } = require('child_process');

let lastCpuInfo = null;
let lastTime = null;

function getCpuUsage() {
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

function getSmartCpuThreshold() {
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

module.exports = { getCpuUsage, getSmartCpuThreshold };
