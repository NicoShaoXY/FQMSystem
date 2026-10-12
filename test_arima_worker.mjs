import { Worker } from 'worker_threads';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const worker = new Worker(join(__dirname, 'backend/ml_train_worker.mjs'));

worker.on('message', (msg) => {
  console.log('MSG:', JSON.stringify(msg).slice(0, 500));
});

worker.on('error', (e) => {
  console.error('WORKER ERROR:', e.message);
  console.error(e.stack?.slice(0, 500));
});

worker.on('exit', (code) => {
  console.error('WORKER EXIT code=', code);
  process.exit(0);
});

// 超时60秒
setTimeout(() => {
  console.error('TIMEOUT');
  worker.terminate();
  process.exit(1);
}, 60000);

console.log('启动 Worker，发送训练消息...');
worker.postMessage({
  modelId: 'arima',
  options: { targetSampleCount: 5000 },
  dbPath: join(__dirname, 'database/stocks.db')
});
