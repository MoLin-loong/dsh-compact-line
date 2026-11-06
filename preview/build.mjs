import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/Software/workspace/dsh-compact-line';
const OUT = path.join(ROOT, 'preview');

/** 在 Node 里求值 client.js 的 CSS 数组，拿运行时真值。
 *  不能正则解析 —— 源码里的 \" 转义会被提前截断，
 *  抽出来的规则残缺，后续 CSS 全部失效（踩过一次）。 */
function extractCss() {
  const src = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8');
  const start = src.indexOf('const CSS = [');
  const end = src.indexOf('].join("")', start);
  if (start < 0 || end < 0) throw new Error('未找到 CSS 块');
  const block = src.slice(start, end + '].join("")'.length);
  return new Function('return ' + block.replace(/^const CSS = /, ''))();
}

const TOKENS = `
:root{
  --dsw-alias-label-primary:#e8e8ea;
  --dsw-alias-label-secondary:#b8b8bd;
  --dsw-alias-label-tertiary:#8a8a92;
  --dsw-alias-label-primary-inverted:#16161a;
  --dsw-alias-border-l1:rgba(255,255,255,.18);
  --dsw-alias-border-l2:rgba(255,255,255,.14);
  --dsw-alias-interactive-bg-hover:rgba(255,255,255,.09);
  --dsw-alias-button-primary-fill:#e8e8ea;
  --dsw-alias-button-primary-hover:#f5f5f7;
  --dsw-alias-state-error-primary:#ff6b6b;
  --dsw-alias-state-success-primary:#4ade80;
  --dsw-specific-menu:rgba(28,28,32,.94);
  --dsw-menu-backdrop-filter:blur(24px);
  --dsw-elevation-prominent:0 12px 32px rgba(0,0,0,.5);
  --dsw-elevation-stroke-color:rgba(255,255,255,.18);
  --dsw-radius-sm:6px;
  --dsw-radius-lg:12px;
  --dsh-content-font-size-secondary:13px;
  --dsh-content-font-delta-secondary:0px;
}
body{margin:0;padding:28px 24px;min-height:100vh;
  background:linear-gradient(135deg,#2a2f3a,#1b1f26 55%,#242a35);
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#e8e8ea}
.stage{display:flex;flex-direction:column;gap:26px;align-items:flex-start}
.label{font-size:11px;color:#7a7a85;letter-spacing:.04em;margin-bottom:-16px}
`;

/* 覆盖块必须放在抽取 CSS 之后：同优先级下后写的赢。
   真实环境里弹层是 absolute，预览里改成 relative 才好并排展示。 */
const OVERRIDES = `
.dcl-anchor{position:static}
.dcl-pop{position:relative;bottom:auto;left:auto}
`;

const form = (value, msg) => `
  <div class="dcl-root">
    <div class="dcl-row">
      <input class="dcl-input" type="number" value="${value}">
      <span class="dcl-unit">tokens</span>
    </div>
    <div class="dcl-row">
      <button class="dcl-btn dcl-btn-primary" type="button">应用</button>
      <button class="dcl-btn dcl-btn-ghost" type="button">刷新</button>
      <button class="dcl-btn dcl-btn-ghost" type="button">恢复默认</button>
    </div>
    <div class="dcl-note">压完保留这条线的一半</div>
    ${msg}
  </div>`;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>dsh-compact-line 预览</title>
<style>${TOKENS}</style>
<style>${extractCss()}</style>
<style>${OVERRIDES}</style>
</head><body>
<div class="stage">

  <div class="label">读数胶囊</div>
  <div class="dcl-anchor">
    <button class="dcl-pill" type="button">压缩线 17万</button>
  </div>

  <div class="label">弹层 · 正常</div>
  <div class="dcl-pop">
    ${form('170000', '<div class="dcl-ok">已写入 standard、ptc，压缩线 170000</div>')}
  </div>

  <div class="label">弹层 · 报错</div>
  <div class="dcl-pop">
    ${form('100000', '<div class="dcl-error">压缩线至少要 131072</div>')}
  </div>

  <div class="label">设置页卡片</div>
  <div class="dcl-root" style="width:max-content;padding:12px;background:rgba(28,28,32,.94);border-radius:12px">
    <div class="dcl-row">
      <input class="dcl-input" type="number" value="170000">
      <span class="dcl-unit">tokens</span>
    </div>
    <div class="dcl-row">
      <button class="dcl-btn dcl-btn-primary" type="button">应用</button>
      <button class="dcl-btn dcl-btn-ghost" type="button">刷新</button>
      <button class="dcl-btn dcl-btn-ghost" type="button">恢复默认</button>
    </div>
    <div class="dcl-note">压完保留这条线的一半</div>
    <table class="dcl-table">
      <thead><tr><th>预设</th><th>压缩线</th></tr></thead>
      <tbody>
        <tr><td>standard</td><td class="dcl-num">170,000</td></tr>
        <tr><td>ptc</td><td class="dcl-num">170,000</td></tr>
        <tr><td>minimal</td><td class="dcl-num">170,000</td></tr>
        <tr><td>cordis</td><td class="dcl-num">170,000</td></tr>
      </tbody>
    </table>
  </div>

</div>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
console.log('预览页已生成（CSS 来自运行时求值）');
