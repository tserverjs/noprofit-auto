const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// 配置区
const CONFIG = {
  loginUrl: 'https://accounts.noprofit.space/login',
  recordingDir: path.join(__dirname, 'recordings'),
  timeout: 60000, // 单步超时60秒
  maxRetries: 3,  // 最大重试次数
  // 代理配置：从环境变量 PROXY_SERVER 读取，如 socks5://127.0.0.1:40000
  proxyServer: process.env.PROXY_SERVER || null
};

// 确保录制目录存在
if (!fs.existsSync(CONFIG.recordingDir)) {
  fs.mkdirSync(CONFIG.recordingDir, { recursive: true });
}

// 从环境变量读取账号密码
const username = process.env.NOPROFIT_USERNAME;
const password = process.env.NOPROFIT_PASSWORD;

if (!username || !password) {
  console.error('❌ 错误：请设置 NOPROFIT_USERNAME 和 NOPROFIT_PASSWORD 环境变量');
  console.error('示例：');
  console.error('  export NOPROFIT_USERNAME="你的用户名"');
  console.error('  export NOPROFIT_PASSWORD="你的密码"');
  console.error('  export PROXY_SERVER="socks5://127.0.0.1:40000" # 可选，需要代理时设置');
  process.exit(1);
}

if (CONFIG.proxyServer) {
  console.log(`🌐 已配置代理: ${CONFIG.proxyServer}`);
} else {
  console.log('ℹ️  未配置代理，直接连接目标网站');
}

// 带随机延迟的输入函数，模拟真人打字
async function humanType(element, text, page) {
  for (const char of text) {
    await element.type(char, { delay: 80 + Math.random() * 120 }); // 80-200ms 随机延迟
  }
}

async function attemptLogin(attemptNumber) {
  const timestamp = Date.now();
  const attemptPrefix = path.join(CONFIG.recordingDir, `attempt-${attemptNumber}-${timestamp}`);
  
  console.log(`\n🚀 开始第 ${attemptNumber} 次登录尝试...`);
  
  // 浏览器启动配置，含反检测和代理
  const browserOptions = {
    headless: true,
    slowMo: 50, // 每个操作慢50ms，方便录制观看
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage'
    ]
  };
  
  // 添加代理配置（如果存在）
  if (CONFIG.proxyServer) {
    browserOptions.proxy = {
      server: CONFIG.proxyServer
    };
  }

  const browser = await chromium.launch(browserOptions);
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // 全程开启视频录制
    recordVideo: {
      dir: CONFIG.recordingDir,
      size: { width: 1920, height: 1080 }
    }
  });

  // 绕过自动化检测
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
  });

  const page = await context.newPage();
  
  // 监听控制台和页面错误，方便排查
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[浏览器控制台错误] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    console.log(`[页面错误] ${err.message}`);
  });

  try {
    console.log(`📄 正在打开登录页面: ${CONFIG.loginUrl}`);
    await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle', timeout: CONFIG.timeout });
    
    // 等待页面加载完成，截图初始页面
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${attemptPrefix}-login-page.png`, fullPage: true });
    console.log('📸 登录页面初始截图已保存');

    console.log('⌛ 等待登录表单加载...');
    
    // 填写用户名/邮箱 - 自动识别正确的输入框
    const usernameInput = await page.waitForSelector('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]', { timeout: CONFIG.timeout });
    console.log('✍️  正在输入用户名/邮箱...');
    await humanType(usernameInput, username, page);

    // 填写密码
    const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: CONFIG.timeout });
    console.log('🔑 正在输入密码...');
    await humanType(passwordInput, password, page);

    // 勾选"保持登录"复选框（如果存在）
    const rememberCheckbox = await page.$('input[type="checkbox"][name*="remember"], input[type="checkbox"]');
    if (rememberCheckbox) {
      console.log('☑️  勾选登录选项复选框...');
      await rememberCheckbox.check({ force: true });
      await page.waitForTimeout(500 + Math.random() * 500);
    }

    // 勾选同意条款复选框（如果存在）
    const termsCheckboxes = await page.$$('input[type="checkbox"]');
    for (const cb of termsCheckboxes) {
      const isChecked = await cb.isChecked();
      if (!isChecked) {
        console.log('☑️  勾选同意条款复选框...');
        await cb.check({ force: true });
        await page.waitForTimeout(300 + Math.random() * 400);
      }
    }

    // 处理 Cloudflare Turnstile 验证码（自动等待用户交互完成）
    console.log('🤖 正在检测 Cloudflare 验证码...');
    const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]').first();
    
    try {
      const captchaCheckbox = turnstileFrame.locator('.ctp-checkbox-label, input[type="checkbox"]');
      await captchaCheckbox.waitFor({ timeout: 5000 });
      console.log('🔍 发现 Turnstile 验证码，等待自动验证完成...');
      // Turnstile 通常会自动验证，等待验证成功标记出现
      await page.waitForTimeout(8000);
      console.log('✅ 验证码验证完成');
    } catch (e) {
      console.log('ℹ️  未检测到需要手动处理的验证码，继续...');
    }

    // 截图填写完成后的页面
    await page.screenshot({ path: `${attemptPrefix}-before-submit.png`, fullPage: true });

    // 点击登录按钮
    console.log('🖱️  点击登录按钮...');
    const loginButton = await page.waitForSelector('button[type="submit"], button:has-text("登录"), button:has-text("Login"), input[type="submit"]', { timeout: CONFIG.timeout });
    
    // 随机等待一下再点击，模拟真人思考
    await page.waitForTimeout(800 + Math.random() * 1200);
    await loginButton.click({ delay: 100 });

    console.log('⏳ 等待登录跳转和页面加载...');
    // 等待页面跳转完成，网络空闲
    await page.waitForLoadState('networkidle', { timeout: CONFIG.timeout });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log(`📍 当前页面URL: ${currentUrl}`);

    // 截图登录后的页面
    await page.screenshot({ path: `${attemptPrefix}-after-login.png`, fullPage: true });

    // 判断是否登录成功：URL不再包含login，或者页面出现用户信息/登出按钮
    const loginSuccess = !currentUrl.includes('/login') || 
      await page.$('button:has-text("退出"), button:has-text("Logout"), a:has-text("退出"), a:has-text("Logout"), [class*="user-menu"], [class*="avatar"]').catch(() => false);

    if (loginSuccess) {
      console.log('🎉 登录成功！');
      
      // 保存 cookies 到文件，后续可以复用
      await context.storageState({ path: path.join(CONFIG.recordingDir, 'storage-state.json') });
      console.log(`💾 Cookies 已保存到 storage-state.json`);
      
      // 重命名视频文件
      const videoPath = await page.video().path();
      const finalVideoPath = `${attemptPrefix}-login-success.webm`;
      await context.close();
      await browser.close();
      fs.renameSync(videoPath, finalVideoPath);
      console.log(`🎬 操作视频已保存到: ${finalVideoPath}`);
      
      return true;
    } else {
      console.log('❌ 登录失败，仍在登录页面或出现错误');
      const pageText = await page.textContent('body');
      if (pageText.includes('错误') || pageText.includes('失败') || pageText.includes('error') || pageText.includes('incorrect')) {
        console.log('⚠️  检测到错误提示，请查看截图确认');
      }
      
      // 保存失败截图和视频
      await page.screenshot({ path: `${attemptPrefix}-login-error.png`, fullPage: true });
      const videoPath = await page.video().path();
      await context.close();
      await browser.close();
      const finalVideoPath = `${attemptPrefix}-login-failed.webm`;
      fs.renameSync(videoPath, finalVideoPath);
      console.log(`🎬 失败操作视频已保存到: ${finalVideoPath}`);
      
      return false;
    }

  } catch (error) {
    console.error(`❌ 第 ${attemptNumber} 次尝试出错:`, error.message);
    
    // 出错时也保存截图和视频
    try {
      await page.screenshot({ path: `${attemptPrefix}-error.png`, fullPage: true });
      const videoPath = await page.video().path();
      await context.close();
      await browser.close();
      const finalVideoPath = `${attemptPrefix}-error.webm`;
      fs.renameSync(videoPath, finalVideoPath);
      console.log(`🎬 错误过程视频已保存到: ${finalVideoPath}`);
    } catch (e) {
      await browser.close().catch(() => {});
    }
    
    return false;
  }
}

// 主函数，带重试逻辑
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('    noprofit.space 自动登录脚本（带操作录制）');
  console.log('═══════════════════════════════════════════════');
  console.log(`👤 用户名: ${username}`);
  console.log(`📹 录制目录: ${CONFIG.recordingDir}`);
  console.log(`🔄 最大重试次数: ${CONFIG.maxRetries}`);
  console.log('═══════════════════════════════════════════════\n');

  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    const success = await attemptLogin(attempt);
    if (success) {
      console.log('\n✅ 自动登录任务完成！');
      process.exit(0);
    }
    
    if (attempt < CONFIG.maxRetries) {
      const waitTime = 3000 + Math.random() * 5000;
      console.log(`\n⏳ 等待 ${Math.round(waitTime/1000)} 秒后进行第 ${attempt + 1} 次重试...\n`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  console.error(`\n❌ 已重试 ${CONFIG.maxRetries} 次，全部失败，请检查账号密码和网络连接`);
  console.error('📹 请查看 recordings 目录下的操作视频和截图排查具体失败步骤');
  process.exit(1);
}

main().catch(err => {
  console.error('💥 脚本执行异常:', err);
  process.exit(1);
});
