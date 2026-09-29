'use strict';

/**
 * 评测脚本：用 10 份带人工标注的合同跑真实审查链路，统计召回率与误报率
 *
 *   召回率 = AI 命中的人工标注风险 / 人工标注风险总数
 *   误报率 = AI 报错的意见 / AI 报出的意见总数
 *
 * 匹配判定采用 LLM-as-judge：把合同原文、人工标注清单、AI 意见清单一起交给模型，
 * 由模型判定每条 AI 意见是否命中某条标注（语义等价即可，不要求措辞一致），
 * 未命中的意见再判定是"真误报"还是"标注集未覆盖的正确发现"。
 *
 * 用法：node eval/run.js [并发数]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { runReview } = require(path.join(ROOT, 'src/pipeline'));
const llm = require(path.join(ROOT, 'src/llm'));

const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'gold.json'), 'utf8'));
const CONTRACT_DIR = path.join(__dirname, 'contracts');
const OUT_PATH = path.join(__dirname, 'result.json');

const ERROR_TYPES = [
  '合同无此依据（无中生有/幻觉）',
  '条款理解错误（曲解或过度推断原文）',
  '风险等级夸大（轻微问题当作高风险）',
  '脱离审查立场或重点项',
  '把有利条款当成风险',
  '建议不可执行或缺乏依据',
  '其他',
];

const MISS_TYPES = [
  '缺失类问题（合同没写，需要主动检查清单）',
  '条款表述间接隐蔽',
  '需要外部法律知识（法定上限/强制性规定）',
  '立场或重点项未被覆盖',
  '输出条数限制被截断',
  '其他',
];

const JUDGE_SYSTEM = `# 角色
你是合同审查质量评测员。你会拿到：合同原文、人工标注的风险清单（gold）、AI 审查输出的意见清单（ai）。
你的任务是客观比对两者，不修改、不新增任何风险。

# 判定规则
对每条 AI 意见必须给出两个判断：

1. gold 匹配：它是否与某条 gold 指向同一个合同问题？语义等价即可，不要求措辞一致。一条 AI 意见最多匹配一条 gold，一条 gold 最多被一条 AI 意见匹配。没有命中填 null。
2. grounded 成立性（独立于是否命中 gold）：
   - supported：合同原文能支撑该意见（包括"合同缺失某必备条款"这类合理提醒）；
   - fabricated：援引了合同中不存在的条款、金额、日期或事实；
   - overstated：有依据，但风险后果或风险等级被明显夸大；
   - wrong_stance：把对审查方有利的条款当成风险，或脱离了指定审查立场/重点项。
   grounded 不为 supported 的即为误报，并须给出 error_type。

3. 未被任何 AI 意见匹配的 gold，判为漏报（missed），并给出 miss_type。

# 输出格式（严格 JSON，不要代码块）
{
  "ai_verdicts": [{"ai": 1, "gold": "01-1", "grounded": "supported", "error_type": "", "reason": "一句话说明"}],
  "gold_missed": [{"gold": "01-5", "miss_type": "<从候选中选择>", "reason": "一句话说明"}]
}

# 候选值
grounded 只能是：supported、fabricated、overstated、wrong_stance
error_type 只在 grounded 不为 supported 时填写，只能是以下之一：${ERROR_TYPES.map((t) => `「${t}」`).join('、')}
miss_type 只能是以下之一：${MISS_TYPES.map((t) => `「${t}」`).join('、')}

# 限制
- ai 序号使用输入中给出的编号，不要改动。
- 不得凭空新增 gold 或 ai 条目。
- 只依据合同原文判断，不得引入合同外事实。`;

function buildJudgeUser(contractText, goldList, aiList) {
  const goldText = goldList
    .map((g, i) => `G${i + 1}（${g.id}）条款：${g.clause}\n风险：${g.risk}`)
    .join('\n');
  const aiText = aiList
    .map((o, i) => `A${i + 1} 标题：${o.title}\n等级：${o.level}\n分析：${o.analysis}\n建议：${o.suggestion}`)
    .join('\n');
  return `# 合同原文\n${contractText}\n\n# 人工标注风险清单（gold）\n${goldText}\n\n# AI 审查意见清单（ai）\n${aiText}`;
}

async function judgeCase(contractText, goldList, aiList) {
  let parsed;
  try {
    parsed = await llm.completeJson(JUDGE_SYSTEM, buildJudgeUser(contractText, goldList, aiList), {
      temperature: 0.2,
      maxTokens: 3000,
    });
  } catch (e) {
    parsed = await llm.completeJson(JUDGE_SYSTEM, buildJudgeUser(contractText, goldList, aiList), {
      temperature: 0.2,
      maxTokens: 3000,
    });
  }
  return {
    ai_verdicts: Array.isArray(parsed.ai_verdicts) ? parsed.ai_verdicts : [],
    gold_missed: Array.isArray(parsed.gold_missed) ? parsed.gold_missed : [],
  };
}

/** judge 可能回传 G2 / 2 / 01-2 三种形式，统一归一化为 gold.id */
function normalizeGoldRef(ref, goldList) {
  if (ref == null) return '';
  const raw = String(ref).trim();
  if (!raw || raw.toLowerCase() === 'null') return '';
  if (goldList.some((g) => g.id === raw)) return raw;
  const seq = raw.match(/^(?:G|g)?(\d+)$/);
  if (seq) {
    const idx = Number(seq[1]) - 1;
    if (goldList[idx]) return goldList[idx].id;
  }
  const hit = goldList.find((g) => raw.includes(g.id) || g.id.includes(raw));
  return hit ? hit.id : '';
}

function normalizeLevel(level) {
  const v = String(level || '').toLowerCase();
  if (v.includes('high') || v.includes('高')) return 'high';
  if (v.includes('mid') || v.includes('中')) return 'medium';
  return 'low';
}

async function runCase(item) {
  const filePath = path.join(CONTRACT_DIR, item.file);
  const buffer = fs.readFileSync(filePath);
  const text = buffer.toString('utf8');

  const started = Date.now();
  const result = await runReview({
    buffer,
    fileName: item.file,
    contractType: item.contractType,
    stance: item.stance,
    focuses: item.focuses || [],
    extra: '',
  });
  const costMs = Date.now() - started;

  const opinions = (result.opinions || []).map((o, i) => ({
    index: i + 1,
    title: o.title,
    level: normalizeLevel(o.level),
    analysis: o.analysis,
    suggestion: o.suggestion,
  }));

  const verdict = await judgeCase(text, item.gold, opinions);

  const matchedGold = new Set();
  const matchedPairs = [];
  const falsePositives = [];
  let extras = 0;
  for (const v of verdict.ai_verdicts) {
    const aiIdx = Number(v.ai);
    const goldId = normalizeGoldRef(v.gold, item.gold);
    if (goldId && !matchedGold.has(goldId)) {
      matchedGold.add(goldId);
      matchedPairs.push({ ai: aiIdx, gold: goldId, reason: v.reason || '' });
    }
    if (v.grounded && v.grounded !== 'supported') {
      falsePositives.push({
        ai: aiIdx,
        grounded: v.grounded,
        error_type: v.error_type || '其他',
        title: (opinions.find((o) => o.index === aiIdx) || {}).title || '',
        reason: v.reason || '',
      });
    } else if (!v.gold) {
      extras += 1;
    }
  }

  const missed = item.gold
    .filter((g) => !matchedGold.has(g.id))
    .map((g) => {
      const info = verdict.gold_missed.find((x) => String(x.gold) === g.id) || {};
      return { gold: g.id, clause: g.clause, risk: g.risk, level: g.level, miss_type: info.miss_type || '其他', reason: info.reason || '' };
    });

  return {
    id: item.id,
    file: item.file,
    contractType: item.contractType,
    stance: item.stance,
    mode: result.mode,
    costMs,
    goldTotal: item.gold.length,
    aiTotal: opinions.length,
    hit: matchedGold.size,
    miss: missed.length,
    falsePositive: falsePositives.length,
    extraCorrect: extras.length,
    recall: item.gold.length ? +(matchedGold.size / item.gold.length).toFixed(3) : 0,
    precision: opinions.length ? +((opinions.length - falsePositives.length) / opinions.length).toFixed(3) : 0,
    opinions,
    matchedPairs,
    falsePositives,
    missed,
    levelStats: {
      aiHigh: opinions.filter((o) => o.level === 'high').length,
      goldHigh: item.gold.filter((g) => normalizeLevel(g.level) === 'high').length,
    },
  };
}

async function main() {
  const concurrency = Number(process.argv[2] || 3);
  const cases = GOLD.cases;
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < cases.length) {
      const item = cases[cursor++];
      try {
        const r = await runCase(item);
        results.push(r);
        console.log(`[${r.id}] ${r.file}  gold ${r.goldTotal} / AI ${r.aiTotal} / 命中 ${r.hit} / 误报 ${r.falsePositive}  召回 ${(r.recall * 100).toFixed(0)}%  精确 ${(r.precision * 100).toFixed(0)}%  ${(r.costMs / 1000).toFixed(0)}s`);
      } catch (err) {
        console.error(`[${item.id}] 失败：${err.message}`);
        results.push({ id: item.id, file: item.file, error: err.message, goldTotal: item.gold.length, aiTotal: 0, hit: 0, miss: item.gold.length, falsePositive: 0, recall: 0, precision: 0, missed: [], falsePositives: [], opinions: [] });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  results.sort((a, b) => a.id.localeCompare(b.id));

  const ok = results.filter((r) => !r.error);
  const goldTotal = ok.reduce((s, r) => s + r.goldTotal, 0);
  const aiTotal = ok.reduce((s, r) => s + r.aiTotal, 0);
  const hit = ok.reduce((s, r) => s + r.hit, 0);
  const fp = ok.reduce((s, r) => s + r.falsePositive, 0);

  const summary = {
    cases: ok.length,
    goldTotal,
    aiTotal,
    hit,
    miss: goldTotal - hit,
    falsePositive: fp,
    recall: goldTotal ? +(hit / goldTotal).toFixed(3) : 0,
    falsePositiveRate: aiTotal ? +(fp / aiTotal).toFixed(3) : 0,
    precision: aiTotal ? +((aiTotal - fp) / aiTotal).toFixed(3) : 0,
    avgOpinionsPerCase: ok.length ? +(aiTotal / ok.length).toFixed(1) : 0,
    avgSecondsPerCase: ok.length ? +(ok.reduce((s, r) => s + r.costMs, 0) / ok.length / 1000).toFixed(1) : 0,
  };

  const errorBuckets = {};
  const missBuckets = {};
  for (const r of ok) {
    for (const f of r.falsePositives) errorBuckets[f.error_type] = (errorBuckets[f.error_type] || 0) + 1;
    for (const m of r.missed) missBuckets[m.miss_type] = (missBuckets[m.miss_type] || 0) + 1;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    model: require(path.join(ROOT, 'src/config')).getConfig().llm.model,
    summary,
    errorBuckets,
    missBuckets,
    cases: results,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');

  console.log('\n===== 汇总 =====');
  console.log(JSON.stringify(summary, null, 2));
  console.log('误报分类：', JSON.stringify(errorBuckets, null, 2));
  console.log('漏报分类：', JSON.stringify(missBuckets, null, 2));
  console.log(`\n明细已写入 ${OUT_PATH}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { runCase };
