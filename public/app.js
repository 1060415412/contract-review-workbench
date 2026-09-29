/* 合同审查工作台 - 前端交互 */
(function () {
  'use strict';

  var HISTORY_KEY = 'contract_review_history_v1';
  var MAX_FILE_SIZE = 10 * 1024 * 1024;
  var ALLOWED_EXT = ['pdf', 'doc', 'docx', 'txt', 'md', 'markdown'];

  var state = {
    file: null,          // { name, size, base64 }
    result: null,        // 最近一次审查结果
    filter: 'all',
    running: false,
  };

  var els = {};
  var timers = { steps: [], elapsed: null, seconds: 0 };

  function $(id) { return document.getElementById(id); }

  function init() {
    els = {
      statusBadge: $('statusBadge'), statusText: $('statusText'),
      steps: $('steps'),
      contractType: $('contractType'), stanceGroup: $('stanceGroup'), focusGroup: $('focusGroup'),
      extra: $('extra'),
      dropzone: $('dropzone'), fileInput: $('fileInput'),
      fileInfo: $('fileInfo'), fileName: $('fileName'), fileSize: $('fileSize'), removeFile: $('removeFile'),
      contractText: $('contractText'),
      formError: $('formError'), submitBtn: $('submitBtn'), resetBtn: $('resetBtn'),
      progressCard: $('progressCard'), progressFill: $('progressFill'),
      progressTitle: $('progressTitle'), progressDesc: $('progressDesc'), elapsed: $('elapsed'),
      resultArea: $('resultArea'),
      historyList: $('historyList'), clearHistory: $('clearHistory'),
      configBtn: $('configBtn'), configModal: $('configModal'), tokenInput: $('tokenInput'),
      baseUrlInput: $('baseUrlInput'), modelInput: $('modelInput'), entInput: $('entInput'),
      saveConfig: $('saveConfig'), closeConfig: $('closeConfig'),
      configError: $('configError'),
      toast: $('toast'),
    };

    bindEvents();
    loadStatus();
    renderHistory();
  }

  // ------------------------------------------------------------ 事件绑定

  function bindEvents() {
    els.stanceGroup.addEventListener('click', function (e) {
      var btn = e.target.closest('.seg');
      if (!btn) return;
      Array.prototype.forEach.call(els.stanceGroup.querySelectorAll('.seg'), function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });

    els.focusGroup.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      btn.classList.toggle('active');
    });

    els.dropzone.addEventListener('click', function () { els.fileInput.click(); });
    els.dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
    });
    els.fileInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) pickFile(e.target.files[0]);
      e.target.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      els.dropzone.addEventListener(type, function (e) {
        e.preventDefault(); e.stopPropagation();
        els.dropzone.classList.add('is-drag');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      els.dropzone.addEventListener(type, function (e) {
        e.preventDefault(); e.stopPropagation();
        if (type === 'dragleave' && els.dropzone.contains(e.relatedTarget)) return;
        els.dropzone.classList.remove('is-drag');
      });
    });
    els.dropzone.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files[0]) pickFile(files[0]);
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    els.removeFile.addEventListener('click', function (e) {
      e.stopPropagation();
      state.file = null;
      els.fileInfo.classList.add('hidden');
      showError('');
    });

    els.submitBtn.addEventListener('click', submit);
    els.resetBtn.addEventListener('click', resetForm);
    els.clearHistory.addEventListener('click', clearHistory);

    els.configBtn.addEventListener('click', openConfig);
    els.closeConfig.addEventListener('click', function () { els.configModal.classList.add('hidden'); });
    els.configModal.addEventListener('click', function (e) {
      if (e.target === els.configModal) els.configModal.classList.add('hidden');
    });
    els.saveConfig.addEventListener('click', saveConfig);
  }

  // ------------------------------------------------------------ 状态与配置

  function loadStatus() {
    fetch('/api/status').then(function (r) { return r.json(); }).then(function (data) {
      if (data.configured) {
        els.statusBadge.className = 'status';
        els.statusText.textContent = '大模型已连接（' + data.model + '）';
      } else {
        els.statusBadge.className = 'status is-demo';
        els.statusText.textContent = '未配置大模型 · 演示模式';
      }
      els.statusBadge.title = data.apiKeyMasked
        ? '服务端已保存密钥：' + data.apiKeyMasked + '　接口：' + data.baseUrl
        : '服务端未保存密钥，当前使用演示数据';
    }).catch(function () {
      els.statusBadge.className = 'status is-error';
      els.statusText.textContent = '无法连接本地服务';
    });
  }

  function openConfig() {
    els.configError.classList.add('hidden');
    els.tokenInput.value = '';
    fetch('/api/status').then(function (r) { return r.json(); }).then(function (data) {
      els.baseUrlInput.value = data.baseUrl || '';
      els.modelInput.value = data.model || '';
    }).catch(function () { els.baseUrlInput.value = ''; });
    els.configModal.classList.remove('hidden');
  }

  function saveConfig() {
    var token = els.tokenInput.value.trim();
    var baseUrl = els.baseUrlInput.value.trim();
    var model = els.modelInput.value.trim();
    if (!token) {
      els.configError.textContent = '请填写 API Key（留空则继续使用演示数据）。';
      els.configError.classList.remove('hidden');
      return;
    }
    if (!baseUrl) {
      els.configError.textContent = '请填写接口地址，例如 https://api.deepseek.com/v1';
      els.configError.classList.remove('hidden');
      return;
    }
    els.saveConfig.disabled = true;
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: token,
        baseUrl: baseUrl,
        model: model,
        enterpriseUrl: els.entInput.value.trim(),
      }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      els.saveConfig.disabled = false;
      if (!data.ok) throw new Error(data.error || '保存失败');
      els.configModal.classList.add('hidden');
      toast('配置已保存到本机 .env，重新提交即调用真实大模型');
      loadStatus();
    }).catch(function (err) {
      els.saveConfig.disabled = false;
      els.configError.textContent = err.message || '保存失败，请重试。';
      els.configError.classList.remove('hidden');
    });
  }

  // ------------------------------------------------------------ 文件与校验

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function pickFile(file) {
    showError('');
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ALLOWED_EXT.indexOf(ext) === -1) {
      showError('不支持的文件格式：' + (ext || '未知') + '，请上传 PDF、Word、TXT 或 MD 文件。');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showError('文件大小为 ' + formatSize(file.size) + '，已超过 10MB 限制。');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var base64 = String(reader.result).split(',')[1] || '';
      state.file = { name: file.name, size: file.size, base64: base64 };
      els.fileName.textContent = file.name;
      els.fileSize.textContent = formatSize(file.size);
      els.fileInfo.classList.remove('hidden');
    };
    reader.onerror = function () { showError('文件读取失败，请重新选择。'); };
    reader.readAsDataURL(file);
  }

  function collectPayload() {
    var stance = els.stanceGroup.querySelector('.seg.active');
    var focuses = [];
    Array.prototype.forEach.call(els.focusGroup.querySelectorAll('.chip.active'), function (c) {
      focuses.push(c.dataset.value);
    });
    return {
      contractType: els.contractType.value,
      stance: stance ? stance.dataset.value : '中立',
      focuses: focuses,
      extra: els.extra.value,
      fileName: state.file ? state.file.name : '',
      fileBase64: state.file ? state.file.base64 : '',
      text: els.contractText.value,
    };
  }

  function showError(msg) {
    if (!msg) { els.formError.classList.add('hidden'); els.formError.textContent = ''; return; }
    els.formError.textContent = msg;
    els.formError.classList.remove('hidden');
  }

  // ------------------------------------------------------------ 提交与进度

  function submit() {
    if (state.running) return;
    var payload = collectPayload();
    if (!payload.fileBase64 && !payload.text.trim()) {
      showError('请先上传合同文件，或粘贴合同文本，再开始审查。');
      els.dropzone.focus();
      return;
    }
    showError('');

    state.running = true;
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = '审查中…';
    els.resultArea.innerHTML = '';
    resetSteps();
    startProgress();

    fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) data.__httpError = true;
        return data;
      });
    }).then(function (data) {
      stopProgress();
      if (data.error) {
        finishSteps(false);
        renderError(data.error, data.retryable !== false);
        return;
      }
      finishSteps(true);
      state.result = data;
      state.filter = 'all';
      saveHistory(data, payload);
      renderResult(data);
      scrollToResult();
    }).catch(function (err) {
      stopProgress();
      finishSteps(false);
      renderError('请求失败：' + err.message + '。请确认本地服务正在运行后重试。', true);
    }).then(function () {
      state.running = false;
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = '开始智能审查';
    });
  }

  function resetForm() {
    if (state.running) return;
    state.file = null;
    state.result = null;
    state.filter = 'all';
    els.fileInput.value = '';
    els.fileInfo.classList.add('hidden');
    els.contractText.value = '';
    els.extra.value = '';
    els.contractType.selectedIndex = 0;
    Array.prototype.forEach.call(els.focusGroup.querySelectorAll('.chip'), function (c, i) {
      c.classList.toggle('active', i < 2);
    });
    Array.prototype.forEach.call(els.stanceGroup.querySelectorAll('.seg'), function (b, i) {
      b.classList.toggle('active', i === 0);
    });
    els.resultArea.innerHTML = '';
    resetSteps();
    showError('');
  }

  function setStepState(index, cls) {
    var li = els.steps.querySelector('.step[data-step="' + index + '"]');
    if (!li) return;
    li.classList.remove('is-active', 'is-done');
    if (cls) li.classList.add(cls);
  }

  function resetSteps() {
    clearTimers(timers.steps);
    for (var i = 1; i <= 4; i++) setStepState(i, '');
  }

  function clearTimers(list) {
    list.forEach(clearTimeout);
    list.length = 0;
  }

  function startProgress() {
    els.progressCard.classList.remove('hidden');
    els.elapsed.textContent = '0';
    if (els.progressFill) els.progressFill.style.width = '8%';

    setStepState(1, 'is-active');
    timers.steps.push(setTimeout(function () { setStepState(1, 'is-done'); setStepState(2, 'is-active'); }, 1500));
    timers.steps.push(setTimeout(function () { setStepState(2, 'is-done'); setStepState(3, 'is-active'); }, 3200));

    timers.seconds = 0;
    clearInterval(timers.elapsed);
    timers.elapsed = setInterval(function () {
      timers.seconds += 1;
      els.elapsed.textContent = String(timers.seconds);
      var pct = Math.min(92, 8 + timers.seconds * 1.6);
      if (els.progressFill) els.progressFill.style.width = pct + '%';
    }, 1000);
  }

  function stopProgress() {
    clearTimers(timers.steps);
    clearInterval(timers.elapsed);
    timers.elapsed = null;
    els.progressCard.classList.add('hidden');
    if (els.progressFill) els.progressFill.style.width = '100%';
  }

  function finishSteps(success) {
    for (var i = 1; i <= 3; i++) setStepState(i, 'is-done');
    if (success) {
      setStepState(4, 'is-done');
    } else {
      setStepState(4, '');
    }
  }

  // ------------------------------------------------------------ 结果渲染

  function levelText(level) {
    return level === 'high' ? '高风险' : level === 'medium' ? '中风险' : '低风险';
  }

  function countBy(level) {
    if (!state.result) return 0;
    return state.result.opinions.filter(function (o) { return o.level === level; }).length;
  }

  function renderResult(data) {
    var opinions = data.opinions || [];
    var high = opinions.filter(function (o) { return o.level === 'high'; }).length;
    var mid = opinions.filter(function (o) { return o.level === 'medium'; }).length;
    var low = opinions.filter(function (o) { return o.level === 'low'; }).length;
    var isDemo = data.mode === 'demo';

    var html = '<div class="result-wrap">';

    if (isDemo) {
      html += '<div class="demo-banner"><span>!</span><div><strong>当前为演示结果</strong>'
        + '未配置大模型接口或接口不可用，以下数据由本地模拟生成，用于演示完整流程。</div></div>';
    }

    // 概览
    html += '<section class="card"><div class="result-head"><div class="result-title">'
      + '<span class="check-badge">✓</span><div><h3>审查完成</h3>'
      + '<p>' + escapeHtml(data.title || '合同审查') + ' · ' + new Date().toLocaleString('zh-CN')
      + (data.meta && data.meta.model ? ' · 模型 ' + escapeHtml(data.meta.model) : '')
      + (data.meta && data.meta.steps ? ' · 耗时 ' + totalSeconds(data.meta.steps) + 's' : '')
      + '</p></div></div>'
      + '<div>' + reportButton(data.reportUrl) + '</div></div>'
      + '<div class="stats">'
      + stat('审查意见', opinions.length, '')
      + stat('高风险', high, 'high')
      + stat('中风险', mid, 'mid')
      + stat('低风险', low, 'low')
      + '</div></section>';

    // 法律引用核验
    var law = data.lawCheck || {};
    html += '<section class="card summary-card"><h4>法律引用核验'
      + '<span class="tag ' + (law.status === 'warning' ? 'warning' : 'ok') + '">'
      + (law.status === 'warning' ? '需人工复核' : '未发现预设旧法') + '</span></h4>'
      + '<p>' + escapeHtml(law.summary || '未返回核验结果。') + '</p>';
    if (law.items && law.items.length) {
      html += '<ul class="law-list">';
      law.items.forEach(function (item) {
        html += '<li><b>' + escapeHtml(item.name) + '</b><span>' + escapeHtml(item.snippet) + '</span></li>';
      });
      html += '</ul>';
    }
    html += '</section>';

    // 企业信息核验
    html += '<section class="card summary-card"><h4>企业信息核验<span class="tag info">数据源核验</span></h4>'
      + '<p>' + escapeHtml((data.enterprise && data.enterprise.summary) || '未返回核验结果。') + '</p></section>';

    // 意见列表
    html += '<section class="card"><div class="card-head"><h3>审查意见</h3></div>'
      + '<div class="filter-bar"><div class="filter-group">'
      + filterBtn('all', '全部 ' + opinions.length)
      + filterBtn('high', '高风险 ' + high)
      + filterBtn('medium', '中风险 ' + mid)
      + filterBtn('low', '低风险 ' + low)
      + '</div>'
      + '<button type="button" class="btn btn-outline btn-sm" id="copyAllBtn">一键复制全部审查意见</button>'
      + '</div><div id="opinionList" style="margin-top:14px"></div></section>';

    html += '</div>';
    els.resultArea.innerHTML = html;

    document.getElementById('copyAllBtn').addEventListener('click', copyAll);
    Array.prototype.forEach.call(els.resultArea.querySelectorAll('.filter-btn'), function (btn) {
      btn.addEventListener('click', function () {
        state.filter = btn.dataset.level;
        Array.prototype.forEach.call(els.resultArea.querySelectorAll('.filter-btn'), function (b) {
          b.classList.toggle('active', b.dataset.level === state.filter);
        });
        renderOpinions();
      });
    });
    var reportBtn = document.getElementById('reportBtn');
    if (reportBtn && data.reportUrl) {
      reportBtn.addEventListener('click', function () { window.open(data.reportUrl, '_blank', 'noopener'); });
    }
    renderOpinions();
  }

  function totalSeconds(steps) {
    var ms = steps.reduce(function (sum, s) { return sum + (s.ms || 0); }, 0);
    return (ms / 1000).toFixed(1);
  }

  function stat(label, value, cls) {
    return '<div class="stat ' + cls + '"><span>' + label + '</span><strong>' + value + '</strong></div>';
  }

  function filterBtn(level, text) {
    return '<button type="button" class="filter-btn' + (state.filter === level ? ' active' : '') + '" data-level="' + level + '">' + text + '</button>';
  }

  function reportButton(url) {
    if (url) {
      return '<button type="button" class="btn btn-primary" id="reportBtn">查看飞书完整审查报告</button>';
    }
    return '<button type="button" class="btn btn-ghost" disabled title="本次未返回飞书文档地址">查看飞书完整审查报告（未生成）</button>';
  }

  function renderOpinions() {
    var box = document.getElementById('opinionList');
    if (!box || !state.result) return;
    var list = state.result.opinions.filter(function (o) {
      return state.filter === 'all' || o.level === state.filter;
    });

    if (!list.length) {
      box.innerHTML = '<div class="empty">当前筛选条件下没有审查意见。</div>';
      return;
    }

    box.innerHTML = list.map(function (o) {
      return '<article class="opinion" data-id="' + o.id + '">'
        + '<div class="opinion-head"><h4>' + escapeHtml(o.title) + '</h4>'
        + '<span class="level ' + o.level + '">' + levelText(o.level) + '</span></div>'
        + '<div class="opinion-block"><span class="label">问题分析</span><p>' + escapeHtml(o.analysis) + '</p></div>'
        + '<div class="opinion-block"><span class="label">修改建议</span><p>' + escapeHtml(o.suggestion) + '</p></div>'
        + '<div class="opinion-foot"><button type="button" class="btn btn-ghost btn-sm" data-copy="' + o.id + '">复制修改建议</button></div>'
        + '</article>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-copy]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.copy;
        var item = state.result.opinions.filter(function (o) { return o.id === id; })[0];
        if (!item) return;
        copyText('【' + levelText(item.level) + '】' + item.title + '\n修改建议：' + item.suggestion, '修改建议已复制');
      });
    });
  }

  function renderError(message, retryable) {
    var html = '<section class="card"><div class="result-head"><div class="result-title">'
      + '<span class="check-badge" style="background:var(--high-bg);color:var(--high)">!</span>'
      + '<div><h3>审查未完成</h3><p>' + escapeHtml(message) + '</p></div></div></div>';
    if (retryable) {
      html += '<div class="actions"><button type="button" class="btn btn-primary" id="retryBtn">重新尝试</button>'
        + '<button type="button" class="btn btn-ghost" id="demoBtn">改用演示数据查看效果</button></div>';
    }
    html += '</section>';
    els.resultArea.innerHTML = html;
    if (retryable) {
      document.getElementById('retryBtn').addEventListener('click', submit);
      document.getElementById('demoBtn').addEventListener('click', function () {
        fetch('/api/status').catch(function () {});
        showError('');
        loadDemo();
      });
    }
    scrollToResult();
  }

  function loadDemo() {
    fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractType: els.contractType.value, stance: '中立', focuses: [], extra: '', text: '演示合同文本', forceDemo: true }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) { showError(data.error); return; }
      state.result = data;
      state.filter = 'all';
      renderResult(data);
      scrollToResult();
    }).catch(function (err) { showError('演示数据加载失败：' + err.message); });
  }

  function scrollToResult() {
    setTimeout(function () {
      var top = els.resultArea.getBoundingClientRect().top + window.pageYOffset - 20;
      window.scrollTo({ top: top, behavior: 'smooth' });
    }, 120);
  }

  // ------------------------------------------------------------ 复制

  function copyAll() {
    if (!state.result) return;
    var lines = ['合同审查意见（共 ' + state.result.opinions.length + ' 条）', ''];
    state.result.opinions.forEach(function (o, i) {
      lines.push((i + 1) + '. [' + levelText(o.level) + '] ' + o.title);
      lines.push('   分析：' + o.analysis);
      lines.push('   修改建议：' + o.suggestion);
      lines.push('');
    });
    var law = state.result.lawCheck || {};
    lines.push('法律引用核验：' + (law.summary || '无'));
    lines.push('企业信息核验：' + ((state.result.enterprise && state.result.enterprise.summary) || '无'));
    if (state.result.reportUrl) lines.push('飞书完整报告：' + state.result.reportUrl);
    copyText(lines.join('\n'), '全部审查意见已复制');
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { fallbackCopy(text, okMsg); });
    } else {
      fallbackCopy(text, okMsg);
    }
  }

  function fallbackCopy(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(okMsg);
    } catch (e) {
      toast('复制失败，请手动选择文本复制');
    }
    document.body.removeChild(ta);
  }

  var toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, 2200);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ------------------------------------------------------------ 历史记录

  function readHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function writeHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 8))); } catch (e) { /* 忽略容量错误 */ }
  }

  function saveHistory(data, payload) {
    var name = payload.fileName || ('粘贴文本（' + payload.contractType + '）');
    var high = (data.opinions || []).filter(function (o) { return o.level === 'high'; }).length;
    var list = readHistory();
    list.unshift({
      id: 'h-' + Date.now(),
      name: name,
      time: new Date().toLocaleString('zh-CN'),
      count: (data.opinions || []).length,
      high: high,
      mode: data.mode,
      result: data,
    });
    writeHistory(list);
    renderHistory();
  }

  function renderHistory() {
    var list = readHistory();
    if (!list.length) {
      els.historyList.innerHTML = '<div class="empty">暂无审查记录，完成一次审查后会自动保存到这里。</div>';
      return;
    }
    els.historyList.innerHTML = list.map(function (item, index) {
      return '<div class="history-item" data-index="' + index + '">'
        + '<div class="history-main"><strong>' + escapeHtml(item.name) + '</strong>'
        + '<span>' + escapeHtml(item.time) + (item.mode === 'demo' ? ' · 演示结果' : '') + '</span></div>'
        + '<div class="history-meta"><span>意见 <b>' + item.count + '</b> 条</span>'
        + '<span>高风险 <b>' + item.high + '</b> 条</span></div></div>';
    }).join('');

    Array.prototype.forEach.call(els.historyList.querySelectorAll('.history-item'), function (el) {
      el.addEventListener('click', function () {
        var item = list[Number(el.dataset.index)];
        if (!item || !item.result) return;
        state.result = item.result;
        state.filter = 'all';
        renderResult(item.result);
        scrollToResult();
      });
    });
  }

  function clearHistory() {
    if (!readHistory().length) { toast('暂无记录'); return; }
    if (!window.confirm('确认清空全部历史审查记录？')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    toast('历史记录已清空');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
