# FQMSystem 优化实施报告 v2.0

> 日期：2026-04-22
> 来源：《FQMSystem优化文档》五大维度升级

---

## ✅ 已完成优化（4/5）

| # | 维度 | 优化内容 | 状态 |
|---|------|---------|------|
| 1 | 感知层 | 6维精细化情绪分析 + 新闻标题NLP | ✅ |
| 2 | 逻辑层 | 产业链知识图谱 + L3研报级核验 | ✅ |
| 3 | 执行层 | TWAP/VWAP智能拆单 + 流动性画像 | ✅ |
| 4 | 风控层 | 动态仓位修正 + 宏观压力测试 | ✅ |
| 5 | 数据层 | ClickHouse迁移评估报告 | ✅ |

---

## 优化1：感知层（情绪分析升级）

### 问题
- `bullish/bearish` 恒为0（数据源稀疏）
- 仅有简单利好/利空二分法

### 解决方案
**新增 `analyzeSentimentFineGrained()` 函数**（6维精细化情绪）：

```javascript
// 6维情绪向量
{
  fear: 0.2,          // 恐慌指数（下跌相关词）
  greed: 0.4,         // 贪婪指数（上涨相关词）
  policy: 0.6,        // 政策力度（监管/政策词）
  technical: 0.3,     // 技术信号（技术分析词）
  institutional: 0.5, // 机构动向（大单/北向/研报）
  macro: 0.7,         // 宏观环境（外围/汇率/大宗）
  total: 0.35,        // 综合情绪分（-1~1）
  dominant: 'greed',   // 主导情绪
  confidence: 0.82    // 置信度
}
```

**修改文件：**
- `server/data_server.js`：更新3处情绪采集函数 + 聚合输出

---

## 优化2：逻辑层（产业链知识图谱）

### 问题
- L3仅规则过滤，无产业链逻辑
- 选股逻辑停留在因子驱动层面

### 解决方案
**新增 `INDUSTRY_CHAIN_MAP` + `verifyResearchLogic()` 函数**：

- 12条核心产业链覆盖（新能源车/半导体/医药/白酒等）
- 每条产业链含：上游/下游/关键词/政策关键词
- 研报级5项核验：行业归属→热点共振→产业链传导→政策共振→风险筛查

**研报级评级：**
```
A（85-100分）：完全符合研报逻辑标准
B（70-85分）：基本符合，少量缺失
C（55-70分）：逻辑不完整，谨慎参考
D（<55分）：逻辑存疑，不建议介入
```

**修改文件：**
- `src/services/stockSelectionService.js`：知识图谱 + L3核验集成
- `server/research_logic_engine.js`（新建）：服务端研报核验引擎
- `server/data_server.js`：导入 + 3个新API路由

**新增API：**
- `GET /api/stock/research-verify?code=000001` — 研报级个股核验

---

## 优化3：执行层（TWAP/VWAP智能拆单）

### 问题
- 舜帝仅支持市价单
- 大单直接市价执行冲击成本高

### 解决方案
**智能拆单决策树：**

```
订单规模 vs 日均成交量：
├─ < 0.5%  → MARKET（市价直接执行）
├─ 0.5-3%  → VWAP（按日内成交量分布执行）
├─ > 3%    → TWAP_MULTI（分多日TWAP）
└─ 题材小票 → TWAP_MULTI（分多日，降低冲击）
```

**流动性画像**（4种类型）：
- `megaCap`：大盘蓝筹，日均成交额>50亿，全天均匀
- `growth`：成长股，早盘+尾盘双峰
- `themed`：题材小票，脉冲式放量，高波动
- `normal`：普通股票

**修改文件：**
- `server/aiQuantCore.js`：新增5个函数 + 3个导出
- `server/data_server.js`：导入 + 1个新API路由

**新增API：**
- `POST /api/shundi/smart-execute` — 舜帝智能拆单执行

---

## 优化4：风控层（动态仓位 + 压力测试）

### 问题
- 固定10%仓位，无动态调整
- 无极端行情压力测试

### 解决方案
**动态仓位公式：**
```
actual_position = base(10%) × accuracy_factor × macro_factor × vol_factor × winRate_factor

accuracy_factor  = 0.5 + (yaodiAccuracy / 80)，上限2.0
macro_factor     = 1.0 + macroScore × 0.3，极端行情额外×0.7
vol_factor       = 高波动股→0.6，低波动股→1.2
winRate_factor   = 胜率>75%时 +0.1
```

**压力测试4大情景：**
| 情景 | 描述 | 基准跌幅 |
|------|------|---------|
| 2015式股灾 | 沪深300 -40% 快速下跌 | -40% |
| 2018式阴跌 | 日跌-1.5% × 20天 | -27% |
| 2020新冠冲击 | -15% 后V形修复 | -15% |
| 2022加息冲击 | -25% 全球联动 | -25% |

**修改文件：**
- `quant_engine/risk/risk_manager.js`：新增3个函数 + module.exports扩展
- `server/data_server.js`：导入 + 2个新API路由

**新增API：**
- `GET /api/risk/dynamic-position?accuracy=80&winRate=70&macro=0&riskLevel=moderate`
- `GET /api/risk/stress-test`

---

## 优化5：数据层（ClickHouse迁移评估）

### 结论
**建议继续使用 SQLite，近期不迁移。**

原因：
1. 感知层/逻辑层/执行层/风控层优化收益更高（直接提升选股质量）
2. 清理后3.2GB，满足当前需求
3. ClickHouse引入运维复杂度
4. 渐进式迁移更安全（冷数据先行）

**4阶段迁移规划：**
```
阶段1（1-2周）：架构评估
阶段2（2-4周）：冷数据迁移
阶段3（4-6周）：双写架构
阶段4（6-8周）：全量切换
```

**输出文档：**
- `docs/CLICKHOUSE_MIGRATION_PLAN.md`（321行）

---

## 新增文件清单

| 文件 | 行数 | 说明 |
|------|------|------|
| `server/research_logic_engine.js` | 189 | 服务端研报核验引擎 |
| `docs/CLICKHOUSE_MIGRATION_PLAN.md` | 321 | ClickHouse迁移评估报告 |
| `docs/OPTIMIZATION_V2_SUMMARY.md` | - | 本文件 |

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `server/data_server.js` | 情绪分析升级 + 导入4个新函数 + 4个新API |
| `server/aiQuantCore.js` | TWAP/VWAP智能拆单 + 3个导出 |
| `quant_engine/risk/risk_manager.js` | 动态仓位 + 压力测试 |
| `src/services/stockSelectionService.js` | 产业链知识图谱 + L3研报核验 |

## 待验证项

- [ ] 重启 data_server.js 后验证4个新API是否正常
- [ ] 测试 `/api/risk/dynamic-position?accuracy=90&winRate=85`
- [ ] 测试 `/api/stock/research-verify?code=600519`（贵州茅台）
- [ ] 测试 `/api/shundi/smart-execute` POST请求
- [ ] 验证前端子股详情弹窗是否正常显示研报级核验结果
