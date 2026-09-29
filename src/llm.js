'use strict';

/**
 * 大模型适配层：OpenAI 兼容的 /chat/completions 协议
 * DeepSeek、通义千问、智谱、Kimi、豆包（OpenAI 兼容端点）、Ollama、vLLM 等均可直接接入
 * 只需在 .env 配置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
 */

const { getConfig } = require('./config');

class LLMError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'LLMError';
    this.detail = detail;
  }
}

function endpoint(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

/** 从模型回复中尽量取出 JSON 对象 */
function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new LLMError('模型未返回可解析的 JSON', raw.slice(0, 200));
  return JSON.parse(candidate.slice(start, end + 1));
}

async function chat(options) {
  const { system, user, temperature, maxTokens, json } = options || {};
  const cfg = getConfig().llm;
  if (!cfg.apiKey && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(cfg.baseUrl)) {
    throw new LLMError('未配置大模型接口（LLM_API_KEY 为空），当前只能使用演示数据。');
  }

  const body = {
    model: cfg.model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: user == null ? '' : user },
    ],
    temperature: temperature == null ? cfg.temperature : temperature,
    max_tokens: maxTokens || cfg.maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };

  let resp;
  try {
    resp = await fetch(endpoint(cfg.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (err) {
    throw new LLMError(`大模型接口请求失败：${err.message}（请检查 LLM_BASE_URL 与网络）`);
  }

  const text = await resp.text().catch(() => '');
  let json2;
  try {
    json2 = JSON.parse(text);
  } catch (e) {
    throw new LLMError(`大模型返回非 JSON（HTTP ${resp.status}）`, text.slice(0, 300));
  }
  if (!resp.ok) {
    const msg = (json2.error && (json2.error.message || json2.error.code)) || json2.msg || json2.message;
    throw new LLMError(`大模型调用失败（HTTP ${resp.status}）：${msg || '未知错误'}`);
  }
  const content = json2.choices && json2.choices[0] && json2.choices[0].message && json2.choices[0].message.content;
  if (content == null) throw new LLMError('大模型返回内容为空', JSON.stringify(json2).slice(0, 300));
  return { content: String(content), raw: json2 };
}

/** 文本输出 */
async function complete(system, user, options) {
  const res = await chat({ system, user, ...(options || {}) });
  return res.content.trim();
}

/** JSON 输出：优先 json_object 模式，不被支持时降级为文本解析 */
async function completeJson(system, user, options) {
  try {
    const res = await chat({ system, user, json: true, ...(options || {}) });
    return extractJson(res.content);
  } catch (err) {
    if (!(err instanceof LLMError)) throw err;
    const res = await chat({ system, user, ...(options || {}) });
    return extractJson(res.content);
  }
}

module.exports = { chat, complete, completeJson, extractJson, LLMError, endpoint };
