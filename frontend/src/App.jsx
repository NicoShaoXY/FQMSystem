import { useState, useEffect, lazy, Suspense } from 'react';
import './App.css';
import { useMarketStore } from './store/store';
import { applyTheme } from './theme';
import { initGlobalDataLoader } from './services/GlobalDataLoader';
import sseClient from './services/sseClient';
import heartbeatService from './services/heartbeatService';

// 页面组件 - 懒加载优化
const MarketOverview = lazy(() => import('./pages/MarketOverview'));
const Holding = lazy(() => import('./pages/Holding'));
const RedQueen = lazy(() => import('./pages/RedQueen'));
const Yaodi = lazy(() => import('./pages/Yaodi'));
const StockPool = lazy(() => import('./pages/StockPool'));
const StockSelection = lazy(() => import('./pages/StockSelection'));
const SystemManagement = lazy(() => import('./pages/SystemManagement'));
const AutonomyControl = lazy(() => import('./pages/AutonomyControl'));
const BlackSwanHistory = lazy(() => import('./pages/BlackSwanHistory'));
const ModelTraining = lazy(() => import('./pages/ModelTraining'));

// 加载中组件
const LoadingSpinner = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: '400px',
    flexDirection: 'column',
    gap: '16px',
    color: 'var(--text-secondary)'
  }}>
    <div style={{
      width: '40px',
      height: '40px',
      border: '3px solid var(--border)',
      borderTopColor: 'var(--accent-blue)',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    <span>加载中...</span>
  </div>
);

// 图标 - SF Symbols风格
const icons = {
  market: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7 16l4-4 4 4 5-6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  holding: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
    </svg>
  ),
  redqueen: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9"/>
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>
    </svg>
  ),
  yaodi: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
  ),
  datasource: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
      <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>
    </svg>
  ),
  stockpool: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <path d="M12 22V12M3.27 6.96L12 12M20.73 6.96L12 12"/>
    </svg>
  ),
  selection: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
    </svg>
  ),
  system: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  blackswan: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  autonomy: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 6v6"/>
      <circle cx="12" cy="16" r="1" fill="currentColor"/>
    </svg>
  ),
  sun: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="5"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  ),
  moon: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ),
  modeltrain: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <path d="M9 9h6M9 12h6M9 15h4"/>
    </svg>
  ),
};

// 导航项配置
const navItems = [
  { id: 'market', label: '市场概览', icon: icons.market },
  { id: 'holding', label: '用户持仓', icon: icons.holding },
  { id: 'redqueen', label: '舜帝交易', icon: icons.redqueen, highlight: true },
  { id: 'yaodi', label: '尧帝2.0', icon: icons.yaodi, highlight: true },
  { id: 'stockpool', label: '收藏股', icon: icons.stockpool },
  { id: 'selection', label: '智能选股', icon: icons.selection },
  { id: 'blackswan', label: '黑天鹅', icon: icons.blackswan, highlight: true },
  { id: 'autonomy', label: '🛑 自主控制', icon: icons.autonomy, highlight: true },
  { id: 'modeltrain', label: '🤖 模型训练', icon: icons.modeltrain, highlight: true },
  { id: 'system', label: '系统管理', icon: icons.system },
];

// 页面组件映射
const pageMap = {
  market: MarketOverview,
  holding: Holding,
  redqueen: RedQueen,
  yaodi: Yaodi,
  stockpool: StockPool,
  selection: StockSelection,
  autonomy: AutonomyControl,
  blackswan: BlackSwanHistory,
  modeltrain: ModelTraining,
  system: SystemManagement,
};

function App() {
  const [currentPage, setCurrentPage] = useState('market');
    const loadStockPool = useMarketStore((s) => s.loadStockPool);
  
  // 主题状态 - 从 localStorage 读取保存的主题
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('fqm-theme');
    if (savedTheme) return savedTheme;
    // 默认跟随系统
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });
  
  // 初始化：加载收藏股 + 静默分级预加载全局数据 + SSE全局连接
  useEffect(() => {
    loadStockPool();
    // 静默分级预加载（不阻塞UI，后台并行）
    initGlobalDataLoader().catch(() => {});
    // 全局SSE连接（保持全局连接，页面切换时不断开）
    sseClient.connectIfNeeded();
    
    // 启动心跳服务（检测浏览器标签关闭）
    heartbeatService.start();
    
    // 清理函数：组件卸载时停止心跳
    return () => {
      heartbeatService.stop();
    };
  }, []);

  // 监听 hash 导航（如黑天鹅详情跳转）
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash && pageMap[hash]) {
        setCurrentPage(hash);
        window.history.replaceState(null, '', window.location.pathname); // 清除 hash
      }
    };
    handleHashChange(); // 初始化时检查一次
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  
  // 应用主题
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    applyTheme(theme);
  }, [theme]);
  
  // 切换主题并保存到 localStorage
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('fqm-theme', newTheme);
    applyTheme(newTheme);
  };
  
  const Page = pageMap[currentPage];

  return (
    <div className="app-container">
      {/* 侧边栏 */}
      <aside className="sidebar">
        {/* Logo区域 */}
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <defs>
                  <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="var(--accent-blue)"/>
                    <stop offset="100%" stopColor="var(--accent-purple)"/>
                  </linearGradient>
                </defs>
                <circle cx="12" cy="12" r="10" stroke="url(#logoGrad)" strokeWidth="2"/>
                <circle cx="12" cy="12" r="4" fill="url(#logoGrad)"/>
              </svg>
            </div>
            <span className="logo-text">FQMSystem_尧帝智能版</span>
          </div>
        </div>
        
        {/* 导航菜单 */}
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${currentPage === item.id ? 'active' : ''} ${item.highlight ? 'highlight' : ''}`}
              onClick={() => setCurrentPage(item.id)}
            >
              <span className="nav-icon"><item.icon /></span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        
        {/* 底部工具栏 */}
        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={toggleTheme} title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}>
            {theme === 'light' ? <icons.sun /> : <icons.moon />}
          </button>
        </div>
      </aside>
      
      {/* 主内容区 */}
      <main className="main-content">
        <Suspense fallback={<LoadingSpinner />}>
          <Page />
        </Suspense>
      </main>
    </div>
  );
}

export default App;
