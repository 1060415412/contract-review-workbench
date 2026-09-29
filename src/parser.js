'use strict';

/** 结果解析（对应工作流「数据汇总」之后的展示结构化处理） */

const HIGH_WORDS = [
  '无限', '连带', '不设上限', '无上限', '单方', '放弃', '免除', '不可撤销', '自动续约',
  '知识产权', '竞业', '违约金过高', '滞纳金', '管辖', '重大', '无效', '违法', '未约定',
  '缺失', '未明确', '缺少', '无法追偿', '丧失', '承担全部', '全部损失', '风险敞口', '不对等',
  '不利', '漏洞', '争议', '违约成本',
];
const LOW_WORDS = [
  '措辞', '笔误', '标点', '序号', '编号', '重复', '冗余', '术语', '格式', '错别字',
  '表述不够', '建议统一', '排版',
];

/** 风险等级初判：仅用于归类筛选，最终判断仍需人工复核 */
function classifyRisk(text) {
  const source = String(text || '');
  let high = 0;
  let low = 0;
  for (const w of HIGH_WORDS) if (source.includes(w)) high += 1;
  for (const w of LOW_WORDS) if (source.includes(w)) low += 1;
  if (high >= 2) return 'high';
  if (high === 1) return 'medium';
  if (low >= 1) return 'low';
  return 'medium';
}

/**
 * 解析常规审查结果（工作流 output）
 * - 问题1：标题
 *   - 分析：……
 *   - 修改建议：……
 */
function parseOpinions(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  if (text.includes('未发现可明确判断的问题')) return [];

  const items = [];
  let current = null;
  let field = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const titleMatch = line.match(/^\s*[-*]\s*(?:#*\s*)?问题\s*\d*\s*[：:]\s*(.+)$/);
    const analysisMatch = line.match(/^\s*[-*]\s*\**\s*分析\s*\**\s*[：:]\s*(.*)$/);
    const suggestMatch = line.match(/^\s*[-*]\s*\**\s*(?:修改建议|建议)\s*\**\s*[：:]\s*(.*)$/);

    if (titleMatch) {
      current = { title: clean(titleMatch[1]), analysis: '', suggestion: '' };
      items.push(current);
      field = 'title';
      continue;
    }
    if (analysisMatch) {
      if (!current) { current = { title: '审查意见', analysis: '', suggestion: '' }; items.push(current); }
      current.analysis = clean(analysisMatch[1]);
      field = 'analysis';
      continue;
    }
    if (suggestMatch) {
      if (!current) { current = { title: '审查意见', analysis: '', suggestion: '' }; items.push(current); }
      current.suggestion = clean(suggestMatch[1]);
      field = 'suggestion';
      continue;
    }
    if (current && field && field !== 'title') {
      current[field] = (current[field] ? current[field] + '\n' : '') + clean(line);
    }
  }

  return items
    .filter((i) => i.title || i.analysis || i.suggestion)
    .map((i, index) => ({
      id: `op-${index + 1}`,
      title: i.title || `审查意见 ${index + 1}`,
      analysis: i.analysis || '（未返回分析内容，请人工复核）',
      suggestion: i.suggestion || '（未返回修改建议，请人工复核）',
      level: classifyRisk(`${i.title} ${i.analysis} ${i.suggestion}`),
    }));
}

/** 解析旧法引用初筛结果（工作流 output1） */
function parseLawCheck(raw) {
  const text = String(raw || '').trim();
  if (!text) return { status: 'unknown', summary: '未返回法律引用核验结果。', items: [] };

  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s*(.+?)\s*[：:]\s*(.+)$/);
    if (m) items.push({ name: clean(m[1]), snippet: clean(m[2]) });
  }
  const hasIssue = items.length > 0 && !text.includes('未发现预设旧法名称');
  return {
    status: hasIssue ? 'warning' : 'ok',
    summary: hasIssue ? `发现 ${items.length} 处疑似旧法引用，需人工复核。` : '未发现预设旧法名称，仍需人工复核。',
    items: hasIssue ? items : [],
  };
}

function clean(text) {
  return String(text || '').replace(/\*\*/g, '').replace(/`/g, '').trim();
}

module.exports = { parseOpinions, parseLawCheck, classifyRisk };
