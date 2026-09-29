/**
 * 合同审查工作台 - 本地服务端（零第三方依赖，Node 18+）
 *
 * 职责：
 * 1. 托管 public/ 静态页面与生成的审查报告
 * 2. 保存大模型接口配置（仅服务端可读的 .env，不返回给浏览器）
 * 3. 按工作流节点顺序本地编排：提取文本 → LLM 解析标题/合作方 → 企业信息 → LLM 审查 → 生成报告
 *
 * 启动：node server.js      浏览器打开 http://127.0.0.1:5173
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const { getConfig, saveEnv, mask, ROOT } = require('./src/config');
const { runReview, isLLMConfigured } = require('./src/pipeline');
const { LLMError } = require('./src/llm');
const { ExtractError } = require('./src/extract');

const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 5173);
// 默认监听所有网卡，否则局域网/手机访问会被直接拒绝（想只限本机用 HOST=127.0.0.1 启动）
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 80 * 1024 * 1024;
const MAX_FILE = 10 * 1024 * 1024;
const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.txt', '.md', '.markdown'];

// ---------------------------------------------------------------- 工具

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- 接口

async function handleReview(res, body) {
  const payload = body || {};
  const hasFile = Boolean(payload.fileBase64);
  const hasText = Boolean(payload.text && payload.text.trim());
  if (!hasFile && !hasText) {
    return sendJson(res, 400, { error: '请上传合同文件或粘贴合同文本后再开始审查。' });
  }

  let fileName = String(payload.fileName || '').trim();
  let buffer;
  if (hasFile) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext && ALLOWED_EXT.indexOf(ext) === -1) {
      return sendJson(res, 400, { error: `不支持的文件格式：${ext}，请上传 PDF、Word、TXT 或 MD 文件。` });
    }
    buffer = Buffer.from(payload.fileBase64, 'base64');
    if (buffer.length > MAX_FILE) return sendJson(res, 400, { error: '单个文件大小不能超过 10MB。' });
    if (!fileName) fileName = 'contract.txt';
  } else {
    fileName = 'contract.txt';
    buffer = Buffer.from(payload.text, 'utf8');
    payload.fileName = '';
  }

  try {
    const result = await runReview({
      buffer,
      fileName,
      contractType: payload.contractType,
      stance: payload.stance,
      focuses: payload.focuses,
      extra: payload.extra,
      forceDemo: Boolean(payload.forceDemo),
    });
    if (result.mode === 'demo') {
      result.notice = payload.forceDemo
        ? '已按演示数据生成结果。'
        : '未配置大模型接口，已返回演示结果。';
    }
    return sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof ExtractError) return sendJson(res, 400, { error: err.message });
    if (err instanceof LLMError) return sendJson(res, 502, { error: err.message, retryable: true });
    return sendJson(res, 500, { error: `审查失败：${err.message}`, retryable: true });
  }
}

// ---------------------------------------------------------------- 静态资源

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) throw new Error('is dir');
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('资源不存在');
  }
}

// ---------------------------------------------------------------- 服务

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  if (req.method === 'GET' && url.startsWith('/api/status')) {
    const cfg = getConfig();
    return sendJson(res, 200, {
      configured: isLLMConfigured(),
      model: cfg.llm.model,
      baseUrl: cfg.llm.baseUrl,
      apiKeyMasked: mask(cfg.llm.apiKey),
      enterpriseConfigured: Boolean(cfg.enterprise.url),
      reportWebhook: Boolean(cfg.report.webhook),
    });
  }

  if (req.method === 'POST' && url.startsWith('/api/config')) {
    // 密钥写入接口只允许本机调用（服务监听 0.0.0.0 时防止局域网内被改配置）
    const remote = String(req.socket.remoteAddress || '').replace('::ffff:', '');
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      return sendJson(res, 403, { error: '接口配置仅允许在本机（127.0.0.1）访问。' });
    }
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const updates = {};
      if (body.baseUrl) updates.LLM_BASE_URL = String(body.baseUrl).trim();
      if (body.apiKey) updates.LLM_API_KEY = String(body.apiKey).trim();
      if (body.model) updates.LLM_MODEL = String(body.model).trim();
      if (body.enterpriseUrl) updates.ENTERPRISE_API_URL = String(body.enterpriseUrl).trim();
      if (body.webhook) updates.REPORT_WEBHOOK_URL = String(body.webhook).trim();
      await saveEnv(updates);
      const cfg = getConfig();
      return sendJson(res, 200, {
        ok: true,
        configured: isLLMConfigured(),
        model: cfg.llm.model,
        apiKeyMasked: mask(cfg.llm.apiKey),
      });
    } catch (e) {
      return sendJson(res, 500, { error: `保存配置失败：${e.message}` });
    }
  }

  if (req.method === 'POST' && url.startsWith('/api/review')) {
    try {
      return await handleReview(res, JSON.parse((await readBody(req)).toString('utf8')));
    } catch (e) {
      if (e instanceof SyntaxError) return sendJson(res, 400, { error: '请求格式有误，请重试。' });
      return sendJson(res, 500, { error: `服务端处理失败：${e.message}`, retryable: true });
    }
  }

  if (req.method === 'GET') return serveStatic(res, url);

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Method Not Allowed');
});

if (require.main === module) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  端口 ${PORT} 已被占用：可能已有一个实例在运行，直接访问 http://127.0.0.1:${PORT} 即可；`);
      console.error(`  如需重启，先结束占用进程（netstat -ano | findstr :${PORT}），或用 PORT=5174 node server.js\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, HOST, () => {
    const cfg = getConfig();
    const ips = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
      }
    }
    console.log('');
    console.log('  合同审查工作台已启动');
    console.log(`  本机访问：   http://127.0.0.1:${PORT}`);
    if (ips.length) console.log(`  局域网访问： http://${ips[0]}:${PORT}（同一 WiFi 下的手机/电脑可用）`);
    console.log(`  大模型接口： ${isLLMConfigured() ? `已配置 ${cfg.llm.model} @ ${cfg.llm.baseUrl}（密钥 ${mask(cfg.llm.apiKey)}）` : '未配置，当前为演示模式'}`);
    console.log(`  企业数据源： ${cfg.enterprise.url ? '已配置' : '未配置（跳过，提示人工复核）'}`);
    console.log('  配置文件：   .env（已在 .gitignore 中，请勿外传）');
    console.log('');
  });
}

module.exports = { server };
