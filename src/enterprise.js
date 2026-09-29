'use strict';

/**
 * 企业信息数据源（对应工作流「查询合作方企业信息」分支的插件节点）
 *
 * 默认未配置：返回"未配置数据源"，流程继续，页面标注需人工复核。
 * 接入方式：在 .env 配置 ENTERPRISE_API_URL（可选 ENTERPRISE_API_TOKEN），
 * 该接口接收 POST {company} ，返回 JSON：
 *   { registration: {...}, annualReports: [...], creditA: [...], abnormal: [...] }
 * 未返回的字段一律按"数据源未返回"处理，不做推测。
 */

const { getConfig } = require('./config');

const NOT_CONFIGURED = '未配置企业信息数据源（ENTERPRISE_API_URL），本次未查询合作方企业信息，请人工复核。';
const NO_COMPANY = '合同中未识别出可查询的合作方公司名称。请检查合同中的甲乙方信息和本次审查立场后重新运行。';

async function queryEnterprise(company) {
  if (!company) return { ok: false, company: '', payload: null, fallback: NO_COMPANY };

  const cfg = getConfig().enterprise;
  if (!cfg.url) return { ok: false, company, payload: null, fallback: NOT_CONFIGURED };

  const resp = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
    },
    body: JSON.stringify({ company }),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) throw new Error(`企业信息数据源返回 HTTP ${resp.status}`);
  const data = await resp.json().catch(() => ({}));
  return { ok: true, company, payload: data && typeof data === 'object' ? data : {} };
}

function hasAny(payload) {
  if (!payload) return false;
  return Object.keys(payload).some((key) => {
    const v = payload[key];
    if (Array.isArray(v)) return v.length > 0;
    return v && Object.keys(v).length > 0;
  });
}

module.exports = { queryEnterprise, hasAny, NOT_CONFIGURED, NO_COMPANY };
