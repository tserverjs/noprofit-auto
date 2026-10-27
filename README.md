# noprofit.space 自动登录

🔄 基于 Playwright 的 noprofit.space 全自动登录脚本，支持 GitHub Actions 定时运行、GOST代理隧道、全程操作视频录制、企业微信机器人通知。

## ✨ 功能特性

- ✅ **反检测机制**：模拟真人打字速度、随机延迟、绕过浏览器自动化检测
- ✅ **全程视频录制**：1920×1080 高清录制完整操作过程，每一步都看得清
- ✅ **GOST 代理隧道**：内置 GOST 代理转发，支持各类上游代理协议（relay+tls/socks5/http等）
- ✅ **企业微信通知**：登录成功/失败自动推送markdown通知到企业微信群
- ✅ **Cloudflare 自动处理**：自动等待 Turnstile 验证码验证完成
- ✅ **自动重试**：失败最多自动重试3次，随机间隔避免被检测
- ✅ **GitHub Actions 支持**：每天定时自动运行，无需本地服务器
- ✅ **结果留存**：自动保存cookies、截图、操作视频，方便排查问题
- ✅ **登录状态持久化**：登录成功后保存 storage-state.json，可复用登录态

## 🚀 快速开始

### 本地运行

1. **安装依赖**
```bash
npm install
npx playwright install chromium
```

2. **配置环境变量**
复制 `.env.example` 为 `.env`，填写你的账号密码和配置：
```env
# noprofit.space 账号密码（必填）
NOPROFIT_USERNAME=你的用户名或邮箱
NOPROFIT_PASSWORD=你的密码

# 代理配置（可选，需要代理时填写）
# 本地运行时如果不需要代理可以注释掉这行
PROXY_SERVER=socks5://127.0.0.1:40000
```

3. **（可选）本地启动GOST代理**
如果你使用代理，提前启动GOST：
```bash
gost -L socks5://:40000 -F "你的上游代理地址"
```

4. **运行脚本**
```bash
npm start
```

运行完成后，所有截图、视频和登录状态都会保存在 `recordings/` 目录下。

### GitHub Actions 定时运行

#### 1. 准备 Secrets

在你的 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，添加以下3个Secret：

| Secret名称 | 必填 | 说明 |
|-----------|------|------|
| `NOPROFIT_USERNAME` | ✅ 是 | 你的 noprofit.space 用户名/邮箱 |
| `NOPROFIT_PASSWORD` | ✅ 是 | 你的 noprofit.space 密码 |
| `GOST_PROXY` | ✅ 是 | GOST上游代理地址，格式如：<br>`relay+tls://你的用户名:你的密码@你的代理服务器:端口`<br>`socks5://用户名:密码@服务器:端口`<br>`http://用户名:密码@服务器:端口` |
| `WECOM_WEBHOOK` | ⚠️ 可选 | 企业微信群机器人Webhook地址，配置后自动发送通知 |

> 💡 GOST_PROXY 是必填项，不配置代理会直接报错退出。这样可以避免GitHub Actions原生IP被网站封禁。

#### 2. 获取企业微信机器人Webhook

1. 在企业微信群聊中点击右上角 **...** → **群机器人** → **添加机器人**
2. 新建一个机器人，名字随便填（比如"自动登录通知"）
3. 创建完成后复制 **Webhook地址**，粘贴到上面的 `WECOM_WEBHOOK` Secret中即可
4. 机器人支持markdown格式通知，包含运行时间、出口IP、运行链接等信息

#### 3. 推送到 GitHub

将代码推送到你的 GitHub 仓库后，会自动启动工作流：
- 每天 UTC 0:00（北京时间早上8点）自动执行登录
- 也可以在 Actions 页面手动点击 **Run workflow** 随时测试运行

## 📹 查看操作录制

### GitHub Actions 中查看视频

每次运行结束后，都会自动上传录制文件作为 Artifact：
1. 进入仓库的 **Actions** 页面
2. 点击任意一次运行记录
3. 滚动到页面底部的 **Artifacts** 区域
4. 下载 `login-recording-<run_id>` 压缩包
5. 解压后即可看到所有截图和 `.webm` 格式的操作视频

WebM 视频支持所有主流浏览器直接播放（Chrome/Edge/Firefox 直接拖入即可打开），也可以用 VLC 等播放器播放。

### 录制文件说明

每次登录尝试都会生成以下文件：
- `attempt-N-xxx-login-page.png` - 打开登录页后的初始截图
- `attempt-N-xxx-before-submit.png` - 填写完表单点击登录前的截图
- `attempt-N-xxx-after-login.png` - 登录完成后的页面截图
- `attempt-N-xxx-login-success.webm` - ✅ 登录成功的完整操作视频
- `attempt-N-xxx-login-failed.webm` - ❌ 登录失败的完整操作视频
- `attempt-N-xxx-*.png` - 错误截图（如果出现异常）
- `storage-state.json` - 登录成功后的cookies和登录态，可复用
- `gost.log` - GOST代理运行日志

## ⚙️ 自定义配置

### 修改定时运行时间

编辑 `.github/workflows/auto-login.yml` 中的 cron 表达式：
```yaml
on:
  schedule:
    - cron: '0 0 * * *'  # UTC时间，北京时间+8小时
```
cron 格式：`分 时 日 月 周`
- `0 0 * * *` = 每天UTC 0点 = 北京时间8点
- `0 22 * * *` = 每天UTC 22点 = 北京时间次日6点
- `0 */12 * * *` = 每12小时运行一次

### 修改重试次数/超时

编辑 `login.js` 顶部的 CONFIG 区域：
```javascript
const CONFIG = {
  loginUrl: 'https://accounts.noprofit.space/login',
  recordingDir: path.join(__dirname, 'recordings'),
  timeout: 60000, // 单步超时，毫秒
  maxRetries: 3,  // 最大重试次数
  proxyServer: process.env.PROXY_SERVER || null
};
```

## 📬 通知效果

配置企业微信机器人后，你会收到如下格式的通知：

**登录成功：**
> ## ✅ noprofit.space 自动登录成功
> > 运行时间：2026-10-27 19:30:00
> > 代理出口IP：1.2.3.4
> > 
> [查看运行详情](https://github.com/xxx/xxx/actions/runs/xxx)
> > 📹 完整操作视频和截图请到 Actions 页面下载 Artifact 查看

**登录失败：**
> ## ❌ noprofit.space 自动登录失败
> > 运行时间：2026-10-27 19:30:00
> > 代理出口IP：1.2.3.4
> > 错误原因：请查看运行日志和操作录制排查问题
> > 
> [查看运行详情](https://github.com/xxx/xxx/actions/runs/xxx)
> > 📹 请下载 Artifact 中的操作视频查看具体是哪一步出错

## 🔧 故障排查

1. **登录失败？**
   - 下载 Artifact 中的操作视频，看完整过程就能知道卡在哪一步
   - 检查账号密码是否正确
   - 检查代理是否正常工作，出口IP是否被Cloudflare拦截
   - 看截图中页面显示的具体错误提示

2. **GOST代理启动失败？**
   - 检查GOST_PROXY地址格式是否正确
   - 确认上游代理服务器可用、账号密码正确
   - 下载gost.log查看具体错误日志

3. **没收到企业微信通知？**
   - 确认Webhook地址正确，没有复制多余空格
   - 确认机器人没有被移出群聊
   - 查看运行日志中通知步骤的输出

4. **Cloudflare 验证过不去？**
   - 换一个干净的住宅代理IP，数据中心IP容易被拦截
   - 脚本已经内置了反检测，大部分情况下Turnstile可以自动通过

## 📝 目录结构

```
noprofit-auto-login/
├── .github/
│   └── workflows/
│       └── auto-login.yml    # GitHub Actions 工作流配置
├── login.js                  # 核心自动登录脚本（含视频录制、代理支持）
├── package.json              # Node.js 依赖配置
├── .env.example              # 环境变量示例
├── .gitignore               # Git 忽略规则
└── README.md                # 使用说明（本文件）
```

## ⚠️ 免责声明

本脚本仅用于学习和个人账号的自动化维护，请勿用于任何违反网站服务条款的用途。使用本脚本产生的一切后果由使用者自行承担。
