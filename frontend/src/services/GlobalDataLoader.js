// GlobalDataLoader.js - 分层数据加载器（精简版）
// 【修复】统一API_BASE来源
import { API_BASE } from '../config/api';

function fetchJSON(url, timeout = 5000) {
  return fetch(url, { signal: AbortSignal.timeout(timeout) }).then(r => r.json());
}

// 初始化全局加载器
export function initGlobalDataLoader() {
  // 通知功能已在App.jsx的checkShundiNotifications中实现
  // 此处仅保留基础加载逻辑（空实现）
  console.log('[GlobalDataLoader] 已初始化');
  return Promise.resolve();  // 返回Promise以支持.catch()
}

export default { initGlobalDataLoader };
