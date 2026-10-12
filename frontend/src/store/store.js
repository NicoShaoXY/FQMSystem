import { create } from 'zustand';
import { yaodiAPI, holdingAPI, stockAPI, API_BASE } from '../config/api';
import { toBeijingTime, bjISO } from '../utils/beijingTime';

// 导入API函数
// SmartCache — 原提取自 performanceOptimization.js（已删除，其余为死代码）
class SmartCache {
  constructor(config = {}) {
    this.config = {
      maxSize: config.maxSize || 1000,
      defaultTTL: config.defaultTTL || 300000,
      cleanupInterval: config.cleanupInterval || 60000,
      ...config,
    };
    this.cache = new Map();
    this.accessLog = new Map();
    this.hitCount = 0;
    this.missCount = 0;
    this.startCleanup();
  }
  set(key, value, ttl = this.config.defaultTTL) {
    if (this.cache.size >= this.config.maxSize) this.evictLeastUsed();
    this.cache.set(key, { value, expiry: Date.now() + ttl, createdAt: Date.now(), accessCount: 0 });
    this.accessLog.set(key, Date.now());
  }
  get(key) {
    const item = this.cache.get(key);
    if (!item) { this.missCount++; return null; }
    if (Date.now() > item.expiry) { this.cache.delete(key); this.accessLog.delete(key); this.missCount++; return null; }
    item.accessCount++;
    this.accessLog.set(key, Date.now());
    this.hitCount++;
    return item.value;
  }
  delete(key) { this.cache.delete(key); this.accessLog.delete(key); }
  clear() { this.cache.clear(); this.accessLog.clear(); this.hitCount = 0; this.missCount = 0; }
  evictLeastUsed() {
    let minAccess = Infinity, minKey = null;
    this.cache.forEach((item, key) => { if (item.accessCount < minAccess) { minAccess = item.accessCount; minKey = key; } });
    if (minKey) { this.cache.delete(minKey); this.accessLog.delete(minKey); }
  }
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];
    this.cache.forEach((item, key) => { if (now > item.expiry) keysToDelete.push(key); });
    keysToDelete.forEach(key => { this.cache.delete(key); this.accessLog.delete(key); });
    return keysToDelete.length;
  }
  startCleanup() { setInterval(() => this.cleanup(), this.config.cleanupInterval); }
  getStats() {
    const total = this.hitCount + this.missCount;
    return { size: this.cache.size, maxSize: this.config.maxSize, hitCount: this.hitCount, missCount: this.missCount, hitRate: total > 0 ? (this.hitCount / total * 100).toFixed(2) + '%' : '0%' };
  }
}

// 性能缓存（TTL 3秒，避免高频重复请求）
const apiCache = new SmartCache({ maxSize: 200, defaultTTL: 3000 });

// 使用后端API获取单股票实时数据
async function fetchStockRealTime(code) {
  try {
    const response = await fetch(`${API_BASE}/stock/${code}`);
    const data = await response.json();
    if (data.success) {
      return {
        price: parseFloat(data.price) || 0,
        changePercent: parseFloat(data.changePercent) || 0,
        change: parseFloat(data.change) || 0,
        high: parseFloat(data.high) || 0,
        low: parseFloat(data.low) || 0,
        volume: parseFloat(data.volume) || 0,
        preClose: 0
      };
    }
    return null;
  } catch (error) {
    console.error(`获取股票 ${code} 实时数据失败:`, error);
    return null;
  }
}

// 辅助函数：调用API（带缓存）
async function apiCall(endpoint, options = {}) {
  const cacheKey = `${options.method || 'GET'}:${endpoint}`;
  const cached = apiCache.get(cacheKey);
  if (cached && !options.forceRefresh) return cached;

  const url = `${API_BASE}${endpoint}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });
    const data = await response.json();
    apiCache.set(cacheKey, data);
    return data;
  } catch (error) {
    console.error(`API调用失败 (${endpoint}):`, error);
    return { success: false, error: error.message };
  }
}

// 市场状态存储（兼容版本：同步更新+异步持久化）
export const useMarketStore = create((set, get) => ({
  // 指数数据
  indices: [],
  setIndices: (indices) => set({ indices }),
  
  // 市场统计
  stats: {
    limitUp: 0,
    limitDown: 0,
    up: 0,
    down: 0,
    flat: 0,
    sentiment: 50,
    northFlow: 0,
    southFlow: 0,
  },
  setStats: (stats) => set({ stats }),
  
  // 全量股票数据
  stocks: [],
  setStocks: (stocks) => set({ stocks }),
  
  // 收藏股（从API加载和保存）
  stockPool: [],
  
  // 加载收藏股（在App初始化时调用）
  loadStockPool: async () => {
    try {
      console.log('🔄 开始加载收藏股...');
      // forceRefresh 确保获取最新数据，不使用缓存
      const result = await apiCall('/pool/list', { forceRefresh: true });
      console.log('📊 收藏股加载结果:', result);
      if (result.success) {
        // 为每只股票获取实时数据（使用腾讯财经API）
        const stocksWithRealTimeData = await Promise.all(
          result.stocks.map(async (stock) => {
            try {
              const realtimeData = await fetchStockRealTime(stock.code);
              if (realtimeData) {
                console.log(`✅ 获取 ${stock.code} 实时数据: 价格=${realtimeData.price}, 涨跌幅=${realtimeData.changePercent}%`);
                return {
                  ...stock,
                  price: realtimeData.price || 0,
                  changePercent: realtimeData.changePercent || 0,
                  change: realtimeData.change || 0,
                  high: realtimeData.high || 0,
                  low: realtimeData.low || 0,
                  volume: realtimeData.volume || 0,
                  preClose: realtimeData.preClose || 0,
                };
              } else {
                console.warn(`⚠️ 股票 ${stock.code} 实时数据获取返回空`);
                return {
                  ...stock,
                  price: 0,
                  changePercent: 0,
                  change: 0,
                  high: 0,
                  low: 0,
                  volume: 0,
                  preClose: 0,
                };
              }
            } catch (error) {
              console.error(`❌ 获取股票 ${stock.code} 实时数据失败:`, error);
              return {
                ...stock,
                price: 0,
                changePercent: 0,
                change: 0,
                high: 0,
                low: 0,
                volume: 0,
                preClose: 0,
              };
            }
          })
        );
        
        console.log(`✅ 设置收藏股，共 ${stocksWithRealTimeData.length} 只股票（包含实时数据）`);
        console.log('📈 收藏股详情:', stocksWithRealTimeData.map(s => ({
          code: s.code,
          name: s.name,
          price: s.price,
          changePercent: s.changePercent
        })));
        set({ stockPool: stocksWithRealTimeData });
      } else {
        console.log('❌ 收藏股加载失败:', result.error);
      }
      return result;
    } catch (error) {
      console.error('加载收藏股失败:', error);
      return { success: false, error: error.message };
    }
  },
  
  // 添加股票到收藏股（同步更新，异步持久化）
  addToPool: async (stock) => {
    try {
      // 获取股票实时数据
      const realtimeData = await fetchStockRealTime(stock.code);
      const stockWithData = realtimeData ? {
        ...stock,
        price: realtimeData.price || 0,
        changePercent: realtimeData.changePercent || 0,
        change: realtimeData.change || 0,
        high: realtimeData.high || 0,
        low: realtimeData.low || 0,
        volume: realtimeData.volume || 0,
        preClose: realtimeData.preClose || 0,
      } : stock;
      
      console.log(`➕ 添加股票到收藏股: ${stock.code}`, {
        price: stockWithData.price,
        changePercent: stockWithData.changePercent
      });
      
      // 同步更新本地状态（新股票插入到开头，符合最新的在最上面的显示逻辑）
      set((state) => ({
        stockPool: state.stockPool.some(s => s.code === stock.code)
          ? state.stockPool
          : [stockWithData, ...state.stockPool]
      }));
      
      // 异步保存到API（只保存基础信息）
      apiCall('/pool/add', {
        method: 'POST',
        forceRefresh: true,
        body: JSON.stringify({
          stocks: [{
            code: stock.code,
            name: stock.name,
            source: stock.source || 'manual',
            notes: stock.notes || '',
          }]
        })
      }).then(result => {
        if (!result.success) {
          console.error('保存股票到API失败:', result.error);
        }
      });
    } catch (error) {
      console.error('添加股票失败:', error);
      // 即使获取实时数据失败，也添加到收藏股（同样插入到开头）
      set((state) => ({
        stockPool: state.stockPool.some(s => s.code === stock.code)
          ? state.stockPool
          : [stock, ...state.stockPool]
      }));
    }
  },
  
  // 从收藏股删除股票（先调API，成功后再更新本地状态）
  removeFromPool: async (code) => {
    console.log(`🗑️ 删除收藏股中的股票: ${code}`);
    
    try {
      const result = await apiCall('/pool/remove', {
        method: 'POST',
        body: JSON.stringify({ code }),
        forceRefresh: true
      });
      
      if (result.success) {
        console.log(`✅ 股票 ${code} 已从数据库删除`);
        // 删除成功，更新本地状态
        set((state) => ({
          stockPool: state.stockPool.filter(s => s.code !== code)
        }));
      } else {
        console.error('❌ 从API删除股票失败:', result.error);
        // 删除失败，重新加载以确保本地状态与数据库一致
        await get().loadStockPool();
      }
    } catch (error) {
      console.error('❌ 删除股票异常:', error);
      await get().loadStockPool();
    }
  },
  
  // 持仓（从API加载和保存）
  holdings: [],
  
  // 加载持仓（在App初始化时调用）
  loadHoldings: async () => {
    try {
      console.log('🔄 开始加载持仓...');
      const result = await apiCall('/holding/list');
      console.log('📊 持仓加载结果:', result);
      if (result.success) {
        // 为每个持仓获取实时价格
        const holdingsWithRealTimeData = await Promise.all(
          result.holdings.map(async (holding) => {
            try {
              const realtimeData = await fetchStockRealTime(holding.code);
              const currentPrice = realtimeData ? realtimeData.price : holding.current_price;
              
              if (realtimeData) {
                console.log(`📈 持仓 ${holding.code} 实时价格: ${currentPrice} (数据库: ${holding.current_price})`);
              }
              
              return {
                code: holding.code,
                name: holding.name,
                quantity: holding.shares,
                cost: holding.cost_price,
                price: currentPrice, // 使用实时价格
                notes: holding.notes,
                buy_time: holding.buy_time
              };
            } catch (error) {
              console.error(`❌ 获取持仓 ${holding.code} 实时价格失败:`, error);
              return {
                code: holding.code,
                name: holding.name,
                quantity: holding.shares,
                cost: holding.cost_price,
                price: holding.current_price, // 使用数据库价格
                notes: holding.notes,
                buy_time: holding.buy_time
              };
            }
          })
        );
        
        console.log(`✅ 设置持仓，共 ${holdingsWithRealTimeData.length} 只股票（包含实时价格）`);
        set({ holdings: holdingsWithRealTimeData });
      } else {
        console.log('❌ 持仓加载失败:', result.error);
      }
      return result;
    } catch (error) {
      console.error('加载持仓失败:', error);
      return { success: false, error: error.message };
    }
  },
  
  // 添加持仓（同步更新，异步持久化）
  addHolding: async (holding) => {
    try {
      // 获取股票实时价格
      const realtimeData = await fetchStockRealTime(holding.code);
      const currentPrice = realtimeData ? realtimeData.price : (holding.price || 0);
      
      const holdingWithRealTimePrice = {
        ...holding,
        price: currentPrice // 使用实时价格
      };
      
      console.log(`➕ 添加持仓: ${holding.code}`, {
        成本价: holding.cost,
        实时价格: currentPrice
      });
      
      // 同步更新本地状态
      set((state) => ({
        holdings: [...state.holdings.filter(h => h.code !== holding.code), holdingWithRealTimePrice]
      }));
      
      // 异步保存到API（保存实时价格到数据库）
      apiCall('/holding/add', {
        method: 'POST',
        body: JSON.stringify({
          code: holding.code,
          name: holding.name,
          shares: holding.quantity || holding.shares || 0,
          cost_price: holding.cost || holding.cost_price || 0,
          current_price: currentPrice, // 保存实时价格
          notes: holding.notes || ''
        })
      }).then(result => {
        if (!result.success) {
          console.error('保存持仓到API失败:', result.error);
        }
      });
    } catch (error) {
      console.error('添加持仓失败:', error);
      // 即使获取实时数据失败，也添加到持仓
      set((state) => ({
        holdings: [...state.holdings.filter(h => h.code !== holding.code), holding]
      }));
    }
  },
  
  // 删除持仓（同步更新，异步持久化）
  removeHolding: (code) => {
    console.log(`🗑️ 删除持仓: ${code}`);
    // 同步更新本地状态
    set((state) => ({
      holdings: state.holdings.filter(h => h.code !== code)
    }));
    
    // 异步从API删除
    apiCall('/holding/remove', {
      method: 'POST',
      body: JSON.stringify({ code })
    }).then(result => {
      if (result.success) {
        console.log(`✅ 持仓 ${code} 已从数据库删除`);
      } else {
        console.error('❌ 从API删除持仓失败:', result.error);
      }
    });
  },
  
  // 更新持仓（同步更新，异步持久化）
  updateHolding: (code, updates) => {
    set((state) => ({
      holdings: state.holdings.map(h => h.code === code ? { ...h, ...updates } : h)
    }));
    
    // 异步更新到API（通过重新添加）
    const currentHoldings = get().holdings;
    const updatedHolding = currentHoldings.find(h => h.code === code);
    if (updatedHolding) {
      apiCall('/holding/add', {
        method: 'POST',
        body: JSON.stringify({
          code: updatedHolding.code,
          name: updatedHolding.name,
          shares: updatedHolding.quantity || updatedHolding.shares || 0,
          cost_price: updatedHolding.cost || updatedHolding.cost_price || 0,
          current_price: updatedHolding.price || updatedHolding.current_price || 0,
          notes: updatedHolding.notes || ''
        })
      }).then(result => {
        if (!result.success) {
          console.error('更新持仓到API失败:', result.error);
        }
      });
    }
  },
  
  // 选股结果
  morningSelection: [],
  eveningSelection: [],
  setMorningSelection: (results) => set({ morningSelection: results }),
  setEveningSelection: (results) => set({ eveningSelection: results }),
  
  // 历史选股
  historySelection: {},
  addToHistory: (date, type, stocks) => set((state) => ({
    historySelection: {
      ...state.historySelection,
      [date]: { ...(state.historySelection[date] || {}), [type]: stocks }
    }
  })),
  
  // 加载状态
  loading: false,
  setLoading: (loading) => set({ loading }),
  
  // 最后更新时间
  lastUpdate: null,
  setLastUpdate: (time) => set({ lastUpdate: time }),
}));

// 尧帝智能体状态（全局持久化，切换模块不丢失）
export const useYaodiStore = create((set, get) => ({
  // 【铁律合规】核心指标（从API加载后存这里，切换模块不丢失）
  // 无数据时为 null，不伪造假数据
  metrics: {
    accuracy: null,
    avgReturn: null,
    winRate: null,
    sharpeRatio: null,
    maxDrawdown: null,
    totalTrades: null,
    evolutionCount: null,
    evolutionSpeed: null,
    marketSentiment: null,
    avgReliability: null,
    lastAccuracy: null,
    stagnationCount: 0,
    activeDays: null,
  },
  dataVersion: 0,  // 【修复】数据版本号，每次更新递增，强制触发React重渲染
  
  // 演化版本系统
  // 主版本（大版本升级）：尧帝智能体本身的升级，如 v1.0.0 → v2.0.0
  // 小版本升级：分支大模型和技术分析大模型的升级，如 v1.0 → v1.1
  mainVersion: { major: 1, minor: 0, build: 0 },  // 尧帝主版本
  mainVersionHistory: [{ major: 1, minor: 0, build: 0, date: bjISO(), reason: '初始版本' }],
  
  // 分支小版本（每个分支独立的小版本号）
  branchVersions: {},  // { branchId: { minor: 0, build: 0 } }
  
  // 检查并升级主版本（无限演化，无上限）
  checkMainVersionUpgrade: () => {
    const state = get();
    const { metrics, branches, mainVersion } = state;
    
    // 大版本升级条件：准确率≥99.5% 或 活跃分支数≥50 或 总进化等级≥100
    const totalEvolutionLevel = branches.reduce((sum, b) => sum + (b.evolution_level || 0), 0);
    const shouldUpgrade = metrics.accuracy >= 99.5 || branches.filter(b => b.active).length >= 50 || totalEvolutionLevel >= 100;
    
    // 无限演化：移除 mainVersion.major < 10 的上限限制
    if (shouldUpgrade) {
      const newVersion = { major: mainVersion.major + 1, minor: 0, build: 0 };
      set({
        mainVersion: newVersion,
        mainVersionHistory: [...state.mainVersionHistory, { ...newVersion, date: bjISO(), reason: `准确率${metrics.accuracy.toFixed(1)}%或分支数${branches.filter(b => b.active).length}触发升级` }]
      });
      return true;
    }
    return false;
  },
  
  // 检查并升级分支小版本（小版本升级条件：进化等级提升或可靠度>0.8）
  checkBranchVersionUpgrade: (branchId) => {
    const state = get();
    const branch = state.branches.find(b => b.id === branchId);
    if (!branch) return false;
    
    const currentVersion = state.branchVersions[branchId] || { minor: 0, build: 0 };
    // 小版本升级条件：进化等级提升 或 可靠度>0.85 或 准确率>90%
    const shouldUpgrade = (branch.evolution_level >= 3 && currentVersion.minor < branch.evolution_level - 2) || 
                         branch.reliability_score > 0.85 || 
                         branch.accuracy > 90;
    
    if (shouldUpgrade) {
      const newVersion = { minor: currentVersion.minor + 1, build: currentVersion.build + 1 };
      set({ branchVersions: { ...state.branchVersions, [branchId]: newVersion } });
      return newVersion;
    }
    return null;
  },
  
  // 获取格式化的版本号（语义化：V24.59 表示第24大版本第59小版本）
  getMainVersionString: () => {
    const { mainVersion } = get();
    let ver = 1;
    if (mainVersion && typeof mainVersion === 'object') {
      ver = mainVersion.major || 1;
    } else {
      ver = mainVersion || 1;
    }
    const major = Math.floor(ver / 100);
    const minor = ver % 100;
    return `V${major}.${String(minor).padStart(2, '0')}`;
  },
  
  getBranchVersionString: (branchId) => {
    const { branches, techBranches, branchVersions } = get();
    // 【修复】从预构建 Map 查找，O(1) 而非 O(n)，消除 200×200 性能灾难
    const versionMap = (branches || []).reduce((m, b) => { m[b.id] = b.evolution_level; return m; }, {});
    (techBranches || []).forEach(b => { versionMap[b.id] = b.evolution_level; });
    const lvl = versionMap[branchId];
    if (lvl) return `v${lvl}`;
    // 兼容旧格式
    const v = branchVersions[branchId];
    if (typeof v === 'number') return `v${v}`;
    if (v && typeof v === 'object') return `v${v.minor || 1}`;
    return 'v1';
  },

  // 技术分析大模型分支（不参与淘汰，持续进化）
  // 这些分支是尧帝智能体的核心技术分析能力，标记为 isTechModel: true
  techBranches: [],  // 由API数据驱动，不再硬编码

  branches: [],
  disabledBranches: [],
  isLoaded: false,       // 是否已从API加载过
  isRunning: false,
  evolutionSpeed: 10,
  avgReliability: 0.5,
  lastSaveTime: null,

  setMetrics: (metrics) => set({ metrics }),
  updateMetrics: (patch) => set((state) => ({ metrics: { ...state.metrics, ...patch }, dataVersion: state.dataVersion + 1 })),
  setBranches: (branches) => set((s) => ({ branches, dataVersion: s.dataVersion + 1 })),
  setDisabledBranches: (db) => set({ disabledBranches: db }),
  setTechBranches: (tb) => set((s) => ({ techBranches: tb, dataVersion: s.dataVersion + 1 })),
  setIsLoaded: (v) => set({ isLoaded: v }),
  setIsRunning: (v) => set({ isRunning: v }),
  setEvolutionSpeed: (v) => set({ evolutionSpeed: v }),
  setLastSaveTime: (v) => set({ lastSaveTime: v }),
  setMainVersion: (v) => set({ mainVersion: v }),
  setBranchVersions: (bv) => set({ branchVersions: bv }),

  // 从API加载数据（只同步metrics，分支和版本由前端自己管理）
  loadFromAPI: async () => {
    try {
      const result = await yaodiAPI.getSummary();
      if (!result?.success) return false;
      const data = result?.main || result?.data;
      if (data) {
        const speed = data.evolution_speed ?? 50;
        // 【铁律合规】同步核心指标，无数据时为 null
        set({
          metrics: {
            accuracy:       data.accuracy       ?? null,
            avgReturn:      data.avg_return      ?? null,
            winRate:        data.win_rate        ?? null,
            sharpeRatio:    data.sharpe_ratio    ?? null,
            maxDrawdown:    data.max_drawdown    ?? null,
            totalTrades:    data.total_trades    ?? null,
            evolutionCount: data.evolution_count ?? null,
            evolutionSpeed: speed,
            marketSentiment: data.market_sentiment ?? null,
            lastAccuracy:   data.accuracy        ?? null,
            stagnationCount: 0,
            activeDays:     data.active_days     ?? null,
          },
          // 同步顶层 evolutionSpeed（供 speedRef 和 HeaderStat 使用）
          evolutionSpeed: speed,
        });
      }
      // 同步主版本号（优先从 main.main_version 读，其次从顶层 main_version）
      const mvRaw = data?.main_version ?? result?.main_version;
      if (mvRaw != null) {
        const vNum = typeof mvRaw === 'number' ? mvRaw : (mvRaw?.major || 1);
        set({ mainVersion: { major: vNum, minor: 0, build: 0 } });
      }
      // 同步分支版本号（演化版本）
      if (result?.branch_versions && typeof result.branch_versions === 'object') {
        set({ branchVersions: result.branch_versions });
      }
      // 同步分支数据（如果后端有）
      if (result?.branches && Array.isArray(result.branches) && result.branches.length > 0) {
        const { branches: currentBranches } = get();
        // 始终同步 techBranches（技术分析大模型，前端不动，后端演化生成）
        const newTechBranches = result.branches.filter(b => b.is_tech_model);
        const newStratBranches = result.branches.filter(b => !b.is_tech_model);
        if (newTechBranches.length > 0) {
          set({ techBranches: newTechBranches });
        }
        // 策略分支：只在本地为空时才初始化（避免覆盖前端演化状态）
        if (!currentBranches || currentBranches.length === 0) {
          set({ branches: newStratBranches });
        }
      }
      set({ isLoaded: true });
      return true;
    } catch (e) {
      console.warn('尧帝加载失败:', e);
      return false;
    }
  },

  // 保存到API
  saveToAPI: async () => {
    const { metrics, branches, disabledBranches, mainVersion, branchVersions } = get();
    const mainPayload = {
      accuracy:        metrics?.accuracy ?? 0,
      avg_return:      metrics?.avgReturn ?? 0,
      win_rate:        metrics?.win_rate ?? 0,
      sharpe_ratio:    metrics?.sharpeRatio ?? 0,
      total_trades:    metrics?.totalTrades ?? 0,
      evolution_count: metrics?.evolutionCount ?? 0,
      evolution_speed: metrics?.evolutionSpeed ?? 50,
    };
    try {
      const res = await yaodiAPI.save({
        main: mainPayload,
        branches: [...branches, ...disabledBranches],
        main_version: mainVersion?.major || 1,
        branch_versions: branchVersions || {},
      });
      if (res?.success) {
        set({ lastSaveTime: bjISO() });
        console.log(`💾 尧帝已保存 accuracy=${(metrics?.accuracy ?? 0).toFixed(2)} evo=${metrics?.evolutionCount ?? 0} trades=${metrics?.totalTrades ?? 0}`);
      }
    } catch (e) {
      console.warn('尧帝保存失败:', e);
    }
  },

  // sendBeacon 保存（页面关闭/组件卸载用）
  saveToAPISync: () => {
    const { metrics, branches, disabledBranches, mainVersion, branchVersions } = get();
    if (!metrics) return;
    const mainPayload = {
      accuracy:        metrics.accuracy ?? 0,
      avg_return:      metrics.avgReturn ?? 0,
      win_rate:        metrics.win_rate ?? 0,
      sharpe_ratio:    metrics.sharpeRatio ?? 0,
      total_trades:    metrics.totalTrades ?? 0,
      evolution_count: metrics.evolutionCount ?? 0,
      // evolution_speed 由后端管理，前端不覆盖
      evolution_speed: metrics.evolutionSpeed ?? 50,
    };
    const payload = JSON.stringify({
      main: mainPayload,
      branches: [...branches, ...disabledBranches],
      main_version: mainVersion?.major || 1,
      branch_versions: branchVersions || {},
    });
    navigator.sendBeacon('/yaodi/save', new Blob([payload], { type: 'application/json' }));
    console.log(`📡 sendBeacon accuracy=${(metrics?.accuracy ?? 0).toFixed(2)} evo=${metrics?.evolutionCount ?? 0}`);
  },

  // ═══════════════════════════════════════════════════════════════
  // 技术分析大模型淘汰机制（优胜劣汰）
  // ═══════════════════════════════════════════════════════════════
  
  // 执行技术分析大模型淘汰检查
  checkTechModelElimination: () => {
    const { techBranches } = get();
    if (!techBranches || techBranches.length === 0) return [];
    
    const now = toBeijingTime();
    const eliminated = [];
    const survived = [];
    
    // 按场景分组
    const sceneGroups = {};
    techBranches.forEach(branch => {
      const scene = branch.scene || branch.strategy || '其他';
      if (!sceneGroups[scene]) sceneGroups[scene] = [];
      sceneGroups[scene].push(branch);
    });
    
    // 对每个场景内的模型进行优胜劣汰
    Object.entries(sceneGroups).forEach(([scene, models]) => {
      if (models.length <= 1) {
        // 只有一个模型，保留
        survived.push(...models);
        return;
      }
      
      // 按综合评分排序：准确率(40%) + 胜率(30%) + 可靠度(20%) + 进化等级(10%)
      const scoredModels = models.map(m => ({
        ...m,
        compositeScore: 
          (m.accuracy || 70) * 0.4 + 
          (m.win_rate || 65) * 0.3 + 
          (m.reliability_score || 0.5) * 100 * 0.2 + 
          (m.evolution_level || 1) * 10 * 0.1
      }));
      
      scoredModels.sort((a, b) => b.compositeScore - a.compositeScore);
      
      // 淘汰条件：
      // 1. 准确率低于场景平均水平 5% 以上
      // 2. 或者可靠度 < 0.6
      // 3. 或者连续多轮演化没有提升
      const avgAccuracy = models.reduce((sum, m) => sum + (m.accuracy || 70), 0) / models.length;
      
      scoredModels.forEach((model, index) => {
        const shouldEliminate = 
          model.accuracy < avgAccuracy - 5 || // 准确率显著低于平均
          model.reliability_score < 0.6 ||    // 可靠度过低
          (model.stagnationCount || 0) >= 5;   // 连续5轮未提升
        
        if (shouldEliminate && index > 0) { // 保留第一名
          eliminated.push({
            ...model,
            eliminateReason: `准确率${model.accuracy.toFixed(1)}%低于平均${avgAccuracy.toFixed(1)}%或可靠度${(model.reliability_score || 0).toFixed(2)}过低`,
            eliminateTime: bjISO()
          });
        } else {
          survived.push(model);
        }
      });
    });
    
    // 更新技术分析大模型列表
    if (eliminated.length > 0) {
      set({ techBranches: survived });
      console.log(`🔄 技术分析大模型淘汰: ${eliminated.length}个被淘汰, ${survived.length}个保留`);
      eliminated.forEach(e => {
        console.log(`  - ${e.name}: ${e.eliminateReason}`);
      });
    }
    
    return eliminated;
  },
  
  // 更新技术分析大模型的停滞计数
  updateTechModelStagnation: (branchId, hasImproved) => {
    const { techBranches } = get();
    const updated = techBranches.map(branch => {
      if (branch.id === branchId) {
        return {
          ...branch,
          stagnationCount: hasImproved ? 0 : (branch.stagnationCount || 0) + 1
        };
      }
      return branch;
    });
    set({ techBranches: updated });
  },
}));


// 版本控制状态
export const useVersionStore = create((set) => ({
  // 模型版本
  modelVersion: 'v1.0.0',
  modelVersions: [
    { version: 'v1.0.0', date: '2026-03-24', status: 'current', changelog: '初始版本' },
  ],
  
  // 代码版本
  codeVersion: '1.0.0',
  
  // 回测版本
  backtestVersions: [],
  addBacktestVersion: (version) => set((state) => ({
    backtestVersions: [...state.backtestVersions, version]
  })),

  // ═══════════════════════════════════════════════════════════════
  // 【BUG-07 FIX】从 yaodiStore.js 合并缺失方法，统一为单一 store 实例
  // ═══════════════════════════════════════════════════════════════

  // ── 数据加载方法 ──
  
  /** 加载尧帝摘要数据 */
  loadSummary: async () => {
    set({ isLoaded: false });
    try {
      const data = await yaodiAPI.getSummary();
      if (data.success) {
        const main = data.main || data;
        set({
          metrics: {
            accuracy:        main.accuracy        ?? null,
            avgReturn:       main.avg_return       ?? null,
            winRate:         main.win_rate         ?? null,
            sharpeRatio:     main.sharpe_ratio     ?? null,
            maxDrawdown:     main.max_drawdown     ?? null,
            totalTrades:     main.total_trades     ?? null,
            evolutionCount:  main.evolution_count  ?? null,
            evolutionSpeed:  main.evolution_speed   ?? null,
            avgReliability:  main.avg_reliability  ?? null,
            activeDays:      main.active_days       ?? null,
          },
          isLoaded: true,
          dataVersion: get().dataVersion + 1,
        });
      }
    } catch (e) { console.error('加载尧帝摘要失败:', e); }
    set({ isLoaded: true });
  },
  
  /** 加载分支列表 */
  loadBranches: async (page = 1, pageSize = 20, type = 'all') => {
    try {
      const data = await yaodiAPI.get(page, pageSize, type);
      if (data.success) {
        const all = data.branches || [];
        const tech = all.filter(b => b.is_tech_model === 1);
        const strat = all.filter(b => b.is_tech_model !== 1);
        set({
          branches: strat,
          techBranches: [...(get().techBranches || []), ...tech].filter(Boolean),
          isLoaded: true,
          dataVersion: get().dataVersion + 1,
        });
      }
    } catch (e) { console.error('加载分支列表失败:', e); }
  },
  
  /** 获取指定股票的尧帝分析（通过分支投票API） */
  analyzeStock: async (code) => {
    try {
      const data = await yaodiAPI.analyzeStock(code);
      if (data.success) return data;
      return null;
    } catch (e) {
      console.error('获取尧帝分析失败:', e);
      return null;
    }
  },
  
  /** 触发一次演化 */
  triggerEvolution: async () => {
    try {
      const data = await yaodiAPI.evolve();
      if (data.success) await get().loadSummary();
      return data;
    } catch (e) { return { success: false, error: e.message }; }
  },
  
  /** 启动/停止演化引擎 */
  toggleEvolution: async (action) => {
    try {
      const data = await yaodiAPI.evolutionAction(action);
      if (data.success) {
        set({ isRunning: action === 'start' });
        await get().loadSummary();
      }
      return data;
    } catch (e) { return { success: false, error: e.message }; }
  },
  
  /** 执行对抗训练 */
  runAdversarialTraining: async () => {
    try {
      const data = await evolutionAPI.distill();
      if (data.success) await get().loadSummary();
      return data;
    } catch (e) { return { success: false, error: e.message }; }
  },
  
  /** 刷新所有数据 */
  refreshAll: async () => {
    await Promise.all([get().loadSummary(), get().loadBranches()]);
  },
  
  // ── 本地操作方法 ──
  
  /** 添加价格预警 */
  addPriceAlert: (stockCode, price, type) => {
    // 本地状态，暂不持久化
  },
  
  /** 移除价格预警 */
  removePriceAlert: (stockCode, price) => {},
  
  /** 添加预警日志 */
  addAlertLog: (type, title, content, stockCode = null) => {},
  
  /** 更新设置 */
  updateSettings: (newSettings) => {},
  
  /** 启用/禁用分支 */
  toggleBranch: async (branchId) => {
    const branch = get().branches.find(b => b.id === branchId)
                || get().techBranches?.find(b => b.id === branchId);
    if (!branch) return;
    const action = branch.active ? 'disable' : 'enable';
    try {
      const data = await yaodiAPI.branchAction(branchId, action);
      if (data.success) await get().loadBranches();
    } catch (e) { console.error('切换分支状态失败:', e); }
  },
}));

// 初始化函数：在App.jsx中调用
export async function initializePersistedData() {
  const marketStore = useMarketStore.getState();
  
  // 加载收藏股
  await marketStore.loadStockPool();
  
  // 加载持仓
  await marketStore.loadHoldings();
  
  console.log('持久化数据加载完成');
}
