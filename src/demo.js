'use strict';

/** 演示数据：未配置大模型接口时使用，页面会标注「当前为演示结果」 */

const { classifyRisk } = require('./parser');

function buildDemoResult(payload) {
  const type = payload && payload.contractType ? payload.contractType : '采购合同';
  const stance = payload && payload.stance ? payload.stance : '中立';
  const focuses = (payload && Array.isArray(payload.focuses) ? payload.focuses : []).filter(Boolean);
  const focusText = focuses.length ? focuses.join('、') : '通用条款';

  const base = [
    {
      title: '付款节点与验收未挂钩，存在先付后验风险',
      analysis: `本合同为${type}，当前条款约定"到货后 15 日内一次性付清全款"，但未约定验收合格作为付款前提。站在${stance}立场，一旦货物或服务未达约定标准，已付款项的追偿成本高，且合同未约定质量异议期，容易形成风险敞口。`,
      suggestion: '将付款条款拆分为"预付款 30% + 验收合格后付款 60% + 质保期满付款 10%"，并明确"验收合格"以双方签署的验收单为准；同时增加 7 个工作日的质量异议期。',
    },
    {
      title: '违约责任不对称，违约金额未设上限',
      analysis: `合同仅约定${stance === '甲方' ? '乙方' : '甲方'}逾期交付的违约金，未约定对方逾期付款的违约责任，且违约金按日 1% 计算且未设上限，属于不对等条款，累计金额可能远超合同总价。`,
      suggestion: '对双向违约情形分别约定责任，违约金调整为按日 0.05%，并增加"累计不超过合同总价的 20%"的上限，同时保留守约方解除权。',
    },
    {
      title: '知识产权归属约定缺失',
      analysis: `${type}履行过程中会形成交付成果、文档及衍生材料，合同未约定其知识产权归属与使用范围，后续商业化或二次开发可能产生争议。`,
      suggestion: '新增条款："本合同项下交付成果的知识产权自验收合格且款项结清之日起归甲方所有；乙方保留通用组件与既有技术的基础权利，并可在本项目案例中使用成果摘要。"',
    },
    {
      title: '保密义务未约定期限与例外情形',
      analysis: '保密条款仅表述"双方应保守商业秘密"，未约定保密期限、信息返还或销毁义务，也未列出法定例外情形，在司法实践中可执行性较弱。',
      suggestion: '明确保密期限为合同终止后 3 年；增加"法律法规要求披露、信息已进入公有领域、接收方独立开发所得"三类例外；约定终止后 15 日内返还或销毁载密材料。',
    },
    {
      title: '争议解决条款的管辖机构指向不明',
      analysis: '合同仅写"协商不成时提交仲裁"，未指定具体仲裁委员会名称与所在地，该约定可能因无法确定机构而被认定无效，导致争议长期无法进入实质程序。',
      suggestion: '明确约定"提交××仲裁委员会（位于××市）按其现行仲裁规则仲裁，仲裁裁决为终局"；如倾向诉讼，则改为"由甲方所在地有管辖权的人民法院管辖"。',
    },
    {
      title: '术语与签署信息表述不规范',
      analysis: '合同正文中"甲方""买方""需方"三种称谓混用，签署页缺少签署日期与统一社会信用代码，格式问题会影响条款解释与主体识别。',
      suggestion: '统一全文主体称谓为"甲方/乙方"，并在签署页补充签署日期、统一社会信用代码、送达地址与联系人信息。',
    },
  ];

  return {
    mode: 'demo',
    title: `${type}（${stance}立场 · 重点：${focusText}）`,
    opinions: base.map((item, index) => ({
      id: `mock-${index + 1}`,
      title: item.title,
      analysis: item.analysis,
      suggestion: item.suggestion,
      level: classifyRisk(`${item.title} ${item.analysis} ${item.suggestion}`),
    })),
    lawCheck: {
      status: 'warning',
      summary: '发现 2 处疑似旧法引用，需人工复核。',
      items: [
        { name: '《合同法》', snippet: '本合同未尽事宜，适用《中华人民共和国合同法》有关规定。' },
        { name: '《担保法》', snippet: '保证人按照《中华人民共和国担保法》承担保证责任。' },
      ],
    },
    enterprise: {
      status: 'info',
      summary: '演示结果：已按审查立场提取合作方企业名称，企业信息数据源未返回有效记录；未返回记录不等于企业无风险，请人工复核。',
    },
    reportUrl: '',
    meta: {
      model: '演示数据',
      company: '',
      steps: [
        { name: '提取合同内容', status: 'done', note: '演示文本' },
        { name: '查询企业信息', status: 'done', note: '数据源未配置' },
        { name: '审查合同条款', status: 'done', note: '演示意见' },
        { name: '生成审查报告', status: 'done', note: '演示报告' },
      ],
    },
  };
}

module.exports = { buildDemoResult };
