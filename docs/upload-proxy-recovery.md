# 图片上传 HTTP 500 的入口恢复

2026-10-06 05:49–05:50（北京时间），正式 API 的六次图片上传在 Nginx
写入 `/var/lib/nginx/body/` 时返回 `Permission denied`。请求未进入 Go
服务，不能将这个 HTTP 500 归因于微信审核结果。

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
