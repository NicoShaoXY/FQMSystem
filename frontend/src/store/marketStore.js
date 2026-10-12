import { create } from 'zustand';
import {
  fetchMarketStats,
  fetchIndices,
  fetchStockDistribution,
  fetchNorthFlow,
  fetchSectors,
  fetchTopGainers,
  fetchTopLosers,
  fetchTopTurnover,
  fetchTopAmplitude,
  fetchStockList,
  getSentimentLevel,
  formatYi,
} from '../services/realTimeData';

const useMarketStore = create((set, get) => ({
  // 市场情绪
  sentiment: {
    score: 50,
    level: '中性',
    color: '#faad14',
  },
  
  // 市场统计
  marketStats: {
    limitUp: 0,
    limitDown: 0,
    up: 0,
    down: 0,
    flat: 0,
  },
  
  // 涨跌分布
  stockDistribution: {
    limitUp: 0,
    up7: 0,
    up3to7: 0,
    up0to3: 0,
    down0to3: 0,
    down3to7: 0,
    down7: 0,
    limitDown: 0,
  },
  
  upDownCount: {
    up: 0,
    down: 0,
    flat: 0,
  },
  
  // 三大指数
  indices: [
    { code: '000001', name: '上证指数', price: 0, change: 0, changePercent: 0, volume: 0 },
    { code: '399001', name: '深证成指', price: 0, change: 0, changePercent: 0, volume: 0 },
    { code: '399006', name: '创业板指', price: 0, change: 0, changePercent: 0, volume: 0 },
  ],
  
  // 北向资金
  capitalFlow: {
    northNetIn: 0,
    northForce: '加载中',
    southNetIn: 0,
    southForce: '加载中',
  },
  
  // 板块数据
  sectors: [],
  
  // 涨跌幅榜单
  gainersTop: [],
  losersTop: [],
  turnoverTop: [],
  amplitudeTop: [],
  
  // 股票列表
  stocks: [],
  totalStocks: 0,
  currentPage: 1,
  
  // 加载状态
  loading: false,
  error: null,
  lastUpdate: null,
  
  // ═══════════════════════════════════════════════════════════════
  // 数据加载方法
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 加载所有市场数据
   */
  loadAllData: async () => {
    set({ loading: true, error: null });
    
    try {
      // 并行请求所有数据
      const [statsRes, indicesRes, distRes, northRes, sectorsRes, gainersRes, losersRes, turnoverRes, amplitudeRes] = await Promise.all([
        fetchMarketStats(),
        fetchIndices(),
        fetchStockDistribution(),
        fetchNorthFlow(),
        fetchSectors(),
        fetchTopGainers(20),
        fetchTopLosers(20),
        fetchTopTurnover(20),
        fetchTopAmplitude(20),
      ]);
      
      // 处理市场统计
      if (statsRes) {
        const level = getSentimentLevel(statsRes.sentiment);
        set({
          sentiment: {
            score: statsRes.sentiment,
            level: level.label,
            color: level.color,
          },
          marketStats: {
            limitUp: statsRes.limitUp,
            limitDown: statsRes.limitDown,
            up: statsRes.up,
            down: statsRes.down,
            flat: statsRes.flat,
          },
        });
      }
      
      // 处理指数
      if (indicesRes) {
        set({ indices: indicesRes });
      }
      
      // 处理涨跌分布
      if (distRes) {
        set({
          stockDistribution: {
            limitUp: distRes.limitUp,
            up7: distRes.up7,
            up3to7: distRes.up3to7,
            up0to3: distRes.up0to3,
            down0to3: distRes.down0to3,
            down3to7: distRes.down3to7,
            down7: distRes.down7,
            limitDown: distRes.limitDown,
          },
          upDownCount: distRes.upDownCount,
        });
      }
      
      // 处理北向资金
      if (northRes) {
        set({ capitalFlow: northRes });
      }
      
      // 处理板块
      if (sectorsRes) {
        set({ sectors: sectorsRes });
      }
      
      // 处理榜单
      set({
        gainersTop: gainersRes || [],
        losersTop: losersRes || [],
        turnoverTop: turnoverRes || [],
        amplitudeTop: amplitudeRes || [],
      });
      
      set({
        loading: false,
        lastUpdate: bjISO(),
      });
      
    } catch (e) {
      console.error('加载市场数据失败:', e);
      set({ loading: false, error: e.message });
    }
  },
  
  /**
   * 刷新数据（简化版，只刷新核心数据）
   */
  refresh: async () => {
    try {
      const [statsRes, indicesRes] = await Promise.all([
        fetchMarketStats(),
        fetchIndices(),
      ]);
      
      if (statsRes) {
        const level = getSentimentLevel(statsRes.sentiment);
        set({
          sentiment: {
            score: statsRes.sentiment,
            level: level.label,
            color: level.color,
          },
          marketStats: {
            limitUp: statsRes.limitUp,
            limitDown: statsRes.limitDown,
            up: statsRes.up,
            down: statsRes.down,
            flat: statsRes.flat,
          },
        });
      }
      
      if (indicesRes) {
        set({ indices: indicesRes });
      }
      
      set({ lastUpdate: bjISO() });
      
    } catch (e) {
      console.error('刷新市场数据失败:', e);
    }
  },
  
  /**
   * 加载股票列表
   */
  loadStocks: async (page = 1, pageSize = 50) => {
    try {
      const result = await fetchStockList(page, pageSize);
      set({
        stocks: result.stocks,
        totalStocks: result.total,
        currentPage: result.page,
      });
    } catch (e) {
      console.error('加载股票列表失败:', e);
    }
  },
  
  /**
   * 刷新榜单数据
   */
  refreshTopLists: async () => {
    try {
      const [gainersRes, losersRes, turnoverRes, amplitudeRes] = await Promise.all([
        fetchTopGainers(20),
        fetchTopLosers(20),
        fetchTopTurnover(20),
        fetchTopAmplitude(20),
      ]);
      
      set({
        gainersTop: gainersRes || [],
        losersTop: losersRes || [],
        turnoverTop: turnoverRes || [],
        amplitudeTop: amplitudeRes || [],
      });
    } catch (e) {
      console.error('刷新榜单失败:', e);
    }
  },
  
  // 兼容旧版方法
  initStockData: async () => {
    await get().loadAllData();
  },
}));

export default useMarketStore;
