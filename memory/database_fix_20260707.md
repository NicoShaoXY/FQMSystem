# FQMSystem 数据库大修复

**时间**: 2026-07-07 16:17-16:25  
**问题**: 从备份恢复数据库后，大量表和列缺失导致后端反复崩溃

## 修复内容

### 新建的表

| 表名 | 说明 |
|------|------|
| `capital_config` | 资金配置表 |
| `branch_performance` | 演化分支性能表 |
| `ml_training_history` | ML训练历史表 |
| `sector_history` | 板块历史数据表 |

### 新增的列

| 表名 | 新增列 |
|------|--------|
| `user_stock_pool` | `user_deleted`, `add_time`, `add_source`, `is_favorite`, `price`, `pre_close`, `change_percent`, `update_time` |
| `trade_signals` | `expires_at`, `price`, `target_price`, `stop_loss`, `trade_type`, `status`, `retry_count`, `error_message` |
| `yaodi_branch` | `active`, `is_tech_model`, `score`, `generation`, `strategy`, `updated_at` |
| `yaodi_l2_cache` | `kelly_pct`, `confidence`, `stop_loss_pct`, `take_profit_pct`, `recommendation`, `risk_level` |
| `yaodi_l3_signals` | `kelly_pct`, `stop_loss_pct`, `confidence`, `take_profit_pct` |
| `shundi_mock_holdings` | `avg_cost`, `kelly_pct` |
| `mock_holdings` | `avg_cost` |
| `ml_training_checkpoint` | `retry_count`, `error_message`, `last_error` |

### 修复的问题

1. ✅ `capital_config` 表不存在 → 已创建并初始化资金 ¥1,000,000
2. ✅ `kelly_pct` 列缺失 → 已添加到多个表
3. ✅ `retry_count` 列缺失 → 已添加到 `ml_training_checkpoint`
4. ✅ `branch_performance` 表不存在 → 已创建
5. ✅ 尧帝/舜帝引擎初始化失败的列缺失问题 → 全部修复

## 当前状态

- **后端**: PID 80018, 端口 8769, 运行稳定
- **前端**: 端口 5174
- **市场格局**: BEAR（空头格局）
- **资金配置**: 总资金 ¥1,000,000, 可用资金 ¥1,000,000
- **错误日志**: 无错误

## 根本原因

从2026-05-29的备份(`stocks.db.bak2`)恢复后，该备份缺少后续开发中新增的表结构和列。需要将所有Phase 1-5超进化中的数据库结构变更同步到数据库。

## 建议

1. **定期完整备份**: 备份时确保数据库完整性，包括所有新表和列
2. **数据库迁移脚本**: 创建版本化的数据库迁移脚本，方便快速恢复
3. **Schema验证**: 启动时检查必需的表和列是否存在

## 下次启动

```bash
cd /Users/shao/Projects/FQMSystem
node --stack-size=8192 --max-old-space-size=3072 backend/data_server.js
```
