/**
 * ============================================================
 * 尧帝中央调度器 (Yaodi Central Scheduler)
 * ============================================================
 * 路径: /Users/shao/Projects/FQMSystem/backend/yaodi_ml_trainer.js
 * 描述: 尧帝智能控制的ML模型训练 + 系统资源统一调度
 * 
 * 功能:
 * - ML模型自动训练（Worker线程非阻塞）
 * - 演化引擎频率动态调节（训练时降频/空闲时恢复）
 * - CPU自适应算力（Mac系统负载高时降低优先级）
 * - 实时断点保存（每50棵树持久化一次）
 * - 训练完成立即通知尧帝2.0使用最新结果
 * - 最新结果自动覆盖前一个（事务保证原子性）
 * 
 * 调度策略:
 *   🟢 正常模式(负载<50%):  演化正常 + 训练正常
 *   🟡 平衡模式(负载50-80%): 演化降频2x + 训练继续
 *   🔴 节能模式(负载>80%):  演化暂停  + 训练暂停
 *   🔵 训练中模式:           演化降频3x + 训练全速
 * 
 * 架构:
 *   YaodiV2.onReady() → scheduler.start()
 *   → EvolutionCoordinator 启动（监控+调频）
 *   → MLTrainer 启动（恢复+队列训练）
 *   → Worker线程训练 ←→ 演化引擎动态协调
 * ============================================================
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { bjISO, toBeijingTime } from './beijingTime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_FILE = join(__dirname, '../database/stocks.db');

// ============================================================
// 配置常量
// ============================================================

const MODEL_PRIORITY = [
  'xgboost', 'lightgbm', 'rf', 'catboost', 'svm', 'linear',
  'arima', 'garch', 'lstm', 'gru', 'cnn', 'transformer',
  'autoencoder', 'gnn', 'bayesian', 'rl'
];

// 智能样本量策略
const SAMPLE_STRATEGY = {
  simple:     { base: 10000,  max: 80000,  step: 20000 },  // linear/arima/garch/bayesian
  tree:       { base: 30000,  max: 200000, step: 30000 },  // xgb/lgb/rf/cat/gbdt
  neural:     { base: 50000,  max: 300000, step: 50000 },  // lstm/gru/cnn/transformer/autoencoder/gnn
  analysis:   { base: 20000,  max: 80000,  step: 20000 },  // rl
};

const SAMPLE_MAP = {
  xgboost: 'tree', lightgbm: 'tree', rf: 'tree', catboost: 'tree',
  linear: 'simple', arima: 'simple', garch: 'simple', bayesian: 'simple',
  lstm: 'neural', gru: 'neural', cnn: 'neural', transformer: 'neural',
  autoencoder: 'neural', gnn: 'neural', svm: 'tree', rl: 'analysis'
};

// 断点保存间隔
const CHECKPOINT_INTERVAL = 50;  // 每50棵树保存一次checkpoint
// Worker超时（分钟）
const TRAIN_TIMEOUT_MINUTES = 30;

// ============================================================
// CPU自适应管理
// ============================================================

// 获取系统负载（macOS: 5秒平均）
function getSystemLoad() {
  try {
    const out = execSync('sysctl -n vm.loadavg | awk \'{print $2}\'', { encoding: 'utf8', timeout: 2000 });
    return parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}

// 获取Node进程CPU占用（最近采样）
function getNodeCpuUsage() {
  try {
    const out = execSync(
      'ps -p ' + process.pid + ' -o %cpu 2>/dev/null | tail -1',
      { encoding: 'utf8', timeout: 2000 }
    );
    return parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}

// 动态调整Worker线程优先级
function adjustWorkerNice(worker, loadScore) {
  if (!worker || worker.unrefed) return;
  try {
    // loadScore: 0-100, >60为高负载
    // 高负载时降低优先级，低负载时恢复正常
    const niceValue = loadScore > 60 ? 10 : loadScore > 40 ? 5 : 0;
    execSync(`renice ${niceValue} -p ${worker.pid} 2>/dev/null`, { timeout: 1000 });
    if (niceValue > 0) {
      console.log(`[Yaodi-ML] 系统负载${loadScore.toFixed(0)}%，调低Worker优先级 nice=${niceValue}`);
    }
  } catch (e) {
    // renice可能失败，忽略
  }
}

// 计算CPU负载评分（0-100）
function calcLoadScore() {
  const sysLoad = getSystemLoad();
  const nodeCpu = getNodeCpuUsage();
  // 4核Mac，sysLoad 4=100%单核，等效百分比
  const sysPct = (sysLoad / 4) * 100;
  // Node CPU占用（可能多线程）
  const nodePct = Math.min(nodeCpu, 400);
  return Math.max(sysPct, nodePct);
}

// ============================================================
// 数据库操作
// ============================================================

function createTrainerDB() {
  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -4000');
  return db;
}

// 初始化checkpoint表（支持增量升级）
function initCheckpointTable(db) {
  // 先检查现有列
  const existingCols = db.prepare('PRAGMA table_info(ml_training_checkpoint)').all().map(c => c.name);
  
  // 需要的新列
  const neededCols = {
    accuracy: 'REAL',
    trees_data: 'TEXT',
    params_json: 'TEXT',
    last_updated: 'TEXT'
  };
  
  for (const [col, type] of Object.entries(neededCols)) {
    if (!existingCols.includes(col)) {
      try { db.exec(`ALTER TABLE ml_training_checkpoint ADD COLUMN ${col} ${type}`); } catch(e) {}
    }
  }
}

// 获取模型最新checkpoint
function getModelCheckpoint(db, modelId) {
  return db.prepare('SELECT * FROM ml_training_checkpoint WHERE model_id = ?').get(modelId);
}

// 保存断点
function saveCheckpoint(db, modelId, data) {
  const {
    trees_built = 0,
    total_trees = 100,
    sample_count = 0,
    progress_pct = 0,
    status = 'in_progress',
    random_seed = '',
    accuracy = null,
    trees_data = null,
    params_json = null,
    retry_count = 0,
    last_error = null
  } = data;

  db.prepare(`
    INSERT OR REPLACE INTO ml_training_checkpoint 
    (model_id, checkpoint_at, sample_count, trees_built, total_trees, progress_pct, status, random_seed, accuracy, trees_data, params_json, last_updated, retry_count, last_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    modelId, bjISO(), sample_count, trees_built, total_trees,
    progress_pct, status, random_seed || '', accuracy,
    trees_data ? JSON.stringify(trees_data) : null,
    params_json ? JSON.stringify(params_json) : null,
    bjISO(), retry_count, last_error
  );
}

// 获取模型历史训练记录
function getModelHistory(db, modelId, limit = 5) {
  // 优先从 ml_training_history 读取(每次训练一条记录)
  try {
    const rows = db.prepare(`
      SELECT accuracy, sample_count, trained_at, duration_sec
      FROM ml_training_history
      WHERE model_id = ? AND accuracy IS NOT NULL
      ORDER BY trained_at DESC LIMIT ?
    `).all(modelId, limit);
    if (rows.length > 0) return rows;
  } catch(e) { /* 表可能不存在 */ }
  // 回退到 checkpoint 表(兼容)
  const rows = db.prepare(`
    SELECT accuracy, trees_built, sample_count, checkpoint_at 
    FROM ml_training_checkpoint 
    WHERE model_id = ? AND accuracy IS NOT NULL
    ORDER BY checkpoint_at DESC LIMIT ?
  `).all(modelId, limit);
  return rows;
}

// ============================================================
// 智能样本量决策
// ============================================================

function getSmartSampleCount(db, modelId, prevAccuracy) {
  const category = SAMPLE_MAP[modelId] || 'simple';
  const strategy = SAMPLE_STRATEGY[category];

  const hist = getModelHistory(db, modelId, 3);
  
  let baseSample = strategy.base;
  
  // 如果有历史记录，根据准确率调整
  if (hist.length > 0) {
    const lastAcc = hist[0].accuracy;
    if (lastAcc >= 0.80) {
      // 已达标，保持当前水平
      baseSample = Math.min(hist[0].sample_count, strategy.max);
    } else if (lastAcc >= 0.60) {
      // 良好，逐步增加
      baseSample = Math.min(hist[0].sample_count + strategy.step, strategy.max);
    } else if (hist.length >= 2 && prevAccuracy !== null) {
      const prevAcc = hist[1].accuracy;
      if (lastAcc <= prevAcc) {
        // 准确率下降或持平，增加样本
        baseSample = Math.min(Math.round(hist[0].sample_count * 1.5), strategy.max);
      } else {
        // 有提升，小幅增加
        baseSample = Math.min(Math.round(hist[0].sample_count * 1.2), strategy.max);
      }
    }
  }
  
  console.log(`[Yaodi-ML] ${modelId} 决策样本数=${baseSample}(历史${hist.length}条, 上次${hist[0]?.accuracy ? (hist[0].accuracy*100).toFixed(1)+'%' : '无'})`);
  return baseSample;
}

// 检查是否需要继续训练
function shouldContinueTraining(db, modelId, currentAccuracy) {
  const hist = getModelHistory(db, modelId, 5);
  if (hist.length === 0) return { needed: true, reason: '首次训练' };
  if (currentAccuracy >= 0.80) return { needed: false, reason: '已达80%目标' };
  if (hist.length >= 5) return { needed: false, reason: '已达最大训练次数' };
  
  // 检测瓶颈1：连续2次准确率提升<0.5%且样本达上限90%
  if (hist.length >= 2) {
    const delta = (hist[0].accuracy - hist[1].accuracy);
    if (delta < 0.005 && hist[0].sample_count >= SAMPLE_STRATEGY[SAMPLE_MAP[modelId]||'simple'].max * 0.9) {
      return { needed: false, reason: '连续瓶颈且样本达上限' };
    }
  }
  
  // 检测瓶颈2：连续2次准确率几乎无变化（<0.1%）→ 模型已收敛到当前架构上限
  if (hist.length >= 2) {
    const delta = Math.abs(hist[0].accuracy - hist[1].accuracy);
    if (delta < 0.001) {
      return { needed: false, reason: `准确率停滞(${(hist[0].accuracy*100).toFixed(1)}%连续不变)，模型架构瓶颈` };
    }
  }

  // 检测瓶颈3：准确率低于随机水平（<52%），再多数据也无法提升
  if (currentAccuracy < 0.52 && hist.length >= 2) {
    return { needed: false, reason: `准确率${(currentAccuracy*100).toFixed(1)}%低于随机水平，停止无效训练` };
  }
  
  return { needed: true, reason: '继续优化' };
}

// ============================================================
// Worker训练器
// ============================================================

class ModelTrainer {
  constructor() {
    this.db = createTrainerDB();
    initCheckpointTable(this.db);
    
    this.currentWorker = null;
    this.currentModelId = null;
    this.trainQueue = [];
    this.isRunning = false;
    this.schedulers = [];
    this.loadCheckInterval = null;
    // 演化协调器引用（由YaodiCentralScheduler设置）
    this.evoCoordinator = null;
    
    // 回调：训练完成通知尧帝
    this.onTrainComplete = null;
    // 回调：训练开始通知
    this.onTrainStart = null;
  }

  // 通知尧帝有新模型结果
  notifyYaodi(modelId, result) {
    if (this.onTrainComplete) {
      this.onTrainComplete(modelId, result);
    }
  }

  // 设置尧帝回调
  setOnTrainComplete(callback) {
    this.onTrainComplete = callback;
  }
  
  setOnTrainStart(callback) {
    this.onTrainStart = callback;
  }

  // 启动训练引擎
  async start() {
    if (this.isRunning) {
      console.log('[Yaodi-ML] 训练引擎已在运行');
      return;
    }
    
    // 🧹 清理僵尸检查点（启动时的健康检查）
    try {
      const oneHourAgo = new Date(Date.now() - 60*60*1000).toISOString();
      let cleanupCount = 0;
      
      // 1. in_progress超时>1小时 → failed
      const r1 = this.db.prepare("UPDATE ml_training_checkpoint SET status='failed', last_error='zombie_cleanup' WHERE status='in_progress' AND last_updated < ?").run(oneHourAgo);
      cleanupCount += r1.changes;
      
      // 2. retry_pending且retry_count>=3 → failed
      const r2 = this.db.prepare("UPDATE ml_training_checkpoint SET status='failed' WHERE status='retry_pending' AND retry_count >= 3").run();
      cleanupCount += r2.changes;
      
      // 3. interrupted超时>1小时 → failed（允许重新训练）
      const r3 = this.db.prepare("UPDATE ml_training_checkpoint SET status='failed' WHERE status='interrupted' AND last_updated < ?").run(oneHourAgo);
      cleanupCount += r3.changes;
      
      if (cleanupCount > 0) {
        console.log(`[Yaodi-ML] 🧹 启动清理: 个僵尸检查点`);
      }
    } catch(e) {
      console.error('[Yaodi-ML] 僵尸清理失败:', e.message);
    }
    
    this.isRunning = true;
    console.log('[Yaodi-ML] 尧帝智能训练引擎启动 🎯');
    
    // 启动CPU负载监控（每30秒检查）
    this.loadCheckInterval = setInterval(() => {
      const score = calcLoadScore();
      if (score > 80) {
        console.log(`[Yaodi-ML] 系统高负载警告: ${score.toFixed(0)}%`);
        // 高负载时降低当前Worker优先级
        if (this.currentWorker) {
          adjustWorkerNice(this.currentWorker, score);
        }
      }
    }, 30000);

    // 【修复 2026-06-08】启动定期检查定时器（非交易时段自动训练）
    // 每5分钟检查是否有模型需要训练
    this.periodicCheckInterval = setInterval(() => {
      if (!this.isRunning) return;
      const now = new Date();
      const hour = now.getHours();
      const day = now.getDay();
      // 非交易时段: 工作日 11:30-13:00 / 15:00后 / 周末
      const isNonTrading = (day === 0 || day === 6) || 
        (hour >= 11 && hour < 13) || 
        (hour >= 15);
      
      // 非交易时段才自动训练，交易时段跳过
      if (!isNonTrading) {
        console.log('[Yaodi-ML] ⏸ 交易时段，暂停自动训练检查');
        return;
      }
      
      // 队列为空时检查是否需要新训练
      if (this.trainQueue.length === 0) {
        console.log('[Yaodi-ML] 🔄 定期检查: 构建训练队列...');
        this.buildQueue();
        if (this.trainQueue.length > 0) {
          console.log(`[Yaodi-ML] 📋 发现 ${this.trainQueue.length} 个模型待训练，开始训练`);
          this.processQueue();
        } else {
          console.log('[Yaodi-ML] ✓ 定期检查完成: 无模型需训练');
        }
      }
    }, 5 * 60 * 1000);  // 每5分钟检查
    console.log('[Yaodi-ML] ✅ 定期检查定时器已启动(5分钟间隔,非交易时段)');

    // 扫描未完成的checkpoint，恢复训练
    // 【P0修复】延迟执行，避免阻塞HTTP服务

    // 延迟5秒执行，确保HTTP服务先就绪
    setTimeout(async () => {
      await this.recoverInterrupted();
      await this.processQueue();
    }, 5000);

    // 开始队列训练
  }

  // 恢复中断/重试的训练
  async recoverInterrupted() {
    console.log('[Yaodi-ML] 检查中断的训练...');
    const recoverable = this.db.prepare(
      "SELECT model_id, trees_built, total_trees, accuracy, sample_count, status, retry_count FROM ml_training_checkpoint WHERE status IN ('in_progress', 'interrupted', 'retry_pending')"
    ).all();
    
    if (recoverable.length === 0) {
      console.log('[Yaodi-ML] 无中断训练，开始新训练');
      return;
    }
    
    for (const cp of recoverable) {
      console.log(`[Yaodi-ML] 恢复 ${cp.model_id}: status=${cp.status} retry=${cp.retry_count||0} 已训练${cp.trees_built}/${cp.total_trees}`);
      // 将恢复任务加入队列（优先级最高）
      this.trainQueue.unshift({ modelId: cp.model_id, recovered: true, checkpoint: cp });
    }
  }

  // 处理训练队列
  async processQueue() {
    if (!this.isRunning) return;

    // 构建训练队列（按优先级）
    if (this.trainQueue.length === 0) {
      this.buildQueue();
    }

    while (this.trainQueue.length > 0 && this.isRunning) {
      const task = this.trainQueue.shift();
      
      // Worker线程是独立进程，训练不增加主线程负载
      // 仅在极端负载(>400%)时暂停，否则正常执行
      const loadScore = calcLoadScore();
      if (loadScore > 400) {
        task._retryCount = (task._retryCount || 0) + 1;
        if (task._retryCount <= 3) {
          console.log(`[Yaodi-ML] 系统极端负载${loadScore.toFixed(0)}%，暂停训练等待...(${task._retryCount}/3)`);
          this.trainQueue.unshift(task);
          await this.sleep(30000);
          continue;
        } else {
          console.log(`[Yaodi-ML] ${task.modelId} 负载仍未降低，强制开始训练（Worker线程隔离）`);
        }
      }
      
      await this.trainOneModel(task);
      
      // 训练完成后检查是否需要继续迭代
      const cp = getModelCheckpoint(this.db, task.modelId);
      if (cp && cp.accuracy !== null) {
        const cont = shouldContinueTraining(this.db, task.modelId, cp.accuracy);
        if (cont.needed && this.isRunning) {
          console.log(`[Yaodi-ML] ${task.modelId} ${cont.reason}，增加样本继续训练`);
          const newSample = getSmartSampleCount(this.db, task.modelId, cp.accuracy);
          this.trainQueue.push({ modelId: task.modelId, targetSampleCount: newSample, iteration: (task.iteration || 0) + 1 });
        } else {
          console.log(`[Yaodi-ML] ${task.modelId} 停止训练: ${cont.reason}`);
        }
      }
      
      // 训练间隔（避免过密）
      await this.sleep(3000);
    }

    if (this.isRunning) {
      console.log('[Yaodi-ML] 当前队列训练完成，等待下一轮调度...');
      // 5分钟后再次检查
      setTimeout(() => this.processQueue(), 5 * 60 * 1000);
    }
  }

  // 构建训练队列
  buildQueue() {
    console.log('[Yaodi-ML] 构建训练队列...');
    let added = 0;
    
    for (const modelId of MODEL_PRIORITY) {
      const cp = getModelCheckpoint(this.db, modelId);
      
      // ✅ 可训练的status: idle, failed, retry_pending, interrupted, paused
      const trainableStatus = ['idle', 'failed', 'retry_pending', 'interrupted', 'paused'];
      
      // ✅ 准确率停滞检测：连续2次提升<0.1%的模型不加入队列
      const recentHist = getModelHistory(this.db, modelId, 3);
      let stagnantModel = false;
      if (recentHist.length >= 2) {
        const delta = Math.abs(recentHist[0].accuracy - recentHist[1].accuracy);
        if (delta < 0.001) {
          stagnantModel = true;
          console.log(`[Yaodi-ML] ⊘ ${modelId} 跳过: 准确率停滞(${(recentHist[0].accuracy*100).toFixed(1)}%连续不变)`);
        }
      }
      // ✅ 低于随机水平的模型不加入队列
      if (!stagnantModel && recentHist.length >= 2 && recentHist[0].accuracy < 0.52) {
        stagnantModel = true;
        console.log(`[Yaodi-ML] ⊘ ${modelId} 跳过: 准确率${(recentHist[0].accuracy*100).toFixed(1)}%低于随机水平`);
      }
      if (stagnantModel) continue;
      
      // 【修复】低准确率或accuracy缺失模型强制重训
      // 【修复】disk I/O error 模型直接跳过，不加入队列
      const lastErr = cp?.last_error || '';
      if (lastErr.includes('disk I/O error')) {
        console.log(`[Yaodi-ML] ⊘ ${modelId} 跳过: disk I/O error (需人工处理)`);
        continue;
      }
      let forceRetrain = false;
      if (cp && cp.status === 'completed') {
        const hoursSince = (Date.now() - new Date(cp.checkpoint_at).getTime()) / 3600000;
        // 【修复 2026-06-08】添加定期重训机制：每24小时重训一次
        if (cp.accuracy == null || cp.accuracy < 0.5) {
          if (hoursSince >= 0.17) {  // 10分钟冷却（低准确率模型应尽快重训）
            forceRetrain = true;
            console.log(`[Yaodi-ML] ⚡ 强制重训(低准确率): ${modelId} acc=${(cp.accuracy*100).toFixed(1)}%`);
          }
        } else if (hoursSince >= 24) {  // 24小时定期重训
          forceRetrain = true;
          console.log(`[Yaodi-ML] ⚡ 定期重训(24h): ${modelId} acc=${(cp.accuracy*100).toFixed(1)}%`);
        }
      }
      
      if (forceRetrain || !cp || trainableStatus.includes(cp.status)) {
        const sampleCount = getSmartSampleCount(this.db, modelId, forceRetrain ? null : cp?.accuracy);
        this.trainQueue.push({ modelId, targetSampleCount: sampleCount });
        added++;
        console.log(`[Yaodi-ML] + 队列添加: ${modelId} (status=${cp?.status||'idle'}${forceRetrain?' FORCE':''})`);
      } else if (cp.status === 'in_progress') {
        console.log(`[Yaodi-ML] ⊘ ${modelId} 跳过: in_progress (需重启清理)`);
      } else {
        console.log(`[Yaodi-ML] ⊘ ${modelId} 跳过: status=${cp.status}`);
      }
    }
    
    console.log(`[Yaodi-ML] 训练队列已构建: ${added}个模型`);
  }

  // 训练单个模型
  async trainOneModel(task) {
    const { modelId, targetSampleCount, recovered, checkpoint } = task;
    
    // ✅ 等待全局训练队列空闲，避免与调度器Worker并发写DB
    while (globalThis._trainingActive) {
      console.log(`[Yaodi-ML] 等待全局训练队列空闲...`);
      await new Promise(r => setTimeout(r, 5000));
    }
    globalThis._trainingActive = true; // 占位，防止调度器同时启动
    this._queueLock = true; // 标记：需要释放
    
    // ✅ 初始化完成标志
    this._workerCompleted = false;
    
    console.log(`[Yaodi-ML] 开始训练 ${modelId} ${recovered ? '(恢复)' : ''} samples=${targetSampleCount}`);
    
    // 🔵 通知协调器：训练开始（演化降频）
    if (this.evoCoordinator) {
      this.evoCoordinator.setTrainingState(true);
    }
    
    return new Promise((resolve, reject) => {
      // 包装resolve：训练结束后释放全局队列锁
      const _origResolve = resolve;
      const _resolve = () => {
        if (this._queueLock) { globalThis._trainingActive = false; this._queueLock = false; }
        _origResolve();
      };
      const workerPath = join(__dirname, 'ml_train_worker.mjs');
      const worker = new Worker(workerPath, { stderr: 'inherit' });
      this.currentWorker = worker;
      this.currentModelId = modelId;
      
      // 通知训练开始
      if (this.onTrainStart) this.onTrainStart(modelId, { targetSampleCount });

      let checkpointCount = 0;
      let timeoutTimer = setTimeout(() => {
        console.log(`[Yaodi-ML] ${modelId} 训练超时(${TRAIN_TIMEOUT_MINUTES}min)，强制终止`);
        worker.terminate();
        this.saveFailedCheckpoint(modelId, 'timeout');
        _resolve();
      }, TRAIN_TIMEOUT_MINUTES * 60 * 1000);

      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          console.log(`[Yaodi-ML] ${modelId} Worker已启动(ready)`);
          
          // 发送训练开始消息（包含目标样本数）
          const initMsg = {
            modelId,
            options: { 
              targetSampleCount: targetSampleCount || null,
              recoveredTrees: recovered ? (checkpoint?.trees_built || 0) : 0,
              checkpointInterval: CHECKPOINT_INTERVAL
            },
            dbPath: DB_FILE
          };
          worker.postMessage(initMsg);
          
          // 保存初始checkpoint
          saveCheckpoint(this.db, modelId, {
            status: 'in_progress',
            trees_built: recovered ? (checkpoint?.trees_built || 0) : 0,
            total_trees: targetSampleCount ? Math.round(targetSampleCount / 200) : 100,
            sample_count: recovered ? (checkpoint?.sample_count || 0) : 0,
            random_seed: String(Date.now())
          });
        }
        
        if (msg.type === 'checkpoint') {
          // Worker定期发送checkpoint更新
          checkpointCount++;
          const progress = msg.progress || 0;
          
          // CPU自适应：每5个checkpoint检查一次负载
          if (checkpointCount % 5 === 0) {
            const score = calcLoadScore();
            adjustWorkerNice(worker, score);
          }
          
          saveCheckpoint(this.db, modelId, {
            trees_built: msg.treesBuilt || 0,
            total_trees: msg.totalTrees || 100,
            sample_count: msg.sampleCount || 0,
            progress_pct: progress,
            status: 'in_progress',
            trees_data: msg.treesData || null,
            params_json: msg.params || null
          });
        }
        
        if (msg.type === 'completed') {
          clearTimeout(timeoutTimer);
          this._workerCompleted = true;  // ✅ 标记训练已完成
          
          // ✅ 追加训练历史记录(不再覆盖，每次训练一条)
          try {
            this.db.prepare(`INSERT INTO ml_training_history (model_id, accuracy, sample_count, trained_at, duration_sec) VALUES (?, ?, ?, ?, ?)`)
              .run(modelId, msg.result?.accuracy || null, msg.result?.sample_count || msg.result?.sampleCount || 0, msg.result?.trained_at || bjISO(), msg.result?.elapsed || null);
          } catch(e) { /* 表可能不存在 */ }
          
          // 完整保存最终结果（覆盖之前）
          saveCheckpoint(this.db, modelId, {
            status: 'completed',
            trees_built: msg.result?.trees?.length || 0,
            total_trees: msg.result?.totalTrees || 0,
            sample_count: msg.result?.sampleCount || 0,
            progress_pct: 100,
            accuracy: msg.result?.accuracy || null,
            random_seed: checkpoint?.random_seed || '',
            trees_data: msg.result?.trees || null,
            params_json: msg.result?.params || null
          });
          
          // ✅ 同步更新 ai_ml_model 表（前端 GET /api/ml/models 从此表读取准确率）
          try {
            const modelRow = this.db.prepare('SELECT data FROM ai_ml_model WHERE id = ?').get(modelId);
            if (modelRow) {
              const modelData = JSON.parse(modelRow.data || '{}');
              modelData.accuracy = msg.result?.accuracy ?? modelData.accuracy;
              modelData.trained_at = msg.result?.trained_at ?? modelData.trained_at ?? Math.floor(Date.now() / 1000);
              modelData.params = msg.result?.params ?? modelData.params ?? null;
              modelData.updated_at = new Date().toISOString();
              this.db.prepare('UPDATE ai_ml_model SET data = ? WHERE id = ?').run(
                JSON.stringify(modelData),
                modelId
              );
              console.log(`[Yaodi-ML] ✅ ai_ml_model 已更新: ${modelId} accuracy=${(modelData.accuracy * 100).toFixed(1)}%`);
            } else {
              // 记录不存在则插入
              const newData = {
                accuracy: msg.result?.accuracy || null,
                trained_at: msg.result?.trained_at || Math.floor(Date.now() / 1000),
                params: msg.result?.params || null,
                status: 'ready',
                feature_names: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              };
              this.db.prepare('INSERT OR REPLACE INTO ai_ml_model (id, data) VALUES (?, ?)').run(
                modelId,
                JSON.stringify(newData)
              );
              console.log(`[Yaodi-ML] ✅ ai_ml_model 已插入: ${modelId}`);
            }
          } catch (err) {
            console.error(`[Yaodi-ML] ❌ ai_ml_model 更新失败: ${err.message}`);
          }
          
          const accPct = msg.result?.accuracy ? (msg.result.accuracy * 100).toFixed(1) : 'N/A';
          console.log(`[Yaodi-ML] ✅ ${modelId} 训练完成! 准确率=${accPct}%, 耗时=${msg.elapsed}s`);
          
          // 通知尧帝有新结果可用
          this.notifyYaodi(modelId, msg.result);
          
          worker.terminate();
          this.currentWorker = null;
          this.currentModelId = null;  // 重置当前模型ID
          // 🟢 通知协调器：训练结束（恢复演化频率）
          if (this.evoCoordinator) {
            this.evoCoordinator.setTrainingState(false);
          }
          _resolve();
        }
        
        if (msg.type === 'error') {
          clearTimeout(timeoutTimer);
          console.error(`[Yaodi-ML] ❌ ${modelId} 训练失败: ${msg.error}`);
          this.saveFailedCheckpoint(modelId, msg.error);
          worker.terminate();
          this.currentWorker = null;
          _resolve();
        }
      });

      worker.on('exit', (code) => {
        clearTimeout(timeoutTimer);
        const hadCompleted = this._workerCompleted;
        this._workerCompleted = false;
        
        if (code === 0 && hadCompleted) {
          // ✅ 正常完成
          console.log(`[Yaodi-ML] ${modelId} Worker正常退出`);
        } else if (code === 0 && !hadCompleted) {
          // ⚠️ Worker退出但没收到completed消息
          console.error(`[Yaodi-ML] ⚠️ ${modelId} Worker退出(code=0)但未收到completed消息`);
          this.saveInterruptedCheckpoint(modelId, 'exit_without_completed');
          this.scheduleRetry(modelId);
        } else {
          // ❌ 非正常退出
          console.error(`[Yaodi-ML] ❌ ${modelId} Worker非正常退出 code=${code}`);
          this.saveFailedCheckpoint(modelId, `worker_exit_${code}`);
          this.scheduleRetry(modelId);
        }
        this.currentWorker = null;
        this.currentModelId = null;  // 重置当前模型ID
        _resolve();
      });

      worker.on('error', (err) => {
        clearTimeout(timeoutTimer);
        console.error(`[Yaodi-ML] ❌ ${modelId} Worker错误: ${err.message}`);
        this.saveFailedCheckpoint(modelId, err.message);
        worker.terminate();
        this.currentWorker = null;
        this.currentModelId = null;  // 重置当前模型ID
        this.scheduleRetry(modelId);
        _resolve();
      });
    });
  }

  // 保存失败状态
  saveFailedCheckpoint(modelId, error) {
    try {
      const retryCount = this.db.prepare('SELECT COALESCE(retry_count,0) as cnt FROM ml_training_checkpoint WHERE model_id = ?').get(modelId)?.cnt || 0;
      const isDiskIO = String(error).includes('disk I/O error');
      saveCheckpoint(this.db, modelId, {
        status: isDiskIO ? 'failed' : (retryCount >= 2 ? 'failed' : 'retry_pending'),
        last_updated: bjISO(),
        retry_count: retryCount + 1,
        last_error: String(error).slice(0, 500)
      });
      console.log(`[Yaodi-ML] ${modelId} 训练失败, 重试${retryCount + 1}/3`);
    } catch (e) {
      console.error(`[Yaodi-ML] 保存失败checkpoint失败: ${e.message}`);
    }
  }

  // 保存中断状态（Worker退出但没收到completed）
  saveInterruptedCheckpoint(modelId, reason) {
    try {
      saveCheckpoint(this.db, modelId, {
        status: 'interrupted',
        last_updated: bjISO(),
        last_error: String(reason).slice(0, 500)
      });
      console.log(`[Yaodi-ML] ${modelId} 保存中断状态: ${reason}`);
    } catch (e) {
      console.error(`[Yaodi-ML] 保存中断checkpoint失败: ${e.message}`);
    }
  }

  // 调度重试
  scheduleRetry(modelId) {
    // 延迟5秒后重新入队
    setTimeout(() => {
      const cp = this.db.prepare('SELECT * FROM ml_training_checkpoint WHERE model_id = ?').get(modelId);
      if (cp && (cp.status === 'retry_pending' || cp.status === 'interrupted') && (cp.retry_count || 0) < 3) {
        console.log(`[Yaodi-ML] ${modelId} 重新入队(重试${(cp.retry_count || 0) + 1}/3)`);
        this.trainQueue.unshift({ modelId, targetSampleCount: getSmartSampleCount(this.db, modelId, cp.accuracy) });
      } else {
        console.log(`[Yaodi-ML] ${modelId} 放弃重试(status=${cp?.status}, retries=${cp?.retry_count})`);
      }
    }, 5000);
  }

  // 停止训练引擎
  stop() {
    this.isRunning = false;
    if (this.loadCheckInterval) {
      clearInterval(this.loadCheckInterval);
      this.loadCheckInterval = null;
    }
    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval);
      this.periodicCheckInterval = null;
    }
    if (this.currentWorker) {
      console.log('[Yaodi-ML] 终止当前Worker...');
      this.currentWorker.terminate();
      this.currentWorker = null;
    }
    this.db.close();
    console.log('[Yaodi-ML] 训练引擎已停止');
  }

  // 获取训练状态
  getStatus() {
    const allModels = this.db.prepare(
      "SELECT model_id, status, accuracy, trees_built, total_trees, progress_pct, last_updated FROM ml_training_checkpoint"
    ).all();
    
    // 计算当前正在训练的模型（包含in_progress状态）
    // paused 不算 inProgress，只有真正在训练的才算
    const currentTraining = allModels.filter(m => m.status === 'training' || m.status === 'in_progress');
    
    // 如果currentModelId有值但不在trainingModels中，补充当前训练进度
    if (this.currentModelId && !currentTraining.find(m => m.model_id === this.currentModelId)) {
      const cp = this.db.prepare(
        "SELECT model_id, status, accuracy, trees_built, total_trees, progress_pct FROM ml_training_checkpoint WHERE model_id = ?"
      ).get(this.currentModelId);
      if (cp) {
        currentTraining.push({
          ...cp,
          status: 'training'
        });
      } else {
        currentTraining.push({ model_id: this.currentModelId, status: 'training', accuracy: null, trees_built: 0, total_trees: 0, progress_pct: 0 });
      }
    }
    
    // 计算今日训练时长（从checkpoint表统计今日完成的训练）
    let todayTrainingMinutes = 0;
    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const todayCheckpoints = this.db.prepare(
        `SELECT model_id, checkpoint_at FROM ml_training_checkpoint WHERE checkpoint_at LIKE ? AND status = 'completed'`
      ).all(today + '%');
      // 每个模型训练约2分钟
      const uniqueModels = new Set(todayCheckpoints.map(cp => cp.model_id));
      todayTrainingMinutes = uniqueModels.size * 2;
    } catch(e) {}
    
    // isRunning 表示训练引擎是否在运行（包括等待队列）
    // 不再因为无当前训练就重置，避免队列有任务时显示空闲
    const hasQueueWork = this.trainQueue.length > 0;
    if (!hasQueueWork && currentTraining.length === 0) {
      this.isRunning = false;
    }
    
    return {
      isRunning: (currentTraining.length > 0) || (this.trainQueue.length > 0),
      currentModel: this.currentModelId,
      queueLength: this.trainQueue.length,
      inProgressCount: currentTraining.length,
      allModels: allModels.length,
      loadScore: calcLoadScore(),
      trainingModels: currentTraining,
      todayTrainingMinutes,
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================
// 演化引擎协调器 (Evolution Coordinator)
// ============================================================
// 职责：动态调整演化引擎频率，协调训练与演化的CPU竞争

class EvolutionCoordinator {
  constructor(trainer) {
    this.trainer = trainer;  // ModelTrainer实例
    this.db = createTrainerDB();
    
    // 原始演化速度（用户设置值，恢复时用）
    this.originalSpeed = 50;
    // 当前有效速度
    this.currentSpeed = 50;
    // 协调模式
    this.mode = 'normal';  // normal | balanced | eco | training
    // 是否正在训练
    this.isTraining = false;
    // 监控定时器
    this.monitorInterval = null;
    // 上次调整时间（防止频繁调整）
    this.lastAdjustTime = 0;
    const ADJUST_COOLDOWN_MS = 10000;  // 最小调整间隔10秒
    
    // 负载阈值
    this.THRESHOLDS = {
      normal: 50,   // <50% 正常
      balanced: 80, // 50-80% 平衡
      eco: 200      // >200% 节能
    };
    
    // 训练中降频倍数
    this.TRAINING_DOWNSCALE = 3;  // 训练时演化降频3倍
  }

  // 启动协调器
  start() {
    console.log('[尧帝调度] 🎛️ 演化引擎协调器启动');
    
    // 读取当前演化速度作为基准
    try {
      const row = this.db.prepare('SELECT evolution_speed FROM yaodi_main WHERE id = 1').get();
      if (row && row.evolution_speed) {
        this.originalSpeed = row.evolution_speed;
        this.currentSpeed = row.evolution_speed;
        console.log(`[尧帝调度] 原始演化速度: ${this.originalSpeed}`);
      }
    } catch(e) {
      console.log(`[尧帝调度] 读取演化速度失败: ${e.message}`);
    }
    
    // 启动负载监控（每15秒检查一次）
    this.monitorInterval = setInterval(() => this.monitorAndAdjust(), 15000);
    console.log('[尧帝调度] ✅ 负载监控已启动(15s间隔)');
  }

  // 核心监控+调频逻辑
  monitorAndAdjust() {
    const now = Date.now();
    if (now - this.lastAdjustTime < 10000) return;  // 冷却期
    
    const loadScore = calcLoadScore();
    const training = this.isTraining || (this.trainer && this.trainer.currentWorker !== null);
    
    let newMode = 'normal';
    let newSpeed = this.originalSpeed;
    
    // 决策逻辑
    if (training) {
      // 🔵 训练中模式：演化降频3x，给训练让路
      newMode = 'training';
      newSpeed = Math.max(5, Math.round(this.originalSpeed / this.TRAINING_DOWNSCALE));
    } else if (loadScore > this.THRESHOLDS.eco) {
      // 🔴 节能模式：暂停演化
      newMode = 'eco';
      newSpeed = 0;
    } else if (loadScore > this.THRESHOLDS.balanced) {
      // 🟡 平衡模式：降频2x
      newMode = 'balanced';
      newSpeed = Math.max(5, Math.round(this.originalSpeed / 2));
    }
    
    // 应用新速度
    if (newMode !== this.mode || newSpeed !== this.currentSpeed) {
      this.applySpeed(newSpeed, newMode, loadScore);
      this.lastAdjustTime = now;
    }
    
    // 更新训练状态
    this.isTraining = training;
  }

  // 应用新的演化速度到数据库
  applySpeed(newSpeed, mode, loadScore) {
    try {
      this.db.prepare('UPDATE yaodi_main SET evolution_speed = ? WHERE id = 1').run(newSpeed);
      this.currentSpeed = newSpeed;
      this.mode = mode;
      
      const modeEmoji = { normal: '🟢', balanced: '🟡', eco: '🔴', training: '🔵' };
      const modeName = { normal: '正常', balanced: '平衡', eco: '节能', training: '训练中' };
      
      console.log(
        `[尧帝调度] ${modeEmoji[mode]} ${modeName[mode]}模式 | ` +
        `演化${newSpeed === 0 ? '⏸暂停' : this.originalSpeed + '→' + newSpeed} | ` +
        `CPU=${loadScore.toFixed(0)}%`
      );
    } catch(e) {
      console.error(`[尧帝调度] 设置演化速度失败: ${e.message}`);
    }
  }

  // 手动设置训练状态（供ModelTrainer调用）
  setTrainingState(training) {
    this.isTraining = training;
    if (training) {
      // 立即降频
      const newSpeed = Math.max(5, Math.round(this.originalSpeed / this.TRAINING_DOWNSCALE));
      this.applySpeed(newSpeed, 'training', calcLoadScore());
    }
  }

  // 恢复原始速度
  restoreOriginal() {
    try {
      this.db.prepare('UPDATE yaodi_main SET evolution_speed = ? WHERE id = 1').run(this.originalSpeed);
      this.currentSpeed = this.originalSpeed;
      this.mode = 'normal';
      console.log(`[尧帝调度] 🟢 恢复原始演化速度: ${this.originalSpeed}`);
    } catch(e) {}
  }

  // 停止协调器
  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    // 恢复原始速度
    this.restoreOriginal();
    this.db.close();
    console.log('[尧帝调度] 协调器已停止，演化速度已恢复');
  }

  // 获取状态
  getStatus() {
    return {
      mode: this.mode,
      originalSpeed: this.originalSpeed,
      currentSpeed: this.currentSpeed,
      isTraining: this.isTraining,
      loadScore: calcLoadScore()
    };
  }
}

// ============================================================
// 尧帝中央调度器 (Yaodi Central Scheduler)
// ============================================================
// 统一管理 ML训练 + 演化调频
class YaodiCentralScheduler {
  constructor() {
    this.mlTrainer = new ModelTrainer();
    this.evoCoordinator = new EvolutionCoordinator(this.mlTrainer);
    // 双向引用：训练器可通知协调器
    this.mlTrainer.evoCoordinator = this.evoCoordinator;
    this.isRunning = false;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('\n═══════════════════════════════════════');
    console.log('🧠 尧帝中央调度器 启动');
    console.log('═══════════════════════════════════════\n');
    
    // 1. 启动演化协调器
    this.evoCoordinator.start();
    
    // 2. 启动ML训练引擎
    await this.mlTrainer.start();
    
    console.log('\n═══════════════════════════════════════');
    console.log('✅ 尧帝中央调度器 就绪');
    console.log('   - ML训练: Worker线程非阻塞');
    console.log('   - 演化频率: 动态自适应调节');
    console.log('   - CPU策略: 训练时降频/空闲时恢复');
    console.log('═══════════════════════════════════════\n');
  }

  stop() {
    this.isRunning = false;
    this.mlTrainer.stop();
    this.evoCoordinator.stop();
    console.log('[尧帝调度] 中央调度器已停止');
  }

  getStatus() {
    return {
      ml: this.mlTrainer.getStatus(),
      evo: this.evoCoordinator.getStatus(),
      isRunning: this.isRunning
    };
  }
}

// ============================================================
// 导出单例
// ============================================================

const yaodiScheduler = new YaodiCentralScheduler();
export default yaodiScheduler;
export { yaodiScheduler, YaodiCentralScheduler, ModelTrainer, EvolutionCoordinator, getSmartSampleCount, calcLoadScore, adjustWorkerNice };