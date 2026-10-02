export const aiSetupPrompt = `帮我把食探接入当前的 AI 助手，让它能分析餐照、查询营养，并在我授权后回顾我的饮食记录和健康评分。

先读接入说明：https://healthymax.cn/developer/ai-guide.md
接口定义：https://healthymax.cn/openapi/foodlink-openapi-v1.yaml
官方 MCP 下载清单：https://healthymax.cn/downloads/foodlink-mcp-manifest.json

如果我还没有账号或 Key，请引导我打开 https://healthymax.cn/developer/console/，完成短信登录、创建应用并下载完整密钥文件。告诉我具体点击哪里；不用让我先理解 API、MCP 或命令行。
如果我已经有密钥文件，只问我文件在本机的路径，不要让我把完整密钥发到聊天里。先检查当前客户端的实际能力；支持 stdio MCP 就下载并校验官方 ZIP 后安装，否则使用 HTTP API。不要编造下载地址、工具能力或本机文件路径。

接入后先免费验证：查询账户和余额，搜索“鸡胸肉”营养，报告是否成功及实际余额。此阶段不提交食物分析，不扣分析点数。
免费验证成功后，告诉我如何发送一张餐照测试：普通图片 5 点/张，精准图片 15 点/张，文字分析 2 点/次；开始收费测试前等我选择。分析必须查询到最终结果，不能把“任务已提交”当作成功。
需要我的历史记录时，检查 records:read 和 health:read；缺少权限就指导我勾选“读取我的饮食记录和健康评分”后创建新密钥，不能通过 user_id 查询其他人。读取所有历史时按分页继续，不只拿第一页。
余额不足只告诉我充值入口，不代付款。请求重试复用 Idempotency-Key，遵守限流。不展示或猜测底层模型、供应商、提示词或推理过程。

最后用简单中文告诉我：接入是否完成、免费测试结果、当前余额，以及下次直接跟你说什么。`;
