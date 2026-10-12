/**
 * 深度学习模型状态组件 - P2优化
 * 显示LSTM/Transformer模型训练状态、预测准确率、模型版本
 */
import { useState, useEffect } from 'react';
import { Brain, Cpu, Activity, TrendingUp, AlertCircle, RefreshCw, Zap } from 'lucide-react';
import { API_BASE } from '../config/api';

export default function DeepLearningStatus({ compact = false }) {
  const [loading, setLoading] = useState(false);
  const [modelStatus, setModelStatus] = useState(null);

  // 获取模型状态
  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/yaodi-v2/learning-status`, {
        signal: AbortSignal.timeout(5000)
      });
      const data = await res.json();
      if (data?.success) {
        setModelStatus(data);
      }
    } catch (e) {
      console.warn('[DeepLearning] 获取状态失败:', e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 60000); // 每分钟刷新
    return () => clearInterval(timer);
  }, []);

  // 样式
  const cardStyle = {
    background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1))',
    borderRadius: 12,
    padding: compact ? 12 : 16,
    border: '1px solid rgba(99,102,241,0.2)',
  };

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...cardStyle }}>
        <Brain size={16} style={{ color: '#6366f1' }} />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>深度学习</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: modelStatus?.learning?.accuracy >= 70 ? '#10b981' : '#f59e0b' }}>
          {modelStatus?.learning?.accuracy?.toFixed(1) || '--'}%
        </span>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={18} style={{ color: '#6366f1' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>深度学习模型</span>
        </div>
        <button
          onClick={fetchStatus}
          disabled={loading}
          style={{
            background: 'rgba(99,102,241,0.2)',
            border: 'none',
            borderRadius: 6,
            padding: '4px 8px',
            cursor: 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          <RefreshCw size={12} style={{ color: '#6366f1' }} />
        </button>
      </div>

      {modelStatus ? (
        <div>
          {/* 模型类型 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <Cpu size={20} style={{ color: '#6366f1', marginBottom: 4 }} />
              <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>模型类型</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Stacking集成</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <Activity size={20} style={{ color: '#10b981', marginBottom: 4 }} />
              <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>准确率</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#10b981' }}>
                {modelStatus.learning?.accuracy?.toFixed(1) || '--'}%
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <Zap size={20} style={{ color: '#f59e0b', marginBottom: 4 }} />
              <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>演化代数</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {modelStatus.evolution?.generation || '--'}
              </div>
            </div>
          </div>

          {/* 子模型状态 */}
          <div style={{ borderTop: '1px solid rgba(99,102,241,0.2)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>子模型</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['GBDT', 'HistGBDT', 'CatBoost', 'ElasticNet'].map((name, i) => (
                <span
                  key={name}
                  style={{
                    background: 'rgba(99,102,241,0.15)',
                    padding: '4px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    color: '#6366f1',
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>

          {/* 训练状态 */}
          {modelStatus.learning?.isTraining && (
            <div style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'rgba(245,158,11,0.1)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <RefreshCw size={12} style={{ color: '#f59e0b', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 11, color: '#f59e0b' }}>模型训练中...</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>
          {loading ? '加载中...' : '暂无模型数据'}
        </div>
      )}
    </div>
  );
}
