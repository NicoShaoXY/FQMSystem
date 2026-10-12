/**
 * 投资组合管理UI组件
 * 
 * 功能：
 * 1. 组合构建界面
 * 2. 资产配置可视化
 * 3. 再平衡管理
 * 4. 风险预算管理
 * 5. 实时监控面板
 */

import React, { useState, useEffect, useCallback } from 'react';

// ========== 组合构建界面 ==========

export const PortfolioBuilder = ({ onBuildComplete }) => {
  const [stocks, setStocks] = useState([]);
  const [newStock, setNewStock] = useState({ code: '', weight: 0, targetWeight: 0 });
  const [totalWeight, setTotalWeight] = useState(0);
  const [error, setError] = useState('');

  const handleAddStock = useCallback(() => {
    if (!newStock.code) {
      setError('请输入股票代码');
      return;
    }
    if (newStock.weight <= 0 || newStock.weight > 100) {
      setError('权重应在0-100之间');
      return;
    }
    if (totalWeight + newStock.weight > 100) {
      setError('总权重不能超过100%');
      return;
    }

    setStocks([...stocks, { ...newStock, id: Date.now() }]);
    setTotalWeight(prev => prev + newStock.weight);
    setNewStock({ code: '', weight: 0, targetWeight: 0 });
    setError('');
  }, [newStock, stocks, totalWeight]);

  const handleRemoveStock = useCallback((id) => {
    const stock = stocks.find(s => s.id === id);
    if (stock) {
      setStocks(stocks.filter(s => s.id !== id));
      setTotalWeight(prev => prev - stock.weight);
    }
  }, [stocks]);

  const handleBuild = useCallback(() => {
    if (totalWeight !== 100) {
      setError('总权重必须等于100%');
      return;
    }
    onBuildComplete?.({ stocks, totalWeight });
  }, [stocks, totalWeight, onBuildComplete]);

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-6">
      <h3 className="text-lg font-bold mb-4">组合构建</h3>

      {/* 添加股票 */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <input
          type="text"
          placeholder="股票代码"
          value={newStock.code}
          onChange={(e) => setNewStock({ ...newStock, code: e.target.value })}
          className="px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded"
        />
        <input
          type="number"
          placeholder="当前权重%"
          value={newStock.weight || ''}
          onChange={(e) => setNewStock({ ...newStock, weight: parseFloat(e.target.value) || 0 })}
          className="px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded"
        />
        <input
          type="number"
          placeholder="目标权重%"
          value={newStock.targetWeight || ''}
          onChange={(e) => setNewStock({ ...newStock, targetWeight: parseFloat(e.target.value) || 0 })}
          className="px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded"
        />
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      <button
        onClick={handleAddStock}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 mb-6"
      >
        添加股票
      </button>

      {/* 股票列表 */}
      <div className="space-y-2 mb-6">
        {stocks.map((stock) => (
          <div key={stock.id} className="flex items-center justify-between p-3 bg-[var(--bg-primary)] rounded">
            <span className="font-mono">{stock.code}</span>
            <span className="text-sm text-[var(--text-secondary)]">
              当前: {stock.weight}% → 目标: {stock.targetWeight}%
            </span>
            <button
              onClick={() => handleRemoveStock(stock.id)}
              className="text-red-400 hover:text-red-500"
            >
              删除
            </button>
          </div>
        ))}
      </div>

      {/* 总权重 */}
      <div className="flex justify-between items-center p-4 bg-[var(--bg-primary)] rounded mb-4">
        <span className="font-bold">总权重</span>
        <span className={`text-xl font-bold ${totalWeight === 100 ? 'text-green-400' : 'text-yellow-400'}`}>
          {totalWeight.toFixed(1)}%
        </span>
      </div>

      <button
        onClick={handleBuild}
        disabled={totalWeight !== 100}
        className={`w-full py-3 rounded font-bold ${
          totalWeight === 100
            ? 'bg-green-500 text-white hover:bg-green-600'
            : 'bg-gray-500 text-gray-300 cursor-not-allowed'
        }`}
      >
        构建组合
      </button>
    </div>
  );
};

// ========== 资产配置可视化 ==========

export const AssetAllocationChart = ({ portfolio }) => {
  const [hoveredSegment, setHoveredSegment] = useState(null);

  const colors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  ];

  const segments = portfolio?.allocations?.map((item, i) => ({
    ...item,
    color: colors[i % colors.length],
    percentage: ((item.value / portfolio.totalValue) * 100).toFixed(1),
  })) || [];

  // 计算饼图路径
  const createPieSlice = (startAngle, endAngle, radius = 100) => {
    const start = polarToCartesian(100, 100, radius, endAngle);
    const end = polarToCartesian(100, 100, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;

    return [
      'M', 100, 100,
      'L', start.x, start.y,
      'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y,
      'Z',
    ].join(' ');
  };

  const polarToCartesian = (cx, cy, radius, angle) => {
    const rad = (angle - 90) * Math.PI / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  };

  let currentAngle = 0;
  const pieSlices = segments.map((segment, i) => {
    const angle = (parseFloat(segment.percentage) / 100) * 360;
    const slice = {
      ...segment,
      path: createPieSlice(currentAngle, currentAngle + angle - 1),
      startAngle: currentAngle,
      endAngle: currentAngle + angle,
    };
    currentAngle += angle;
    return slice;
  });

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-6">
      <h3 className="text-lg font-bold mb-4">资产配置</h3>

      <div className="flex items-center">
        {/* 饼图 */}
        <svg width="200" height="200" className="flex-shrink-0">
          {pieSlices.map((slice, i) => (
            <path
              key={i}
              d={slice.path}
              fill={slice.color}
              stroke="var(--bg-secondary)"
              strokeWidth="2"
              onMouseEnter={() => setHoveredSegment(i)}
              onMouseLeave={() => setHoveredSegment(null)}
              className="cursor-pointer transition-all hover:opacity-80"
            />
          ))}
          {/* 中心文字 */}
          <text x="100" y="95" textAnchor="middle" className="text-sm fill-current">
            总价值
          </text>
          <text x="100" y="115" textAnchor="middle" className="text-lg font-bold fill-current">
            ¥{(portfolio?.totalValue || 0).toLocaleString()}
          </text>
        </svg>

        {/* 图例 */}
        <div className="ml-6 flex-1 space-y-2">
          {pieSlices.map((slice, i) => (
            <div
              key={i}
              className={`flex items-center justify-between p-2 rounded ${
                hoveredSegment === i ? 'bg-[var(--bg-primary)]' : ''
              }`}
            >
              <div className="flex items-center">
                <div
                  className="w-3 h-3 rounded mr-2"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="text-sm">{slice.name || slice.code}</span>
              </div>
              <div className="text-right">
                <span className="font-mono text-sm">{slice.percentage}%</span>
                <span className="text-xs text-[var(--text-tertiary)] ml-2">
                  ¥{(slice.value || 0).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ========== 再平衡管理 ==========

export const RebalancingManager = ({ portfolio, onRebalance }) => {
  const [rebalancePlan, setRebalancePlan] = useState(null);
  const [selectedStrategy, setSelectedStrategy] = useState('threshold');
  const [threshold, setThreshold] = useState(5);

  const calculateRebalance = useCallback(() => {
    if (!portfolio?.allocations) return;

    const plan = portfolio.allocations.map(item => {
      const drift = item.currentWeight - item.targetWeight;
      const action = Math.abs(drift) > threshold ? (drift > 0 ? 'sell' : 'buy') : 'hold';

      return {
        ...item,
        drift: drift.toFixed(1),
        action,
        amount: Math.abs(drift * portfolio.totalValue / 100),
      };
    });

    setRebalancePlan(plan);
  }, [portfolio, threshold]);

  useEffect(() => {
    calculateRebalance();
  }, [calculateRebalance]);

  const handleExecuteRebalance = useCallback(() => {
    onRebalance?.(rebalancePlan);
  }, [rebalancePlan, onRebalance]);

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-6">
      <h3 className="text-lg font-bold mb-4">再平衡管理</h3>

      {/* 设置 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-2">策略</label>
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded"
          >
            <option value="threshold">阈值触发</option>
            <option value="calendar">日历再平衡</option>
            <option value="dynamic">动态再平衡</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-2">偏离阈值 (%)</label>
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded"
          />
        </div>
      </div>

      {/* 再平衡计划 */}
      {rebalancePlan && (
        <div className="space-y-2 mb-6">
          <h4 className="text-sm font-bold text-[var(--text-secondary)]">调整计划</h4>
          {rebalancePlan.map((item, i) => (
            <div
              key={i}
              className={`flex items-center justify-between p-3 rounded ${
                item.action === 'sell' ? 'bg-red-900/20' :
                item.action === 'buy' ? 'bg-green-900/20' :
                'bg-[var(--bg-primary)]'
              }`}
            >
              <span className="font-mono">{item.code}</span>
              <span className="text-sm">
                {item.currentWeight.toFixed(1)}% → {item.targetWeight.toFixed(1)}%
              </span>
              <span className={`text-sm ${
                item.action === 'sell' ? 'text-red-400' :
                item.action === 'buy' ? 'text-green-400' :
                'text-gray-400'
              }`}>
                {item.action === 'sell' ? `卖出 ¥${item.amount.toLocaleString()}` :
                 item.action === 'buy' ? `买入 ¥${item.amount.toLocaleString()}` :
                 '无需调整'}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleExecuteRebalance}
        className="w-full py-3 bg-blue-500 text-white rounded hover:bg-blue-600 font-bold"
      >
        执行再平衡
      </button>
    </div>
  );
};

// ========== 风险预算管理 ==========

export const RiskBudgetManager = ({ portfolio, riskMetrics }) => {
  const [riskBudget, setRiskBudget] = useState({
    maxDrawdown: 20,
    maxPositionSize: 30,
    maxSectorExposure: 50,
    varLimit: 5,
  });

  const riskUtilization = {
    drawdown: ((riskMetrics?.currentDrawdown || 0) / riskBudget.maxDrawdown * 100).toFixed(1),
    positionSize: (portfolio?.maxPositionWeight || 0),
    sectorExposure: (portfolio?.maxSectorExposure || 0),
    var: ((riskMetrics?.VaR || 0) / riskBudget.varLimit * 100).toFixed(1),
  };

  const getUtilizationColor = (util) => {
    if (util < 50) return 'bg-green-500';
    if (util < 80) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-6">
      <h3 className="text-lg font-bold mb-4">风险预算</h3>

      {/* 风险预算设置 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">最大回撤 (%)</label>
          <input
            type="number"
            value={riskBudget.maxDrawdown}
            onChange={(e) => setRiskBudget({ ...riskBudget, maxDrawdown: parseFloat(e.target.value) })}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded"
          />
        </div>
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">单票上限 (%)</label>
          <input
            type="number"
            value={riskBudget.maxPositionSize}
            onChange={(e) => setRiskBudget({ ...riskBudget, maxPositionSize: parseFloat(e.target.value) })}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded"
          />
        </div>
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">行业上限 (%)</label>
          <input
            type="number"
            value={riskBudget.maxSectorExposure}
            onChange={(e) => setRiskBudget({ ...riskBudget, maxSectorExposure: parseFloat(e.target.value) })}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded"
          />
        </div>
        <div>
          <label className="block text-sm text-[var(--text-secondary)] mb-1">VaR限制 (%)</label>
          <input
            type="number"
            value={riskBudget.varLimit}
            onChange={(e) => setRiskBudget({ ...riskBudget, varLimit: parseFloat(e.target.value) })}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded"
          />
        </div>
      </div>

      {/* 风险利用率 */}
      <div className="space-y-3">
        {Object.entries(riskUtilization).map(([key, value]) => (
          <div key={key}>
            <div className="flex justify-between text-sm mb-1">
              <span className="capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
              <span className="font-mono">{value}%</span>
            </div>
            <div className="h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
              <div
                className={`h-full ${getUtilizationColor(parseFloat(value))} transition-all`}
                style={{ width: `${Math.min(100, value)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ========== 实时监控面板 ==========

export const PortfolioMonitor = ({ portfolio, riskMetrics, performance }) => {
  const [timeframe, setTimeframe] = useState('1D');

  const formatNumber = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(2);
  };

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-bold">实时监控</h3>
        <div className="flex gap-2">
          {['1D', '1W', '1M', '3M', '1Y'].map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 text-sm rounded ${
                timeframe === tf
                  ? 'bg-blue-500 text-white'
                  : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* 关键指标 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-[var(--bg-primary)] rounded">
          <div className="text-sm text-[var(--text-tertiary)]">总价值</div>
          <div className="text-xl font-bold">¥{formatNumber(portfolio?.totalValue || 0)}</div>
          <div className={`text-sm ${(performance?.return || 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {(performance?.return || 0) >= 0 ? '+' : ''}{(performance?.return || 0).toFixed(2)}%
          </div>
        </div>

        <div className="p-4 bg-[var(--bg-primary)] rounded">
          <div className="text-sm text-[var(--text-tertiary)]">日收益</div>
          <div className="text-xl font-bold">
            ¥{formatNumber(performance?.dailyReturn || 0)}
          </div>
          <div className={`text-sm ${(performance?.dailyReturnPercent || 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {(performance?.dailyReturnPercent || 0) >= 0 ? '+' : ''}{(performance?.dailyReturnPercent || 0).toFixed(2)}%
          </div>
        </div>

        <div className="p-4 bg-[var(--bg-primary)] rounded">
          <div className="text-sm text-[var(--text-tertiary)]">夏普比率</div>
          <div className="text-xl font-bold">{performance?.sharpeRatio || 0}</div>
          <div className="text-sm text-[var(--text-tertiary)]">
            {performance?.sharpeRatio >= 1 ? '优秀' : performance?.sharpeRatio >= 0.5 ? '良好' : '一般'}
          </div>
        </div>

        <div className="p-4 bg-[var(--bg-primary)] rounded">
          <div className="text-sm text-[var(--text-tertiary)]">最大回撤</div>
          <div className="text-xl font-bold text-red-400">
            {(riskMetrics?.maxDrawdown || 0).toFixed(2)}%
          </div>
          <div className="text-sm text-[var(--text-tertiary)]">
            VaR: {(riskMetrics?.VaR || 0).toFixed(2)}%
          </div>
        </div>
      </div>

      {/* 风险状态 */}
      <div className="p-4 bg-[var(--bg-primary)] rounded mb-6">
        <div className="flex justify-between items-center">
          <span className="text-sm text-[var(--text-secondary)]">风险状态</span>
          <span className={`px-3 py-1 rounded text-sm font-bold ${
            riskMetrics?.status === 'safe' ? 'bg-green-500/20 text-green-400' :
            riskMetrics?.status === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {riskMetrics?.status === 'safe' ? '安全' :
             riskMetrics?.status === 'warning' ? '警戒' : '危险'}
          </span>
        </div>
      </div>

      {/* 最近交易 */}
      <div>
        <h4 className="text-sm font-bold text-[var(--text-secondary)] mb-3">最近交易</h4>
        <div className="space-y-2">
          {(portfolio?.recentTrades || []).slice(0, 5).map((trade, i) => (
            <div key={i} className="flex justify-between items-center p-2 bg-[var(--bg-primary)] rounded text-sm">
              <span className={trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}>
                {trade.type === 'buy' ? '买入' : '卖出'}
              </span>
              <span className="font-mono">{trade.code}</span>
              <span>{trade.shares}股 @ ¥{trade.price}</span>
              <span className="text-[var(--text-tertiary)]">{trade.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ========== 导出组件 ==========

export default {
  PortfolioBuilder,
  AssetAllocationChart,
  RebalancingManager,
  RiskBudgetManager,
  PortfolioMonitor,
};
