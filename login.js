const { Camoufox } = require('camoufox-js');
const fs = require('fs');
const path = require('path');

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
  console.log('  noprofit.space 自动登录脚本（Camoufox反检测版）');
  console.log('═══════════════════════════════════════════════');
  console.log('🦊 使用 Camoufox C++级反检测引擎，自动绕过Cloudflare');
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
    const videoDir = path.join(recordDir, `video-${attempt}-${timestamp}`);
    let browser;
    let context;
    let page;

    try {
      console.log(`\n🚀 开始第 ${attempt} 次登录尝试...`);

      if (!fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
      }

      // Camoufox 启动参数（参考官方API：camoufox-js完全兼容playwright firefox launch参数）
      const camoufoxOptions = {
        headless: true,
        humanize: true, // 启用真人行为模拟：鼠标移动、输入延迟等
        geoip: true,
        // Firefox 首选项
        firefox_user_prefs: {
          // 禁用自动更新和后台请求
          'app.update.auto': false,
          'app.update.enabled': false,
          'browser.safebrowsing.enabled': false,
          'dom.webnotifications.enabled': false,
          'media.navigator.permission.disabled': true,
        },
      };

      // 配置代理（支持socks5/http/https）
      if (proxyServer) {
        console.log('🔌 代理已启用，所有流量将通过Camoufox内置代理转发');
        const proxyUrl = new URL(proxyServer);
        camoufoxOptions.proxy = {
          server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
        };
        if (proxyUrl.username) {
          camoufoxOptions.proxy.username = decodeURIComponent(proxyUrl.username);
        }
        if (proxyUrl.password) {
          camoufoxOptions.proxy.password = decodeURIComponent(proxyUrl.password);
        }
      }

      // 启动Camoufox反检测浏览器
      console.log('🦊 启动Camoufox反检测浏览器...');
      browser = await Camoufox(camoufoxOptions);

      // 创建上下文，开启视频录制
      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true,
        locale: 'en-US', // noprofit是英文网站，用英文locale更真实
        timezoneId: 'UTC', // 代理是海外IP时用UTC时区，保持指纹一致
        recordVideo: {
          dir: videoDir,
          size: { width: 1920, height: 1080 }
        }
      });

      page = await context.newPage();

      // 监听控制台错误（仅记录，不中断）
      page.on('console', msg => {
        const type = msg.type();
        if (type === 'error') {
          const text = msg.text();
          // 过滤无关错误
          if (!text.includes('font-size') && !text.includes('data:,')) {
            console.log(`[浏览器控制台] ${type}: ${text.substring(0, 150)}`);
          }
        }
      });

      page.on('pageerror', error => {
        console.log(`[页面错误] ${error.message.substring(0, 200)}`);
      });

      // 打开登录页面
      console.log('📄 正在打开登录页面...');
      await page.goto('https://accounts.noprofit.space/login', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });

      // 等待页面渲染
      console.log('⏳ 等待页面加载完成...');
      await page.waitForTimeout(5000);

      // 保存登录页面截图
      const loginPageScreenshot = path.join(recordDir, `attempt-${attempt}-${timestamp}-login-page.png`);
      await page.screenshot({ path: loginPageScreenshot, fullPage: true });
      console.log(`📸 登录页截图已保存: ${loginPageScreenshot}`);

      // 检测是否有Cloudflare验证，Camoufox会自动处理大部分隐形验证，这里只等待
      const hasCloudflare = await page.evaluate(() => {
        return document.title.includes('Just a moment') || 
               document.querySelector('iframe[src*="challenges.cloudflare.com"]') !== null ||
               document.body.innerText.includes('Checking your browser');
      });

      if (hasCloudflare) {
        console.log('🛡️  检测到Cloudflare验证，Camoufox正在自动处理（最长120秒）...');
        await page.waitForFunction(() => {
          return !document.title.includes('Just a moment') && 
                 !document.body.innerText.includes('Checking your browser') &&
                 document.querySelector('input[type="email"], input[name="username"], input[type="password"]') !== null;
        }, { timeout: 120000 }).catch(e => {
          console.log('⚠️  Cloudflare验证等待超时，继续执行...');
        });
        await page.waitForTimeout(3000);
      }

      // 等待登录表单加载
      console.log('👀 等待登录表单加载...');
      await page.waitForSelector('input[type="email"], input[name="username"], input[type="password"]', {
        timeout: 60000,
        state: 'visible'
      });
      console.log('✅ 登录表单已加载完成');
      await page.waitForTimeout(2000);

      // 定位用户名和密码输入框
      const usernameInput = await page.$('input[type="email"]') || 
                           await page.$('input[name="username"]') || 
                           await page.$('input[type="text"]');
      const passwordInput = await page.$('input[type="password"]');

      if (!usernameInput || !passwordInput) {
        throw new Error('找不到用户名或密码输入框，请检查页面结构');
      }

      // 模拟真人输入（Camoufox内置humanize，这里补充字符级延迟更真实）
      console.log('⌨️  正在输入用户名...');
      await usernameInput.click({ delay: 100 + Math.random() * 200 });
      await usernameInput.fill('');
      for (const char of username) {
        await usernameInput.type(char, { delay: 60 + Math.random() * 120 });
      }
      await page.waitForTimeout(500 + Math.random() * 1000);

      console.log('🔑 正在输入密码...');
      await passwordInput.click({ delay: 100 + Math.random() * 200 });
      await passwordInput.fill('');
      for (const char of password) {
        await passwordInput.type(char, { delay: 60 + Math.random() * 120 });
      }
      await page.waitForTimeout(800 + Math.random() * 1500);

      // 勾选"I agree to the..."同意条款复选框
      console.log('☑️  正在查找并勾选同意服务条款复选框...');
      let agreeCheckbox = null;
      let agreeLabel = null;
      try {
        agreeLabel = page.locator('label').filter({ hasText: /I agree to|terms of service|Terms/i }).first();
        if (await agreeLabel.count() > 0) {
          const checkboxId = await agreeLabel.getAttribute('for');
          if (checkboxId) {
            agreeCheckbox = await page.$(`#${checkboxId}`);
          }
          if (!agreeCheckbox) {
            agreeCheckbox = agreeLabel.locator('input[type="checkbox"]').first();
          }
        }
      } catch (e) {}

      // 兜底查找
      if (!agreeCheckbox || !(await agreeCheckbox.count())) {
        const allCheckboxes = await page.$$('input[type="checkbox"]');
        for (const cb of allCheckboxes) {
          const name = await cb.getAttribute('name') || '';
          const id = await cb.getAttribute('id') || '';
          const parentText = await cb.evaluate(el => el.closest('label')?.innerText || el.parentElement?.innerText || '');
          if (!name.includes('remember') && 
              !id.includes('remember') &&
              !parentText.includes("I'm not a robot") &&
              !parentText.includes('Turnstile')) {
            agreeCheckbox = cb;
            break;
          }
        }
      }

      if (agreeCheckbox) {
        try {
          const isChecked = await agreeCheckbox.isChecked().catch(() => false);
          if (!isChecked) {
            if (agreeLabel && await agreeLabel.count()) {
              await agreeLabel.click({ delay: 200 + Math.random() * 300, force: true });
            } else {
              await agreeCheckbox.click({ delay: 200 + Math.random() * 300, force: true });
            }
            console.log('✅ 同意条款复选框已勾选');
          } else {
            console.log('ℹ️  同意条款复选框默认已勾选');
          }
        } catch (e) {
          console.log('⚠️  勾选同意条款失败:', e.message);
        }
      } else {
        console.log('ℹ️  未找到同意条款复选框，跳过');
      }
      await page.waitForTimeout(500 + Math.random() * 1000);

      // 处理Turnstile验证 - Camoufox通常自动通过，这里处理需要点击的情况
      console.log('🛡️  检测Turnstile验证状态...');
      try {
        const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]').first();
        const checkbox = turnstileFrame.locator('.ctp-checkbox-label, input[type="checkbox"]');
        if (await checkbox.count() > 0 && await checkbox.isVisible().catch(() => false)) {
          console.log('🔘 找到Turnstile验证复选框，正在点击...');
          await checkbox.click({ delay: 300 + Math.random() * 400, force: true });
          console.log('⏳ 等待Turnstile验证完成...');
        }
      } catch (e) {}

      // 等待Turnstile验证完成
      await page.waitForFunction(() => {
        const responseInput = document.querySelector('[name="cf-turnstile-response"]');
        if (responseInput && responseInput.value && responseInput.value.length > 20) return true;
        const turnstile = document.querySelector('.cf-turnstile');
        if (turnstile && turnstile.getAttribute('data-state') === 'verified') return true;
        // 如果没有turnstile元素了说明验证完成
        return !document.querySelector('.cf-turnstile') && !document.querySelector('iframe[src*="challenges.cloudflare.com"]');
      }, { timeout: 90000 }).catch(() => {
        console.log('⚠️  Turnstile验证等待超时，尝试继续登录...');
      });
      await page.waitForTimeout(2000 + Math.random() * 2000);

      // 点击登录按钮
      console.log('🖱️  点击登录按钮...');
      const loginButton = await page.$('button[type="submit"]') || 
                         await page.getByRole('button', { name: /sign in|log in|登录/i }).first() ||
                         await page.$('input[type="submit"]');
      
      if (!loginButton) {
        throw new Error('找不到登录按钮');
      }

      await loginButton.click({ delay: 200 + Math.random() * 300 });

      // 等待登录跳转
      console.log('⏳ 等待登录完成...');
      try {
        await page.waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
      } catch (e) {
        console.log('⚠️  导航等待超时，检查当前页面状态...');
      }
      await page.waitForTimeout(5000);

      // 检查登录后是否还有Cloudflare验证
      const postCloudflare = await page.evaluate(() => {
        return document.title.includes('Just a moment') || 
               document.body.innerText.includes('Checking your browser');
      });
      if (postCloudflare) {
        console.log('🛡️  登录后仍有Cloudflare验证，继续等待...');
        await page.waitForFunction(() => {
          return !document.title.includes('Just a moment') && 
                 !document.body.innerText.includes('Checking your browser');
        }, { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(3000);
      }

      // 判断登录结果
      const currentUrl = page.url();
      const pageTitle = await page.title();
      const bodyText = await page.evaluate(() => document.body.innerText);
      
      // 提取错误信息
      const errorMsg = await page.evaluate(() => {
        const errorEls = document.querySelectorAll('.error, .alert-error, [role="alert"], .text-red-500, .text-danger, .form-error, [class*="error"]');
        let msg = [];
        errorEls.forEach(el => {
          const t = el.innerText.trim();
          if (t && t.length < 200) msg.push(t);
        });
        const body = document.body.innerText.toLowerCase();
        if (body.includes('invalid password') || body.includes('密码错误') || body.includes('incorrect password')) {
          msg.push('账号或密码错误');
        }
        if (body.includes('please complete the captcha') || body.includes('captcha failed') || body.includes('verification failed')) {
          msg.push('人机验证未通过');
        }
        if (body.includes('please agree to the terms') || body.includes('agree to the terms')) {
          msg.push('未同意服务条款');
        }
        return [...new Set(msg)].join('; ');
      });
      
      const loginSuccess = !currentUrl.includes('/login') || 
                           bodyText.includes('Dashboard') || 
                           bodyText.includes('控制台') ||
                           bodyText.includes('My Account') ||
                           bodyText.includes('我的账户') ||
                           bodyText.includes('Logout') ||
                           bodyText.includes('Sign out') ||
                           bodyText.includes('退出登录');

      // 获取视频文件路径
      const video = page.video();
      const videoTempPath = video ? await video.path() : null;

      // 保存截图
      const afterLoginScreenshot = path.join(recordDir, `attempt-${attempt}-${timestamp}-${loginSuccess ? 'success' : 'failed'}.png`);
      await page.screenshot({ path: afterLoginScreenshot, fullPage: true });
      console.log(`📸 登录后截图已保存: ${afterLoginScreenshot}`);

      if (loginSuccess) {
        console.log('✅ 登录成功！');
        console.log(`🔗 当前页面: ${currentUrl}`);
        console.log(`📝 页面标题: ${pageTitle}`);

        // 保存登录状态
        const storageState = await context.storageState();
        const storagePath = path.join(recordDir, 'storage-state.json');
        fs.writeFileSync(storagePath, JSON.stringify(storageState, null, 2));
        console.log(`💾 登录状态已保存到: ${storagePath}`);

        // 关闭浏览器保存视频
        await context.close();
        await browser.close();

        // 移动视频文件
        await new Promise(resolve => setTimeout(resolve, 1000)); // 等待文件写入
        if (videoTempPath && fs.existsSync(videoTempPath)) {
          const finalVideoPath = path.join(recordDir, `attempt-${attempt}-${timestamp}-success.webm`);
          fs.renameSync(videoTempPath, finalVideoPath);
          console.log(`🎬 操作视频已保存到: ${finalVideoPath}`);
        } else if (fs.existsSync(videoDir)) {
          const files = fs.readdirSync(videoDir);
          for (const f of files) {
            if (f.endsWith('.webm')) {
              const finalVideoPath = path.join(recordDir, `attempt-${attempt}-${timestamp}-success.webm`);
              fs.renameSync(path.join(videoDir, f), finalVideoPath);
              console.log(`🎬 操作视频已保存到: ${finalVideoPath}`);
              break;
            }
          }
        }
        // 清理临时目录
        try { fs.rmSync(videoDir, { recursive: true, force: true }); } catch (e) {}

        success = true;
        break;
      } else {
        let errMsg = `登录未成功，当前URL: ${currentUrl}`;
        if (errorMsg) {
          errMsg += `，错误提示: ${errorMsg}`;
        } else {
          errMsg += `，页面内容前200字: ${bodyText.substring(0, 200)}`;
        }
        throw new Error(errMsg);
      }

    } catch (error) {
      lastError = error;
      console.log(`❌ 第 ${attempt} 次尝试出错: ${error.message}`);
      
      // 获取视频路径
      let videoTempPath = null;
      try {
        if (page && page.video()) {
          videoTempPath = await page.video().path();
        }
      } catch (e) {}

      // 保存错误截图
      if (page) {
        try {
          const errorScreenshot = path.join(recordDir, `attempt-${attempt}-${timestamp}-error.png`);
          await page.screenshot({ path: errorScreenshot, fullPage: true });
          console.log(`📸 错误截图已保存到: ${errorScreenshot}`);
        } catch (e) {}
      }

      // 关闭浏览器
      if (context) {
        await context.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }

      // 移动错误视频
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (videoTempPath && fs.existsSync(videoTempPath)) {
        const finalVideoPath = path.join(recordDir, `attempt-${attempt}-${timestamp}-failed.webm`);
        fs.renameSync(videoTempPath, finalVideoPath);
        console.log(`🎬 错误过程视频已保存到: ${finalVideoPath}`);
      } else if (fs.existsSync(videoDir)) {
        const files = fs.readdirSync(videoDir);
        for (const f of files) {
          if (f.endsWith('.webm')) {
            const finalVideoPath = path.join(recordDir, `attempt-${attempt}-${timestamp}-failed.webm`);
            fs.renameSync(path.join(videoDir, f), finalVideoPath);
            console.log(`🎬 错误过程视频已保存到: ${finalVideoPath}`);
            break;
          }
        }
      }
      // 清理临时目录
      try { fs.rmSync(videoDir, { recursive: true, force: true }); } catch (e) {}

      if (attempt < maxRetries) {
        const waitTime = 10 + attempt * 5;
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
