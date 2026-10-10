# 六路原始回答对比器

你填写同一个问题，可选附一张实物原图，点击“开始对比”后六路同时回答，各自显示原文、耗时和错误。不预填提示词，不加入系统提示词，不要求食物 JSON，不打分、不自动切型号/重试/回退。选择图片本身不会发送。

| 对比栏 | 请求模型 | 路由 |
|---|---|---|
| 万界方舟 · 3.5 | `gemini-3.5-flash` | 渠道默认 |
| 万界方舟 · 3 Flash Preview | `gemini-3-flash-preview` | 渠道默认 |
| OpenLux · 3.7 | `gemini-3.7-flash` | 官网成功率优先 |
| OpenLux · 3 Flash Preview | `gemini-3-flash-preview` | 官网成功率优先 |
| A6 · 3.7 | `gemini-3.7-flash` | 渠道默认 |
| A6 · 3 Flash Preview | `gemini-3-flash-preview` | 渠道默认 |

2026-10-03最新选择：在之前五路基础上新增万界方舟3 Flash Preview（用户所说双子星3.0，采用目录已有gemini-3-flash-preview，与另两家Flash一致，不是3 Pro），现在六栏。万界3.5、OpenLux/A6各3.7及3 Flash Preview保持。3.6与Lite均不在当前对比集合。只改本独立工具，不更改线上应用模式/Apollo配置；旧导出或旧页结果是历史证据，不重写。

## 打开

双击仓库内 `scripts/open-model-comparator.cmd`，就绪后自动打开 `http://127.0.0.1:38915`。保留启动窗口；关闭工具进程即可结束。不启停现有小程序或业务后端，也不部署到线上。

也可在项目根目录运行：

```powershell
node scripts/model-compare.mjs --open
```

启动器仅通过现有 SSH 登录 `ubuntu@154.8.205.78`，只读取得正式 Apollo 中三家 Key/Base URL，再通过 stdin 传给独立工具；凭证不写文件、不传浏览器。需要本机已有 Node、Go、SSH 和服务器只读访问权限。SSH/Apollo失败时不会开始模型调用。不支持公网或局域网暴露。端口占用时退出，不结束其他进程。

不用远端凭证时，可从 `backend` 运行 `go run ./cmd/model-compare -config-dir .`，复用现有配置源；仅加载配置、不初始化数据库/队列/任务。

## 使用边界

- 可以只问文字、只发图片，或两者同时填写；问题初始为空，内容及回答要求由你自己规定。选图/改问题都不会调用，只有点击“开始对比”才提交；请求进行期间输入固定，完成后可修改再测。
- 请避开银行卡、人脸和个人资料。JPEG/PNG/WebP、原文件不压缩、上限8MiB/4000万像素，图片仅保留于当前内存，不上传COS、不创建FoodLink任务、不扣产品积分。
- 每次六栏各一次独立供应商调用，可能计费，重复测试仍会产生费用。停止会取消工具的请求等待，但不能保证第三方已经收到的调用不计费。
- 六路收到相同原图、完全相同的问题，无隐藏营养分析要求。原生请求不设置 generationConfig，兼容请求只指定 model/messages/stream=false；其余采样、输出长度及思考参数使用渠道默认，因此不是严格同参数性能基准。不是小程序带用户上下文/营养库处理的完整链路。
- “不加提示词”仅指本工具不添加系统指令；中转站可能带自身系统提示词或其他包装，这里无法保证或去除。用户旧页“请问你是谁”的A6 3.5原文自称Antigravity，是可见回答现象，不能单凭此证明实际底层模型、上游来源或具体隐藏prompt。用户认为A6由Antigravity反代且廉价的观察已记录，未独立核验上游或账单。
- 不默认追加“忽略Antigravity指令”的提示词：普通用户指令不保证覆盖上游的隐藏指令，而且会改变原始对比输入。需要测试任务聚焦提示时，由用户自己填写同一句要求；不承诺能清除上游包装。当前直接请求3.7只是一项对照实验，不等于已证明上游纯净或更稳定。
- 报错保留原始文字、完整响应、请求格式（无Key/Base64）、模型字符串和用量（渠道自报）。原图预览/文件名/SHA256保留；浏览器不能读取完整本地路径，可自行填路径备注。导出JSON不含图片数据或Key。
- 普通文本或 JSON 均可正常回答，工具不强制解析食物结构。回答是否准确、是否符合你提出的格式由你核对；已知退役提示、HTTP错误、无回答、截断等会单独标识并保留原文。不能用渠道自报型号或“模型说自己是什么型号”认证底层模型。
- “发送完成”和“首响应”是从调用开始的累计时间点，“总耗时”含网络连接、图片发送、等响应和读回；未收到的阶段显示空值。本机出口不代表生产服务器/手机端速度。

## 默认原生请求格式

| 渠道 | 完整POST端点 | 鉴权头 | 图像字段 |
|---|---|---|---|
| 万界方舟 | `https://maas-openapi.wanjiedata.com/api/v1beta/models/gemini-3.5-flash:generateContent` | `Authorization: Bearer <key>` | `contents[].parts[].inlineData` |
| 万界方舟 3 Flash Preview | `https://maas-openapi.wanjiedata.com/api/v1beta/models/gemini-3-flash-preview:generateContent` | `Authorization: Bearer <key>` | 同上 |
| OpenLux 3.7 | `https://api.openlux.ai/v1beta/models/gemini-3.7-flash:generateContent?sort=success_rate` | `Authorization: Bearer <key>` | 同上 |
| OpenLux 3 Flash Preview | `https://api.openlux.ai/v1beta/models/gemini-3-flash-preview:generateContent?sort=success_rate` | `Authorization: Bearer <key>` | 同上 |
| A6 3.7 | `https://api.a6api.com/v1beta/models/gemini-3.7-flash:generateContent` | `x-goog-api-key: <key>` | 同上 |
| A6 3 Flash Preview | `https://api.a6api.com/v1beta/models/gemini-3-flash-preview:generateContent` | `x-goog-api-key: <key>` | 同上 |

共有请求体（`data`是原始图片字节的Base64，不是URL，也不带data URI前缀）：

```json
{
  "contents": [{"role":"user", "parts":[
    {"text":"你自己写的问题及回答要求，六路完全相同"},
    {"inlineData":{"mimeType":"image/jpeg", "data":"<原图Base64>"}}
  ]}]
}
```

纯文字时不发送 inlineData；纯图片时不补 text。高级选项的 OpenAI 兼容模式是另一次显式实验：万界 `/api/v1/chat/completions`、OpenLux/A6 `/v1/chat/completions`，均 Bearer，图片为 `messages[].content[].image_url.url="data:image/jpeg;base64,..."`，不是 CDN URL。OpenLux 请求模型加 `:stable`（当前为 `gemini-3.7-flash:stable` 或 `gemini-3-flash-preview:stable`）以映射官网成功率优先；不换型号。不会在原生失败时偷偷改兼容模式。

上游当前使用非流式 generateContent/chat completions；浏览器则在任一模型完整返回时立即显示该栏，不等其他五路完成。不是逐字输出。每路最多90秒，无自动重试；本机一次仅允许一组对比，避免重复付费并发。

依据：[OpenLux官方原生文档](https://doc.openlux.ai/en/reference/gemini-v1beta?op=post-v1beta-models-gemini-2-5-pro-generatecontent&leaf=305048984)、用户提供的A6官方Developer Docs（2026-09-13）、[Google generateContent图像输入文档](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding)。万界官网API文档需登录，未取得其完整官方规范；这里复用当前项目原生格式并实际核验，不冒称三家全部规范已取到。

## 连通证据与当前运行验证

2026-10-03 后续诊断已覆盖早期“OpenLux 3.5不可用”的宽泛判断：同项目 Key/同一咖啡原图，官网成功率优先路由五次视觉均正常（9.259–12.413秒），默认路由五次视觉仍返回退役提示。原生 `sort=success_rate` 和兼容 `:stable` 均正常，流式/非流式都可用，不是只打开 stream 就解决。详见 `.local-state/current-task/model-comparator-20261003/OPENLUX-INVESTIGATION.md` 及原始控制 JSONL；单图不能证明所有照片准确率、百分百稳定或真机速度。

首次五栏、之后Lite替换的截图/报告分别为five-way-ui.jpg/FIVE-WAY-IMPLEMENTATION.md、five-way-flash-lite-ui.jpg/FLASH-LITE-UPDATE.md，均属历史版本。上一版去Lite、用两个3 Flash Preview，见PREVIEW-UPDATE.md与five-way-preview-ui.jpg。五栏“就绪”仅代表Key/Base已配置，不意味着新增型号已付费实测成功。两家今日既有只读models目录列gemini-3-flash-preview与gemini-3.7-flash，真实问答由用户自主提交。

更新：用户随后实测OpenLux普通3.5在sort=success_rate下仍返回Antigravity退役提示（HTTP200、1.7秒），不能把上面的有限成功样本当作稳定性保证。用户现要求将两家3.5换为3.7、保留3 Flash Preview，见FLASH-37-UPDATE.md；新3.7实际回答由用户自行测试，本代理不替用户收费提交。销售目录、官方产品列表和返回model字段都不能认证中转站实际底层身份。

最新六路更新：新增万界方舟3 Flash Preview，见SIX-WAY-UPDATE.md和six-way-ui.jpg。此前所有五栏报告/截图均保留为历史；当前六项配置就绪不代表新增组合已收费测试，真实问答仍由用户自主提交。

微信工具仅尝试只读状态检查，不继续控制或导航模拟器；独立网页不属于微信页面，不能把小程序截图当作此工具的运行验收。现有小程序/业务后端/线上配置保持不变。

### 历史：2026-10-03 05:33 默认路由原生核验

原图：`D:/创业/healthymax/food_test_sanitized_20260424_mini10/sample_0018.jpg`，646502字节，同原图/简短提示词、三家并行各一次。

| 渠道 | HTTP | 结果 | 总耗时 |
|---|---|---|---|
| 万界 | 200 | 咖啡245g / 识读245mL | 12.179秒 |
| A6 | 200 | 咖啡245g / 识读245mL | 9.282秒 |
| OpenLux | 200 | 仍返回3.5不可用的Antigravity提示，不是识别 | 2.621秒 |

这仅记录当时默认路由下的结果，后续 OpenLux 已通过显式官网路由恢复识图，不能继续据此称其3.5整体不可用。不足以证明准确率或型号真实性，不能和此前服务器完整prompt结果合并排名；不擅自改成3.7。

完整证据：`.local-state/current-task/model-comparator-20261003/native-connectivity.jsonl`。没有更改Apollo、线上模型/路由或业务数据。
