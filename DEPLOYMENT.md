# 部署资源说明

本文档记录 food_link 项目在服务器上的部署配置，用于重装服务器后快速恢复。

> 生成时间：2026-04-25
> 来源服务器：`healthymax.cn`

---

## 服务器部署架构

| 环境 | 域名 | 后端端口 | 项目路径 |
|------|------|----------|----------|
| 生产 | `healthymax.cn` | 3010 | `/www/wwwroot/food/food_link` |
| 开发 | `dev.healthymax.cn` | 3011 | `/www/wwwroot/food/food_link-dev` |

---

## 目录结构

```
deploy/
├── nginx/
│   ├── healthymax.cn.conf      # 生产环境 nginx 配置
│   └── dev.healthymax.cn.conf  # 开发环境 nginx 配置
├── systemd/
│   ├── food-backend.service      # 生产环境 systemd 服务
│   └── food-backend-dev.service  # 开发环境 systemd 服务
└── scripts/
    ├── deploy_backend.sh         # 实际使用的部署脚本（硬编码路径）
    └── deploy_backend_v2.sh      # 通用版本（支持参数）
```

---

## 重装服务器后恢复步骤

### 1. 克隆代码并安装依赖

```bash
cd /www/wwwroot/food
git clone <仓库地址> food_link
cd food_link/backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
# 把生产环境 .env 放到 backend/ 目录
cp /path/to/saved/.env backend/.env
```

> `.env` 含有真实密钥和私钥，**不要提交到 git**。参考 `backend/.env.example` 填写。

### 3. 配置 systemd 服务

```bash
cp deploy/systemd/food-backend.service /etc/systemd/system/
cp deploy/systemd/food-backend-dev.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable food-backend.service
systemctl start food-backend.service
```

### 4. 配置 nginx

```bash
cp deploy/nginx/healthymax.cn.conf /etc/nginx/conf.d/
cp deploy/nginx/dev.healthymax.cn.conf /etc/nginx/conf.d/
nginx -t
systemctl reload nginx
```

> 需要提前申请 SSL 证书（Let's Encrypt）：
> ```bash
> certbot certonly --webroot -w /var/www/certbot -d healthymax.cn -d dev.healthymax.cn
> ```

### 5. 放置部署脚本

```bash
# 生产环境
cp deploy/scripts/deploy_backend.sh /www/wwwroot/food/deploy_backend.sh
chmod +x /www/wwwroot/food/deploy_backend.sh
```

### 6. GitHub Actions 自动部署（可选）

配置 GitHub Secrets：

| Secret | 说明 |
|--------|------|
| `DEPLOY_SSH_KEY` | SSH 私钥 |
| `DEPLOY_HOST` | 服务器 IP/域名 |
| `DEPLOY_USER` | SSH 用户名（`root`） |
| `DEPLOY_PATH` | 项目路径（`/www/wwwroot/food/food_link`） |

---

## 后端缺失文件同步记录

以下文件此前仅存在于服务器，现已同步回本地项目：

| 文件 | 说明 |
|------|------|
| `backend/user_points.py` | 用户积分系统（扣减/充值/邀请码） |
| `backend/scripts/wechat_pay_show_cert_serial.py` | 微信商户 API 证书序列号读取工具 |
| `backend/database/user_points.sql` | 积分系统数据库表结构迁移脚本 |

---

## ⚠️ 已知问题

### GitHub Workflow 传参缺失

当前 `.github/workflows/deploy-backend.yml` 调用方式：

```bash
cd ${DEPLOY_PATH} && ./deploy_backend.sh
```

没有传递参数，而 `deploy_backend_v2.sh` 需要三个参数：`PROJECT_DIR`、`BRANCH`、`SERVICE_NAME`。

**建议修复**（如果需要使用带参数的通用脚本）：

```bash
ssh ... "cd ${DEPLOY_PATH} && ./deploy_backend.sh ${DEPLOY_PATH} main food-backend"
```

或者继续使用 `deploy/scripts/deploy_backend.sh`（硬编码路径版本）。
