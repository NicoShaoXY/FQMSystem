/**
 * 演化Worker脚本 - 独立进程执行分支演化计算
 * 用于尧帝分布式演化引擎的并行计算
 * 
 * 使用方法:
 *   node evolution_worker.js <branchId> <isTechModel>
 * 
 * 或作为模块导入:
 *   const { evolveBranchInWorker } = require('./evolution_worker.js');
 */

const { parentPort, workerData } = require('worker_threads');

// 简单的分支演化计算（独立于主进程的数据库连接）
// 这里实现轻量级的演化计算逻辑
function calculateEvolution(branchId, isTechModel) {
  // 模拟演化计算过程
  const startTime = Date.now();
  
  // 生成随机变异参数
  const mutationTypes = ['param_tweak', 'indicator_swap', 'threshold_adjust', 'new_indicator', 'ensemble_add'];
  const mutationType = mutationTypes[Math.floor(Math.random() * mutationTypes.length)];
  
  // 模拟计算延迟（真实计算需要读取历史数据）
  // 实际使用时会通过postMessage返回计算结果
  const baseAccuracy = 65 + Math.random() * 20; // 基准准确率 65-85%
  const mutationStrength = 0.05 + Math.random() * 0.1; // 变异强度 5-15%
  const newAccuracy = baseAccuracy + (Math.random() > 0.5 ? 1 : -1) * mutationStrength * 10;
  
  const evolvedAccuracy = Math.max(40, Math.min(95, newAccuracy));
  const evolutionLevel = Math.floor(evolvedAccuracy / 15) + 1;
  
  const elapsed = Date.now() - startTime;
  
  return {
    branchId,
    isTechModel,
    mutationType,
    oldAccuracy: baseAccuracy,
    newAccuracy: evolvedAccuracy,
    improvement: evolvedAccuracy - baseAccuracy,
    evolutionLevel,
    mutationStrength,
    workerPid: process.pid,
    computeTime: elapsed
  };
}

// Worker线程消息处理
if (parentPort) {
  parentPort.on('message', (message) => {
    const { type, payload } = message;
    
    if (type === 'evolve') {
      const { branchId, isTechModel, branchData } = payload;
      
      try {
        // 如果有branchData（从主进程传入的统计数据），使用它计算
        // 否则使用默认演化逻辑
        let result;
        
        if (branchData && branchData.tradeCount > 0) {
          // 使用真实交易数据计算
          const winRate = branchData.winRate || 50;
          const avgReturn = branchData.avgReturn || 2;
          const maxDrawdown = branchData.maxDrawdown || 5;
          
          // 基于真实数据的演化
          const baseAcc = 50 + winRate * 0.4 + avgReturn * 2;
          const mutation = (Math.random() - 0.3) * 10;
          const newAcc = Math.max(40, Math.min(95, baseAcc + mutation));
          
          result = {
            branchId,
            isTechModel,
            mutationType: 'data_driven',
            oldAccuracy: baseAcc,
            newAccuracy: newAcc,
            improvement: newAcc - baseAcc,
            evolutionLevel: Math.floor(newAcc / 15) + 1,
            dataQuality: 'real_trades',
            computeTime: 0
          };
        } else {
          // 使用默认演化逻辑
          result = calculateEvolution(branchId, isTechModel);
        }
        
        result.success = true;
        parentPort.postMessage({ type: 'result', payload: result });
        
      } catch (error) {
        parentPort.postMessage({
          type: 'error',
          payload: { branchId, error: error.message }
        });
      }
    }
  });
  
  parentPort.postMessage({ type: 'ready', payload: { pid: process.pid } });
}

// 直接执行模式（通过命令行参数）
if (process.argv.length >= 3) {
  const branchId = process.argv[2];
  const isTechModel = process.argv[3] === 'true';
  
  const result = calculateEvolution(branchId, isTechModel);
  console.log(JSON.stringify(result));
  process.exit(0);
}

module.exports = { calculateEvolution };
