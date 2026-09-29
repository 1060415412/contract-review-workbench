'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

/** 读取 .env（进程环境变量优先级更高），密钥只在本机，不上页面、不进仓库 */
function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function getConfig() {
  loadEnv();
  return {
    llm: {
      baseUrl: (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
      apiKey: (process.env.LLM_API_KEY || '').trim(),
      model: (process.env.LLM_MODEL || 'deepseek-chat').trim(),
      temperature: Number(process.env.LLM_TEMPERATURE || 0.5),
      maxTokens: Number(process.env.LLM_MAX_TOKENS || 4096),
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 180000),
    },
    enterprise: {
      url: (process.env.ENTERPRISE_API_URL || '').trim(),
      token: (process.env.ENTERPRISE_API_TOKEN || '').trim(),
    },
    report: {
      webhook: (process.env.REPORT_WEBHOOK_URL || '').trim(),
    },
  };
}

function mask(value) {
  const v = String(value || '');
  if (!v) return '';
  if (v.length <= 10) return '***';
  return v.slice(0, 4) + '*'.repeat(Math.min(10, v.length - 8)) + v.slice(-4);
}

/** 写入 .env：只覆盖给定键，其余保持原样 */
async function saveEnv(updates) {
  const existing = [];
  const seen = new Set();
  if (fs.existsSync(ENV_PATH)) {
    const text = fs.readFileSync(ENV_PATH, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const idx = line.indexOf('=');
      const key = idx > 0 ? line.slice(0, idx).trim() : '';
      if (key && Object.prototype.hasOwnProperty.call(updates, key)) {
        existing.push(`${key}=${updates[key]}`);
        seen.add(key);
      } else {
        existing.push(line);
      }
    }
  }
  for (const key of Object.keys(updates)) {
    if (!seen.has(key)) existing.push(`${key}=${updates[key]}`);
  }
  await fsp.writeFile(
    ENV_PATH,
    `# 本地配置（保存在本机，未提交到代码仓库，请勿外传）\n# 更新时间：${new Date().toISOString()}\n${existing.join('\n')}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  loadEnv();
}

module.exports = { ROOT, ENV_PATH, getConfig, loadEnv, saveEnv, mask };
