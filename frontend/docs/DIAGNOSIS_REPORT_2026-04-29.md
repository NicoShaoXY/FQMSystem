# FQMSystem 尧帝智能版诊断报告

## 诊断时间
2026-04-29 18:40 (北京时间)

## 发现的问题

### 🔴 P0 - 严重问题

#### 1. win_rate 数据异常 (已修复)
- **现象**: 449 个分支的 win_rate > 100% (最高达 108.13%)
- **根因**: `evolveBranch()` 函数中 `derivedWinRate` 计算逻辑有嵌套的 `Math.min/max`,导致边界条件失效
- **影响**: 可能在后续计算中产生 NaN/Infinity,导致 RangeError
- **修复**: 已执行 `fix_win_rate.mjs` 修复异常数据

#### 2. Detached Promise 错误传播
- **位置**: `calculateStats()` 函数 (约第 4583 行)
- **代码**:
```javascript
fetchNorthFlow().then(northData => {
  // 这是一个 detached Promise,错误不会被外层 try-catch 捕获
}).catch(() => {});
```
- **风险**: 如果 `fetchNorthFlow()` 返回异常数据,可能导致 unhandledRejection
- **建议**: 改为 `await fetchNorthFlow()` 或在 `.catch()` 中记录详细错误

### 🟡 P1 - 中等问题

#### 3. 持仓数据不一致
- 多只股票的 `shares` 字段与 `shundi_mock_trades` 交易记录不符
  - `300114`: 持仓 1400股 vs 交易记录 100股
  - `688262`: 持仓 500股 vs 交易记录 200股
- **根因**: 可能存在并发写入或事务未正确提交
- **建议**: 在交易执行时使用事务,确保持仓与交易记录一致性

#### 4. 数据类型不一致
- 部分股票的 `price/change_percent/volume` 字段类型为 TEXT 而非 REAL
- **影响**: SQL 数值比较可能出错
- **建议**: 执行数据类型转换,统一为 REAL 类型

### 🟢 P2 - 低优先级

#### 5. SQL 表结构缺失字段
- `q_learning_history` 表不存在
- `branch_performance` 表缺少 `avg_profit` 列
- `shundi_mock_trades` 表缺少 `profit` 列
- **建议**: 补充建表语句或修复查询 SQL

## 修复建议

### 修复 1: evolveBranch() 中的 win_rate 计算
```javascript
// 原代码 (有问题)
derivedWinRate = Math.min(100, Math.max(0, Math.min(newAccuracy + 3, Math.max(newAccuracy - 5, parent.win_rate || newAccuracy - 2))));

// 修复后 (简化且安全)
const baseWinRate = parent.win_rate || newAccuracy;
const winRateDelta = (newAccuracy > parent.accuracy) ? 1.5 : -1.5;
derivedWinRate = Math.max(0, Math.min(100, baseWinRate + winRateDelta));
```

### 修复 2: calculateStats() 中的 detached Promise
```javascript
// 原代码 (有问题)
fetchNorthFlow().then(northData => {
  try {
    // ...
  } catch (e) { /* 非关键 */ }
}).catch(() => {});

// 修复后 (捕获所有错误)
fetchNorthFlow()
  .then(northData => {
    try {
      const today = northData?.today;
      const netIn = parseFloat(today?.hkToSh) || 0;
      const latest = db.prepare('SELECT id FROM market_stats ORDER BY id DESC LIMIT 1').get();
      if (latest) {
        db.prepare('UPDATE market_stats SET north_flow = ? WHERE id = ?').run(netIn, latest.id);
      }
    } catch (e) {
      console.error('[calculateStats] north_flow 更新失败:', e.message);
    }
  })
  .catch(err => {
    console.error('[calculateStats] fetchNorthFlow 失败:', err?.message || err);
  });
```

### 修复 3: 数据类型转换
```sql
-- 转换 TEXT 类型为 REAL
UPDATE stock_realtime 
SET price = CAST(price AS REAL),
    change_percent = CAST(change_percent AS REAL),
    volume = CAST(volume AS REAL)
WHERE typeof(price) = 'text' 
   OR typeof(change_percent) = 'text'
   OR typeof(volume) = 'text';
```

## 建议的下一步

1. **立即**: 应用上述代码修复补丁
2. **短期**: 添加数据库约束,防止 win_rate 超出 [0, 100]
3. **中期**: 重构 detached Promise 为 async/await
4. **长期**: 添加数据一致性校验定时任务

## 相关日志文件
- `/tmp/fqm_server.log` - 服务器主日志
- `/tmp/fqm_server_new.log` - 详细运行日志
- `/tmp/fqm_backend.error.log` - 错误日志
