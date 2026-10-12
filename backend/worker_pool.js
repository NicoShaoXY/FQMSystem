/**
 * Worker线程池 - 用于尧帝演化引擎的并行计算加速
 * 
 * 使用Node.js Worker Threads实现真正的并行计算
 * 避免主线程阻塞，提升演化效率
 */

const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

class WorkerPool {
  constructor(options = {}) {
    this.maxWorkers = options.maxWorkers || Math.max(2, os.cpus().length - 1);
    this.workers = [];
    this.taskQueue = [];
    this.activeWorkers = 0;
    this.ready = false;
  }
  
  async init() {
    console.log(`[WorkerPool] 初始化线程池, 最大${this.maxWorkers}个工作线程`);
    
    for (let i = 0; i < this.maxWorkers; i++) {
      try {
        const worker = new Worker(path.join(__dirname, 'evolution_worker.js'));
        
        worker.on('error', (err) => {
          console.error(`[WorkerPool] Worker${i}错误:`, err.message);
        });
        
        worker.on('exit', (code) => {
          if (code !== 0) {
            console.warn(`[WorkerPool] Worker${i}异常退出, code=${code}`);
          }
          this.activeWorkers--;
        });
        
        this.workers.push({ worker, busy: false, index: i });
      } catch (e) {
        console.warn(`[WorkerPool] 无法创建Worker${i}:`, e.message);
      }
    }
    
    // 等待所有Worker就绪
    await new Promise(resolve => setTimeout(resolve, 500));
    this.ready = true;
    console.log(`[WorkerPool] 线程池就绪, ${this.workers.length}个Worker可用`);
  }
  
  async executeTask(payload) {
    return new Promise((resolve, reject) => {
      const availableWorker = this.workers.find(w => !w.busy);
      
      if (!availableWorker) {
        // 队列满时，拒绝任务
        reject(new Error('Worker池已满'));
        return;
      }
      
      availableWorker.busy = true;
      this.activeWorkers++;
      
      const timeout = setTimeout(() => {
        availableWorker.busy = false;
        this.activeWorkers--;
        reject(new Error('Worker任务超时'));
      }, 30000); // 30秒超时
      
      const messageHandler = (msg) => {
        if (msg.type === 'result') {
          clearTimeout(timeout);
          availableWorker.worker.off('message', messageHandler);
          availableWorker.busy = false;
          this.activeWorkers--;
          resolve(msg.payload);
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          availableWorker.worker.off('message', messageHandler);
          availableWorker.busy = false;
          this.activeWorkers--;
          reject(new Error(msg.payload.error));
        }
      };
      
      availableWorker.worker.on('message', messageHandler);
      availableWorker.worker.postMessage({ type: 'evolve', payload });
    });
  }
  
  async parallelEvolve(tasks) {
    // 并行执行多个演化任务
    const results = await Promise.allSettled(
      tasks.map(task => this.executeTask(task).catch(e => ({ success: false, error: e.message })))
    );
    
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return { success: false, branchId: tasks[i].branchId, error: r.reason?.message };
    });
  }
  
  getStatus() {
    return {
      maxWorkers: this.maxWorkers,
      activeWorkers: this.activeWorkers,
      idleWorkers: this.workers.filter(w => !w.busy).length,
      ready: this.ready,
      queueLength: this.taskQueue.length
    };
  }
  
  async shutdown() {
    console.log('[WorkerPool] 关闭线程池');
    for (const { worker } of this.workers) {
      await worker.terminate();
    }
    this.workers = [];
    this.ready = false;
  }
}

module.exports = WorkerPool;
