# noprofit.space 自动登录脚本

自动登录 https://accounts.noprofit.space 账号，支持全程操作视频录制，GitHub Actions 定时执行，GOST代理隧道，企业微信结果通知。

## ✨ 功能特性

- 🌐 **GOST代理支持**：自动启动代理隧道，避免原生IP被Cloudflare封禁
- 🎬 **全程操作录制**：1080P全高清视频记录完整登录过程，每一步都能看清楚
- 🤖 **真人行为模拟**：随机输入延迟、鼠标移动，绕过自动化检测
- 🛡️ **智能Cloudflare处理**：自动绕过Turnstile人机验证，支持CSP绕过解决验证卡住问题
- 🔄 **自动重试**：失败自动重试最多3次，指数退避等待
- 📢 **企业微信通知**：登录成功/失败自动推送通知，附带运行详情链接
- 📸 **完整证据留存**：每个步骤截图、错误截图、GOST日志、登录日志全部保存
- 🍪 **状态导出**：自动保存登录后的Cookies和LocalStorage，方便后续复用

## ⚡ 快速开始

### 本地运行

1. 安装依赖：
```bash
npm install
npx playwright install chromium --with-deps
```

2. 复制环境变量文件并填写配置：
```bash
cp .env.example .env
# 编辑 .env 填写账号密码和代理
```

3. 启动自动登录：
```bash
npm start
```

4. 查看结果：所有视频、截图、登录状态保存在 `recordings/` 目录下

### GitHub Actions 定时运行

1. Fork 或 Push 本仓库到你的 GitHub
2. 进入仓库 `Settings` → `Secrets and variables` → `Actions`
3. 添加以下 Secrets：

| Secret名称 | 必填 | 说明 |
|-----------|------|------|
| `NOPROFIT_USERNAME` | ✅ | noprofit 用户名/邮箱 |
| `NOPROFIT_PASSWORD` | ✅ | noprofit 密码 |
| `GOST_PROXY` | ✅ | GOST 上游代理地址，例如 `relay+tls://你的账号:你的密码@你的代理服务器:端口` |
| `WECOM_WEBHOOK` | ⚠️ 可选 | 企业微信群机器人 Webhook 地址，配置后自动发送结果通知 |

4. 进入仓库 `Actions` 页面，启用工作流即可
5. 默认每天北京时间早8点自动执行，也可以手动点击 `Run workflow` 触发

## 🔧 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|-------|--------|------|
| `NOPROFIT_USERNAME` | - | 登录用户名/邮箱 |
| `NOPROFIT_PASSWORD` | - | 登录密码 |
| `PROXY_SERVER` | - | 代理地址，例如 `socks5://127.0.0.1:40000`，本地运行不需要可以不填 |
| `MAX_RETRIES` | `3` | 最大重试次数 |

### 常见问题排查

#### 1. 页面加载超时 `Timeout 60000ms exceeded`
**原因**：之前版本等待 `networkidle`，但Cloudflare验证页面会持续发起后台请求，永远不会达到网络空闲状态。
**已修复**：现在改为只等待DOM加载完成，然后主动等待登录表单元素出现，Cloudflare验证单独检测和等待。

#### 2. Cloudflare CSP 错误 `Connecting to 'data:,' violates Content Security Policy`
**原因**：GitHub Actions无界面环境下，Cloudflare验证的探针请求触发CSP拦截，导致页面卡住。
**已修复**：启动浏览器时添加 `--disable-web-security` 和 `bypassCSP: true`，绕过CSP限制，不影响登录功能。

#### 3. 代理连接失败
- 检查GOST_PROXY地址格式是否正确，协议、账号、密码、端口是否完整
- 查看Artifacts中的 `gost.log` 排查代理启动错误
- 确认代理服务器网络正常，没有封禁GitHub Actions出口IP段

#### 4. 登录一直失败
- 下载Artifacts中的视频和截图，看具体卡在哪一步
- 视频是 `.webm` 格式，直接用Chrome/Edge/VLC打开即可播放
- 检查账号密码是否正确，是否需要二次验证
- 如果卡在Cloudflare验证超过2分钟，可以尝试更换代理节点IP

## 📁 目录结构

```
noprofit-auto-login/
├── .github/workflows/
│   └── auto-login.yml    # GitHub Actions 工作流配置
├── login.js              # 核心登录脚本
├── package.json          # 依赖配置
├── .env.example          # 环境变量示例
├── .gitignore            # Git忽略规则
└── README.md             # 说明文档
```

运行后会自动生成 `recordings/` 目录，包含：
- `attempt-N-xxx-login-page.png` - 登录页初始截图
- `attempt-N-xxx-success.png` - 登录成功截图
- `attempt-N-xxx-failed.png` - 登录失败截图
- `attempt-N-xxx-error.png` - 错误截图
- `attempt-N-xxx-success.webm` - 成功操作视频
- `attempt-N-xxx-failed.webm` - 失败操作视频
- `storage-state.json` - 登录后的Cookies和本地存储
