'use strict';

/**
 * 合同文本提取（对应工作流「流程1：文件读取」节点）
 * 内置支持：TXT / MD / CSV / DOCX（零依赖，自解析 zip+xml）
 * PDF 与旧版 DOC 需要可选依赖：npm i pdf-parse word-extractor
 */

const zlib = require('zlib');

class ExtractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExtractError';
  }
}

/** 解析 zip 的中央目录，返回 {name -> Buffer}（仅解压需要的条目） */
function readZipEntries(buffer, wanted) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new ExtractError('文件不是有效的 zip/docx 结构');

  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const result = {};

  for (let n = 0; n < total; n++) {
    if (offset + 46 > buffer.length) break;
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLen).toString('utf8');

    offset += 46 + nameLen + extraLen + commentLen;

    if (wanted.indexOf(name) === -1) continue;

    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buffer.slice(dataStart, dataStart + compSize);

    let content;
    try {
      content = method === 0 ? data : zlib.inflateRawSync(data);
    } catch (e) {
      throw new ExtractError(`解压 ${name} 失败：${e.message}`);
    }
    result[name] = content;
    if (Object.keys(result).length === wanted.length) break;
  }
  return result;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function docxToText(buffer) {
  const entries = readZipEntries(buffer, ['word/document.xml']);
  const xml = entries['word/document.xml'];
  if (!xml) throw new ExtractError('docx 中未找到 word/document.xml');
  const text = xml.toString('utf8')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text).replace(/\n{3,}/g, '\n\n').trim();
}

async function pdfToText(buffer) {
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch (e) {
    throw new ExtractError('解析 PDF 需要可选依赖，请在项目目录执行：npm i pdf-parse（或将合同另存为 TXT / DOCX 后上传）');
  }
  const fn = pdfParse.default || pdfParse;
  const data = await fn(buffer);
  return String(data.text || '').trim();
}

async function docToText(buffer) {
  let mod;
  try {
    mod = require('word-extractor');
  } catch (e) {
    throw new ExtractError('解析旧版 .doc 需要可选依赖：npm i word-extractor（推荐另存为 .docx 或 .txt 后上传）');
  }
  const WordExtractor = mod.default || mod;
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  return String(doc.getBody ? doc.getBody() : '').trim();
}

/**
 * 提取合同正文
 * @param {Buffer} buffer 文件内容
 * @param {string} fileName 原始文件名
 * @returns {Promise<string>}
 */
async function extractText(buffer, fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();

  if (['txt', 'md', 'markdown', 'csv', 'json', 'log'].indexOf(ext) !== -1) {
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    if (!text.trim()) throw new ExtractError('文件内容为空，请确认后重新上传。');
    return text.trim();
  }
  if (ext === 'docx') return docxToText(buffer);
  if (ext === 'pdf') return pdfToText(buffer);
  if (ext === 'doc') return docToText(buffer);

  throw new ExtractError(`暂不支持的文件格式：${ext || '未知'}，请上传 PDF、Word、TXT 或 MD 文件。`);
}

module.exports = { extractText, ExtractError, docxToText };
