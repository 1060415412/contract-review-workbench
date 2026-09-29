'use strict';

/**
 * 审查报告（对应工作流「合同审查结果上传」节点）
 * 默认：生成本地 Markdown 报告，页面按钮可直接打开
 * 可选：配置 REPORT_WEBHOOK_URL 后，把报告同步推送到你自己的系统（如飞书机器人）
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { getConfig } = require('./config');

const REPORT_DIR = path.join(__dirname, '..', 'public', 'reports');

function safeName(title) {
  return String(title || '合同审查').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

async function createReport(title, markdown) {
  if (!fs.existsSync(REPORT_DIR)) await fsp.mkdir(REPORT_DIR, { recursive: true });
  const fileName = `report-${Date.now()}-${safeName(title)}.md`;
  await fsp.writeFile(path.join(REPORT_DIR, fileName), markdown, 'utf8');

  let pushed = false;
  const webhook = getConfig().report.webhook;
  if (webhook) {
    try {
      const resp = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: markdown }),
        signal: AbortSignal.timeout(15000),
      });
      pushed = resp.ok;
    } catch (e) {
      pushed = false; // 推送失败不影响主流程
    }
  }

  return { url: `/reports/${encodeURIComponent(fileName)}`, fileName, pushed };
}

module.exports = { createReport, REPORT_DIR };
