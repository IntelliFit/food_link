# 图片上传 HTTP 500 的入口恢复

2026-10-06 05:49–05:50（北京时间），正式 API 的六次图片上传在 Nginx
写入 `/var/lib/nginx/body/` 时返回 `Permission denied`。请求未进入 Go
服务，不能将这个 HTTP 500 归因于微信审核结果。

触发操作已由 sudo 记录和关联调试任务的脚本核对：05:27:21，以 root
运行 `nginx -t -c /tmp/coachlink-ai-sse-check-5mf3m5vl/nginx.conf`。
该临时配置只包含 `events`/`http`/`server` 和 SSE location，没有 `user`
或独立的请求缓存目录。正式 Nginx 使用 `www-data`，该临时配置使用
编译默认用户 `nobody`。配置校验也执行目录初始化和属主调整，因此它
会影响共用的 `/var/lib/nginx/body`，即使未修改正式配置文件。
这解释了此前上传成功、校验后出现目录权限错误的时间线。

机制依据：[校验时初始化缓存路径](https://github.com/nginx/nginx/blob/release-1.18.0/src/core/ngx_cycle.c#L320)、
[目录属主调整](https://github.com/nginx/nginx/blob/release-1.18.0/src/core/ngx_file.c#L591)、
[默认用户](https://github.com/nginx/nginx/blob/release-1.18.0/auto/unix#L4)。
未在正式服务器重跑这个临时校验来复现故障。

FoodLink 两个 HTTPS API 域名现在使用独立的请求缓存目录：

- `/var/lib/nginx/foodlink-body`，`www-data:www-data`，权限 `0700`。
- `/etc/nginx/conf.d/foodlink.conf` 中两个 API 的 HTTPS server 配置
  `client_body_temp_path /var/lib/nginx/foodlink-body;`。
- `/etc/tmpfiles.d/foodlink-nginx-upload.conf` 保持目录在启动时的属主和权限。

必要时在项目服务器以 root 执行
`python3 scripts/repair-foodlink-upload-proxy.py`（先将该脚本复制到服务器）。
脚本只处理正式和开发 API 的 HTTPS 块，备份现有配置，执行 `nginx -t`
后平滑 reload；校验或 reload 失败会恢复备份，不修改审核、数据库或小程序。
重复运行保留已经正确的目录配置，不重复添加指令。

验收应发送超过 Nginx 内存缓冲大小的 multipart 请求；未登录请求到达
应用并返回 401，只能证明入口已恢复，不能代替登录后的真实上传和识别。
同时核对正常用户上传 200，以及错误日志是否再次出现目录权限错误。
本修复不需要 Docker 镜像更新或小程序重新上传。

以后校验独立 Nginx 配置，应明确设置运行用户及全部临时路径，并优先
在本地或隔离环境执行；不能把 root 执行 `nginx -t` 当作完全只读操作。
