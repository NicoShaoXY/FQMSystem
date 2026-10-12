# 任务：修复 React duplicate key 警告（根治 stocks 表重复数据）

## 时间
2026-07-07 16:41 ~ 17:00 GMT+8

## 现象
前端控制台报错：`Encountered two children with the same key, '600584'`（Holding.jsx:253 AddHoldingModal），以及此前 MarketOverview.jsx:82 的 `000001` key 重复警告。

## 根因
`database/stocks.db` 的 `stocks` 表存在 **46.5 万行重复数据**（A股实际仅约 5800 只），系 2026-07-07 从 `stocks.db.bak2` 恢复数据库时整表重复插入所致。所有按 `code` 查询/关联/统计的后端逻辑（/api/search、热门股、L2缓存、样本生成、各类计数）都会返回重复行，导致 React `key={s.code}` 冲突，并会放大后端统计。

## 执行步骤
1. **前端即时去重（零风险，无需重启）**
   - `frontend/src/pages/Holding.jsx`：searchResults 按 `code` 去重后再 `setSearchResults`。
   - `frontend/src/pages/MarketOverview.jsx`：HotStocksList 渲染前按 `code` 去重（IIFE 包一层 filter）。
   - 两文件 esbuild 编译均 0 错误，Vite HMR 自动生效。
2. **根因根治（破坏性，需停后端）**
   - 停后端 PID 83665，确认无外部 Watchdog 重启（PPID=1，launchd `com.fqmsystem.tablemonitor` 未运行）。
   - 备份：`database/stocks.db.bak_pre_dedup_20260707_165324`（988MB）。
   - 去重脚本：先 `wal_checkpoint(TRUNCATE)` 落盘防丢数据 → 删 312 条 null code → `DELETE ... WHERE rowid NOT IN (SELECT MIN(rowid) GROUP BY code)` 删 463,825 重复 → 建 `CREATE UNIQUE INDEX idx_stocks_code` → `VACUUM`。
   - 结果：469,968 → **5,831 行**，唯一索引生效。
   - 后端 `/api/search` SQL 加 `DISTINCT` 双保险。
   - 重启后端（PID 84430，端口 8769 正常监听）。

## 验证
- 搜索 `600584` 返回 1 条、无重复；`600320/601390/000620` 等均单条。
- 端口仅 84430 监听，无残留旧实例。
- `idx_stocks_code` 唯一索引存在，未来重复插入会被拒绝。

## 备注
- 启动日志中 `恢复准确率失败: no such column: accuracy` 为历史遗留校准报错（某表缺 accuracy 列），与本次去重无关，属已知技术债。
- 备份文件保留于 `database/stocks.db.bak_pre_dedup_20260707_165324`，确认无误后可后续清理。
