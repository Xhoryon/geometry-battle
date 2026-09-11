import { defineConfig } from '@playwright/test';

/**
 * 浏览器演练配置。
 *
 * 单 worker、不并发：演练会真的起一个比赛服务、跑真的算法，
 * 并发跑没有意义（服务端本来也一次只持有一场比赛）。
 *
 * 超时给到 15 分钟：一场比赛最长可以是 60 轮，每轮都要起两个沙箱。
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60 * 1000,
  expect: { timeout: 60 * 1000 },
  reporter: [['list']],
  use: {
    // 优先用**系统已装的 Google Chrome**：这台机器上装的是它，
    // 而 Playwright 自带的 Chromium 版本随包升级会要求重新下载（几百 MB）。
    // 若要改用自带内核，删掉 channel 后跑一次 `npx playwright install chromium`。
    channel: 'chrome',
    // 失败时留一张截图 —— 现场问题大多一眼能看出来
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
});
