const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 加载 .env 文件（本地运行时）
try {
  require('dotenv').config();
} catch (e) {
  // dotenv 未安装也没关系，继续使用系统环境变量
}

(async () => {
  // 配置参数
  const username = process.env.NOPROFIT_USERNAME;
  const password = process.env.NOPROFIT_PASSWORD;
  const proxyServer = process.env.PROXY_SERVER; // 例如 socks5://127.0.0.1:40000
  const maxRetries = 3;

  if (!username || !password) {
    console.error('❌ 错误: 请设置 NOPROFIT_USERNAME 和 NOPROFIT_PASSWORD 环境变量');
    process.exit(1);
  }

  // 创建录制目录
  const recordDir = path.resolve(__dirname, 'recordings');
  if (!fs.existsSync(recordDir)) {
    fs.mkdirSync(recordDir, { recursive: true });
  }

  console.log('═══════════════════════════════════════════════');
  console.log('  noprofit.space 自动登录脚本（带操作录制）');
  console.log('═══════════════════════════════════════════════');
  if (proxyServer) {
    console.log(`🌐 已配置代理: ${proxyServer}`);
  }
  console.log(`👤 用户名: ${username}`);
  console.log(`📹 录制目录: ${recordDir}`);
  console.log(`🔄 最大重试次数: ${maxRetries}`);
  console.log('═══════════════════════════════════════════════');

  let success = false;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const timestamp = Date.now();
    const videoPath = path.join(recordDir, `attempt-${attempt}-${timestamp}`);
    let browser;
    let context;
    let page;

    try {
      console.log(`\n🚀 开始第 ${attempt} 次登录尝试...`);

      // 浏览器启动参数 - 针对 CI + Cloudflare 优化
      const launchOptions = {
        headless: true,
        slowMo: 50, // 操作间隔 50ms，模拟真人速度
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-translate',
          '--disable-extensions',
          '--disable-default-apps',
          '--mute-audio',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security', // 绕过CSP限制，避免Cloudflare验证卡住
        ]
      };

      // 如果配置了代理，添加到启动选项
      if (proxyServer) {
        launchOptions.proxy = {
          server: proxyServer,
        };
        console.log('🔌 代理已启用，所有流量将通过代理转发');
      }

      browser = await chromium.launch(launchOptions);

      // 创建上下文，配置录制视频
      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        recordVideo: {
          dir: videoPath,
          size: { width: 1920, height: 1080 }
        },
        ignoreHTTPSErrors: true,
        bypassCSP: true, // 绕过CSP，解决Cloudflare CSP拦截问题
      });

      // 绕过 webdriver 检测
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        // 覆盖Chrome自动化属性
        window.chrome = {
          runtime: {},
          loadTimes: function(){},
          csi: function(){},
          app: {}
        };
        // 伪造插件
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        // 伪造语言
        Object.defineProperty(navigator, 'languages', {
          get: () => ['zh-CN', 'zh', 'en-US', 'en'],
        });
        // 伪造权限
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      });

      page = await context.newPage();

      // 监听控制台错误（仅记录，不中断）
      page.on('console', msg => {
        const type = msg.type();
        if (type === 'error') {
          const text = msg.text();
          // 过滤掉CSP和font相关的无关错误，避免干扰日志
          if (!text.includes('Content Security Policy') && !text.includes('font-size') && !text.includes('data:,')) {
            console.log(`[浏览器控制台错误] ${text}`);
          }
        }
      });

      page.on('pageerror', error => {
        console.log(`[页面错误] ${error.message}`);
      });

      // 打开登录页面 - 关键修复：不再等待networkidle！
      // Cloudflare验证页面会持续有后台请求，永远不会networkidle
      console.log('📄 正在打开登录页面...');
      await page.goto('https://accounts.noprofit.space/login', {
        waitUntil: 'domcontentloaded', // 只等DOM加载完成，不等待所有网络请求
        timeout: 120000, // 代理环境下超时延长到2分钟
      });

      // 额外等待页面核心元素渲染完成
      console.log('⏳ 等待页面加载完成...');
      await page.waitForTimeout(3000);

      // 保存登录页面截图
      const loginPageScreenshot = path.join(recordDir, `attempt-${attempt}-${timestamp}-login-page.png`);
      await page.screenshot({ path: loginPageScreenshot, fullPage: true });
      console.log(`📸 登录页截图已保存: ${loginPageScreenshot}`);

      // 检测是否在Cloudflare验证页面
      const isCloudflareChallenge = await page.evaluate(() => {
        const title = document.title;
        const bodyText = document.body.innerText || '';
        return title.includes('Just a moment') || 
               title.includes('请稍候') || 
               bodyText.includes('Checking your browser') ||
               bodyText.includes('正在验证您的浏览器') ||
               bodyText.includes('Turnstile') ||
               document.querySelector('#cf-challenge-running') !== null ||
               document.querySelector('.cf-turnstile') !== null ||
               document.querySelector('iframe[src*="challenges.cloudflare.com"]') !== null;
      });

      if (isCloudflareChallenge) {
        console.log('🛡️  检测到Cloudflare人机验证，等待验证自动完成（最长120秒）...');
        // 等待Cloudflare验证完成，最长2分钟
        await page.waitForFunction(() => {
          return !document.title.includes('Just a moment') && 
                 !document.title.includes('请稍候') &&
                 !document.body.innerText.includes('Checking your browser') &&
                 !document.body.innerText.includes('正在验证您的浏览器');
        }, { timeout: 120000 }).catch(e => {
          console.log('⚠️  Cloudflare验证等待超时，继续执行...');
        });
        // 验证后额外等待页面跳转渲染
        await page.waitForTimeout(5000);
      }

      // 等待用户名输入框出现 - 这才是判断页面加载完成的正确标志
      console.log('👀 等待登录表单加载...');
      await page.waitForSelector('input[type="email"], input[name="username"], input[type="text"]', {
        timeout: 60000,
        state: 'visible'
      });
      console.log('✅ 登录表单已加载完成');

      // 再额外等待一会确保所有元素就绪
      await page.waitForTimeout(2000);

      // 定位用户名输入框
      const usernameInput = await page.$('input[type="email"]') || 
                           await page.$('input[name="username"]') || 
                           await page.$('input[type="text"]');
      
      // 定位密码输入框
      const passwordInput = await page.$('input[type="password"]');

      if (!usernameInput || !passwordInput) {
        throw new Error('找不到用户名或密码输入框，请检查页面结构');
      }

      // 模拟真人输入用户名
      console.log('⌨️  正在输入用户名...');
      await usernameInput.click({ delay: 100 + Math.random() * 200 });
      await usernameInput.fill('');
      for (const char of username) {
        await usernameInput.type(char, { delay: 80 + Math.random() * 150 });
      }
      await page.waitForTimeout(500 + Math.random() * 1000);

      // 模拟真人输入密码
      console.log('🔑 正在输入密码...');
      await passwordInput.click({ delay: 100 + Math.random() * 200 });
      await passwordInput.fill('');
      for (const char of password) {
        await passwordInput.type(char, { delay: 80 + Math.random() * 150 });
      }
      await page.waitForTimeout(800 + Math.random() * 1500);

      // 勾选"保持登录"复选框（如果存在）
      const rememberCheckbox = await page.$('input[type="checkbox"][name*="remember"], input[type="checkbox"]:not([name*="agree"])');
      if (rememberCheckbox) {
        console.log('☑️  勾选保持登录选项...');
        if (!await rememberCheckbox.isChecked()) {
          await rememberCheckbox.click({ delay: 100 + Math.random() * 200 });
        }
        await page.waitForTimeout(300 + Math.random() * 500);
      }

      // 勾选"同意条款"复选框（如果存在 - noprofit注册/登录通常有这个）
      const agreeCheckbox = await page.$('input[type="checkbox"][name*="agree"], input[type="checkbox"][name*="terms"]');
      if (agreeCheckbox) {
        console.log('☑️  勾选同意服务条款...');
        if (!await agreeCheckbox.isChecked()) {
          await agreeCheckbox.click({ delay: 100 + Math.random() * 200 });
        }
        await page.waitForTimeout(300 + Math.random() * 500);
      }

      // 再次处理Cloudflare Turnstile验证（如果出现在表单里）
      const hasTurnstile = await page.$('iframe[src*="challenges.cloudflare.com"], .cf-turnstile');
      if (hasTurnstile) {
        console.log('🛡️  检测到表单中的Turnstile验证，等待自动完成...');
        // 尝试点击验证框（隐形验证不需要，显式的需要）
        const turnstileFrame = await page.frameLocator('iframe[src*="challenges.cloudflare.com"]').first();
        const checkbox = await turnstileFrame.locator('.ctp-checkbox-label, input[type="checkbox"]').count();
        if (checkbox > 0) {
          console.log('🔘 点击Turnstile验证复选框...');
          await turnstileFrame.locator('.ctp-checkbox-label').click({ timeout: 10000 }).catch(() => {});
        }
        // 等待验证完成 - 最长60秒
        await page.waitForFunction(() => {
          // 检查验证是否成功：错误提示消失 或者 验证成功状态
          const turnstile = document.querySelector('.cf-turnstile');
          if (!turnstile) return true;
          return turnstile.classList.contains('cf-turnstile-completed') || 
                 turnstile.getAttribute('data-state') === 'verified' ||
                 document.querySelector('[name="cf-turnstile-response"]')?.value?.length > 0;
        }, { timeout: 60000 }).catch(e => {
          console.log('⚠️  Turnstile验证等待超时，尝试继续...');
        });
        await page.waitForTimeout(2000);
      }

      // 定位并点击登录按钮
      console.log('🖱️  点击登录按钮...');
      const loginButton = await page.$('button[type="submit"]') || 
                         await page.$('button:has-text("登录")') || 
                         await page.$('button:has-text("Sign in")') ||
                         await page.$('button:has-text("Log in")') ||
                         await page.$('input[type="submit"]');
      
      if (!loginButton) {
        throw new Error('找不到登录按钮');
      }

      await loginButton.click({ delay: 200 + Math.random() * 300 });

      // 等待登录完成 - 等待URL变化或者页面出现登录成功标志
      console.log('⏳ 等待登录完成...');
      
      // 先等待导航或者网络稳定
      try {
        await page.waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
      } catch (e) {
        // 如果导航超时，不立即失败，继续检查页面状态
        console.log('⚠️  导航等待超时，检查当前页面状态...');
      }

      await page.waitForTimeout(5000);

      // 检查是否还有Cloudflare验证
      const isStillCloudflare = await page.evaluate(() => {
        return document.title.includes('Just a moment') || 
               document.body.innerText.includes('Checking your browser');
      });

      if (isStillCloudflare) {
        console.log('🛡️  登录后仍在Cloudflare验证，继续等待...');
        await page.waitForFunction(() => {
          return !document.title.includes('Just a moment') && 
                 !document.body.innerText.includes('Checking your browser');
        }, { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(3000);
      }

      // 判断是否登录成功
      const currentUrl = page.url();
      const pageTitle = await page.title();
      const bodyText = await page.evaluate(() => document.body.innerText);
      
      const loginSuccess = !currentUrl.includes('/login') || 
                           bodyText.includes('Dashboard') || 
                           bodyText.includes('控制台') ||
                           bodyText.includes('我的账户') ||
                           bodyText.includes('My Account') ||
                           bodyText.includes('退出登录') ||
                           bodyText.includes('Logout') ||
                           bodyText.includes('Sign out');

      // 保存登录后截图
      const afterLoginScreenshot = path.join(recordDir, `attempt-${attempt}-${timestamp}-${loginSuccess ? 'success' : 'failed'}.png`);
      await page.screenshot({ path: afterLoginScreenshot, fullPage: true });
      console.log(`📸 登录后截图已保存: ${afterLoginScreenshot}`);

      if (loginSuccess) {
        console.log('✅ 登录成功！');
        console.log(`🔗 当前页面: ${currentUrl}`);
        console.log(`📝 页面标题: ${pageTitle}`);

        // 保存登录状态cookies
        const storageState = await context.storageState();
        const storagePath = path.join(recordDir, 'storage-state.json');
        fs.writeFileSync(storagePath, JSON.stringify(storageState, null, 2));
        console.log(`💾 登录状态已保存到: ${storagePath}`);

        // 等待视频写入完成
        await context.close();
        await browser.close();

        // 重命名视频文件
        const tempVideo = fs.existsSync(path.join(videoPath, fs.readdirSync(videoPath)[0])) 
          ? path.join(videoPath, fs.readdirSync(videoPath)[0]) 
          : null;
        
        if (tempVideo && fs.existsSync(tempVideo)) {
          const finalVideoPath = path.join(recordDir, `attempt-${attempt}-${timestamp}-success.webm`);
          fs.renameSync(tempVideo, finalVideoPath);
          fs.rmdirSync(videoPath);
          console.log(`🎬 操作视频已保存到: ${finalVideoPath}`);
        }

        success = true;
        break;
      } else {
        throw new Error(`登录未成功，当前URL: ${currentUrl}，页面内容前200字: ${bodyText.substring(0, 200)}`);
      }

    } catch (error) {
      lastError = error;
      console.log(`❌ 第 ${attempt} 次尝试出错: ${error.message}`);
      
      // 尝试保存错误截图
      if (page) {
        try {
          const errorScreenshot = path.join(recordDir, `attempt-${attempt}-${timestamp}-error.png`);
          await page.screenshot({ path: errorScreenshot, fullPage: true });
          console.log(`📸 错误截图已保存到: ${errorScreenshot}`);
        } catch (e) {}
      }

      // 关闭浏览器保存视频
      if (context) {
        await context.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }

      // 重命名错误视频
      if (fs.existsSync(videoPath)) {
        const files = fs.readdirSync(videoPath);
        if (files.length > 0) {
          const tempVideo = path.join(videoPath, files[0]);
          if (fs.existsSync(tempVideo)) {
            const finalVideoPath = path.join(recordDir, `attempt-${attempt}-${timestamp}-failed.webm`);
            fs.renameSync(tempVideo, finalVideoPath);
            fs.rmdirSync(videoPath);
            console.log(`🎬 错误过程视频已保存到: ${finalVideoPath}`);
          }
        }
      }

      if (attempt < maxRetries) {
        const waitTime = 10 + attempt * 5; // 第一次10秒，第二次15秒
        console.log(`⏳ 等待 ${waitTime} 秒后进行第 ${attempt + 1} 次重试...`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  if (success) {
    console.log('🎉 所有操作完成！登录成功');
    process.exit(0);
  } else {
    console.log(`💔 登录失败，已重试 ${maxRetries} 次`);
    console.log(`最后错误: ${lastError?.message}`);
    console.log('请查看 recordings 目录下的视频和截图排查问题');
    process.exit(1);
  }
})();
