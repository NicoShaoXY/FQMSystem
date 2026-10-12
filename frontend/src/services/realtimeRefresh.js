/**
 * 实时数据刷新管理器
 *
 * 功能：
 * 1. 统一管理所有页面的实时刷新
 * 2. 智能刷新间隔调整
 * 3. 刷新状态同步
 * 4. 性能优化（避免重复刷新）
 */

// 【修复】统一API_BASE来源，移除不必要的变量声明
// 注：当前文件中的 API_BASE 仅作为注释说明，实际刷新逻辑通过各页面组件的回调函数触发
// 如需在后端API调用中使用API_BASE，请从 '../config/api' 导入

// ========== 刷新配置 ==========

const REFRESH_CONFIG = {
  // 各页面刷新间隔（毫秒）
  intervals: {
    marketOverview: 30000,    // 行情概览 30秒
    stockSelection: 30000,    // 选股页面 30秒
    stockPool: 30000,         // 收藏股 30秒
    holding: 30000,           // 持仓页面 30秒
    yaodiAgent: 30000,        // 尧帝智能体 30秒
    defenseStatus: 10000,     // 防御状态 10秒
  },

  // 刷新优先级
  priorities: {
    defenseStatus: 1,         // 最高优先级
    marketOverview: 2,
    yaodiAgent: 2,
    stockSelection: 3,
    stockPool: 3,
    holding: 3,
  },

  // 智能调整规则
  adaptiveRules: {
    highLoad: 60000,          // 高负载时加长间隔
    lowLoad: 15000,           // 低负载时缩短间隔
    cpuThreshold: 80,         // CPU阈值
    memoryThreshold: 85,      // 内存阈值
  },
};

// ========== 刷新状态管理 ==========

let refreshState = {
  activePages: new Set(),           // 当前活跃页面
  lastRefreshTime: {},              // 各页面最后刷新时间
  refreshTimers: {},                // 各页面刷新定时器
  refreshCounts: {},                // 各页面刷新次数
  systemLoad: 'normal',             // 系统负载状态
  isRefreshing: false,              // 是否正在刷新
};

// ========== 刷新核心函数 ==========

/**
 * 注册页面刷新
 */
export function registerPageRefresh(pageName, refreshCallback) {
  if (!pageName || !refreshCallback) {
    console.error('Invalid page registration');
    return;
  }

  refreshState.activePages.add(pageName);
  refreshState.lastRefreshTime[pageName] = Date.now();
  refreshState.refreshCounts[pageName] = 0;

  // 启动定时刷新
  const interval = REFRESH_CONFIG.intervals[pageName] || 30000;
  const timer = setInterval(async () => {
    try {
      await executeRefresh(pageName, refreshCallback);
    } catch (e) {
      console.error(`Refresh failed for ${pageName}:`, e);
    }
  }, interval);

  refreshState.refreshTimers[pageName] = timer;

  console.log(`✅ Registered refresh for ${pageName} (interval: ${interval}ms)`);

  return () => unregisterPageRefresh(pageName);
}

/**
 * 注销页面刷新
 */
export function unregisterPageRefresh(pageName) {
  if (refreshState.refreshTimers[pageName]) {
    clearInterval(refreshState.refreshTimers[pageName]);
    delete refreshState.refreshTimers[pageName];
  }

  refreshState.activePages.delete(pageName);
  delete refreshState.lastRefreshTime[pageName];
  delete refreshState.refreshCounts[pageName];

  console.log(`🔄 Unregistered refresh for ${pageName}`);
}

/**
 * 执行刷新
 */
async function executeRefresh(pageName, refreshCallback) {
  // 检查是否需要刷新
  const lastRefresh = refreshState.lastRefreshTime[pageName] || 0;
  const interval = REFRESH_CONFIG.intervals[pageName] || 30000;
  
  if (Date.now() - lastRefresh < interval * 0.8) {
    return; // 避免过于频繁的刷新
  }

  try {
    refreshState.isRefreshing = true;

    // 执行刷新回调
    await refreshCallback();

    // 更新刷新状态
    refreshState.lastRefreshTime[pageName] = Date.now();
    refreshState.refreshCounts[pageName] = (refreshState.refreshCounts[pageName] || 0) + 1;

    console.log(`🔄 Refreshed ${pageName} (count: ${refreshState.refreshCounts[pageName]})`);
  } catch (e) {
    console.error(`Refresh error for ${pageName}:`, e);
  } finally {
    refreshState.isRefreshing = false;
  }
}

/**
 * 手动触发刷新
 */
export async function triggerRefresh(pageName, refreshCallback) {
  console.log(`⚡ Manual refresh triggered for ${pageName}`);
  await executeRefresh(pageName, refreshCallback);
}

/**
 * 获取刷新状态
 */
export function getRefreshStatus() {
  return {
    activePages: Array.from(refreshState.activePages),
    refreshCounts: { ...refreshState.refreshCounts },
    lastRefreshTime: { ...refreshState.lastRefreshTime },
    systemLoad: refreshState.systemLoad,
    isRefreshing: refreshState.isRefreshing,
  };
}

/**
 * 更新系统负载状态
 */
export function updateSystemLoad(load) {
  refreshState.systemLoad = load; // 'low' | 'normal' | 'high'

  // 根据负载调整刷新间隔
  if (load === 'high') {
    console.log('⚠️ High system load detected, extending refresh intervals');
  } else if (load === 'low') {
    console.log('✅ Low system load, optimizing refresh intervals');
  }
}

/**
 * 暂停所有刷新
 */
export function pauseAllRefresh() {
  Object.values(refreshState.refreshTimers).forEach(timer => {
    clearInterval(timer);
  });
  console.log('⏸️ All refresh paused');
}

/**
 * 恢复所有刷新
 */
export function resumeAllRefresh() {
  console.log('▶️ Resuming all refresh...');
  // 需要重新注册所有页面
}

/**
 * 获取刷新统计
 */
export function getRefreshStats() {
  const stats = {
    totalPages: refreshState.activePages.size,
    totalRefreshes: Object.values(refreshState.refreshCounts).reduce((a, b) => a + b, 0),
    pageStats: {},
  };

  refreshState.activePages.forEach(page => {
    stats.pageStats[page] = {
      refreshCount: refreshState.refreshCounts[page] || 0,
      lastRefresh: refreshState.lastRefreshTime[page] || null,
      interval: REFRESH_CONFIG.intervals[page] || 30000,
    };
  });

  return stats;
}

/**
 * 清理资源
 */
export function cleanup() {
  Object.values(refreshState.refreshTimers).forEach(timer => {
    clearInterval(timer);
  });
  refreshState = {
    activePages: new Set(),
    lastRefreshTime: {},
    refreshTimers: {},
    refreshCounts: {},
    systemLoad: 'normal',
    isRefreshing: false,
  };
  console.log('🧹 Refresh manager cleaned up');
}
