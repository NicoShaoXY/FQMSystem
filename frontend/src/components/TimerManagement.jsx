import React, { useState, useEffect } from 'react';
import { Timer, Play, Square, Settings, BarChart3, AlertCircle, CheckCircle, XCircle, RefreshCw, Zap, ArrowDown, ArrowUp } from 'lucide-react';
import { themeColors } from '../theme';

/**
 * 定时器管理组件
 * 功能：管理数据源自动刷新的定时器（启动/停止/配置/监控）
 */
function TimerManagement() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState({});
  const [saving, setSaving] = useState(false);

  // 获取监控指标
  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/refresh/metrics');
      const d = await res.json();
      if (d.success) {
        setMetrics(d.data);
        setError(null);
      } else {
        setError(d.error || '获取监控指标失败');
      }
    } catch (e) {
      setError('获取监控指标失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // 获取配置
  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/refresh/metrics');
      const d = await res.json();
      if (d.success && d.data.config) {
        setConfig(d.data.config);
      }
    } catch (e) {
      console.error('获取配置失败:', e);
    }
  };

  // 初始加载
  useEffect(() => {
    fetchMetrics();
    fetchConfig();
    
    // 30秒自动刷新
    const timer = setInterval(() => {
      fetchMetrics();
    }, 30000);
    
    return () => clearInterval(timer);
  }, []);

  // 启动所有定时器
  const handleStartAll = async () => {
    try {
      const res = await fetch('/api/refresh/start', { method: 'POST' });
      const d = await res.json();
      if (d.success) {
        alert('✅ 所有定时器已启动');
        fetchMetrics();
      } else {
        alert('❌ 启动失败: ' + (d.error || '未知错误'));
      }
    } catch (e) {
      alert('❌ 启动失败: ' + e.message);
    }
  };

  // 停止所有定时器
  const handleStopAll = async () => {
    try {
      const res = await fetch('/api/refresh/stop', { method: 'POST' });
      const d = await res.json();
      if (d.success) {
        alert('✅ 所有定时器已停止');
        fetchMetrics();
      } else {
        alert('❌ 停止失败: ' + (d.error || '未知错误'));
      }
    } catch (e) {
      alert('❌ 停止失败: ' + e.message);
    }
  };

  // 手动触发更新
  const handleTrigger = async (source) => {
    try {
      const res = await fetch(`/api/refresh/trigger/${source}`, { method: 'POST' });
      const d = await res.json();
      if (d.success) {
        alert(`✅ ${source} 手动更新完成 (耗时: ${d.data.duration}ms)`);
        fetchMetrics();
      } else {
        alert(`❌ ${source} 手动更新失败: ` + (d.error || '未知错误'));
      }
    } catch (e) {
      alert(`❌ ${source} 手动更新失败: ` + e.message);
    }
  };

  // 重启单个定时器
  const handleRestart = async (timerName) => {
    try {
      const res = await fetch(`/api/refresh/restart/${timerName}`, { method: 'POST' });
      const d = await res.json();
      if (d.success) {
        alert(`✅ ${timerName} 定时器已重启`);
        fetchMetrics();
      } else {
        alert(`❌ ${timerName} 重启失败: ` + (d.error || '未知错误'));
      }
    } catch (e) {
      alert(`❌ ${timerName} 重启失败: ` + e.message);
    }
  };

  // 更新配置
  const handleUpdateConfig = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/refresh/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const d = await res.json();
      if (d.success) {
        alert('✅ 配置已更新');
        setConfig(d.data.config || {});
        fetchMetrics();
      } else {
        alert('❌ 配置更新失败: ' + (d.error || '未知错误'));
      }
    } catch (e) {
      alert('❌ 配置更新失败: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // 格式化时间
  const formatTime = (iso) => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString('zh-CN', { hour12: false });
    } catch {
      return '-';
    }
  };

  // 格式化耗时
  const formatDuration = (ms) => {
    if (!ms && ms !== 0) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // 获取状态颜色
  const getStatusColor = (timerName) => {
    if (!metrics || !metrics.metrics) return 'text-gray-400';
    const m = metrics.metrics[timerName];
    if (!m) return 'text-gray-400';
    if (m.failureCount > 0 && m.successCount === 0) return 'text-red-500';
    if (m.failureCount > m.successCount) return 'text-yellow-500';
    return 'text-green-500';
  };

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600 dark:text-gray-300">加载定时器数据...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
        <button
          onClick={fetchMetrics}
          className="mt-2 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  const timerDisplayNames = {
    globalMarkets: '全球市场行情',
    moneyFlow: '资金流向TOP10',
    longhubang: '龙虎榜',
    reportSentiment: '券商研报情绪',
    socialSentiment: '社交情绪聚合',
    stockMainFlow: '个股主力资金'
  };

  return (
    <div className="space-y-6">
      {/* 标题和全局控制按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer className="w-6 h-6 text-blue-500" />
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">数据源定时器管理</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleStartAll}
            className="flex items-center gap-1 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
          >
            <Play className="w-4 h-4" />
            启动所有
          </button>
          <button
            onClick={handleStopAll}
            className="flex items-center gap-1 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
          >
            <Square className="w-4 h-4" />
            停止所有
          </button>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="flex items-center gap-1 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
          >
            <Settings className="w-4 h-4" />
            配置
          </button>
        </div>
      </div>

      {/* 配置面板 */}
      {showConfig && (
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-100">定时器配置</h3>
          <div className="space-y-4">
            {Object.keys(config).map(timerName => (
              <div key={timerName} className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-700 rounded">
                <span className="w-40 font-medium text-gray-700 dark:text-gray-200">
                  {timerDisplayNames[timerName] || timerName}
                </span>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config[timerName]?.enabled !== false}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      [timerName]: { ...prev[timerName], enabled: e.target.checked }
                    }))}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-300">启用</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-300">间隔(秒):</span>
                  <input
                    type="number"
                    value={(config[timerName]?.interval || 60000) / 1000}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      [timerName]: { ...prev[timerName], interval: parseInt(e.target.value) * 1000 }
                    }))}
                    className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                  />
                </label>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfig(false)}
                className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-800 dark:text-gray-100 rounded hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleUpdateConfig}
                disabled={saving}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存配置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 定时器列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics && metrics.metrics && Object.keys(metrics.metrics).map(timerName => {
          const m = metrics.metrics[timerName];
          const isRunning = metrics.activeTimers?.includes(timerName);
          const displayName = timerDisplayNames[timerName] || timerName;
          
          return (
            <div key={timerName} className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Timer className={`w-5 h-5 ${getStatusColor(timerName)}`} />
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">{displayName}</h3>
                </div>
                <div className="flex items-center gap-1">
                  {isRunning ? (
                    <span className="px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 rounded">
                      运行中
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 rounded">
                      已停止
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">最后运行:</span>
                  <span className="text-gray-800 dark:text-gray-100">{formatTime(m.lastRun)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">最后耗时:</span>
                  <span className="text-gray-800 dark:text-gray-100">{formatDuration(m.lastDuration)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">成功次数:</span>
                  <span className="text-green-600 dark:text-green-400">{m.successCount || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">失败次数:</span>
                  <span className="text-red-600 dark:text-red-400">{m.failureCount || 0}</span>
                </div>
                {m.lastError && (
                  <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/30 rounded text-xs text-red-600 dark:text-red-400">
                    最后错误: {m.lastError}
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => handleTrigger(timerName)}
                  className="flex-1 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-sm"
                >
                  手动触发
                </button>
                <button
                  onClick={() => handleRestart(timerName)}
                  className="flex-1 px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors text-sm"
                >
                  重启
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 监控指标汇总 */}
      {metrics && metrics.metrics && (
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-100">监控指标汇总</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700">
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-300">数据源</th>
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-300">状态</th>
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-300">最后运行</th>
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-300">最后耗时</th>
                  <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-300">成功/失败</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(metrics.metrics).map(timerName => {
                  const m = metrics.metrics[timerName];
                  const isRunning = metrics.activeTimers?.includes(timerName);
                  
                  return (
                    <tr key={timerName} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="px-4 py-2 text-gray-800 dark:text-gray-100">
                        {timerDisplayNames[timerName] || timerName}
                      </td>
                      <td className="px-4 py-2">
                        {isRunning ? (
                          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                            <CheckCircle className="w-4 h-4" />
                            运行中
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                            <XCircle className="w-4 h-4" />
                            已停止
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                        {formatTime(m.lastRun)}
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                        {formatDuration(m.lastDuration)}
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-green-600 dark:text-green-400">{m.successCount || 0}</span>
                        <span className="text-gray-400 dark:text-gray-500"> / </span>
                        <span className="text-red-600 dark:text-red-400">{m.failureCount || 0}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default TimerManagement;
