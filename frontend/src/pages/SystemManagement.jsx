import React, { useState, useEffect } from 'react';
import { systemAPI, datasourceAPI } from '../config/api';
import { Activity, Database, Server, RefreshCw, AlertTriangle, CheckCircle, XCircle, Settings, Shield, Zap } from 'lucide-react';

const SystemManagement = () => {
  const [health, setHealth] = useState(null);
  const [datasources, setDatasources] = useState(null);
  const [loading, setLoading] = useState(true);
  const [healing, setHealing] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ✅ 修复：将 fetchData 声明移到 useEffect 之前
  const fetchData = async () => {
    try {
      const [healthRes, dsRes] = await Promise.all([
        systemAPI.healthCheck().catch(() => null),
        datasourceAPI.getStatus().catch(() => null),
      ]);
      if (healthRes?.success) setHealth(healthRes.health);
      if (dsRes?.success) setDatasources(dsRes.datasource);
    } catch (e) {
      console.error('获取数据失败:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // 改为5秒实时刷新
    return () => clearInterval(interval);
  }, []);

  const handleSelfHeal = async () => {
    setHealing(true);
    try {
      const data = await systemAPI.selfHeal();
      if (data.success) {
        showToast('✅ 自愈完成: ' + (data.results?.join(', ') || '系统已修复'), 'success');
        fetchData();
      } else {
        showToast('❌ 自愈失败: ' + (data.error || '未知错误'), 'error');
      }
    } catch (e) {
      showToast('❌ 自愈失败: ' + e.message, 'error');
    }
    setHealing(false);
  };

  const handleDataSourceAction = async (source, action) => {
    try {
      const data = await datasourceAPI[action](source);
      if (data.success) {
        showToast(`✅ ${action} 成功`, 'success');
        fetchData();
      } else {
        showToast(`❌ ${action} 失败`, 'error');
      }
    } catch (e) {
      showToast(`❌ ${action} 失败: ${e.message}`, 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2">加载中...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white flex items-center gap-2`}>
          {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          {toast.message}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>系统管理</h1>
        <div className="flex gap-2">
          <button
            onClick={fetchData}
            className="px-4 py-2 rounded-lg flex items-center gap-2"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
          >
            <RefreshCw className="w-4 h-4" /> 刷新
          </button>
          <button
            onClick={handleSelfHeal}
            disabled={healing}
            className="px-4 py-2 rounded-lg flex items-center gap-2 bg-green-500/10 text-green-500 border border-green-500/30"
          >
            <Shield className="w-4 h-4" /> {healing ? '自愈中...' : '系统自愈'}
          </button>
        </div>
      </div>

      {health && (
        <div className="rounded-xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5" style={{ color: health?.status === 'healthy' ? '#52c41a' : '#faad14' }} />
            <h2 className="text-lg font-semibold">系统健康状态</h2>
            <span className={`px-2 py-1 rounded text-xs ${health?.status === 'healthy' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'}`}>
              {health?.status === 'healthy' ? '健康' : '降级'}
            </span>
            {/* 实时心跳指示器 */}
            <span className="ml-auto flex items-center gap-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              实时更新中
            </span>
          </div>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="p-4 rounded-lg" style={{ background: 'var(--bg-card)' }}>
              <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>运行时间</div>
              <div className="text-xl font-bold mt-1">{health?.uptimeStr || `${Math.floor((health?.uptime||0)/3600)}小时`}</div>
            </div>
            <div className="p-4 rounded-lg" style={{ background: 'var(--bg-card)' }}>
              <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>内存使用</div>
              <div className="text-xl font-bold mt-1">{health?.memory?.heapUsed}MB <span className="text-xs font-normal text-gray-500">({health?.memory?.heapPct}%)</span></div>
            </div>
            <div className="p-4 rounded-lg" style={{ background: 'var(--bg-card)' }}>
              <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>股票数据</div>
              <div className="text-xl font-bold mt-1">{health?.data?.stocks?.toLocaleString()}</div>
            </div>
            <div className="p-4 rounded-lg" style={{ background: 'var(--bg-card)' }}>
              <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>演化分支</div>
              <div className="text-xl font-bold mt-1">{health?.data?.branches?.toLocaleString()}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(health?.modules || {}).map(([name, status]) => (
              <div key={name} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'var(--bg-card)' }}>
                <span className="text-sm">{name}</span>
                <span className={`px-2 py-0.5 rounded text-xs ${status === 'running' || status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                  {status}
                </span>
              </div>
            ))}
          </div>
          {health?.issues?.length > 0 && (
            <div className="mt-4 p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
              <div className="flex items-center gap-2 mb-2 text-yellow-500">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-medium">发现问题</span>
              </div>
              {health.issues.map((issue, i) => (
                <div key={i} className="text-sm py-1" style={{ color: 'var(--text-secondary)' }}>
                  • {issue.module}: {issue.issue}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5" style={{ color: 'var(--accent-blue)' }} />
            <h2 className="text-lg font-semibold">数据源管理</h2>
            {datasources && (
              <span className={`px-2 py-1 rounded text-xs ${datasources.status === 'healthy' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'}`}>
                {datasources.status === 'healthy' ? '正常' : '降级'}
              </span>
            )}
          </div>
          <button
            onClick={async () => {
              try {
                const data = await datasourceAPI.test();
                alert(`测试完成: ${data.results?.filter(r => r.status === 'healthy').length}/${data.results?.length} 健康`);
                fetchData();
              } catch (e) {
                alert('测试失败');
              }
            }}
            className="px-3 py-1.5 rounded-lg text-sm bg-blue-500/10 text-blue-500 border border-blue-500/30"
          >
            测试连接
          </button>
        </div>
        {datasources && (
          <>
            <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--bg-card)' }}>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>当前主数据源</span>
                <span className="font-medium text-green-500">{datasources.primary}</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span style={{ color: 'var(--text-tertiary)' }}>健康/总数</span>
                <span>{datasources.healthyCount}/{datasources.sources?.length}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {datasources.sources?.map(ds => (
                <div key={ds.key} className="p-4 rounded-lg" style={{ background: 'var(--bg-card)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ds.name}</span>
                      {ds.badge && (
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                          ds.badge === '主数据源' ? 'bg-blue-500/20 text-blue-500' :
                          ds.badge === '实时行情' ? 'bg-green-500/20 text-green-500' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>{ds.badge}</span>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      ds.status === 'healthy' ? 'bg-green-500/10 text-green-500' :
                      ds.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                      ds.enabled === false ? 'bg-gray-500/10 text-gray-400' :
                      'bg-yellow-500/10 text-yellow-500'
                    }`}>{ds.connectionStatus || ds.status}</span>
                  </div>
                  <div className="text-xs space-y-1" style={{ color: 'var(--text-tertiary)' }}>
                    <div className="flex justify-between"><span>类型</span><span>{ds.type || '-'}</span></div>
                    <div className="flex justify-between"><span>优先级</span><span>{ds.priority}</span></div>
                    <div className="flex justify-between"><span>响应时间</span><span>{ds.responseTime || 0}ms</span></div>
                    <div className="flex justify-between">
                      <span>成功/失败</span>
                      <span className={ds.failureCount > 0 ? 'text-red-400' : ''}>{ds.successCount || 0}/{ds.failureCount || 0}</span>
                    </div>
                    {ds.officialFrequency && <div className="flex justify-between"><span>官方频率</span><span className="text-green-400">{ds.officialFrequency}</span></div>}
                    {ds.systemFrequency && <div className="flex justify-between"><span>系统频率</span><span className="text-blue-400">{ds.systemFrequency}</span></div>}
                  </div>
                  {ds.unavailableReason && <div className="mt-2 text-xs text-red-400">{ds.unavailableReason}</div>}
                  <div className="mt-3 flex gap-2">
                    {ds.enabled !== false ? (
                      <button onClick={() => handleDataSourceAction(ds.key, 'disable')} className="px-2 py-1 text-xs rounded bg-red-500/10 text-red-500">禁用</button>
                    ) : (
                      <button onClick={() => handleDataSourceAction(ds.key, 'enable')} className="px-2 py-1 text-xs rounded bg-green-500/10 text-green-500">启用</button>
                    )}
                    {ds.failureCount > 0 && (
                      <button onClick={() => handleDataSourceAction(ds.key, 'reset')} className="px-2 py-1 text-xs rounded bg-yellow-500/10 text-yellow-500">重置</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-5 h-5" style={{ color: 'var(--accent-orange)' }} />
          <h2 className="text-lg font-semibold">快速操作</h2>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <button onClick={() => datasourceAPI.refresh().then(() => alert('刷新成功'))} className="p-4 rounded-lg text-center hover:opacity-80" style={{ background: 'var(--bg-card)' }}>
            <RefreshCw className="w-6 h-6 mx-auto mb-2 text-blue-500" /><div className="text-sm">刷新数据</div>
          </button>
          <button onClick={() => datasourceAPI.test().then(d => alert('测试结果: ' + JSON.stringify(d)))} className="p-4 rounded-lg text-center hover:opacity-80" style={{ background: 'var(--bg-card)' }}>
            <Server className="w-6 h-6 mx-auto mb-2 text-green-500" /><div className="text-sm">测试连接</div>
          </button>
          <button onClick={() => systemAPI.validateData().then(d => alert('验证完成: ' + d.valid + '/' + d.total))} className="p-4 rounded-lg text-center hover:opacity-80" style={{ background: 'var(--bg-card)' }}>
            <CheckCircle className="w-6 h-6 mx-auto mb-2 text-orange-500" /><div className="text-sm">验证数据</div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SystemManagement;
