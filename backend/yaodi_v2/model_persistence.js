/**
 * 模型持久化模块 - 尧帝2.0增量学习核心
 * 将 L2/L3 模型序列化到磁盘，重启后无需重训
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// ESM 环境下的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 本地 bjISO 辅助函数（避免循环依赖 data_server）
function bjISO(date) {
  const d = new Date(date || Date.now());
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 本地 Logger（避免循环依赖）
const Logger = {
  info:  (...args) => console.log('[ModelPersistence]', ...args),
  warn:  (...args) => console.warn('[ModelPersistence]', ...args),
  error: (...args) => console.error('[ModelPersistence]', ...args),
};

// 修复MODEL_DIR：复用已有的__filename（ESM绝对路径）
const MODEL_DIR = path.join(path.dirname(__filename), 'models');

// 确保目录存在
function ensureDir() {
  if (!fs.existsSync(MODEL_DIR)) fs.mkdirSync(MODEL_DIR, { recursive: true });
}

/** 序列化模型权重（GBDT/ElasticNet参数） */
function serializeModels(l2Engine) {
  const models = l2Engine.models;
  return {
    version: '1.0',
    timestamp: bjISO(),
    trained: l2Engine.isTrained,
    gbdt: models.gbdt ? serializeGBDT(models.gbdt) : null,
    histgbdt: models.histgbdt ? serializeHistGBDT(models.histgbdt) : null,
    // categoryBoost 每次运行时重新计算，不做持久化（Map 结构无法 JSON 序列化）
    categoryBoost: null,
    meta: models.meta ? serializeElasticNet(models.meta) : null,
  };
}

function serializeGBDT(model) {
  if (!model) return null;
  return {
    trees: model.trees ? model.trees.map(t => ({
      feature: t.feature ?? t.splitFeature,
      threshold: t.threshold ?? t.splitThreshold,
      left: t.left,
      right: t.right,
      value: t.value ?? t.leafValue,
      depth: t.depth ?? 0,
    })) : [],
    learningRate: model.learningRate ?? 0.1,
    maxDepth: model.maxDepth ?? 6,
    minLeafSize: model.minLeafSize ?? 5,
    numTrees: model.numTrees ?? 100,
    featureImportance: model.featureImportance ?? {},
  };
}

function serializeHistGBDT(model) {
  if (!model) return null;
  return {
    trees: model.trees ? model.trees.map(t => ({
      feature: t.feature ?? t.splitFeature,
      threshold: t.threshold ?? t.splitThreshold,
      left: t.left,
      right: t.right,
      value: t.value ?? t.leafValue,
      // Histogram fields
      binThresholds: t.binThresholds || [],
      binIndices: t.binIndices || [],
    })) : [],
    learningRate: model.learningRate ?? 0.05,
    maxDepth: model.maxDepth ?? 8,
    numBins: model.numBins ?? 256,
    numTrees: model.numTrees ?? 150,
    featureImportance: model.featureImportance ?? {},
  };
}

function serializeCatBoost(model) {
  if (!model) return null;
  return {
    trees: model.trees ? model.trees.map(t => ({
      feature: t.feature ?? t.splitFeature,
      threshold: t.threshold ?? t.splitThreshold,
      left: t.left,
      right: t.right,
      value: t.value ?? t.leafValue,
      categorySet: t.categorySet || [],
    })) : [],
    learningRate: model.learningRate ?? 0.03,
    maxDepth: model.maxDepth ?? 6,
    numTrees: model.numTrees ?? 200,
    l2Reg: model.l2Reg ?? 3.0,
    featureImportance: model.featureImportance ?? {},
  };
}

function serializeElasticNet(model) {
  if (!model) return null;
  return {
    weights: model.weights ? [...model.weights] : [],
    intercept: model.intercept ?? 0,
    alpha: model.alpha ?? 0.5,
    l1Ratio: model.l1Ratio ?? 0.5,
    featureNames: model.featureNames ? [...model.featureNames] : [],
    scalerMean: model.scalerMean ? [...model.scalerMean] : [],
    scalerStd: model.scalerStd ? [...model.scalerStd] : [],
  };
}

/** 反序列化加载模型 */
function deserializeModels(data, l2Engine) {
  if (!data || !data.trained) {
    l2Engine.isTrained = false;
    return;
  }
  const models = l2Engine.models;
  models.gbdt = data.gbdt ? deserializeGBDT(data.gbdt) : null;
  models.histgbdt = data.histgbdt ? deserializeHistGBDT(data.histgbdt) : null;
  models.categoryBoost = data.categoryBoost ? deserializeCatBoost(data.categoryBoost) : null;
  models.meta = data.meta ? deserializeElasticNet(data.meta) : null;
  l2Engine.isTrained = true;
}

function deserializeGBDT(data) {
  return {
    trees: data.trees || [],
    learningRate: data.learningRate ?? 0.1,
    maxDepth: data.maxDepth ?? 6,
    minLeafSize: data.minLeafSize ?? 5,
    numTrees: data.numTrees ?? 100,
    featureImportance: data.featureImportance || {},
  };
}

function deserializeHistGBDT(data) {
  return {
    trees: data.trees || [],
    learningRate: data.learningRate ?? 0.05,
    maxDepth: data.maxDepth ?? 8,
    numBins: data.numBins ?? 256,
    numTrees: data.numTrees ?? 150,
    featureImportance: data.featureImportance || {},
  };
}

function deserializeCatBoost(data) {
  return {
    trees: data.trees || [],
    learningRate: data.learningRate ?? 0.03,
    maxDepth: data.maxDepth ?? 6,
    numTrees: data.numTrees ?? 200,
    l2Reg: data.l2Reg ?? 3.0,
    featureImportance: data.featureImportance || {},
  };
}

function deserializeElasticNet(data) {
  return {
    weights: data.weights || [],
    intercept: data.intercept ?? 0,
    alpha: data.alpha ?? 0.5,
    l1Ratio: data.l1Ratio ?? 0.5,
    featureNames: data.featureNames || [],
    scalerMean: data.scalerMean || [],
    scalerStd: data.scalerStd || [],
  };
}

/** 保存模型到文件 */
function saveModels(l2Engine, tag = 'latest') {
  ensureDir();
  const data = serializeModels(l2Engine);
  const filePath = path.join(MODEL_DIR, `l2_models_${tag}.json`);
  const hash = crypto.createHash('md5').update(JSON.stringify(data)).digest('hex').slice(0, 8);
  const meta = {
    ...data,
    checksum: hash,
  };
  fs.writeFileSync(filePath, JSON.stringify(meta, null, 2), 'utf8');

  // 保存元信息
  const metaPath = path.join(MODEL_DIR, `meta_${tag}.json`);
  fs.writeFileSync(metaPath, JSON.stringify({
    tag,
    timestamp: bjISO(),
    checksum: hash,
    version: data.version,
  }, null, 2), 'utf8');

  Logger.info(`[ModelPersistence] 模型已保存: ${tag} (checksum: ${hash})`);
  return { tag, checksum: hash };
}

/** 加载模型从文件 */
function loadModels(l2Engine, tag = 'latest') {
  const filePath = path.join(MODEL_DIR, `l2_models_${tag}.json`);
  if (!fs.existsSync(filePath)) {
    Logger.warn(`[ModelPersistence] 模型文件不存在: ${tag}`);
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  // 校验
  const computed = crypto.createHash('md5')
    .update(JSON.stringify({ ...data, checksum: undefined }))
    .digest('hex').slice(0, 8);
  if (data.checksum && data.checksum !== computed) {
    Logger.error(`[ModelPersistence] 模型校验失败: ${tag}`);
    return null;
  }

  deserializeModels(data, l2Engine);
  Logger.info(`[ModelPersistence] 模型已加载: ${tag}`);
  return data;
}

/** 获取已保存的模型版本列表 */
function listModelVersions() {
  ensureDir();
  const files = fs.readdirSync(MODEL_DIR).filter(f => f.startsWith('meta_') && f.endsWith('.json'));
  return files.map(f => {
    const raw = fs.readFileSync(path.join(MODEL_DIR, f), 'utf8');
    const meta = JSON.parse(raw);
    return meta;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/** 删除旧版本（保留最近 N 个） */
function pruneOldVersions(keep = 3) {
  const versions = listModelVersions();
  if (versions.length <= keep) return;
  const toDelete = versions.slice(keep);
  toDelete.forEach(v => {
    try {
      fs.unlinkSync(path.join(MODEL_DIR, `l2_models_${v.tag}.json`));
      fs.unlinkSync(path.join(MODEL_DIR, `meta_${v.tag}.json`));
      Logger.info(`[ModelPersistence] 清理旧模型: ${v.tag}`);
    } catch (e) { /* ignore */ }
  });
}

export {
  saveModels,
  loadModels,
  listModelVersions,
  pruneOldVersions,
  serializeModels,
  deserializeModels,
  savePools,
  loadPools,
};// ─── 池持久化（L1/L2/L3内存池JSON持久化）──────────────────────


// ─── 池持久化（L1/L2/L3内存池JSON持久化）──────────────────────
const POOLS_FILE = path.join(MODEL_DIR, 'pools_latest.json');

function savePools(core) {
  try {
    if (!fs.existsSync(MODEL_DIR)) fs.mkdirSync(MODEL_DIR, { recursive: true });
    const data = {
      l1Pool: core.l1Pool || [],
      l2Pool: core.l2Pool || [],
      l3Signals: core.l3Signals || [],
      savedAt: bjISO(),
    };
    fs.writeFileSync(POOLS_FILE, JSON.stringify(data), 'utf8');
    console.log(`[Persistence] 池已持久化: L1=${data.l1Pool.length} L2=${data.l2Pool.length} L3=${data.l3Signals.length}`);
  } catch (e) {
    console.log(`[Persistence] 池持久化失败: ${e.message}`);
  }
}

function loadPools(core) {
  try {
    if (!fs.existsSync(POOLS_FILE)) {
      console.log('[Persistence] 无历史池数据，跳过恢复');
      return;
    }
    const raw = fs.readFileSync(POOLS_FILE, 'utf8');
    const data = JSON.parse(raw);
    core.l1Pool    = data.l1Pool    || [];
    core.l2Pool    = data.l2Pool    || [];
    core.l3Signals = data.l3Signals || [];
    console.log(`[Persistence] 池已恢复: L1=${core.l1Pool.length} L2=${core.l2Pool.length} L3=${core.l3Signals.length}`);
    // 【P1修复】用池文件修改时间回填 l1LastRunTime（进程重启后仍有时间戳）
    try {
      const stat = fs.statSync(POOLS_FILE);
      const fileTime = stat.mtime.toISOString();
      if (!core.l1LastRunTime) core.l1LastRunTime = fileTime;
      if (!core.lastRun) core.lastRun = { layer: 'L1', time: fileTime, ms: 0 };
    } catch (_) {}
  } catch (e) {
    console.log(`[Persistence] 池恢复失败: ${e.message}`);
  }
}