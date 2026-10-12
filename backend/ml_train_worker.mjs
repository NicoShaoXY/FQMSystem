/**
 * ML 训练 Worker 线程（只读模式，彻底避免与主进程DB写冲突）
 * 
 * 核心策略：
 * 1. Worker以只读模式打开DB（immutable=1），只能读不能写
 * 2. 创建DB Proxy拦截所有写操作（checkpoint INSERT/UPDATE/DELETE），
 *    改为postMessage发给主进程代理写入
 * 3. 训练函数无感知，照常调用db.prepare().run()
 * 4. 彻底消除Worker与主进程的DB写冲突
 */

import { parentPort, workerData } from 'worker_threads';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// 使用 createRequire 加载 CJS 模块
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Worker 接收消息
parentPort.on('message', async (msg) => {
  const { modelId, options, dbPath } = msg;

  let realDB = null;
  let elapsed = 0;

  try {
    // 【关键】以只读模式打开DB，设置immutable避免任何写操作
    const dbPathResolved = dbPath || join(__dirname, '../database/stocks.db');
    realDB = new Database(dbPathResolved, { readonly: true });
    realDB.pragma('busy_timeout = 300000');
    
    console.log(`[ML-Worker] 以只读模式打开DB: ${dbPathResolved}`);

    // 创建DB Proxy：读操作走realDB，写操作通过postMessage代理给主进程
    const db = new Proxy(realDB, {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return function(sql, ...args) {
            const stmt = target.prepare(sql, ...args);
            const sqlUpper = sql.trim().toUpperCase();
            const isWrite = sqlUpper.startsWith('INSERT') || sqlUpper.startsWith('UPDATE') || 
                           sqlUpper.startsWith('DELETE') || sqlUpper.startsWith('REPLACE') ||
                           sqlUpper.startsWith('CREATE') || sqlUpper.startsWith('DROP') ||
                           sqlUpper.startsWith('ALTER');
            
            if (isWrite) {
              // 写操作：返回一个proxy statement，run()时postMessage给主进程
              return new Proxy(stmt, {
                get(sTarget, sProp) {
                  if (sProp === 'run') {
                    return function(...params) {
                      // 通过postMessage让主进程代写
                      parentPort.postMessage({
                        type: 'db_write',
                        modelId,
                        sql,
                        params
                      });
                      // 解析checkpoint写入，更新进度状态
                      if (sqlUpper.includes('ML_TRAINING_CHECKPOINT') && params.length >= 6) {
                        const treesBuilt = params[3];
                        const totalTrees = params[4];
                        const progressPct = params[5];
                        if (typeof treesBuilt === 'number' && typeof totalTrees === 'number') {
                          _lastProgress = { treesBuilt, totalTrees, progress: Math.round(progressPct || (treesBuilt / totalTrees * 100)) };
                        }
                      }
                      // 返回一个空结果，避免训练函数报错
                      return { changes: 1, lastInsertRowid: 0 };
                    };
                  }
                  if (sProp === 'get') {
                    // 写语句的get()不太合理，但安全起见也拦截
                    return function(...params) {
                      parentPort.postMessage({
                        type: 'db_write',
                        modelId,
                        sql,
                        params
                      });
                      return undefined;
                    };
                  }
                  return sTarget[sProp];
                }
              });
            }
            // 读操作：直接走realDB
            return stmt;
          };
        }
        if (prop === 'exec') {
          return function(sql, ...args) {
            const sqlUpper = sql.trim().toUpperCase();
            const isWrite = sqlUpper.startsWith('INSERT') || sqlUpper.startsWith('UPDATE') || 
                           sqlUpper.startsWith('DELETE') || sqlUpper.startsWith('REPLACE') ||
                           sqlUpper.startsWith('PRAGMA') || sqlUpper.startsWith('CREATE') || 
                           sqlUpper.startsWith('DROP') || sqlUpper.startsWith('ALTER');
            if (isWrite) {
              // PRAGMA和写操作：忽略（Worker不应修改DB结构）
              return this;
            }
            return target.exec(sql, ...args);
          };
        }
        if (prop === 'pragma') {
          return function(...args) {
            // Worker只读，忽略PRAGMA设置
            return '';
          };
        }
        // 其他属性直接透传
        const val = target[prop];
        if (typeof val === 'function') {
          return val.bind(target);
        }
        return val;
      }
    });

    // 动态导入 ml_models.mjs
    const { ML_MODELS } = await import('./ml_models.mjs');
    const handler = ML_MODELS[modelId];

    if (!handler) {
      parentPort.postMessage({ type: 'error', modelId, error: `未知模型: ${modelId}` });
      realDB.close();
      return;
    }

    // 发送开始消息
    parentPort.postMessage({
      type: 'started',
      modelId,
      message: `${handler.name} 训练开始`
    });

    // 进度上报定时器：每3秒从内存状态上报（不再查DB checkpoint）
    let _lastProgress = { treesBuilt: 0, totalTrees: 0, progress: 0 };
    let _progressTimer = setInterval(() => {
      if (_lastProgress.totalTrees > 0) {
        parentPort.postMessage({
          type: 'progress',
          modelId,
          ..._lastProgress
        });
      }
    }, 3000);

    // 拦截db_write消息来更新进度
    const origOnMessage = parentPort.on; // 不需要，progress从db_write sql解析

    // 将动态CPU阈值注入options传给训练函数
    const trainingOptions = {
      ...options,
      cpuThreshold: options?.cpuThreshold || 80,
      yaodiControlled: true
    };

    console.log(`[ML-Worker] ${handler.name} 开始训练, targetSampleCount=${options?.targetSampleCount || 'default'}, cpuThreshold=${trainingOptions.cpuThreshold}%`);

    // 重试机制
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 10000;
    let lastError = null;
    let result = null;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[ML-Worker] ${handler.name} 训练尝试 ${attempt}/${MAX_RETRIES}...`);
        
        const startTime = Date.now();
        result = await handler.fn(db, trainingOptions);
        elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`[ML-Worker] ${handler.name} 训练完成, ${elapsed}秒, accuracy=${result?.accuracy || 'N/A'}`);
        lastError = null;
        break;
        
      } catch (e) {
        lastError = e;
        const isLocked = e.message.includes('database is locked') || e.message.includes('SQLITE_BUSY') || e.message.includes('disk I/O error');
        
        if (isLocked && attempt < MAX_RETRIES) {
          console.warn(`[ML-Worker] ${handler.name} 训练失败(尝试 ${attempt}/${MAX_RETRIES}): ${e.message}`);
          console.log(`[ML-Worker] 等待 ${RETRY_DELAY_MS/1000} 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          throw e;
        }
      }
    }
    
    if (lastError && (lastError.message.includes('database is locked') || lastError.message.includes('disk I/O error'))) {
      throw new Error(`训练失败(重试${MAX_RETRIES}次后仍失败): ${lastError.message}`);
    }
    
    clearInterval(_progressTimer);
    realDB.close();
    realDB = null;

    // 发送完成消息（让主进程写入数据库）
    parentPort.postMessage({
      type: 'completed',
      modelId,
      result: {
        ...result,
        elapsed
      }
    });

    process.exit(0);

  } catch (e) {
    console.error(`[ML-Worker] ${modelId} 训练异常:`, e.message);
    try { if (realDB) realDB.close(); } catch(e2) {}
    parentPort.postMessage({
      type: 'error',
      modelId,
      error: e.message,
      stack: e.stack
    });
    process.exit(1);
  }
});

// Worker 启动通知
parentPort.postMessage({ type: 'ready' });
console.log('[ML-Worker] 训练Worker线程已启动（只读模式）');
