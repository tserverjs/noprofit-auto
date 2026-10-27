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

      // 浏览器启动 - 三级方案，逐级回退：
      // 1. cloakbrowser（stealth Chromium，Playwright 兼容）
      // 2. camoufox-js / Camoufox（stealth Firefox，Playwright 原生驱动）
      // 3. 标准 Playwright Chromium + 反检测注入（最后兜底）
      // 注意：cloakbrowser 和 camoufox-js 都是 ESM 包，CJS 里必须用动态 import()
      console.log('🌐 正在启动浏览器（cloakbrowser → Camoufox → 标准 Playwright）...');
      let useCloak = false;
      let useCamoufox = false;
      try {
        const { launchContext } = await import('cloakbrowser');
        context = await launchContext({
          proxy: proxyServer, // 支持 socks5:// 字符串
          viewport: { width: 1920, height: 1080 },
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          headless: true,
          // CI 容器环境必需；stealth 参数由 cloakbrowser 自带
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
          contextOptions: {
            recordVideo: { dir: videoPath, size: { width: 1920, height: 1080 } },
            ignoreHTTPSErrors: true,
            bypassCSP: true
          }
        });
        browser = context.browser();
        useCloak = true;
        console.log('✅ 已使用 cloakbrowser（stealth Chromium）启动，代理:', proxyServer || '无');
      } catch (e) {
        console.log(`⚠️  cloakbrowser 不可用或启动失败（${e.message}），尝试 Camoufox...`);
      }

      if (!useCloak) {
        try {
          // Camoufox：stealth Firefox，指纹/UA/locale 随机生成并全程一致
          // 首次启动会自动下载 Camoufox 浏览器构建（约百兆级，缓存在 ~/.cache/camoufox）
          const { Camoufox } = await import('camoufox-js');
          let camBrowser;
          try {
            camBrowser = await Camoufox({
              proxy: proxyServer, // string 形式支持 socks5://
              headless: true,
              locale: 'en-US',
              humanize: true // 内置拟人化鼠标/键盘，配合 Turnstile 行为检测
            });
            context = await camBrowser.newContext({
              viewport: { width: 1920, height: 1080 },
              ignoreHTTPSErrors: true,
              recordVideo: { dir: videoPath, size: { width: 1920, height: 1080 } }
            });
            browser = camBrowser;
            useCamoufox = true;
            console.log('✅ 已使用 Camoufox（stealth Firefox）启动，代理:', proxyServer || '无');
          } catch (innerErr) {
            await camBrowser?.close?.().catch(() => {});
            throw innerErr;
          }
        } catch (e) {
          console.log(`⚠️  Camoufox 不可用或启动失败（${e.message}），回退到标准 Playwright Chromium...`);
        }
      }

      if (!useCloak && !useCamoufox) {
        if (proxyServer) {
          console.log('🔌 代理已启用，所有流量将通过代理转发');
        }
        // 标准 Playwright 启动参数 - 针对 CI + Cloudflare 优化
        const launchOptions = {
          headless: true,
          args: ['--no-sandbox', '--disable-dev-shm-usage']
        };
        if (proxyServer) {
          launchOptions.proxy = { server: proxyServer };
        }
        browser = await chromium.launch(launchOptions);
        context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          recordVideo: { dir: videoPath, size: { width: 1920, height: 1080 } },
          ignoreHTTPSErrors: true,
          bypassCSP: true
        });
      }

      // 仅标准 Playwright 需要注入反检测脚本；
      // cloakbrowser / Camoufox 已在浏览器层处理，额外 CDP 注入反而可能被检测
      if (!useCloak && !useCamoufox) {
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
      }

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

      // 勾选 "I agree" 复选框（必须勾选）
      // 页面结构里该复选框通过 label 文本（"I agree to the ..."）关联，name 属性不可靠
      // 做法：遍历页面上所有 checkbox，读取其关联的 label 文本 / aria-label / name，
      // 命中 agree / terms / tos 关键词的就勾选
      console.log('☑️  查找并勾选 "I agree" 复选框...');
      let agreeChecked = false;
      const allCheckboxes = page.locator('input[type="checkbox"]');
      const cbCount = await allCheckboxes.count();
      for (let i = 0; i < cbCount; i++) {
        const cb = allCheckboxes.nth(i);
        if (!await cb.isVisible()) continue;
        const relatedText = await cb.evaluate(el => {
          const closestLabel = el.closest('label')?.textContent?.trim() || '';
          const forLabel = el.id
            ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() || ''
            : '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          return `${forLabel} ${closestLabel} ${ariaLabel} ${el.name || ''}`;
        });
        if (/i agree|agree to|terms|tos/i.test(relatedText)) {
          if (!await cb.isChecked()) {
            console.log(`   找到同意条款复选框（关联文本: ${relatedText.trim().slice(0, 60)}），正在勾选...`);
            await cb.click();
          } else {
            console.log('   同意条款复选框已处于勾选状态');
          }
          agreeChecked = true;
          break;
        }
      }
      if (!agreeChecked) {
        // 兜底：部分实现用隐藏的受控 checkbox + 可见的 label 切换样式
        const fallback = page.locator('label:has-text("I agree")').first();
        if (await fallback.count() > 0) {
          console.log('   通过 label 文本直接点击 "I agree" 区域...');
          await fallback.click();
          agreeChecked = true;
        }
      }
      if (agreeChecked) {
        await page.waitForTimeout(500 + Math.random() * 500);
      } else {
        console.log('⚠️  未找到 "I agree" 复选框，继续执行（可能是注册流程专属）');
      }

      // 处理Cloudflare Turnstile验证（如果出现在表单里）
      const hasTurnstile = await page.$('iframe[src*="challenges.cloudflare.com"], .cf-turnstile');
      if (hasTurnstile) {
        console.log('🛡️  检测到表单中的Turnstile验证...');

        const isTurnstileDone = () => page.evaluate(() => {
          // 判定条件（任一成立）：
          // 1. 隐藏字段 cf-turnstile-response 已写入 token（最可靠）
          const resp = document.querySelector('input[name="cf-turnstile-response"]');
          if (resp && resp.value && resp.value.length > 0) return true;
          // 2. 所有 Turnstile 容器进入完成/成功状态
          const wrappers = document.querySelectorAll('.cf-turnstile');
          if (wrappers.length === 0) return true;
          return Array.from(wrappers).every(el =>
            el.classList.contains('cf-turnstile-completed') ||
            el.classList.contains('cf-turnstile-success'));
        });

        // 策略1: 直接点击 iframe 内的复选框
        let clicked = false;
        const turnstileFrames = page.locator('iframe[src*="challenges.cloudflare.com"]');
        const frameCount = await turnstileFrames.count();
        for (let i = 0; i < frameCount; i++) {
          const frame = turnstileFrames.nth(i).contentFrame();
          if (!frame) {
            console.log(`⚠️  Turnstile iframe #${i + 1} 无法获取 frame 内容`);
            continue;
          }
          console.log(`🔍 Turnstile iframe #${i + 1} 地址: ${frame.url()}`);
          const selectors = ['.ctp-checkbox-label', 'input[type="checkbox"]', 'label'];
          for (const sel of selectors) {
            const box = frame.locator(sel).first();
            if (await box.count() > 0) {
              console.log(`🔘 尝试点击Turnstile验证框（iframe #${i + 1}, 选择器: ${sel}）...`);
              await box.click({ timeout: 15000 }).catch(() => {
                console.log(`⚠️  点击 ${sel} 失败`);
              });
              clicked = true;
              break;
            }
          }
          if (clicked) break;
        }
        if (!clicked) {
          console.log('⚠️  未能直接点击iframe内验证框，改用键盘方式触发...');
        }

        // 等待 15 秒看是否完成
        let done = false;
        for (let i = 0; i < 15; i++) {
          if (await isTurnstileDone()) { done = true; break; }
          await page.waitForTimeout(1000);
        }

        // 策略2: 键盘方式触发（iframe 点击失效时的备用方案）
        if (!done) {
          console.log('⌨️  键盘触发Turnstile: 回车 ×2 → 空格 ×1 ...');
          // 先把焦点放回 "I agree" 复选框，再按序按键
          const legalCheck = page.locator('input[type="checkbox"][name*="legal"], input[type="checkbox"][name*="acceptan"]').first();
          if (await legalCheck.count() > 0) {
            await legalCheck.focus().catch(() => {});
          } else {
            const cfWidget = page.locator('.cf-turnstile').first();
            if (await cfWidget.count() > 0) await cfWidget.click({ force: true }).catch(() => {});
          }
          await page.waitForTimeout(500);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(700 + Math.random() * 500);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(700 + Math.random() * 500);
          await page.keyboard.press('Space');

          for (let i = 0; i < 45; i++) {
            if (await isTurnstileDone()) { done = true; break; }
            await page.waitForTimeout(1000);
          }
        }

        // 策略3: 键盘没生效时，把焦点直接放进 Turnstile 容器再按键
        if (!done) {
          console.log('⌨️  将焦点置于Turnstile容器后重试: 空格 / 回车...');
          const cfWidget = page.locator('.cf-turnstile').first();
          if (await cfWidget.count() > 0) {
            await cfWidget.click({ force: true }).catch(() => {});
            await page.waitForTimeout(500);
            for (const key of ['Space', 'Enter']) {
              await page.keyboard.press(key);
              for (let i = 0; i < 30; i++) {
                if (await isTurnstileDone()) { done = true; break; }
                await page.waitForTimeout(1000);
              }
              if (done) break;
            }
          }
        }

        if (done) {
          console.log('✅ Turnstile 验证已完成');
        } else {
          // 诊断信息：方便下次从 CI 日志定位问题
          const tokenLen = await page.evaluate(() =>
            (document.querySelector('input[name="cf-turnstile-response"]')?.value || '').length);
          const cls = await page.evaluate(() =>
            Array.from(document.querySelectorAll('.cf-turnstile'))
              .map(el => el.className).join(' | '));
          console.log(`⚠️  Turnstile验证未完成（token长度: ${tokenLen}, 容器类名: ${cls || '无'}）`);
        }
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
