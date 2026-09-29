'use strict';

/**
 * 稳定性抽测：对同一份合同重复跑审查，比较输出条数与意见重合度
 * 用法：node eval/stability.js
 */

const fs = require('fs');
const path = require('path');
const { runReview } = require('../src/pipeline');

const DIR = path.join(__dirname, 'contracts');
const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'gold.json'), 'utf8'));
const SAMPLES = ['01', '08'];
const ROUNDS = 3;

function tokens(text) {
  const s = String(text || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  let inter = 0;
  A.forEach((t) => { if (B.has(t)) inter += 1; });
  return +((inter / (A.size + B.size - inter)) || 0).toFixed(2);
}

async function main() {
  const out = [];
  for (const id of SAMPLES) {
    const item = GOLD.cases.find((c) => c.id === id);
    const buffer = fs.readFileSync(path.join(DIR, item.file));
    const rounds = [];
    for (let i = 0; i < ROUNDS; i++) {
      const r = await runReview({
        buffer,
        fileName: item.file,
        contractType: item.contractType,
        stance: item.stance,
        focuses: item.focuses || [],
        extra: '',
      });
      rounds.push({
        count: (r.opinions || []).length,
        titles: (r.opinions || []).map((o) => o.title),
        levels: (r.opinions || []).map((o) => o.level),
        text: (r.opinions || []).map((o) => o.title + o.analysis).join('\n'),
      });
      console.log(`[${id}] 第 ${i + 1} 轮：${rounds[i].count} 条，高 ${rounds[i].levels.filter((l) => /high|高/.test(String(l))).length}`);
    }
    const sims = [];
    for (let i = 0; i < rounds.length; i++) {
      for (let j = i + 1; j < rounds.length; j++) sims.push(jaccard(rounds[i].text, rounds[j].text));
    }
    const counts = rounds.map((r) => r.count);
    out.push({
      id,
      file: item.file,
      counts,
      countSpread: Math.max(...counts) - Math.min(...counts),
      similarity: sims,
      avgSimilarity: +(sims.reduce((s, x) => s + x, 0) / sims.length).toFixed(2),
    });
  }
  const result = { generatedAt: new Date().toISOString(), rounds: ROUNDS, samples: out };
  fs.writeFileSync(path.join(__dirname, 'stability.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('\n稳定性结果：', JSON.stringify(result.samples, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
