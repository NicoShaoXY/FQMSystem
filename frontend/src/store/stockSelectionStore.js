import { create } from 'zustand';

let API_BASE = 'http://localhost:8769/api';

const useStockSelectionStore = create((set, get) => ({
  // ═══════════════════════════════════════════════════════════════
  // 选股结果
  // ═══════════════════════════════════════════════════════════════
  
  // 早盘选股
  morningStocks: [],
  morningLoading: false,
  morningLastUpdate: null,
  
  // 尾盘选股
  eveningStocks: [],
  eveningLoading: false,
  eveningLastUpdate: null,
  
  // 历史选股记录
  historyRecords: [],
  historyLoading: false,
  
  // 选股配置
  config: {
    morningTime: '09:25',
    eveningTime: '14:50',
    maxStocks: 10,
    minUpProb: 60,
    riskThreshold: 'medium',
  },
  
  // ═══════════════════════════════════════════════════════════════
  // 选股操作方法
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 执行早盘选股
   */
  runMorningSelection: async () => {
    set({ morningLoading: true });
    
    try {
      const response = await fetch(`${API_BASE}/stock-selection/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'morning',
          time: get().config.morningTime,
          maxStocks: get().config.maxStocks,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        set({
          morningStocks: data.results || [],
          morningLastUpdate: bjISO(),
        });
      }
      
      set({ morningLoading: false });
      
    } catch (e) {
      console.error('早盘选股失败:', e);
      set({ morningLoading: false });
    }
  },
  
  /**
   * 执行尾盘选股
   */
  runEveningSelection: async () => {
    set({ eveningLoading: true });
    
    try {
      const response = await fetch(`${API_BASE}/stock-selection/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'evening',
          time: get().config.eveningTime,
          maxStocks: get().config.maxStocks,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        set({
          eveningStocks: data.results || [],
          eveningLastUpdate: bjISO(),
        });
      }
      
      set({ eveningLoading: false });
      
    } catch (e) {
      console.error('尾盘选股失败:', e);
      set({ eveningLoading: false });
    }
  },
  
  /**
   * 加载历史选股记录
   */
  loadHistory: async (days = 30) => {
    set({ historyLoading: true });
    
    try {
      const response = await fetch(`${API_BASE}/stock-selection/history?days=${days}`);
      const data = await response.json();
      
      if (data.success) {
        set({ historyRecords: data.records || [] });
      }
      
      set({ historyLoading: false });
      
    } catch (e) {
      console.error('加载历史记录失败:', e);
      set({ historyLoading: false });
    }
  },
  
  /**
   * 获取统计信息
   */
  getStats: (type) => {
    const records = get().historyRecords.filter(r => r.type === type);
    
    if (records.length === 0) {
      return { total: 0, winRate: 0, avgProfit: 0 };
    }
    
    let total = 0;
    let winCount = 0;
    let totalProfit = 0;
    
    records.forEach(r => {
      (r.stocks || []).forEach(s => {
        total++;
        if (s.nextDayChange > 0) winCount++;
        totalProfit += s.nextDayChange || 0;
      });
    });
    
    return {
      total,
      winRate: total > 0 ? (winCount / total * 100).toFixed(1) : 0,
      avgProfit: total > 0 ? (totalProfit / total).toFixed(2) : 0,
    };
  },
  
  /**
   * 更新选股配置
   */
  updateConfig: (newConfig) => {
    set(state => ({
      config: { ...state.config, ...newConfig },
    }));
  },
  
  /**
   * 刷新所有数据
   */
  refreshAll: async () => {
    await Promise.all([
      get().runMorningSelection(),
      get().runEveningSelection(),
      get().loadHistory(),
    ]);
  },
  
  /**
   * 添加到股票池
   */
  addToPool: async (stock) => {
    try {
      const response = await fetch(`${API_BASE}/pool/list/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: stock.code,
          name: stock.name,
        }),
      });
      
      return await response.json();
      
    } catch (e) {
      console.error('添加到股票池失败:', e);
      return { success: false, error: e.message };
    }
  },
  
  /**
   * 添加到持仓
   */
  addToHoldings: async (stock, quantity = 100, costPrice = null) => {
    try {
      const response = await fetch(`${API_BASE}/holdings/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: stock.code,
          name: stock.name,
          shares: quantity,
          cost_price: costPrice || stock.price,
          current_price: stock.price,
        }),
      });
      
      return await response.json();
      
    } catch (e) {
      console.error('添加到持仓失败:', e);
      return { success: false, error: e.message };
    }
  },
}));

export default useStockSelectionStore;
