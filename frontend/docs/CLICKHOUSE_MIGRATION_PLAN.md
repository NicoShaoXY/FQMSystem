# FQMSystem 数据层升级方案：SQLite → ClickHouse

> 来源：《FQMSystem优化文档》数据层
> 日期：2026-04-22
> 目标：从 SQLite 单文件架构升级为 ClickHouse 时序数据库

---

## 一、现状分析

### 1.1 SQLite 当前问题

| 问题 | 影响 | 严重度 |
|------|------|--------|
| 单文件架构，锁竞争严重 | 高并发写入时性能下降 | 🔴 高 |
| 写入性能随数据量增长下降 | stocks.db 已达 1.2GB | 🟡 中 |
| 无列式存储，聚合查询慢 | 多维度统计报表卡顿 | 🟡 中 |
| 无实时副本，故障风险高 | 单点故障，数据丢失风险 | 🔴 高 |
| 无时序优化 | 历史行情查询慢 | 🟡 中 |
| 无向量化执行 | 复杂分析查询慢 | 🟡 中 |

### 1.2 当前数据规模

```
stocks.db: ~1.2GB
  ├── stock_realtime: 6,000+ 条（日更）
  ├── yaodi_branch: 16 条（活跃分支）
  ├── yaodi_signal: 100+ 条/天
  ├── shundi_mock_trades: ~5,000+ 条（累计）
  └── market_stats: 1 条（当日快照）

fqm.db: ~2.0GB
  ├── selection_snapshots: 2,000+ 条
  ├── mock_holdings: ~100 条
  ├── mock_trades: 1,000+ 条
  └── trade_signals: ~500 条
```

**每日增量写入量估算：**
- 行情数据：~6,000 × 10次/天 = 60,000 行
- 尧帝信号：~100 条/天
- 舜帝交易：~10 条/天
- 历史K线：~6,000 × 240分钟 = 1,440,000 行/天（分钟级）

### 1.3 当前查询模式

高频查询（需 < 100ms）：
- `/api/stocks/all` — 全量股票行情
- `/api/market/indices` — 指数行情
- `/api/social-sentiment` — 情绪聚合
- `/api/market/overview` — 市场概览

中频查询（< 500ms）：
- `/api/selection/history` — 历史选股
- `/api/stock/{code}` — 个股详情
- `/api/validation/history` — 验证历史

低频查询（< 2s）：
- `/api/backtest/run` — 批量回测
- `/api/ai/report` — AI综合报告

---

## 二、ClickHouse 优势

| 特性 | SQLite | ClickHouse |
|------|--------|------------|
| 写入吞吐 | ~10,000 行/s | ~500,000+ 行/s |
| 聚合查询 | 慢（无索引时全表扫） | 极快（列式+向量化） |
| 数据压缩 | 无 | 10-20x 压缩率 |
| 副本机制 | 无 | 多副本强一致性 |
| 时序优化 | 无 | 原生 MergeTree 引擎 |
| SQL 标准 | 部分 | 高度兼容 |
| 内存需求 | < 100MB | 推荐 16GB+ |
| 部署复杂度 | 单文件 | 单机/集群 |

---

## 三、迁移方案（渐进式）

### 阶段1：架构评估（1-2周）

```
目标：验证 ClickHouse 集成可行性
- [ ] 在测试环境安装 ClickHouse（单节点）
- [ ] 设计 FQMSystem 数据模型 → ClickHouse 表结构
- [ ] 编写 ETL 脚本（SQLite → ClickHouse）
- [ ] 性能基准测试（对比 SQLite vs ClickHouse）
- [ ] 评估运维复杂度
```

### 阶段2：冷数据迁移（2-4周）

```
目标：历史数据迁移到 ClickHouse，不影响现有架构
- [ ] 创建 ClickHouse 数据库 fqm_analytics
- [ ] 迁移 historical_klines（历史K线，量最大）
- [ ] 迁移 selection_snapshots（历史选股）
- [ ] 迁移 mock_trades（历史交易）
- [ ] 保留 SQLite 作为热数据源
```

### 阶段3：双写架构（4-6周）

```
目标：新数据同时写入 SQLite + ClickHouse
- [ ] 修改 data_server.js 热数据写入逻辑
- [ ] 实时同步脚本（SQLite CDC → ClickHouse）
- [ ] 灰度验证：历史K线查询切换到 ClickHouse
- [ ] 监控系统：延迟、错误率、存储
```

### 阶段4：全量切换（6-8周）

```
目标：全部查询切换到 ClickHouse
- [ ] 切换市场行情查询（indices, overview, stats）
- [ ] 切换情绪聚合查询（social-sentiment）
- [ ] 切换回测引擎数据源
- [ ] 保留 SQLite 只读归档（备用）
```

---

## 四、ClickHouse 表结构设计

### 4.1 行情表（stock_realtime_ck）

```sql
CREATE TABLE fqm_analytics.stock_realtime
(
    code    String,
    name    String,
    price   Float64,
    change_percent Float32,
    volume  UInt64,
    amount  Float64,
    high    Float32,
    low     Float32,
    open    Float32,
    prev_close Float32,
    timestamp DateTime64(3) DEFAULT now64(3),
    date    Date DEFAULT toDate(timestamp)
)
ENGINE = ReplacingMergeTree(timestamp)
PARTITION BY date
ORDER BY (code, timestamp)
TTL timestamp + INTERVAL 30 DAY;
```

### 4.2 K线表（stock_klines_ck）

```sql
CREATE TABLE fqm_analytics.stock_klines
(
    code    String,
    timestamp DateTime64(3),
    open    Float32,
    high    Float32,
    low     Float32,
    close   Float32,
    volume  UInt64,
    amount  Float64,
    date    Date
)
ENGINE = SummingMergeTree()
PARTITION BY date
ORDER BY (code, timestamp);
```

### 4.3 尧帝信号表（yaodi_signals_ck）

```sql
CREATE TABLE fqm_analytics.yaodi_signals
(
    code       String,
    signal     String,        -- 'buy'/'sell'/'hold'
    confidence Float32,
    strength   Float32,
    probability Float32,
    accuracy   Float32,
    win_rate   Float32,
    reason     String,
    timestamp  DateTime64(3),
    date       Date DEFAULT toDate(timestamp)
)
ENGINE = ReplacingMergeTree(timestamp)
PARTITION BY date
ORDER BY (code, timestamp);
```

### 4.4 舜帝交易表（shundi_trades_ck）

```sql
CREATE TABLE fqm_analytics.shundi_trades
(
    code       String,
    direction  String,        -- 'buy'/'sell'
    shares     Int32,
    price      Float32,
    amount     Float64,
    strategy   String,       -- 'VWAP'/'TWAP'/'MARKET'
    pnl        Float64,
    pnl_pct    Float32,
    closed_at  DateTime64(3),
    opened_at  DateTime64(3),
    stop_loss  Float32,
    take_profit Float32,
    timestamp  DateTime64(3),
    date       Date DEFAULT toDate(timestamp)
)
ENGINE = ReplacingMergeTree(timestamp)
PARTITION BY date
ORDER BY (code, opened_at);
```

---

## 五、运维与监控

### 5.1 ClickHouse 资源配置

```yaml
# 推荐单机配置
clickhouse:
  resources:
    memory: 32GB        # 推荐，实际可用 16GB
    cpu: 8 cores
    disk: 500GB SSD     # 压缩后存储
  config:
    max_execution_time: 30
    max_memory_usage: 24GB
    background_pool_size: 16
```

### 5.2 监控指标

```javascript
// data_server.js 新增监控
const CHMonitor = {
  checkHealth: async () => {
    // 1. 查询延迟 P99
    const latency = await ch.query('SELECT quantile(0.99)(elapsed) FROM system.query_log WHERE type = \'QueryFinish\'');
    // 2. 存储使用
    const storage = await ch.query('SELECT formatReadableSize(sum(bytes)) FROM system.parts');
    // 3. 副本同步状态
    const replication = await ch.query('SELECT database, table, is_stale FROM system.replicas');
    return { latency, storage, replication };
  },
  
  alertThresholds: {
    p99Latency: 1000,    // ms
    storageUsage: 0.85,  // 85%
    replicationLag: 5,    // 秒
  }
};
```

### 5.3 备份策略

```sql
-- ClickHouse 原生备份（推荐）
BACKUP TABLE fqm_analytics.yaodi_signals TO S3('s3://fqm-backup/')
  SETTINGS compression_method='zstd';

-- TTL 自动清理（保留30天热数据）
ALTER TABLE fqm_analytics.stock_realtime MODIFY TTL timestamp + INTERVAL 30 DAY;
```

---

## 六、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 数据迁移丢失 | 迁移前完整 SQLite 备份 + 交叉验证脚本 |
| 查询性能回退 | AB测试：SQLite vs ClickHouse，逐步灰度 |
| 单节点故障 | ClickHouse Replica（2副本起步） |
| 运维复杂度上升 | 使用 Altinity Cloud（托管 ClickHouse）降低运维成本 |
| 网络延迟 | ClickHouse 与 data_server 同机部署 |
| 成本增加 | ClickHouse 单机版免费；云托管按量付费 |

---

## 七、决策建议

### 推荐路径（渐进式，零风险）

```
近期（1-2个月）：继续 SQLite
  → 清理脏数据（已完成，3.2GB）
  → 实施感知层+逻辑层+执行层+风控层优化（已完成）
  → 验证业务逻辑层升级效果

中期（3-4个月）：ClickHouse 单机试点
  → 历史K线数据迁移（数据量最大，收益最高）
  → 验证查询性能提升

远期（6个月+）：按需升级
  → 根据实际负载决定是否迁移全部数据
  → 考虑 ClickHouse Cloud 托管方案
```

### 为什么不立即迁移？

1. **感知层、逻辑层、执行层、风控层优化收益更高** — 这四项优化（已实施）直接提升选股质量，执行层优化降低交易成本，效果更直接
2. **SQLite 已满足当前需求** — 清理后 3.2GB，每天增量有限
3. **ClickHouse 引入运维复杂度** — 需学习成本和监控体系
4. **渐进式迁移更安全** — 冷数据先行，热数据殿后，零停机风险

---

## 八、行动清单

- [ ] **P0**：安装 ClickHouse 测试环境
- [ ] **P1**：设计 ClickHouse 表结构（参考第4节）
- [ ] **P1**：编写 SQLite → ClickHouse ETL 脚本
- [ ] **P2**：性能基准测试（historical_klines 查询）
- [ ] **P2**：制定备份和灾备方案
- [ ] **P3**：评估 ClickHouse Cloud 托管方案

