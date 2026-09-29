'use strict';

/**
 * 审查编排（复刻扣子工作流 law_check 的节点顺序，本地执行）
 *
 *   开始 → 文件读取 → 解析标题/合作方(LLM) → 企业信息查询(数据源) → 企业风险总结(LLM)
 *        → 常规审查(LLM) + 旧法引用初筛(LLM) → 数据汇总 → 生成报告
 * 对应页面四步：1 提取合同内容 / 2 查询企业信息 / 3 审查合同条款 / 4 生成审查报告
 */

const prompts = require('./prompts');
const llm = require('./llm');
const { extractText } = require('./extract');
const { parseOpinions, parseLawCheck } = require('./parser');
const { queryEnterprise, hasAny } = require('./enterprise');
const { createReport } = require('./report');
const { buildDemoResult } = require('./demo');
const { getConfig } = require('./config');

function isLLMConfigured() {
  const cfg = getConfig().llm;
  return Boolean(cfg.apiKey) || /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(cfg.baseUrl);
}

async function timed(name, fn) {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start, name };
}

/** 步骤1：提取合同内容 + 解析标题/合作方 */
async function stepExtract(buffer, fileName) {
  const text = await extractText(buffer, fileName);
  if (!text || !text.trim()) throw new Error('未能从文件中提取到有效文本，请换用 TXT / DOCX 或直接粘贴合同文本。');
  return text;
}

async function stepParseMeta(text, xuqiu) {
  const system = prompts.PARSE_TITLE_COMPANY + prompts.JSON_APPENDIX;
  const user = prompts.fill('合同正文：\n{{input}}\n\n审查要求：\n{{xuqiu}}', { input: text, xuqiu });
  let title = '';
  let company = '';
  try {
    const json = await llm.completeJson(system, user);
    title = String(json.title || '').trim();
    company = String(json.company || '').trim();
  } catch (e) {
    // 标题/公司解析失败不阻断主流程，后续按"未识别"处理
    title = '';
    company = '';
  }
  return { title, company };
}

/** 步骤2：查询企业信息 + 风险总结 */
async function stepEnterprise(company) {
  const res = await queryEnterprise(company);
  if (!res.ok) return { company: res.company || '', summary: res.fallback || '未返回企业信息，请人工复核。' };

  if (!hasAny(res.payload)) {
    return { company: res.company, summary: '当前数据源未返回有效企业信息，无法据此判断企业状态或风险，请核对企业名称并人工复核。' };
  }
  const system = prompts.ENTERPRISE_SUMMARY;
  const user = prompts.fill(
    '合作方企业名称：{{company}}\n登记信息：{{detail}}\n经营异常信息：{{abnormal}}',
    {
      company: res.company,
      detail: JSON.stringify(res.payload.registration || res.payload.annualReports || []),
      abnormal: JSON.stringify(res.payload.abnormal || res.payload.creditA || []),
    }
  );
  const summary = await llm.complete(system, user);
  return { company: res.company, summary };
}

/** 步骤3：常规审查 + 旧法引用初筛 */
async function stepReview(text, xuqiu) {
  const [review, oldLaw] = await Promise.all([
    llm.complete(prompts.REVIEW_CONTRACT, prompts.fill('合同正文：\n{{input}}\n\n审查要求：\n{{xuqiu}}', { input: text, xuqiu })),
    llm.complete(prompts.OLD_LAW_CHECK, prompts.fill('合同正文：\n{{input}}', { input: text })),
  ]);
  return { review, oldLaw };
}

/** 汇总 markdown（与工作流「数据汇总」节点一致） */
function buildMarkdown(review, oldLaw, enterprise) {
  return `# 常规审查结果\n${review}\n\n# 旧法引用初筛结果\n${oldLaw}\n\n# 企业信息查询结果\n${enterprise}`;
}

/**
 * 执行完整审查
 * @param {{buffer:Buffer, fileName:string, contractType:string, stance:string, focuses:string[], extra:string}} input
 */
async function runReview(input) {
  if (input.forceDemo || !isLLMConfigured()) return buildDemoResult(input);

  const xuqiu = prompts.buildXuqiu(input);
  const steps = [];

  const t1 = await timed('提取合同内容', () => stepExtract(input.buffer, input.fileName));
  const text = t1.value;
  const meta = await stepParseMeta(text, xuqiu);
  steps.push({ name: '提取合同内容', status: 'done', ms: t1.ms, note: `${text.length} 字` });

  const t2 = await timed('查询企业信息', () => stepEnterprise(meta.company));
  steps.push({ name: '查询企业信息', status: 'done', ms: t2.ms, note: meta.company || '未识别合作方' });

  const t3 = await timed('审查合同条款', () => stepReview(text, xuqiu));
  steps.push({ name: '审查合同条款', status: 'done', ms: t3.ms, note: '常规审查 + 旧法初筛' });

  const opinions = parseOpinions(t3.value.review);
  const lawCheck = parseLawCheck(t3.value.oldLaw);
  const enterpriseSummary = t2.value.summary;
  const contractTitle = meta.title || String(input.fileName || '合同审查').replace(/\.[^.]+$/, '');

  const markdown = buildMarkdown(t3.value.review, t3.value.oldLaw, enterpriseSummary);
  const t4 = await timed('生成审查报告', () => createReport(`${contractTitle}问题与风险`, markdown));
  steps.push({ name: '生成审查报告', status: 'done', ms: t4.ms, note: t4.value.pushed ? '已同步外部系统' : '本地报告' });

  return {
    mode: 'llm',
    title: contractTitle,
    opinions,
    lawCheck,
    enterprise: { status: 'info', summary: enterpriseSummary },
    reportUrl: t4.value.url,
    meta: {
      model: getConfig().llm.model,
      company: meta.company,
      textLength: text.length,
      steps,
    },
    raw: { review: t3.value.review, oldLaw: t3.value.oldLaw, enterprise: enterpriseSummary },
  };
}

module.exports = { runReview, isLLMConfigured, buildMarkdown };
