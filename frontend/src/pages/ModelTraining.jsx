import React, { useState, useEffect, useRef } from 'react';
import { Cpu, Play, Square, PauseCircle, RefreshCw, CheckCircle, XCircle, Clock, TrendingUp, AlertCircle, Zap, Settings, ChevronDown, ChevronUp, BarChart3, Target, Timer, Brain, StopCircle } from 'lucide-react';
import { themeColors } from '../theme';

const MODEL_PHASES = {
 1: { label: 'Phase 1', color: 'bg-[var(--mt-blue-subtle)]', textColor: 'text-[var(--mt-blue)]' },
 2: { label: 'Phase 2', color: 'bg-[var(--mt-purple)]', textColor: 'text-[var(--mt-purple)]' },
 3: { label: 'Phase 3', color: 'bg-[var(--mt-orange)]', textColor: 'text-[var(--mt-orange)]' },
};

const STATUS_CONFIG = {
 idle: { label: '空闲', icon: Clock, color: 'text-[var(--mt-gray)]', bg: 'bg-[var(--mt-gray-subtle)]' },
 training: { label: '训练中', icon: RefreshCw, color: 'text-[var(--mt-blue)]', bg: 'bg-[var(--mt-blue-subtle)]' },
 paused: { label: '已暂停', icon: PauseCircle, color: 'text-[var(--mt-yellow)]', bg: 'bg-[var(--mt-yellow-subtle)]' },
 stopping: { label: '停止中', icon: Square, color: 'text-[var(--mt-orange)]', bg: 'bg-[var(--mt-orange-subtle)]' },
 completed: { label: '已完成', icon: CheckCircle, color: 'text-[var(--mt-green)]', bg: 'bg-[var(--mt-green-subtle)]' },
 failed: { label: '失败', icon: XCircle, color: 'text-[var(--mt-red)]', bg: 'bg-[var(--mt-red-subtle)]' },
};

function formatTime(ms) {
 if (!ms) return '-';
 const s = Math.floor(ms / 1000);
 if (s < 60) return `${s}s`;
 const m = Math.floor(s / 60);
 if (m < 60) return `${m}分${s % 60}秒`;
 return `${Math.floor(m / 60)}小时${m % 60}分`;
}

function formatDate(iso) {
 if (!iso) return '-';
 try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); } catch { return '-'; }
}

function FeatureBar({ name, importance }) {
 return (
 <div className="flex items-center gap-2 text-xs">
 <span className="w-20 truncate text-[var(--mt-text-secondary)] ">{name}</span>
 <div className="flex-1 h-3 bg-[var(--mt-gray-glow)] rounded-full overflow-hidden">
 <div
 className="h-full bg-[var(--mt-blue-subtle)] rounded-full transition-all duration-500"
 style={{ width: `${Math.min(100, importance * 100)}%` }}
 />
 </div>
 <span className="w-12 text-right text-[var(--mt-text-muted)] ">{importance.toFixed(3)}</span>
 </div>
 );
}

// 获取模型训练单位（树模型→棵，神经网络→轮，其他→无单位）
const getTrainingUnit = (modelId) => {
  const treeModels = ['xgboost', 'lightgbm', 'catboost', 'rf'];
  const nnModels   = ['lstm', 'gru', 'cnn', 'transformer', 'gnn', 'autoencoder'];
  if (treeModels.includes(modelId)) return '棵';
  if (nnModels.includes(modelId))   return '轮';
  return '';
};

function ModelCard({ id, model, yaodiTrainingModels }) {
 const [expanded, setExpanded] = useState(false);
 const cfg = STATUS_CONFIG[model.trainStatus] || STATUS_CONFIG.idle;
 const StatusIcon = cfg.icon;
 const phase = MODEL_PHASES[model.phase] || MODEL_PHASES[1];

 const canStart = model.trainStatus === 'idle' || model.trainStatus === 'completed' || model.trainStatus === 'failed';
 const canStop = model.trainStatus === 'training' || model.trainStatus === 'paused' || model.trainStatus === 'stopping';
 const isRunning = model.trainStatus === 'training' || model.trainStatus === 'stopping';
 
 // 检查是否在尧帝训练队列中
 const yaodiCurrentModel = yaodiTrainingModels?.currentModel;
 const yaodiTrainingList = yaodiTrainingModels?.trainingModels || [];
 const yaodiTraining = yaodiTrainingList.find(m => m.model_id === id);
 const isYaodiTraining = yaodiCurrentModel === id || !!yaodiTraining;

 // ★ 统一进度数据源：优先使用尧帝调度器的checkpoint数据（与上面调度器状态栏同步）
 const syncedProgress = yaodiTraining ? {
   treesBuilt: yaodiTraining.trees_built ?? model.treesBuilt,
   totalTrees: yaodiTraining.total_trees ?? model.totalTrees,
   progress: yaodiTraining.progress_pct ?? model.progress,
 } : null;

 // 监听主题切换，强制重新渲染
 const [, setThemeTick] = useState(0);
 useEffect(() => {
 const handleThemeChange = () => setThemeTick(t => t + 1);
 window.addEventListener('fqm-theme-change', handleThemeChange);
 return () => window.removeEventListener('fqm-theme-change', handleThemeChange);
 }, []);

 // 动态主题颜色 - 背景用主题色，边框用themeColors
 const currentTheme = themeColors.current;
 const cardBgColor = currentTheme.bgCard || '#1e2d45';
 const cardBorderColor = isYaodiTraining ? currentTheme.green : isRunning ? currentTheme.cyan : currentTheme.border;

 return (
 <div className="border rounded-lg p-4" style={{ backgroundColor: cardBgColor, borderColor: cardBorderColor }}>
 {/* Header */}
 <div className="flex items-center gap-3">
 <div className={`w-8 h-8 rounded-lg ${phase.color} flex items-center justify-center`}>
 <Cpu className="w-4 h-4 text-white" />
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="font-medium" style={{ color: themeColors.current.textPrimary }}>{model.name}</span>
 <span className={`text-xs px-1.5 py-0.5 rounded ${phase.color} text-white`}>{phase.label}</span>
 {isYaodiTraining && (
 <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--mt-green)] text-[var(--mt-white)] animate-pulse flex items-center gap-1">
 <RefreshCw className="w-3 h-3" /> 尧帝训练中
 </span>
 )}
 </div>
 <div className="flex items-center gap-3 mt-1 text-xs text-[var(--mt-text-muted)] ">
 {model.sample_count > 0 && <span>样本: {model.sample_count.toLocaleString()}</span>}
 {model.accuracy !== null && (
 <span className={model.accuracy >= 55 ? 'text-[var(--mt-green)] font-medium' : ''}>
  准确率: {model.accuracy > 1 ? `${model.accuracy.toFixed(2)}%` : `${(model.accuracy * 100).toFixed(2)}%`}
  {/* 趋势指示器 */}
  {model.previous_accuracy != null && (() => {
    const prev = model.previous_accuracy > 1 ? model.previous_accuracy : model.previous_accuracy * 100;
    const curr = model.accuracy > 1 ? model.accuracy : model.accuracy * 100;
    const diff = curr - prev;
    const absDiff = Math.abs(diff);
    if (absDiff < 0.01) {
      // 变化<0.01% 显示灰色横杠
      return <span className="ml-1 text-gray-400">—</span>;
    } else if (diff > 0) {
      // 提升显示红色向上箭头
      return <span className="ml-1 text-red-500" title={`+${diff.toFixed(2)}%`}>↑</span>;
    } else {
      // 降低显示绿色向下箭头
      return <span className="ml-1 text-green-500" title={`${diff.toFixed(2)}%`}>↓</span>;
    }
  })()}
 </span>
 )}
 {model.diagnostics?.r2 && (
  <span className="text-[var(--mt-text-muted)] ml-2">R²: {model.diagnostics.r2}</span>
 )}
 {model.diagnostics?.rmse && (
  <span className="text-[var(--mt-text-muted)] ml-2">RMSE: {model.diagnostics.rmse}</span>
 )}
 <span className={isYaodiTraining ? 'text-[var(--mt-green)] font-medium' : cfg.color}>
 {isYaodiTraining ? '尧帝训练中' : cfg.label}
 </span>
 </div>
 </div>
 <div className="flex items-center gap-2">
 {(isYaodiTraining || model.trainStatus === 'training') && (
 <RefreshCw className="w-4 h-4 text-[var(--mt-blue)] animate-spin" />
 )}
 </div>
 </div>

 {/* Progress bar */}
 {isRunning && (() => {
   const p = syncedProgress || model;
   const prog = p.progress ?? 0;
   const tB = p.treesBuilt || 0;
   const tT = p.totalTrees || 0;
   const unit = getTrainingUnit(id);
   const elapsedSec = (Date.now() - (model.startTime || model.elapsed)) / 1000;
   return (
 <div className="mt-3">
 <div className="flex justify-between text-xs text-[var(--mt-text-muted)] mb-1">
 <span>{tB ? `${tB}/${tT}${unit}` : `${prog}%`}</span>
 <span>{prog.toFixed(2)}% · 已运行 {formatTime(model.elapsed)} · 预计剩余 {formatTime(prog > 0 ? (model.elapsed / (prog / 100) - model.elapsed) : 0)}</span>
 </div>
 <div className="h-2 bg-[var(--mt-gray-glow)] rounded-full overflow-hidden">
 <div
 className="h-full bg-[var(--mt-blue-subtle)] rounded-full transition-all duration-300"
 style={{ width: `${prog}%` }}
 />
 </div>
 </div>
 );
 })()}

 {/* Error message */}
 {model.error && (
 <div className="mt-2 flex items-center gap-1 text-xs text-[var(--mt-red)] bg-[var(--mt-red-subtle)] p-2 rounded">
 <AlertCircle className="w-3 h-3 flex-shrink-0" />
 <span className="truncate">{model.error}</span>
 </div>
 )}

 {/* 训练进度详情（空闲时也显示） */}
 {model.trainStatus === 'training' ? (
 <div className="mt-2 bg-[var(--mt-blue-subtle)] bg-[var(--mt-blue-subtle)] rounded-lg p-3 space-y-1.5">
 <div className="flex justify-between text-xs">
 <span className="text-[var(--mt-blue)] font-medium">实时进度</span>
 <span className="text-[var(--mt-blue)]">{(syncedProgress?.progress ?? model.progress).toFixed(2)}%</span>
 </div>
 <div className="h-2 bg-[var(--mt-blue-glow)] rounded-full overflow-hidden">
 <div className="h-full bg-[var(--mt-blue-subtle)] rounded-full transition-all" style={{ width: `${syncedProgress?.progress ?? model.progress}%` }} />
 </div>
 {(syncedProgress?.treesBuilt || model.treesBuilt) > 0 && (
 <div className="flex justify-between text-xs text-[var(--mt-blue)] ">
 <span>{getTrainingUnit(model.id) === '棵' ? `树: ${syncedProgress?.treesBuilt ?? model.treesBuilt}/${syncedProgress?.totalTrees ?? model.totalTrees}` : getTrainingUnit(model.id) === '轮' ? `轮: ${syncedProgress?.treesBuilt ?? model.treesBuilt}/${syncedProgress?.totalTrees ?? model.totalTrees}` : ''}</span>
 <span>耗时: {formatTime(model.elapsed)}</span>
 </div>
 )}
 {model.accuracy != null && (
 <div className="text-xs text-[var(--mt-blue)] ">
 历史准确率: {(model.accuracy * 100).toFixed(2)}%
 {/* 趋势指示器 */}
 {model.previous_accuracy != null && (() => {
 const prev = model.previous_accuracy > 1 ? model.previous_accuracy : model.previous_accuracy * 100;
 const curr = model.accuracy > 1 ? model.accuracy : model.accuracy * 100;
 const diff = curr - prev;
 const absDiff = Math.abs(diff);
 if (absDiff < 0.01) {
 return <span className="ml-1 text-gray-400">—</span>;
 } else if (diff > 0) {
 return <span className="ml-1 text-red-500" title={`+${diff.toFixed(2)}%`}>↑</span>;
 } else {
 return <span className="ml-1 text-green-500" title={`${diff.toFixed(2)}%`}>↓</span>;
 }
 })()}
 </div>
 )}
 </div>
 ) : model.trainStatus === 'completed' || model.trainStatus === 'failed' ? (
 <div className="mt-2 flex items-center justify-between text-xs">
 <div className="text-[var(--mt-gray)]">
 {model.trained_at ? `完成: ${formatDate(model.trained_at)}` : `耗时: ${formatTime(model.elapsed)}`}
 </div>
 {model.accuracy != null && (
 <span className={`font-medium ${
 model.accuracy >= 0.6 ? 'text-[var(--mt-green)]' :
 model.accuracy >= 0.5 ? 'text-[var(--mt-blue)]' : 'text-[var(--mt-orange)]'
 }`}>
 准确率 {(model.accuracy * 100).toFixed(2)}%
 {/* 趋势指示器 */}
 {model.previous_accuracy != null && (() => {
 const prev = model.previous_accuracy > 1 ? model.previous_accuracy : model.previous_accuracy * 100;
 const curr = model.accuracy > 1 ? model.accuracy : model.accuracy * 100;
 const diff = curr - prev;
 const absDiff = Math.abs(diff);
 if (absDiff < 0.01) {
 return <span className="ml-1 text-gray-400">—</span>;
 } else if (diff > 0) {
 return <span className="ml-1 text-red-500" title={`+${diff.toFixed(2)}%`}>↑</span>;
 } else {
 return <span className="ml-1 text-green-500" title={`${diff.toFixed(2)}%`}>↓</span>;
 }
 })()}
 </span>
 )}
 </div>
 ) : null}

 {/* Feature importance */}
 {expanded && model.featureImportance && model.featureNames && (
 <div className="mt-3 pt-3 border-t space-y-1">
 <div className="text-xs font-medium text-[var(--mt-text-muted)] mb-2">特征重要性</div>
 {model.featureNames.map((name, i) => (
 model.featureImportance[i] != null && (
 <FeatureBar key={name} name={name} importance={model.featureImportance[i]} />
 )
 ))}
 </div>
 )}

 {/* Expand toggle */}
 {(model.featureImportance || model.diagnostics) && (
 <button
 onClick={() => setExpanded(!expanded)}
 className="mt-2 text-xs text-[var(--mt-blue)] hover:text-[var(--mt-blue)]"
 >
 {expanded ? '收起详情 ▲' : '查看详情 ▼'}
 </button>
 )}
 </div>
 );
}

export default function ModelTraining() {
 const [models, setModels] = useState({});
 const [loading, setLoading] = useState(null); // null = loading, false = done
 const [starting, setStarting] = useState({});
 const [toast, setToast] = useState(null);
 
 // ═══════════════════════════════════════════════════════════════
 // 智能训练控制台状态
 // ═══════════════════════════════════════════════════════════════
 const [smartTraining, setSmartTraining] = useState({
 enabled: false, // 是否启用AI训练
 budgetMinutes: 180, // 每日训练预算（分钟）
 usedMinutes: 0, // 今日已用时间
 currentRound: 0, // 当前全局轮次
 currentIndex: 0, // 当前训练的模型索引
 queue: [], // 训练队列 [{id, priority, reason, iterations[]}]
 strategy: {
 retrainThreshold: 60, // 准确率<60%优先训练
 skipThreshold: 80, // 准确率>80%跳过
 dataStaleDays: 7, // 数据过期天数
 minSamples: 4000, // 最小样本数
 maxIterations: 5, // 每个模型最大迭代次数
 plateauTolerance: 0.5, // 瓶颈容忍度(%)，提升<此值视为瓶颈
 },
 history: [], // 训练历史 [{modelId, accuracy, duration, timestamp}]
 aiLog: [], // AI决策日志 [{time, model, action, reason}]
 });
 const [showStrategy, setShowStrategy] = useState(false);
 const [yaodiStatus, setYaodiStatus] = useState(null); // 尧帝调度器状态
 const [autoTrainConfig, setAutoTrainConfig] = useState(null); // 自动训练配置+CPU阈值
  const [schedulerInfo, setSchedulerInfo] = useState(null); // 调度器倒计时
  const schedulerTimerRef = useRef(null); // 倒计时刷新定时器

 const showToast = (msg, type = 'info') => {
 setToast({ msg, type });
 setTimeout(() => setToast(null), 3000);
 };

 const fetchModels = async () => {
 try {
 const res = await fetch('/api/ml/manual/status');
 const data = await res.json();
 console.log('[fetchModels] Received data, models count:', Object.keys(data.models || {}).length);
 // Check if any model is training
 const training = Object.values(data.models || {}).filter(m => m.trainStatus === 'training');
 if (training.length > 0) {
 console.log('[fetchModels] Training models:', training.map(m => m.name));
 }
 if (data.success) {
 setModels(data.models);
 // 保存尧帝调度器状态
 if (data.yaodi) {
 setYaodiStatus(data.yaodi);
 }
 }
 // 获取自动训练配置+CPU信息
 try {
 // 同时获取自动训练配置和调度器状态
 const [res2, resS] = await Promise.all([
   fetch('/api/ml/autotrain/config'),
   fetch('/api/ml/autotrain/status')
 ]);
 const data2 = await res2.json();
 const dataS = await resS.json();
 if (data2.success) setAutoTrainConfig(data2.config);
 if (dataS.success && dataS.scheduler) {
   setSchedulerInfo(dataS.scheduler);
 }
 } catch (e) { /* ignore */ }
 try {
 const res3 = await fetch('/api/system/cpu');
 const data3 = await res3.json();
 if (data3.success) setAutoTrainConfig(prev => prev ? { ...prev, cpu: data3 } : { cpu: data3 });
 } catch (e) { /* ignore */ }
 } catch (e) { console.error(e); }
 };

 // 调度器倒计时刷新（每5秒）
  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch('/api/ml/autotrain/status');
        const d = await res.json();
        if (d.success && d.scheduler) {
          setSchedulerInfo(d.scheduler);
          // 训练中保留倒计时显示（不再清空）
        }
      } catch(e) {}
    };
    schedulerTimerRef.current = setInterval(tick, 1000);
    return () => clearInterval(schedulerTimerRef.current);
  }, [yaodiStatus?.ml?.isRunning]);

  const pollModels = async () => { 
 try {
 const res = await fetch('/api/ml/manual/status');
 const data = await res.json();
 // Only log if there's a change in training status
 const training = Object.values(data.models || {}).filter(m => m.trainStatus === 'training');
 if (training.length > 0) {
 console.log('[pollModels] Training:', training.map(m => `${m.name}:${m.progress}%`).join(', '));
 }
 if (data.success) {
 setModels(data.models);
 if (data.yaodi) setYaodiStatus(data.yaodi);
 }
 // 更新CPU信息
 try {
 const res3 = await fetch('/api/system/cpu');
 const data3 = await res3.json();
 if (data3.success) setAutoTrainConfig(prev => prev ? { ...prev, cpu: data3 } : { cpu: data3 });
 } catch (e) { /* ignore */ }
 } catch (e) { console.error(e); }
 };


 // Track training completion for toast notifications
 const completedRef = React.useRef({});

 useEffect(() => {
 if (!models) return;
 Object.entries(models).forEach(([modelId, model]) => {
 if (completedRef.current[modelId] !== model.trainStatus && model.trainStatus === 'completed') {
 showToast(`🎉 ${model.name} 训练完成`, 'success');
 // 训练完成时，把训练时间加到预算
 const trainingMinutes = (model.elapsed || 0) / 60000;
 setSmartTraining(prev => ({
 ...prev,
 usedMinutes: prev.usedMinutes + trainingMinutes
 }));
 } else if (completedRef.current[modelId] !== model.trainStatus && model.trainStatus === 'failed') {
 showToast(`❌ ${model.name} 训练失败`, 'error');
 }
 completedRef.current[modelId] = model.trainStatus;
 });
 }, [models]);

 useEffect(() => {
 fetchModels();
 }, []);

 // 尧帝训练状态轮询（每2秒）
 useEffect(() => {
 const interval = setInterval(async () => {
 try {
 const res = await fetch('/api/ml/manual/status');
 const data = await res.json();
 if (data.success && data.yaodi) {
 setYaodiStatus(data.yaodi);
 }
 } catch (e) { /* ignore */ }
 }, 2000);
 return () => clearInterval(interval);
 }, []);

 // 训练中每1秒轮询最新进度
 useEffect(() => {
 if (!models || Object.keys(models).length === 0) return;
 const hasRunning = Object.values(models).some(m => m.trainStatus === 'training' || m.trainStatus === 'stopping');
 const yaodiRunning = yaodiStatus?.ml?.isRunning;
 if (!hasRunning && !yaodiRunning) return;
 const interval = setInterval(pollModels, 1000);
 return () => clearInterval(interval);
 }, [models, yaodiStatus?.ml?.isRunning]);

 const handleStart = async (modelId) => {
 console.log('[handleStart] Starting model:', modelId);
 if (starting[modelId]) {
 console.log('[handleStart] Already starting, returning');
 return;
 }
 setStarting(s => ({ ...s, [modelId]: true }));
 // 乐观更新：立即显示"训练中"状态
 setModels(prev => ({
 ...prev,
 [modelId]: { ...prev[modelId], trainStatus: 'training' }
 }));
 console.log('[handleStart] Calling API...');
 try {
 const res = await fetch(`/api/ml/manual/start/${modelId}`, { 
 method: 'POST',
 headers: { 'Content-Type': 'application/json' }
 });
 const data = await res.json();
 console.log('[handleStart] API response:', data);
 if (data.success) {
 console.log('[handleStart] Success, manually fetching status...');
 showToast(`✅ ${data.message}`, 'success');
 // Simple fetch without abort controller
 console.log('[handleStart] Starting simple fetch...');
 try {
 const res2 = await fetch('/api/ml/manual/status');
 console.log('[handleStart] Fetch status:', res2.status);
 const data2 = await res2.json();
 console.log('[handleStart] Got data2, success:', data2.success);
 
 if (data2.success) {
 console.log('[handleStart] Model', modelId, 'status:', data2.models[modelId]?.trainStatus, 'progress:', data2.models[modelId]?.progress);
 setModels(data2.models);
 console.log('[handleStart] setModels called');
 }
 } catch (e2) {
 console.error('[handleStart] Fetch error:', e2);
 }
 } else {
 showToast(`❌ ${data.error}`, 'error');
 }
 } catch (e) {
 console.error('[handleStart] Error:', e);
 showToast(`❌ 启动失败: ${e.message}`, 'error');
 } finally {
 setStarting(s => ({ ...s, [modelId]: false }));
 }
 };

 // ═══════════════════════════════════════════════════════════════
 // 智能样本量策略
 // ═══════════════════════════════════════════════════════════════
 
 // 根据模型类型获取样本量配置
 const getSampleConfig = (modelId) => {
 const simpleModels = ['linear', 'bayesian', 'svm'];
 const treeModels = ['xgboost', 'lightgbm', 'randomforest', 'catboost'];
 const neuralModels = ['lstm', 'gru', 'cnn', 'transformer', 'gnn'];
 const analysisModels = ['arima', 'garch', 'autoencoder'];
 
 const id = modelId.toLowerCase();
 
 if (simpleModels.some(m => id.includes(m))) {
 return { type: 'simple', base: 10000, multiplier: 1.5, max: 80000 };
 } else if (treeModels.some(m => id.includes(m))) {
 return { type: 'tree', base: 30000, multiplier: 2, max: 200000 };
 } else if (neuralModels.some(m => id.includes(m))) {
 return { type: 'neural', base: 50000, multiplier: 3, max: 300000 };
 } else if (analysisModels.some(m => id.includes(m))) {
 return { type: 'analysis', base: 20000, multiplier: 1.2, max: 80000 };
 }
 return { type: 'default', base: 15000, multiplier: 1.5, max: 80000 };
 };
 
 // ═══════════════════════════════════════════════════════════════
 // AI训练智能决策引擎
 // ═══════════════════════════════════════════════════════════════
 
 // AI决策：计算最优样本数（基于历史迭代判断瓶颈）
 const calculateSmartSampleCount = (modelId, currentAccuracy, currentSamples, iterations = []) => {
 const config = getSampleConfig(modelId);
 const accuracy = currentAccuracy > 1 ? currentAccuracy / 100 : currentAccuracy;
 let targetSamples = currentSamples || config.base;
 
 // 无历史 → 基础策略
 if (iterations.length === 0) {
 if (accuracy < 0.5) {
 targetSamples = Math.min(config.max, Math.floor(targetSamples * 2));
 } else if (accuracy < 0.6) {
 targetSamples = Math.min(config.max, Math.floor(targetSamples * 1.5));
 }
 return Math.max(config.base, targetSamples);
 }
 
 // 有历史 → AI瓶颈分析
 const plateauTol = (smartTraining.strategy.plateauTolerance || 0.5) / 100;
 const lastIter = iterations[iterations.length - 1];
 const prevIter = iterations.length > 1 ? iterations[iterations.length - 2] : null;
 
 const lastAcc = lastIter.accuracy;
 const lastSamples = lastIter.sampleCount || currentSamples;
 const prevAcc = prevIter ? prevIter.accuracy : 0;
 const delta = prevAcc ? (lastAcc - prevAcc) : lastAcc;
 
 // 情况1: 准确率下降 → 减少样本回退
 if (prevAcc > 0 && lastAcc < prevAcc) {
 const drop = ((prevAcc - lastAcc) / prevAcc * 100).toFixed(1);
 // AI日志：准确率下降，可能过拟合，适度增加样本
 targetSamples = Math.min(config.max, Math.floor(lastSamples * 1.3));
 addAiLog(modelId, '准确率下降', `从${(prevAcc*100).toFixed(1)}%降至${(lastAcc*100).toFixed(1)}%，降幅${drop}%，适度增加样本至${targetSamples.toLocaleString()}尝试突破`);
 }
 // 情况2: 提升幅度 < 瓶颈容忍度 → 瓶颈，大幅增加样本
 else if (prevAcc > 0 && delta < plateauTol && lastSamples < config.max) {
 targetSamples = Math.min(config.max, Math.floor(lastSamples * 2));
 addAiLog(modelId, '检测到瓶颈', `提升仅${(delta*100).toFixed(2)}%<${(plateauTol*100).toFixed(1)}%，样本翻倍至${targetSamples.toLocaleString()}尝试突破`);
 }
 // 情况3: 正常提升 → 保持当前样本量
 else if (delta >= plateauTol) {
 targetSamples = lastSamples;
 addAiLog(modelId, '正常提升', `从${(prevAcc*100).toFixed(1)}%→${(lastAcc*100).toFixed(1)}%，保持样本${targetSamples.toLocaleString()}`);
 }
 // 情况4: 首次迭代 → 简单判断
 else {
 if (accuracy < 0.5) {
 targetSamples = Math.min(config.max, Math.floor(lastSamples * 1.8));
 } else {
 targetSamples = Math.min(config.max, Math.floor(lastSamples * 1.3));
 }
 addAiLog(modelId, '首轮分析', `当前${(lastAcc*100).toFixed(1)}%，增加样本至${targetSamples.toLocaleString()}`);
 }
 
 // 已达样本上限
 if (targetSamples >= config.max) {
 addAiLog(modelId, '样本达上限', `已达${config.type}模型上限${config.max.toLocaleString()}，不再增加`);
 }
 
 return Math.max(config.base, targetSamples);
 };
 
 // AI决策：判断是否应继续迭代
 const shouldContinueIterating = (modelId, accuracy, iterations) => {
 const maxIter = smartTraining.strategy.maxIterations || 5;
 const skipThresh = (smartTraining.strategy.skipThreshold || 80) / 100;
 const plateauTol = (smartTraining.strategy.plateauTolerance || 0.5) / 100;
 
 // 达到最大迭代次数
 if (iterations.length >= maxIter) {
 addAiLog(modelId, '达到上限', `已完成${maxIter}轮迭代，停止`);
 return false;
 }
 
 // 准确率已达标
 if (accuracy >= skipThresh) {
 addAiLog(modelId, '达标停止', `准确率${(accuracy*100).toFixed(1)}%≥${skipThresh*100}%目标，停止`);
 return false;
 }
 
 // 检测连续2轮瓶颈且样本已达上限
 if (iterations.length >= 2) {
 const last2 = iterations.slice(-2);
 const deltas = [];
 for (let i = 0; i < last2.length - 1; i++) {
 deltas.push(last2[i + 1].accuracy - last2[i].accuracy);
 }
 const allPlateau = deltas.every(d => d < plateauTol);
 const config = getSampleConfig(modelId);
 const lastSamples = last2[last2.length - 1].sampleCount || 0;
 if (allPlateau && lastSamples >= config.max * 0.9) {
 addAiLog(modelId, '瓶颈放弃', `连续2轮瓶颈且样本接近上限，停止`);
 return false;
 }
 }
 
 return true;
 };
 
 // 添加AI决策日志
 const addAiLog = (modelId, action, reason) => {
 setSmartTraining(prev => ({
 ...prev,
 aiLog: [...prev.aiLog.slice(-49), {
 time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
 model: modelId,
 action,
 reason,
 }],
 }));
 };

 const handleStop = async (modelId) => {
 try {
 const res = await fetch(`/api/ml/manual/stop/${modelId}`, { method: 'POST' });
 const data = await res.json();
 if (data.success) {
 showToast(`⏹ ${data.message}`, 'info');
 } else {
 showToast(`❌ ${data.error}`, 'error');
 }
 fetchModels();
 } catch (e) {
 showToast(`❌ 停止失败: ${e.message}`, 'error');
 }
 };

 // ═══════════════════════════════════════════════════════════════
 // 智能训练逻辑
 // ═══════════════════════════════════════════════════════════════
 
 // 计算模型健康度
 const getModelHealth = (model, modelId) => {
 const accuracy = model.accuracy > 1 ? model.accuracy / 100 : model.accuracy;
 const sampleCount = model.sample_count || 0;
 const lastTrained = model.trained_at ? new Date(model.trained_at) : null;
 const daysSinceTrained = lastTrained ? (Date.now() - lastTrained.getTime()) / (1000 * 60 * 60 * 24) : 999;
 
 let health = 'good';
 let priority = 0;
 let reason = '';
 
 // 时序统计模型（准确率基于MSE/波动率，不可与分类模型直接比较）
 const isStatModel = ['arima', 'garch'].includes(modelId);
 const effectiveAcc = isStatModel ? Math.min(accuracy, 0.65) : accuracy; // 统计模型上限65%等效
 
 if (isStatModel) {
 // 统计模型用更宽松的阈值
 if (accuracy < 0.5) {
 health = 'warning';
 priority = 60;
 reason = `统计拟合度偏低(${(accuracy*100).toFixed(1)}%)，非分类准确率`;
 } else {
 health = 'normal';
 priority = 30;
 reason = `统计拟合度${(accuracy*100).toFixed(1)}%（非分类准确率）`;
 }
 } else if (accuracy < 0.5) {
 health = 'critical';
 priority = 100;
 reason = `准确率过低(${(accuracy*100).toFixed(1)}%)，急需重训`;
 } else if (accuracy < 0.6) {
 health = 'warning';
 priority = 80;
 reason = `准确率偏低(${(accuracy*100).toFixed(1)}%)，建议训练`;
 } else if (accuracy < 0.8) {
 health = 'normal';
 priority = 50;
 reason = `准确率正常(${(accuracy*100).toFixed(1)}%)`;
 } else if (daysSinceTrained > smartTraining.strategy.dataStaleDays) {
 health = 'stale';
 priority = 40;
 reason = `数据已过期${Math.floor(daysSinceTrained)}天，建议更新`;
 } else {
 health = 'good';
 priority = 0;
 reason = `模型健康，无需训练`;
 }
 
 if (sampleCount < smartTraining.strategy.minSamples) {
 priority += 20;
 reason += ` | 样本不足(${sampleCount.toLocaleString()})`;
 }
 
 return { health, priority, reason, accuracy, daysSinceTrained, sampleCount };
 };
 
 // 更新模型样本数配置（调用后端API）
 const updateModelSampleCount = async (modelId, targetSamples) => {
 try {
 const res = await fetch(`/api/ml/config/${modelId}`, {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ targetSampleCount: targetSamples }),
 });
 const data = await res.json();
 if (data.success) {
 console.log(`[SmartTraining] Updated ${modelId} sample count to ${targetSamples}`);
 return true;
 } else {
 console.error(`[SmartTraining] Failed to update sample count:`, data.error);
 return false;
 }
 } catch (e) {
 console.error(`[SmartTraining] Error updating sample count:`, e);
 return false;
 }
 };
 
 // 构建训练队列
 const buildTrainingQueue = () => {
 const queue = [];
 for (const [id, model] of Object.entries(models || {})) {
 if (model.trainStatus === 'training' || model.trainStatus === 'stopping') continue;
 
 const health = getModelHealth(model, id);
 if (health.priority > 0) {
 queue.push({
 id,
 name: model.name,
 priority: health.priority,
 reason: health.reason,
 health: health.health,
 accuracy: health.accuracy,
 });
 }
 }
 // 按优先级排序
 queue.sort((a, b) => b.priority - a.priority);
 return queue;
 };
 
 // 启动AI训练
 const handleSmartStart = async () => {
 const queue = buildTrainingQueue();
 if (queue.length === 0) {
 showToast('✅ 所有模型健康，无需训练', 'success');
 return;
 }
 
 addAiLog('system', '启动AI训练', `队列${queue.length}个模型，预算${smartTraining.budgetMinutes}分钟`);
 
 // 为队列中的每个模型计算并更新样本数
 const updatedQueue = [];
 for (const item of queue) {
 const model = models[item.id];
 const currentSamples = model?.sample_count || 0;
 const currentAccuracy = model?.accuracy || 0;
 const iterations = smartTraining.history
 .filter(h => h.modelId === item.id)
 .map(h => ({ accuracy: h.accuracy, sampleCount: h.sampleCount }));
 
 // AI计算智能样本量
 const targetSamples = calculateSmartSampleCount(
 item.id,
 currentAccuracy,
 currentSamples,
 iterations
 );
 
 // 如果样本数需要更新，调用后端API
 if (targetSamples !== currentSamples && targetSamples > currentSamples) {
 const updated = await updateModelSampleCount(item.id, targetSamples);
 if (updated) {
 showToast(`📊 ${item.name} 样本数更新: ${currentSamples.toLocaleString()} → ${targetSamples.toLocaleString()}`, 'info');
 }
 }
 
 updatedQueue.push({
 ...item,
 targetSamples,
 originalSamples: currentSamples,
 iterationCount: iterations.length,
 bestAccuracy: iterations.length > 0 ? Math.max(...iterations.map(i => i.accuracy)) : currentAccuracy,
 });
 }
 
 // 先刷新模型数据，确保 useEffect 能看到最新的 trainStatus
 try {
 const res = await fetch('/api/ml/manual/status');
 const data = await res.json();
 if (data.success) {
 setModels(data.models);
 }
 } catch (e) {
 console.error('[handleSmartStart] Error fetching models:', e);
 }
 
 setSmartTraining(prev => ({
 ...prev,
 enabled: true,
 queue: updatedQueue,
 currentIndex: 0,
 currentRound: prev.currentRound + 1,
 }));
 
 showToast(`🚀 AI训练启动，队列: ${updatedQueue.length}个模型`, 'success');
 };
 
 // 暂停智能训练
 const handleSmartPause = async () => {
 // 停止当前训练的模型
 const currentModel = smartTraining.queue[smartTraining.currentIndex];
 if (currentModel && models[currentModel.id]?.trainStatus === 'training') {
 await handleStop(currentModel.id);
 }
 setSmartTraining(prev => ({ ...prev, enabled: false }));
 showToast('⏸ AI训练已暂停', 'info');
 };
 
 // 智能训练调度器 - 当一个模型完成时自动启动下一个
 useEffect(() => {
 if (!smartTraining.enabled || smartTraining.queue.length === 0) return;
 console.log('[SmartScheduler] useEffect triggered, enabled:', smartTraining.enabled, 'queue length:', smartTraining.queue?.length, 'currentIndex:', smartTraining.currentIndex);
 
 const currentModel = smartTraining.queue[smartTraining.currentIndex];
 console.log('[SmartScheduler] currentModel:', currentModel);
 if (!currentModel) {
 // 队列完成，检查是否需要下一轮
 const newQueue = buildTrainingQueue();
 if (newQueue.length > 0 && smartTraining.usedMinutes < smartTraining.budgetMinutes) {
 setSmartTraining(prev => ({
 ...prev,
 queue: newQueue,
 currentIndex: 0,
 currentRound: prev.currentRound + 1,
 }));
 showToast(`🔄 开始第${smartTraining.currentRound + 1}轮训练`, 'info');
 } else {
 setSmartTraining(prev => ({ ...prev, enabled: false }));
 showToast('✅ 智能训练完成', 'success');
 }
 return;
 }
 
 // 直接使用 models 状态，假设 handleSmartStart 已经刷新了数据
 const modelStatus = models[currentModel.id]?.trainStatus;
 const modelElapsed = models[currentModel.id]?.elapsed || 0;
 
 // 如果当前模型正在训练中，跳过（等待训练完成）
 if (modelStatus === 'training') {
 console.log(`[SmartScheduler] ${currentModel.name} 正在训练中，跳过`);
 return;
 }
 
 // 如果当前模型失败，跳过并移到下一个
 if (modelStatus === 'failed') {
 console.log(`[SmartScheduler] ${currentModel.name} 训练失败，跳过`);
 const isQueueExhausted = smartTraining.currentIndex + 1 >= smartTraining.queue.length;
 if (isQueueExhausted) {
 setSmartTraining(prev => ({ ...prev, enabled: false }));
 showToast('⚠️ 训练队列中的模型全部失败，已停止', 'error');
 } else {
 setSmartTraining(prev => ({ ...prev, currentIndex: prev.currentIndex + 1 }));
 }
 return;
 }
 
 // 如果当前模型完成，累加训练时间并移动到下一个
 if (modelStatus === 'completed') {
 const trainingMinutes = Math.ceil(modelElapsed / 60000); // ms -> 分钟
 const newAccuracy = models[currentModel.id]?.accuracy || 0;
 const newSampleCount = models[currentModel.id]?.sample_count || 0;
 
 // 该模型的历史迭代
 const modelIterations = smartTraining.history
 .filter(h => h.modelId === currentModel.id)
 .map(h => ({ accuracy: h.accuracy, sampleCount: h.sampleCount }));
 const prevBestAccuracy = modelIterations.length > 0 
 ? Math.max(...modelIterations.map(i => i.accuracy)) : 0;
 const improved = newAccuracy > prevBestAccuracy;
 
 // AI判断是否继续迭代
 const continueIter = shouldContinueIterating(
 currentModel.id,
 newAccuracy,
 [...modelIterations, { accuracy: newAccuracy, sampleCount: newSampleCount }]
 );
 
 if (improved) {
 addAiLog(currentModel.id, '新纪录', `准确率${(newAccuracy*100).toFixed(1)}%，${continueIter ? '继续优化' : '已达标停止'}`);
 }
 
 setSmartTraining(prev => {
 const newHistory = [...prev.history, {
 modelId: currentModel.id,
 name: currentModel.name,
 accuracy: newAccuracy,
 sampleCount: newSampleCount,
 duration: modelElapsed,
 timestamp: new Date().toISOString(),
 improved,
 }];
 
 // 如果需要继续迭代（瓶颈突破策略），不移动到下一个模型
 if (continueIter && newAccuracy < (smartTraining.strategy.skipThreshold || 80) / 100) {
 // 计算下一轮样本数
 const nextTargetSamples = calculateSmartSampleCount(
 currentModel.id,
 newAccuracy,
 newSampleCount,
 [...modelIterations, { accuracy: newAccuracy, sampleCount: newSampleCount }]
 );
 
 addAiLog(currentModel.id, '继续迭代', `准确率${(newAccuracy*100).toFixed(1)}%，样本调至${nextTargetSamples.toLocaleString()}`);
 showToast(`🔄 ${currentModel.name} ${(newAccuracy*100).toFixed(1)}%，AI判断继续迭代（样本${nextTargetSamples.toLocaleString()}）`, 'info');
 
 // 更新样本数并重新训练
 updateModelSampleCount(currentModel.id, nextTargetSamples).then(() => {
 fetch('/api/ml/manual/status').then(r => r.json()).then(data => {
 if (data.success && data.models) {
 setModels(data.models);
 setTimeout(() => handleStart(currentModel.id), 1000);
 }
 }).catch(() => {
 setTimeout(() => handleStart(currentModel.id), 1000);
 });
 });
 
 return {
 ...prev,
 history: newHistory,
 usedMinutes: prev.usedMinutes + trainingMinutes,
 currentRound: prev.currentRound + 1,
 }; // 不移动index，等待重新训练
 }
 
 // 不再继续迭代，移动到下一个模型
 const isQueueExhausted = prev.currentIndex + 1 >= prev.queue.length;
 if (isQueueExhausted) {
 showToast(`🎉 AI训练本轮完成！`, 'success');
 } else {
 showToast(`✅ ${currentModel.name} 训练完成 ${(newAccuracy*100).toFixed(1)}%${improved ? ' 🆕' : ''}`, 'success');
 }
 
 return {
 ...prev,
 usedMinutes: prev.usedMinutes + trainingMinutes,
 currentIndex: isQueueExhausted ? prev.currentIndex : prev.currentIndex + 1,
 enabled: isQueueExhausted ? false : prev.enabled,
 history: newHistory,
 };
 });
 }
 
 // 如果当前模型空闲，启动训练
 if (modelStatus === 'idle' || modelStatus === 'completed' || modelStatus === 'failed') {
 // 检查预算
 if (smartTraining.usedMinutes >= smartTraining.budgetMinutes) {
 setSmartTraining(prev => ({ ...prev, enabled: false }));
 showToast('⏱ 训练预算已用完', 'warning');
 return;
 }
 
 handleStart(currentModel.id);
 showToast(`🎯 训练 ${currentModel.name} (优先级${currentModel.priority})`, 'info');
 }
 }, [smartTraining.enabled, smartTraining.queue, smartTraining.currentIndex, models]);

 // 训练期间实时更新预算进度条
 useEffect(() => {
 if (!smartTraining.enabled) return;
 const interval = setInterval(() => {
 // 查找正在训练的模型
 const trainingModel = Object.entries(models || {}).find(
 ([_, m]) => m.trainStatus === 'training'
 );
 if (trainingModel) {
 const [modelId, model] = trainingModel;
 const elapsedMs = model.elapsed || 0;
 const elapsedMinutes = elapsedMs / 60000;
 // 训练中直接显示当前已用时间，不用累积（累积在训练完成时处理）
 if (elapsedMinutes >= 0) {
 setSmartTraining(prev => {
 return { ...prev, usedMinutes: elapsedMinutes };
 });
 }
 }
 }, 5000); // 每5秒检查一次
 return () => clearInterval(interval);
 }, [smartTraining.enabled, models]);

 // No loading spinner - just show cards
 if (false) {
 return (
 <div className="flex items-center justify-center h-64 gap-3">
 <RefreshCw className="w-8 h-8 animate-spin text-[var(--mt-blue)]" />
 <span className="text-[var(--mt-text-muted)]">加载模型状态...</span>
 </div>
 );
 }

 const phase1 = [], phase2 = [], phase3 = [];
 for (const [id, model] of Object.entries(models || {})) {
 if (model.phase === 1) phase1.push([id, model]);
 else if (model.phase === 2) phase2.push([id, model]);
 else phase3.push([id, model]);
 }

 // 计算统计数据
 const queue = buildTrainingQueue();
 const healthStats = {
 critical: 0,
 warning: 0,
 normal: 0,
 good: 0,
 };
 for (const [, model] of Object.entries(models || {})) {
 const health = getModelHealth(model, undefined);
 healthStats[health.health]++;
 }
 const runningCount = Object.values(models || {}).filter(m => m.trainStatus === 'training').length;

 return (
 <div className="p-6 space-y-6">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-xl font-bold text-[var(--mt-text-primary)] flex items-center gap-2">
 <Cpu className="w-6 h-6 text-[var(--mt-blue)]" />
 模型训练
 </h2>
 <p className="text-sm text-[var(--mt-text-secondary)] mt-1">模型训练由尧帝智能控制，训练期间系统正常运行</p>
 </div>
 <div className="flex items-center gap-3">
 {runningCount > 0 && (
 <span className="text-sm text-[var(--mt-blue)] font-medium flex items-center gap-1">
 <RefreshCw className="w-4 h-4 animate-spin" /> {runningCount} 个模型训练中
 </span>
 )}
 <button onClick={fetchModels} className="p-2 hover:bg-[var(--mt-gray-subtle)] rounded-lg transition-colors">
 <RefreshCw className={`w-5 h-5 text-[var(--mt-text-muted)] ${loading ? 'animate-spin' : ''}`} />
 </button>
 </div>
 </div>

 {/* ═══════════════════════════════════════════════════════════════
 AI训练中心
 ═══════════════════════════════════════════════════════════════ */}
 <div className="mt-training-center rounded-2xl border p-6">
 {/* 控制台头部 */}
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-xl bg-[var(--mt-blue)] flex items-center justify-center">
 <Brain className="w-5 h-5 text-[var(--mt-white)]" />
 </div>
 <div>
 <h3 className="text-lg font-bold text-[var(--mt-text-primary)] ">AI训练中心</h3>
 <p className="text-xs text-[var(--mt-text-muted)] ">尧帝自动调度 · 瓶颈检测 · 智能样本调节</p>
 </div>
 </div>
 
 {/* 训练中的视觉提示横幅 */}
 {smartTraining.enabled && smartTraining.queue.length > 0 && (
 <div className="mb-4 px-4 py-3 bg-[var(--mt-blue-subtle)]/10 border border-blue-500/30 rounded-xl flex items-center gap-3 animate-pulse">
 <div className="w-3 h-3 bg-[var(--mt-blue-subtle)] rounded-full animate-pulse" />
 <span className="text-sm font-medium text-[var(--mt-blue)] ">
 正在训练: <span className="font-bold">{models[smartTraining.queue[smartTraining.currentIndex]?.id]?.name || `模型 ${smartTraining.currentIndex + 1}`}</span>
 <span className="ml-2 text-[var(--mt-blue)]/70">({smartTraining.currentIndex + 1}/{smartTraining.queue.length})</span>
 </span>
 </div>
 )}
 
 <div className="flex items-center gap-2">
 </div>
 </div>

 {/* 状态栏 */}
 <div className="grid grid-cols-4 gap-4 mb-4">
 <div className="mt-panel-light rounded-xl p-3">
 <div className="text-xs text-[var(--mt-text-muted)] mb-1">训练状态</div>
 <div className="flex items-center gap-2">
 <div className={`w-2 h-2 rounded-full ${(smartTraining.enabled || yaodiStatus?.ml?.isRunning) ? 'bg-[var(--mt-green)] animate-pulse' : 'bg-[var(--mt-gray-glow)]'}`} />
 <span className="font-medium text-[var(--mt-text-primary)] ">
 {smartTraining.enabled || yaodiStatus?.ml?.isRunning ? '运行中' : yaodiStatus?.ml?.queueLength > 0 ? `队列中 (${yaodiStatus?.ml.queueLength}个)` : '空闲'}
 </span>
 </div>
 </div>
 <div className="mt-panel-light rounded-xl p-3">
 <div className="text-xs text-[var(--mt-text-muted)] mb-1">本轮进度</div>
 <div className="font-medium text-[var(--mt-text-primary)] ">
 {yaodiStatus?.ml?.inProgressCount ? `${yaodiStatus?.ml.inProgressCount}个模型` : (smartTraining.queue.length > 0 ? `${smartTraining.currentIndex + 1}/${smartTraining.queue.length}` : '-')}
 </div>
 </div>
 <div className="mt-panel-light rounded-xl p-3">
 <div className="text-xs text-[var(--mt-text-muted)] mb-1">AI迭代次数</div>
 <div className="font-medium text-[var(--mt-text-primary)] ">
 {yaodiStatus?.ml?.inProgressCount ? `训练中 ${yaodiStatus?.ml.inProgressCount}个` : `${smartTraining.history.length}次 / 第${smartTraining.currentRound}轮`}
 </div>
 </div>
 </div>

 {/* 健康度仪表盘 */}
 <div className="mt-panel-light rounded-xl p-4 mb-4">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <BarChart3 className="w-4 h-4 text-[var(--mt-text-muted)] " />
 <span className="text-sm font-medium text-[var(--mt-text-secondary)] ">模型健康度评估</span>
 <span className="text-xs text-[var(--mt-gray)] " title="P=Priority优先级\nP100: 准确率<50%急需重训\nP80: 准确率<60%建议训练\nP50: 准确率<80%正常\nP0: 健康无需训练">(P=优先级)</span>
 </div>
 <div className="flex items-center gap-4 text-xs">
 <span className="flex items-center gap-1">
 <div className="w-2 h-2 rounded-full bg-[var(--mt-red-subtle)]0" />
 <span className="text-[var(--mt-text-secondary)] ">急需训练 {healthStats.critical}</span>
 </span>
 <span className="flex items-center gap-1">
 <div className="w-2 h-2 rounded-full bg-[var(--mt-yellow-subtle)]0" />
 <span className="text-[var(--mt-text-secondary)] ">建议训练 {healthStats.warning}</span>
 </span>
 <span className="flex items-center gap-1">
 <div className="w-2 h-2 rounded-full bg-[var(--mt-blue-subtle)]" />
 <span className="text-[var(--mt-text-secondary)] ">正常 {healthStats.normal}</span>
 </span>
 <span className="flex items-center gap-1">
 <div className="w-2 h-2 rounded-full bg-[var(--mt-green)]" />
 <span className="text-[var(--mt-text-secondary)] ">健康 {healthStats.good}</span>
 </span>
 </div>
 </div>
 
 {/* 健康度列表 */}
 <div className="grid grid-cols-4 gap-2 max-h-32 overflow-y-auto">
 {Object.entries(models || {}).map(([id, model]) => {
 const health = getModelHealth(model, id);
 const healthColors = {
 critical: 'border-red-300 bg-[var(--mt-red-subtle)] bg-[var(--mt-red-dim)]',
 warning: 'border-yellow-300 bg-[var(--mt-yellow-subtle)] bg-[var(--mt-yellow-dim)]',
 normal: 'border-blue-300 bg-[var(--mt-blue-subtle)] bg-[var(--mt-blue-dim)]',
 good: 'border-green-300 bg-[var(--mt-green-subtle)] bg-[var(--mt-green-dim)]',
 stale: 'border-gray-300 bg-[var(--mt-gray-subtle)]',
 };
 return (
 <div
 key={id}
 className={`border rounded-lg p-2 text-xs ${healthColors[health.health]}`}
 title={`${health.reason}${health.priority > 0 ? ` | 优先级P${health.priority}` : ''}`}
 >
 <div className="font-medium text-[var(--mt-text-secondary)] truncate">{model.name}</div>
 <div className="flex items-center justify-between">
 <span className="text-[var(--mt-text-muted)] ">
 {(health.accuracy * 100).toFixed(2)}%
 {health.priority > 0 && <span className="ml-1 text-[var(--mt-orange)]" title="P=优先级，数值越高越先训练">P{health.priority}</span>}
 </span>
 {model.sample_count && (
 <span className="text-[var(--mt-gray)] " title="当前样本数">
 {(model.sample_count / 1000).toFixed(0)}K
 </span>
 )}
 </div>
 </div>
 );
 })}
 </div>
 </div>

 {/* 策略设置面板 */}
 {showStrategy && (
 <div className="mt-panel-light rounded-xl p-4 border">
 <div className="flex items-center gap-2 mb-3">
 <Settings className="w-4 h-4 text-[var(--mt-text-muted)]" />
 <span className="text-sm font-medium text-[var(--mt-text-secondary)] ">尧帝训练策略</span>
 </div>
 <div className="grid grid-cols-2 gap-4 text-sm">
 <div className="flex items-center justify-between">
 <span className="text-[var(--mt-text-secondary)] ">优先训练阈值</span>
 <input
 type="number"
 value={smartTraining.strategy.retrainThreshold}
 onChange={(e) => setSmartTraining(prev => ({
 ...prev,
 strategy: { ...prev.strategy, retrainThreshold: Number(e.target.value) }
 }))}
 className="w-20 px-2 py-1 border rounded text-[var(--mt-text-secondary)] bg-[var(--mt-gray-dim)] border-[var(--mt-border)]"
 />
 <span className="text-xs text-[var(--mt-text-muted)]">%以下</span>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-[var(--mt-text-secondary)] ">跳过训练阈值</span>
 <input
 type="number"
 value={smartTraining.strategy.skipThreshold}
 onChange={(e) => setSmartTraining(prev => ({
 ...prev,
 strategy: { ...prev.strategy, skipThreshold: Number(e.target.value) }
 }))}
 className="w-20 px-2 py-1 border rounded text-[var(--mt-text-secondary)] bg-[var(--mt-gray-dim)] border-[var(--mt-border)]"
 />
 <span className="text-xs text-[var(--mt-text-muted)]">%以上</span>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-[var(--mt-text-secondary)] ">数据过期天数</span>
 <input
 type="number"
 value={smartTraining.strategy.dataStaleDays}
 onChange={(e) => setSmartTraining(prev => ({
 ...prev,
 strategy: { ...prev.strategy, dataStaleDays: Number(e.target.value) }
 }))}
 className="w-20 px-2 py-1 border rounded text-[var(--mt-text-secondary)] bg-[var(--mt-gray-dim)] border-[var(--mt-border)]"
 />
 <span className="text-xs text-[var(--mt-text-muted)]">天</span>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-[var(--mt-text-secondary)] ">最小样本数</span>
 <input
 type="number"
 value={smartTraining.strategy.minSamples}
 onChange={(e) => setSmartTraining(prev => ({
 ...prev,
 strategy: { ...prev.strategy, minSamples: Number(e.target.value) }
 }))}
 className="w-24 px-2 py-1 border rounded text-[var(--mt-text-secondary)] bg-[var(--mt-gray-dim)] border-[var(--mt-border)]"
 />
 </div>
 <div className="flex items-center justify-between">
 <span className="text-[var(--mt-text-secondary)] ">最大迭代次数</span>
 <input
 type="number"
 value={smartTraining.strategy.maxIterations}
 onChange={(e) => setSmartTraining(prev => ({
 ...prev,
 strategy: { ...prev.strategy, maxIterations: Number(e.target.value) }
 }))}
 className="w-20 px-2 py-1 border rounded text-[var(--mt-text-secondary)] bg-[var(--mt-gray-dim)] border-[var(--mt-border)]"
 />
 <span className="text-xs text-[var(--mt-text-muted)]">次/模型</span>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-[var(--mt-text-secondary)] ">瓶颈容忍度</span>
 <input
 type="number" step="0.1"
 value={smartTraining.strategy.plateauTolerance}
 onChange={(e) => setSmartTraining(prev => ({
 ...prev,
 strategy: { ...prev.strategy, plateauTolerance: Number(e.target.value) }
 }))}
 className="w-20 px-2 py-1 border rounded text-[var(--mt-text-secondary)] bg-[var(--mt-gray-dim)] border-[var(--mt-border)]"
 />
 <span className="text-xs text-[var(--mt-text-muted)]">%</span>
 </div>
 <div className="flex items-center justify-between col-span-2">
 <span className="text-[var(--mt-text-secondary)] ">每日训练预算</span>
 <input
 type="number"
 value={smartTraining.budgetMinutes}
 onChange={(e) => setSmartTraining(prev => ({ ...prev, budgetMinutes: Number(e.target.value) }))}
 className="w-20 px-2 py-1 border rounded text-[var(--mt-text-secondary)] bg-[var(--mt-gray-dim)] border-[var(--mt-border)]"
 />
 <span className="text-xs text-[var(--mt-text-muted)]">分钟</span>
 </div>
 </div>
 
 {/* AI训练策略说明 */}
 <div className="mt-4 p-3 bg-[var(--mt-blue-subtle)] bg-[var(--mt-blue-glow)] rounded-lg">
 <div className="text-xs font-medium text-[var(--mt-blue)] mb-2">🧠 AI训练策略</div>
 <div className="grid grid-cols-2 gap-2 text-xs text-[var(--mt-text-secondary)] ">
 <div>简单模型: 1万起，最大8万</div>
 <div>树模型: 3万起，最大20万</div>
 <div>神经网络: 5万起，最大30万</div>
 <div>分析模型: 2万起，最大8万</div>
 </div>
 <div className="mt-2 text-xs text-[var(--mt-text-muted)] ">
 瓶颈检测: 准确率提升&lt;{smartTraining.strategy.plateauTolerance}%时自动翻倍样本 · 每模型最多{smartTraining.strategy.maxIterations}轮迭代
 </div>
 </div>
 </div>
 )}
 
 {/* AI决策日志 */}
 {smartTraining.aiLog.length > 0 && (
 <div className="mt-4 mt-panel-light rounded-xl p-4 border">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <Brain className="w-4 h-4 text-[var(--mt-purple)]" />
 <span className="text-sm font-medium text-[var(--mt-text-secondary)] ">AI决策日志</span>
 <span className="text-xs text-[var(--mt-gray)]">{smartTraining.aiLog.length}条</span>
 </div>
 <button onClick={() => setSmartTraining(prev => ({ ...prev, aiLog: [] }))} className="text-xs text-[var(--mt-gray)] hover:text-[var(--mt-text-secondary)]">清空</button>
 </div>
 <div className="max-h-40 overflow-y-auto space-y-1">
 {smartTraining.aiLog.slice(-20).reverse().map((log, i) => (
 <div key={i} className="flex items-start gap-2 text-xs">
 <span className="text-[var(--mt-gray)] w-16 shrink-0">{log.time}</span>
 <span className={`px-1.5 py-0.5 rounded font-medium shrink-0 ${
 log.model === 'system' ? 'bg-[var(--mt-blue-glow)] text-[var(--mt-blue)] bg-[var(--mt-blue-glow)] ' :
 log.action.includes('瓶颈') || log.action.includes('下降') ? 'bg-[var(--mt-red-subtle)] text-[var(--mt-red)] bg-[var(--mt-red-dim)] text-[var(--mt-red)]' :
 log.action.includes('达标') || log.action.includes('新纪录') ? 'bg-[var(--mt-green-subtle)] text-[var(--mt-green)] bg-[var(--mt-green-dim)] text-[var(--mt-green)]' :
 'bg-[var(--mt-gray-subtle)] text-[var(--mt-text-secondary)] bg-[var(--mt-bg-deepest)] '
 }`}>{log.model.toUpperCase()}</span>
 <span className="text-[var(--mt-text-secondary)] ">{log.action}: {log.reason}</span>
 </div>
 ))}
 </div>
 </div>
 )}
 {/* 尧帝调度器实时状态 */}
 {yaodiStatus && (
 <div className="mt-4 mt-panel-light rounded-xl p-4 border">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <Zap className="w-4 h-4 text-amber-500" />
 <span className="text-sm font-medium text-[var(--mt-text-secondary)] ">尧帝调度器状态</span>
 </div>
 <div className="flex items-center gap-3 text-xs">
 {/* 自动训练开关 */}
 <button
 onClick={async () => {
 try {
 const res = await fetch('/api/ml/autotrain/config', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ autoTrain: !autoTrainConfig?.autoTrain })
 });
 const d = await res.json();
 if (d.success) setAutoTrainConfig(prev => ({ ...prev, autoTrain: d.config.autoTrain }));
 } catch (e) {}
 }}
 className={`px-2 py-1 rounded-full font-medium border transition-colors ${
 autoTrainConfig?.autoTrain
 ? 'bg-[var(--mt-green-subtle)] text-[var(--mt-green)] bg-[var(--mt-green-dim)] text-[var(--mt-green)]'
 : 'bg-[var(--mt-gray-subtle)] text-[var(--mt-text-muted)] border-gray-300 bg-[var(--mt-gray-dim)] border-[var(--mt-border)]'
 }`}
 title="点击切换自动训练"
 >
 {autoTrainConfig?.autoTrain ? '⚡ 自动训练ON' : '⏸ 自动训练OFF'}
 </button>
 <span className={`px-2 py-1 rounded-full font-medium ${
 yaodiStatus?.ml?.isRunning ? 'bg-[var(--mt-green-subtle)] text-[var(--mt-green)] bg-[var(--mt-green-dim)] text-[var(--mt-green)]' : 'bg-[var(--mt-gray-subtle)] text-[var(--mt-text-muted)]'
 }`}>
 {yaodiStatus?.ml?.isRunning ? '🔄 运行中' : '⏸ 空闲'}
 </span>
 {yaodiStatus.evo?.mode && (
 <span className={`px-2 py-1 rounded-full font-medium ${
 yaodiStatus.evo.mode === 'normal' ? 'bg-[var(--mt-blue-glow)] text-[var(--mt-blue)] bg-[var(--mt-blue-glow)] ' :
 yaodiStatus.evo.mode === 'balanced' ? 'bg-[var(--mt-yellow-subtle)] text-[var(--mt-yellow)] bg-[var(--mt-yellow-dim)] text-[var(--mt-yellow)]' :
 yaodiStatus.evo.mode === 'conserving' ? 'bg-[var(--mt-red-subtle)] text-[var(--mt-red)] bg-[var(--mt-red-dim)] text-[var(--mt-red)]' :
 'bg-[var(--mt-gray-subtle)] text-[var(--mt-text-muted)]'
 }`}>
 {yaodiStatus.evo.mode === 'normal' ? '🟢 正常' :
 yaodiStatus.evo.mode === 'balanced' ? '🟡 平衡' :
 yaodiStatus.evo.mode === 'conserving' ? '🔴 节能' :
 yaodiStatus.evo.mode === 'training' ? '🔵 训练中' :
 yaodiStatus.evo.mode}
 </span>
 )}
 <span className="text-[var(--mt-text-muted)] ">
 CPU: {yaodiStatus.evo?.loadScore?.toFixed(0) || yaodiStatus?.ml?.loadScore?.toFixed(0) || 0}%
 </span>
 </div>
 <div className="grid grid-cols-6 gap-3 text-xs">
 <div className="bg-[var(--mt-gray-subtle)] rounded-lg p-2 text-center">
 <div className="text-[var(--mt-text-muted)] mb-1">训练队列</div>
 <div className="text-lg font-bold text-[var(--mt-text-secondary)] ">{yaodiStatus?.ml?.queueLength > 0 ? yaodiStatus?.ml.queueLength : (yaodiStatus?.ml?.currentModel ? "-" : "✓")}</div>
 </div>
 <div className="bg-[var(--mt-gray-subtle)] rounded-lg p-2 text-center">
 <div className="text-[var(--mt-text-muted)] mb-1">当前模型</div>
 <div className="text-sm font-medium text-[var(--mt-text-secondary)] truncate" title={yaodiStatus?.ml?.currentModel || '-'}>
 {yaodiStatus?.ml?.currentModel?.replace(/[_-]?trainer/gi, '') || '-'}
 </div>
 </div>
 <div className="bg-[var(--mt-gray-subtle)] rounded-lg p-2 text-center">
 <div className="text-[var(--mt-text-muted)] mb-1">系统负载</div>
 <div className="text-lg font-bold text-[var(--mt-text-secondary)] ">{yaodiStatus?.ml?.loadScore?.toFixed(0) || yaodiStatus.evo?.loadScore?.toFixed(0) || 0}%</div>
 </div>
 <div className="bg-[var(--mt-gray-subtle)] rounded-lg p-2 text-center">
 <div className="text-[var(--mt-text-muted)] mb-1">自动训练</div>
 <div className={`text-lg font-bold ${autoTrainConfig?.autoTrain ? 'text-[var(--mt-green)]' : 'text-[var(--mt-gray)]'}`}>
 {autoTrainConfig?.autoTrain ? 'ON' : 'OFF'}
 </div>
 </div>
 <div className="bg-[var(--mt-gray-subtle)] rounded-lg p-2 text-center">
 <div className="text-[var(--mt-text-muted)] mb-1">CPU阈值</div>
 <div className="text-lg font-bold text-[var(--mt-yellow)]">
 {autoTrainConfig?.cpu?.cpuThreshold || 60}%
 </div>
 </div>
 <div className="bg-[var(--mt-gray-subtle)] rounded-lg p-2 text-center">
 <div className="text-[var(--mt-text-muted)] mb-1">下次训练</div>
 <div className="text-lg font-bold" style={{ color: schedulerInfo?.status === 'training' ? 'var(--mt-green)' : schedulerInfo?.status === 'countdown' ? 'var(--mt-blue)' : 'var(--mt-gray)' }}>
 {schedulerInfo?.status === 'training'
   ? `训练中\n${schedulerInfo.nextModel || ''}`
   : schedulerInfo?.status === 'countdown' && schedulerInfo?.secondsUntilNext != null
     ? (schedulerInfo.secondsUntilNext <= 0
       ? '即将开始...'
       : `${String(Math.floor(schedulerInfo.secondsUntilNext / 60)).padStart(2, '0')}:${String(schedulerInfo.secondsUntilNext % 60).padStart(2, '0')}`)
     : schedulerInfo?.status === 'trading_hours'
       ? '交易时段'
       : '无需训练'}
 </div>
 {schedulerInfo?.nextModel && schedulerInfo?.status !== 'training' && (
   <div className="text-[10px] text-[var(--mt-text-muted)] truncate mt-1" title={schedulerInfo.nextReason}>
     下一个: {schedulerInfo.nextModel}
   </div>
 )}
 </div>
 </div>
 <div className="bg-[var(--mt-gray-subtle)] rounded-lg p-2 text-center">
 <div className="text-[var(--mt-text-muted)] mb-1">训练进度</div>
 <div className="text-lg font-bold text-[var(--mt-text-secondary)] ">
 {yaodiStatus?.ml?.currentModel 
  ? `1/${(yaodiStatus?.ml?.queueLength || 0) + 1}` 
  : yaodiStatus?.ml?.inProgressCount > 0 
    ? `${yaodiStatus?.ml.inProgressCount}个模型` 
    : `${yaodiStatus?.ml?.allModels || 16}/${yaodiStatus?.ml?.allModels || 16}`}
 </div>
 </div>
 </div>
 {/* 每个正在训练的模型进度条 */}
 {yaodiStatus?.ml?.isRunning && (
 <div className="mt-3 space-y-2">
 {/* 当前训练模型（从currentModel + checkpoints） */}
 {yaodiStatus?.ml?.currentModel && (() => {
 const m = yaodiStatus?.ml?.trainingModels?.find(t => t.model_id === yaodiStatus?.ml.currentModel);
 const treesBuilt = m?.trees_built || 0;
 const totalTrees = m?.total_trees || 0;
 const pct = m?.progress_pct || (totalTrees > 0 ? (treesBuilt / totalTrees * 100) : 0);
 return (
 <div className="bg-[var(--mt-blue-subtle)] bg-[var(--mt-blue-glow)] rounded-lg p-3 border border-[var(--mt-border)]">
 <div className="flex justify-between text-xs mb-1">
 <span className="font-bold text-[var(--mt-blue)] ">🔥 {yaodiStatus?.ml.currentModel}</span>
 <span className="text-[var(--mt-blue)]">{getTrainingUnit(m.model_id) ? `${treesBuilt}/${totalTrees}${getTrainingUnit(m.model_id)} · ${pct?.toFixed(2)}%` : `${pct?.toFixed(2)}%`}</span>
 </div>
 <div className="h-2 bg-[var(--mt-blue-glow)] rounded-full overflow-hidden">
 <div className="h-full bg-[var(--mt-blue-subtle)] rounded-full transition-all" style={{ width: `${pct || 0}%` }} />
 </div>
 </div>
 );
 })()}
 {/* 其他训练中模型 */}
 {yaodiStatus?.ml?.trainingModels?.filter(m => m.model_id !== yaodiStatus?.ml?.currentModel).map(m => (
 <div key={m.model_id} className="bg-[var(--mt-blue-subtle)] bg-[var(--mt-blue-glow)] rounded-lg p-2">
 <div className="flex justify-between text-xs mb-1">
 <span className="font-medium text-[var(--mt-blue)] ">{m.model_id}</span>
 <span className="text-[var(--mt-blue)]">{getTrainingUnit(m.model_id) ? `${m.trees_built || 0}/${m.total_trees || 0}${getTrainingUnit(m.model_id)} · ${(m.progress_pct || 0).toFixed(0)}%` : `${(m.progress_pct || 0).toFixed(0)}%`}</span>
 </div>
 <div className="h-1.5 bg-[var(--mt-blue-glow)] rounded-full overflow-hidden">
 <div className="h-full bg-[var(--mt-blue-subtle)] rounded-full transition-all" style={{ width: `${m.progress_pct || 0}%` }} />
 </div>
 </div>
 ))}
 {/* 训练队列展示 */}
 {yaodiStatus?.ml?.queueLength > 0 && !yaodiStatus?.ml?.currentModel && (
 <div className="text-xs text-[var(--mt-yellow)] text-[var(--mt-yellow)] p-2">
 ⏳ 队列中有 {yaodiStatus?.ml.queueLength} 个模型等待，系统负载 {yaodiStatus?.ml?.loadScore?.toFixed(0)}% 过高，等待降载...
 </div>
 )}
 </div>
 )}
 </div>
 )}

 </div>

 {/* Toast */}
 {toast && (
 <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
 toast.type === 'success' ? 'bg-[var(--mt-green)] text-[var(--mt-white)]' :
 toast.type === 'error' ? 'bg-[var(--mt-red-subtle)]0 text-[var(--mt-white)]' :
 'bg-[var(--mt-blue-subtle)] text-[var(--mt-white)]'
 }`}>
 {toast.msg}
 </div>
 )}

 {/* Phase sections */}
 {[
 { key: 'phase1', label: 'Phase 1 - 基础模型', models: phase1, color: 'border-blue-400' },
 { key: 'phase2', label: 'Phase 2 - 进阶模型', models: phase2, color: 'border-purple-400' },
 { key: 'phase3', label: 'Phase 3 - 高级模型', models: phase3, color: 'border-orange-400' },
 ].map(({ key, label, models: list, color }) => (
 list.length > 0 && (
 <div key={key}>
 <h3 className="text-sm font-semibold text-[var(--mt-text-secondary)] mb-3">{label} ({list.length})</h3>
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 {list.map(([id, model]) => (
 <ModelCard
 key={id}
 id={id}
 model={model}
 yaodiTrainingModels={yaodiStatus?.ml}
 />
 ))}
 </div>
 </div>
 )
 ))}
 </div>
 );
}