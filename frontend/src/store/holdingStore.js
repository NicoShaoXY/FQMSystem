import { create } from 'zustand';
import {
  fetchUserHoldings,
  fetchStockDetail,
  fetchYaodiAnalysis,
  fetchCapitalConfig,
  formatYi,
  formatPercent,
} from '../services/realTimeData';

let API_BASE = 'http://localhost:8769/api';

const useHoldingStore = create((set, get) => ({
  // 持仓列表
  holdings: [],
  
  // 持仓统计
  totalAssets: 0,
  totalCost: 0,
  totalProfit: 0,
  profitRate: 0,
  
  // 资金配置
  capitalConfig: null,
  
  // 持仓分析结果缓存
  analyses: {},
  
  // 加载状态
  loading: false,
  lastUpdate: null,
  
  // ═══════════════════════════════════════════════════════════════
  // 数据加载方法
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 从服务器加载持仓数据
   */
  loadHoldings: async () => {
    set({ loading: true });
    
    try {
      // 并行加载持仓和资金配置
      const [holdingsRes, capitalRes] = await Promise.all([
        fetch(`${API_BASE}/holding/list`).then(r => r.json()),
        fetchCapitalConfig(),
      ]);
      
      if (holdingsRes.success) {
        const holdings = holdingsRes.holdings || [];
        set({ holdings });
        
        // 计算统计
        get().calculateStats();
      }
      
      if (capitalRes) {
        set({ capitalConfig: capitalRes });
      }
      
      set({ 
        loading: false, 
        lastUpdate: bjISO() 
      });
      
    } catch (e) {
      console.error('加载持仓失败:', e);
      set({ loading: false });
    }
  },
  
  /**
   * 计算持仓统计
   */
  calculateStats: () => {
    const holdings = get().holdings;
    const capitalConfig = get().capitalConfig;
    
    // 计算持仓市值
    const totalAssets = holdings.reduce((sum, h) => {
      const price = h.current_price || h.price || h.cost_price || 0;
      return sum + price * (h.shares || h.holdQuantity || 0);
    }, 0);
    
    // 计算持仓成本
    const totalCost = holdings.reduce((sum, h) => {
      const cost = h.cost_price || h.holdCost || h.buy_price || 0;
      return sum + cost * (h.shares || h.holdQuantity || 0);
    }, 0);
    
    const totalProfit = totalAssets - totalCost;
    const profitRate = totalCost > 0 ? (totalProfit / totalCost * 100) : 0;
    
    // 加上可用资金
    const availableCapital = capitalConfig?.available_capital || 0;
    
    set({ 
      totalAssets: totalAssets + availableCapital,
      totalCost, 
      totalProfit, 
      profitRate 
    });
  },
  
  /**
   * 添加持仓
   */
  addHolding: async (code, name, quantity, cost, price = null) => {
    try {
      const response = await fetch(`${API_BASE}/holdings/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          name,
          shares: quantity,
          cost_price: cost,
          current_price: price || cost,
        }),
      });
      
      const data = await response.json();
      if (data.success) {
        await get().loadHoldings();
        return { success: true };
      }
      return { success: false, error: data.error };
      
    } catch (e) {
      console.error('添加持仓失败:', e);
      return { success: false, error: e.message };
    }
  },
  
  /**
   * 移除持仓
   */
  removeHolding: async (code) => {
    try {
      const response = await fetch(`${API_BASE}/holdings/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      
      const data = await response.json();
      if (data.success) {
        await get().loadHoldings();
      }
      
    } catch (e) {
      console.error('移除持仓失败:', e);
    }
  },
  
  /**
   * 清空所有持仓
   */
  clearAll: async () => {
    try {
      const response = await fetch(`${API_BASE}/capital/reset`, {
        method: 'POST',
      });
      
      const data = await response.json();
      if (data.success) {
        set({ holdings: [], totalAssets: 0, totalCost: 0, totalProfit: 0, profitRate: 0 });
      }
      
    } catch (e) {
      console.error('清空持仓失败:', e);
    }
  },
  
  /**
   * 批量移除
   */
  removeMultiple: async (codes) => {
    for (const code of codes) {
      await get().removeHolding(code);
    }
  },
  
  /**
   * 移入收藏股
   */
  transferToPool: async (code, setPoolStore) => {
    const holding = get().holdings.find(h => h.code === code);
    if (holding) {
      try {
        // 添加到股票池
        await fetch(`${API_BASE}/pool/list/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: holding.code, name: holding.name }),
        });
        
        // 从持仓移除
        await get().removeHolding(code);
        
      } catch (e) {
        console.error('移入股票池失败:', e);
      }
    }
  },
  
  /**
   * 更新持仓信息
   */
  updateHolding: async (code, updates) => {
    try {
      const response = await fetch(`${API_BASE}/holdings/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ...updates }),
      });
      
      const data = await response.json();
      if (data.success) {
        await get().loadHoldings();
      }
      
    } catch (e) {
      console.error('更新持仓失败:', e);
    }
  },
  
  /**
   * 获取持仓分析（从尧帝获取）
   */
  getAnalysis: async (code) => {
    const holding = get().holdings.find(h => h.code === code);
    if (!holding) return null;
    
    try {
      // 从尧帝获取分析
      const analysisRes = await fetch(`${API_BASE}/quant/voting?code=${encodeURIComponent(code)}`);
      const data = await analysisRes.json();
      
      if (data.success && data.analysis) {
        const analysis = {
          ...data.analysis,
          floatingProfit: ((holding.current_price || holding.price || 0) - (holding.cost_price || holding.holdCost || 0)) * (holding.shares || holding.holdQuantity || 0),
          floatingRate: ((holding.current_price || holding.price || 0) - (holding.cost_price || holding.holdCost || 0)) / (holding.cost_price || holding.holdCost || 1) * 100,
          marketValue: (holding.current_price || holding.price || 0) * (holding.shares || holding.holdQuantity || 0),
          timestamp: bjISO(),
        };
        
        set(state => ({
          analyses: { ...state.analyses, [code]: analysis },
        }));
        
        return analysis;
      }
      
      // 降级：使用本地计算
      const price = holding.current_price || holding.price || 0;
      const cost = holding.cost_price || holding.holdCost || 0;
      const qty = holding.shares || holding.holdQuantity || 0;
      
      const floatingProfit = (price - cost) * qty;
      const floatingRate = cost > 0 ? ((price - cost) / cost * 100) : 0;
      
      const analysis = {
        floatingProfit: floatingProfit.toFixed(2),
        floatingRate: floatingRate.toFixed(2),
        marketValue: (price * qty).toFixed(2),
        recommendation: floatingRate > 20 ? '减仓' : floatingRate < -8 ? '加仓' : '继续持有',
        stopLoss: (cost * 0.92).toFixed(2),
        takeProfit: (cost * 1.15).toFixed(2),
        timestamp: bjISO(),
      };
      
      set(state => ({
        analyses: { ...state.analyses, [code]: analysis },
      }));
      
      return analysis;
      
    } catch (e) {
      console.error('获取分析失败:', e);
      return null;
    }
  },
  
  /**
   * 刷新行情
   */
  refreshPrices: async () => {
    await get().loadHoldings();
  },
  
  // 盈亏曲线数据
  profitCurve: [],
  
  /**
   * 加载盈亏曲线
   */
  loadProfitCurve: async () => {
    try {
      const response = await fetch(`${API_BASE}/holding/profit-curve?days=30`);
      const data = await response.json();
      
      if (data.success && data.curve) {
        set({ profitCurve: data.curve });
      }
      
    } catch (e) {
      console.error('加载盈亏曲线失败:', e);
    }
  },
  
  /**
   * 生成盈亏曲线（如果后端没有提供）
   */
  generateProfitCurve: () => {
    const data = [];
    let value = get().totalCost || 100000;
    const now = toBeijingTime();
    
    for (let i = 30; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      
      value *= (1 + (Math.random() * 0.045 - 0.02));
      data.push({
        date: bjDate(),
        value: parseFloat(value.toFixed(2)),
        profit: parseFloat((value - (get().totalCost || 100000)).toFixed(2)),
      });
    }
    
    set({ profitCurve: data });
  },
}));

export default useHoldingStore;
