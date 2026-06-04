# 食物分析灰度 suite

这些 suite 用于验证包装零食/饮料已经无感并入正常拍照识别主链路。

## 最小烟测

`food-analysis-gray-suite.example.json` 只包含已上传 CDN 的雀巢咖啡混合图，用于快速验证：

- 普通餐饮和包装饮品同图同时识别
- 包装 item 命中 `packaged_food_library`
- 包装重量锚点为 `105g`
- 纠错后半包 `52.5g`、用户营养和 AI 摄入比例字段都能落地

```powershell
cd backend
go run ./cmd/food-analysis-gray-verify --config-dir . --user-id latest --suite ./testdata/food-analysis-gray-suite.example.json --output-dir ..\tmp\gray-mixed-nescafe-suite
```

## 完整灰度

`food-analysis-gray-suite.full.json` 覆盖六类验收图：

- `mixed_nescafe`：炸猪排 + 雀巢咖啡 105g，并自动提交一次纠错任务
- `mixed_cutlet_cici`：炸猪排 + 喜之郎 Cici 果冻爽 258g，并自动纠错普通餐饮，验证包装饮料不被误伤
- `mixed_skewer_snickers`：烤串 + 士力架 2 条装 70g
- `mixed_rice_suntory_sugarfree`：白米饭 + SUNTORY 三得利纤漾饮无糖饮料 500ml，要求低热量、三大宏量为 0g 的包装饮料命中包装库且不被计为缺营养
- `package_miss_ai_fallback`：白米饭 + 虚构未收录包装豆干，要求包装库未命中后由 AI 或已生成的普通营养库兜底，且不留下未解析项
- `normal_only_skewer`：纯普通烤串，要求不要误触发包装食品

完整 suite 默认覆盖 `fast`、`standard`、`strict`、`strict_separate`、`fast_web_search`、`standard_web_search`、`strict_web_search` 七种模式。

```powershell
cd backend
go run ./cmd/food-analysis-gray-verify --config-dir . --user-id latest --suite ./testdata/food-analysis-gray-suite.full.json --output-dir ..\tmp\gray-packaged-full-suite
```

本机素材依赖：

- `mixed_cutlet_cici` 已上传为 `http://cdn-food-images.coachlink.fit/1153ee82-2713-4552-90a7-a48814e6bddc.jpg`
- `mixed_skewer_snickers` 已上传为 `http://cdn-food-images.coachlink.fit/154a5549-1e58-44e3-be27-1e45e5b4bdea.jpg`
- `mixed_rice_suntory_sugarfree` 使用本地文件 `backend/testdata/food-analysis-gray-assets/mixed-rice-suntory-sugarfree.png`，运行命令时请先 `cd backend`
- `package_miss_ai_fallback` 使用本地文件 `backend/testdata/food-analysis-gray-assets/mixed-rice-unlisted-dougan.jpg`，运行命令时请先 `cd backend`
- `normal_only_skewer` 使用本地文件 `backend/testdata/food/9F1F4BC7A2986BBFEFE4854FFA939035.jpg`，运行命令时请先 `cd backend`

前两张包装命中扩展图由项目内普通餐食测试图和本机 `D:\BaiduNetdiskDownload\snack-human-collect` 原始零食图拼接生成。原始本地文件位于 `tmp/gray-suite-assets/`；零卡饮料和包装未命中兜底图保存在 `backend/testdata/food-analysis-gray-assets/`，用于随仓库复跑。
