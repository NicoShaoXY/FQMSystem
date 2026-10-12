/**
 * 【逻辑层增强v2】研报级个股核验引擎
 * 来自《FQMSystem优化文档》逻辑层
 * 服务器端安全版本（无前端依赖）
 */

// ═══════════════════════════════════════════════════════════════
// 产业链知识图谱（独立模块，供服务端使用）
// ═══════════════════════════════════════════════════════════════

const INDUSTRY_CHAIN_MAP = {
  '新能源车': {
    upstream: ['锂矿', '钴矿', '镍矿', '稀土', '锂电池材料', '电解液', '隔膜', '正极', '负极'],
    downstream: ['整车', '充电桩', '换电站', '锂电回收', '汽车电子'],
    keywords: ['新能源汽车', '电动车', '锂电', '动力电池', '特斯拉', '宁德', '比亚迪', '华为汽车'],
    policy_keywords: ['购置税减免', '补贴', '充电桩建设', '新能源车下乡', '碳中和', '双积分']
  },
  '半导体': {
    upstream: ['硅片', '光刻胶', '电子特气', '溅射靶材', '晶圆', 'EDA软件'],
    downstream: ['消费电子', '汽车芯片', 'AI芯片', '通信设备', '封装测试'],
    keywords: ['芯片', '半导体', '集成电路', '晶圆代工', '封装', '光刻机', '中芯国际', '韦尔股份'],
    policy_keywords: ['国产替代', '大基金', '集成电路产业', '半导体扶持', '卡脖子', '自主可控']
  },
  '医药生物': {
    upstream: ['原料药', '中间体', '药用辅料', '制药设备'],
    downstream: ['医院', '药房', '线上医疗', '健康险'],
    keywords: ['创新药', '生物医药', '医疗器械', 'CXO', '疫苗', '中药', '恒瑞医药', '药明康德'],
    policy_keywords: ['医保谈判', '集中采购', '创新药审批', '医疗器械支持', 'DRG/DIP']
  },
  '白酒': {
    upstream: ['高粱', '包装', '物流'],
    downstream: ['餐饮', '礼品', '电商'],
    keywords: ['白酒', '酱香', '浓香', '清香', '贵州茅台', '五粮液', '泸州老窖', '山西汾酒'],
    policy_keywords: ['消费税', '禁酒令', '反腐', '扩产限制']
  },
  '房地产': {
    upstream: ['钢铁', '水泥', '工程机械', '建筑建材'],
    downstream: ['装修', '家电', '家具', '物业'],
    keywords: ['房地产', '万科A', '保利发展', '碧桂园', '商品房', '土拍'],
    policy_keywords: ['限购', '限贷', '降息', '降准', '棚改', '城中村', '保障房', '认房不认贷']
  },
  '军工': {
    upstream: ['特种钢材', '军工电子', '航空航天材料'],
    downstream: ['国防信息化', '无人机', '精确制导'],
    keywords: ['军工', '国防', '航天航空', '舰船', '兵器', '航发动力', '中航沈飞', '中国船舶'],
    policy_keywords: ['国防预算', '军事演习', '台海局势', '军品采购', '军工集团资产注入']
  },
  '银行': {
    upstream: ['金融科技', '支付', '征信'],
    downstream: ['企业贷款', '个人贷款', '财富管理'],
    keywords: ['银行', '国有大行', '股份制银行', '城商行', '工商银行', '建设银行', '招商银行'],
    policy_keywords: ['降息', '降准', '资本充足率', '拨备覆盖率', 'LPR', '信贷政策', '监管']
  },
  '券商': {
    upstream: ['交易所', '登记公司'],
    downstream: ['机构客户', '高净值客户', '财富管理'],
    keywords: ['券商', '证券', '投行', '经纪业务', '中信证券', '中金公司', '华泰证券'],
    policy_keywords: ['注册制', '全面注册制', '交易制度改革', 'T+0', '科创板做市商']
  },
  '消费': {
    upstream: ['农产品', '食品加工', '包装'],
    downstream: ['电商', '超市', '便利店'],
    keywords: ['消费', '食品饮料', '家电', '纺织服装', '免税', '中国中免', '珀莱雅', '海天味业'],
    policy_keywords: ['消费券', '以旧换新', '促消费', '消费税减免', '内循环', '扩内需']
  },
  '化工': {
    upstream: ['石油', '天然气', '煤炭'],
    downstream: ['塑料', '橡胶', '化纤', '农药', '化肥'],
    keywords: ['化工', '石化', '煤化工', '万华化学', '卫星化学', '华鲁恒升'],
    policy_keywords: ['双碳', '限产', '环保限产', '能耗双控', '化工园区']
  },
  '有色金属': {
    upstream: ['矿山', '采矿设备'],
    downstream: ['电力', '建筑', '汽车', '航空航天'],
    keywords: ['有色', '铜', '铝', '锂', '钴', '稀土', '紫金矿业', '洛阳钼业', '北方稀土'],
    policy_keywords: ['碳中和', '新能源需求', '稀土管控', '矿产资源税']
  },
  '光伏': {
    upstream: ['硅料', '硅片', '设备'],
    downstream: ['光伏电站', '储能', '电力运营'],
    keywords: ['光伏', '硅料', '硅片', '电池片', '组件', '隆基绿能', '通威股份', '阳光电源'],
    policy_keywords: ['光伏补贴', '绿电', '碳中和', '沙漠戈壁', '整县光伏', '风光大基地']
  },
  '电力能源': {
    upstream: ['煤炭', '天然气', '核燃料', '水力', '风力'],
    downstream: ['电网', '配电', '售电', '储能', '电力设备'],
    keywords: ['电力', '能源', '电气', '发电', '核电', '水电', '风电', '电网', '东方电气', '上海电气', '国电南瑞', '华能国际', '长江电力'],
    policy_keywords: ['电改', '碳达峰', '碳中和', '绿电交易', '新型电力系统', '特高压', '抽水蓄能']
  },
  '机械设备': {
    upstream: ['钢铁', '轴承', '液压件', '减速器', '电机'],
    downstream: ['工程机械', '工业自动化', '机床', '激光设备', '3D打印'],
    keywords: ['机械', '设备', '工程', '重工', '自动化', '机器人', '三一重工', '徐工机械', '中联重科', '汇川技术'],
    policy_keywords: ['智能制造', '工业4.0', '设备更新', '以旧换新', '制造强国', '专精特新']
  },
  '通信': {
    upstream: ['光纤', '光缆', '芯片', '射频器件', '天线'],
    downstream: ['运营商', '5G应用', '物联网', '云计算', '数据中心'],
    keywords: ['通信', '5G', '光纤', '光缆', '中兴通讯', '烽火通信', '中国联通', '中国移动'],
    policy_keywords: ['5G建设', '新基建', '千兆光网', '算力网络', '东数西算']
  },
  '软件信息': {
    upstream: ['操作系统', '数据库', '中间件', '开发工具'],
    downstream: ['SaaS', '云服务', '网络安全', '人工智能应用', '数字政府'],
    keywords: ['软件', '信息', '科技', '数字', '用友', '金山办公', '科大讯飞', '中科创达', '恒生电子'],
    policy_keywords: ['信创', '国产软件', '数字经济', '数据要素', 'AI+', '数字化转型']
  },
  '建材建筑': {
    upstream: ['水泥', '玻璃', '钢铁', '砂石'],
    downstream: ['基建', '市政', '路桥', '水利', '房建'],
    keywords: ['建材', '建筑', '水泥', '玻璃', '装饰', '中国建筑', '海螺水泥', '中国中铁', '中国交建'],
    policy_keywords: ['基建投资', '一带一路', '专项债', '城中村', '保障房', '城市更新']
  },
  '纺织服装': {
    upstream: ['棉花', '化纤', '染料', '纺织机械'],
    downstream: ['品牌服饰', '运动', '快时尚', '电商', '直播带货'],
    keywords: ['纺织', '服装', '服饰', '面料', '安踏', '李宁', '海澜之家', '波司登'],
    policy_keywords: ['国潮', '消费升级', '跨境电商', '新疆棉']
  },
  '农业': {
    upstream: ['种子', '化肥', '农药', '饲料'],
    downstream: ['种植', '养殖', '农产品加工', '食品加工', '冷链物流'],
    keywords: ['农业', '种业', '养殖', '饲料', '化肥', '牧原股份', '温氏股份', '隆平高科', '新希望'],
    policy_keywords: ['粮食安全', '种业振兴', '乡村振兴', '农业现代化', '转基因', '生猪调控']
  },
  // ===== 新兴产业扩展 =====
  'AI算力': {
    upstream: ['芯片', '光模块', 'PCB', '服务器', '液冷'],
    downstream: ['大模型', '云计算', '边缘计算', '智能驾驶', '机器人'],
    keywords: ['AI', '人工智能', '算力', '大模型', '服务器', '浪潮信息', '中科曙光', '工业富联', '寒武纪', '海光信息'],
    policy_keywords: ['新基建', '东数西算', '算力补贴', '智能算力', '数字经济']
  },
  '机器人': {
    upstream: ['减速器', '伺服电机', '控制器', '传感器', '芯片'],
    downstream: ['工业机器人', '服务机器人', '人形机器人', '医疗机器人', '物流机器人'],
    keywords: ['机器人', '减速器', '绿的谐波', '埃斯顿', '拓普股份', '三花智控', '汇川技术', '智能机器人'],
    policy_keywords: ['智能制造', '工业4.0', '机器换人', '人形机器人', '专精特新']
  },
  '低空经济': {
    upstream: ['碳纤维', '电池', '电机', '航电系统'],
    downstream: ['eVTOL', '无人机配送', '低空旅游', '城市空中交通', '应急救援'],
    keywords: ['低空', 'eVTOL', '无人机', '亿航智能', '万丰奥威', '中信海直', '宗申动力', '研制'],
    policy_keywords: ['低空经济', '空域开放', '无人机试点', '城市空中交通', 'eVTOL适航']
  },
  '商业航天': {
    upstream: ['火箭发动机', '卫星平台', '载荷', '测控系统'],
    downstream: ['卫星互联网', '遥感', '通信', '导航增强', '太空旅游'],
    keywords: ['航天', '火箭', '卫星', 'SpaceX', '星链', '中国卫星', '航天动力', '航天电子', '北斗'],
    policy_keywords: ['商业航天', '卫星互联网', '火箭可复用', '发射许可', '新基建']
  },
  '数字货币': {
    upstream: ['加密算法', '区块链', '芯片', '安全模块'],
    downstream: ['支付', '跨境结算', '数字资产', 'DeFi', '供应链金融'],
    keywords: ['数字货币', 'DCEP', '央行数字货币', '区块链', '数字人民币', '恒宝股份', '楚天龙', '新国都'],
    policy_keywords: ['数字人民币', '跨境支付', '数字资产', '区块链扶持', '金融科技']
  },
  '存储芯片': {
    upstream: ['硅片', '光刻机', '刻蚀设备', '沉积设备'],
    downstream: ['手机', 'PC', '服务器', 'AI服务器', '汽车电子'],
    keywords: ['存储', '内存', 'DRAM', 'NAND', '长江存储', '合肥长鑫', '北京君正', '兆易创新'],
    policy_keywords: ['国产替代', '存储国产化', '大基金', '先进制程']
  },
  '先进封装': {
    upstream: ['封装材料', '测试设备', '光刻机', '贴片机'],
    downstream: ['AI芯片', '高性能计算', '汽车芯片', '5G射频'],
    keywords: ['先进封装', 'Chiplet', 'CoWoS', 'HBM', '封装测试', '长电科技', '通富微电', '华天科技'],
    policy_keywords: ['国产替代', '先进封装突破', '芯片突围', '后道工艺']
  },
  '氢能源': {
    upstream: ['电解槽', '储氢瓶', '质子交换膜', '催化剂', '氢气'],
    downstream: ['氢燃料电池', '氢能汽车', '氢能重卡', '工业脱碳', '绿氢炼钢'],
    keywords: ['氢能', '氢燃料', '绿氢', '制氢', '亿华通', '国鸿氢能', '美锦能源', '隆基氢能'],
    policy_keywords: ['氢能规划', '绿氢补贴', '氢能示范', '双碳', '氢能车示范']
  },
  '钠离子电池': {
    upstream: ['钠矿', '正极材料', '负极材料', '电解液'],
    downstream: ['储能', '低速电动车', '两轮车', '基站备用电源'],
    keywords: ['钠离子', '钠电池', '储能', '宁德时代', '比亚迪', '钠电', '维科技术', '传艺科技'],
    policy_keywords: ['新型储能', '钠电示范', '安全电池', '储能补贴']
  },
  '固态电池': {
    upstream: ['固态电解质', '正极材料', '负极材料', '隔膜'],
    downstream: ['新能源汽车', '高端手机', '无人机', '航空'],
    keywords: ['固态电池', '全固态', '固态', '宁德时代', '比亚迪', '国轩高科', '赣锋锂业', '宁德', '比亚迪'],
    policy_keywords: ['技术突破', '电池安全', '新能源车安全', '能量密度']
  },
  '海上风电': {
    upstream: ['风机', '塔筒', '海底电缆', '安装船'],
    downstream: ['海上电站', '海上新能源', '海洋牧场', '海水制氢'],
    keywords: ['海上风电', '海风', '风电', '明阳智能', '金风科技', '三峡能源', '东方电气'],
    policy_keywords: ['海上风电补贴', '深蓝风电', '海风大基地', '双碳']
  },
  '虚拟电厂': {
    upstream: ['分布式能源', '储能', '电动车充电桩', '需求侧响应'],
    downstream: ['电网调度', '电力交易', '削峰填谷', '绿电交易'],
    keywords: ['虚拟电厂', 'VPP', '需求侧', '储能调度', '国网英大', '国电南瑞', '恒华科技'],
    policy_keywords: ['虚拟电厂试点', '电力市场改革', '需求响应', '新型电力系统']
  },
  '充换电': {
    upstream: ['充电桩', '充电模块', '运营平台', '电池'],
    downstream: ['新能源汽车', '出租车', '网约车', '城市补能网络'],
    keywords: ['充电', '换电', '充电桩', '特锐德', '星星充电', '宁德时代', '蔚来', 'BaaS'],
    policy_keywords: ['充电基建', '换电试点', '城乡充电网络', '新基建']
  },
  '车路云': {
    upstream: ['传感器', '雷达', '芯片', '高精地图', '算力'],
    downstream: ['智能驾驶', '车联网', '智慧交通', '自动驾驶', '无人驾驶'],
    keywords: ['车路云', '智能驾驶', '自动驾驶', '车联网', 'V2X', '华为', '百度', '地平线', '德赛西威'],
    policy_keywords: ['智能网联', '车路云试点', '自动驾驶试点', '高精地图', '智能交通']
  },
  '智能驾驶': {
    upstream: ['芯片', '传感器', '算法', '高精地图', '线控底盘'],
    downstream: ['乘用车', '商用车', '物流车', 'Robotaxi', '无人配送'],
    keywords: ['智能驾驶', '自动驾驶', '智驾', '华为', '百度', '地平线', '德赛西威', '四维图新', '中科创达'],
    policy_keywords: ['智能驾驶试点', '自动驾驶法规', '高精地图', '车路协同', '智能汽车']
  },
  '量子科技': {
    upstream: ['量子芯片', '稀释制冷机', '测控系统', '光子源'],
   下游: ['量子通信', '量子计算', '量子传感', '金融加密', '药物研发'],
    keywords: ['量子', '量子计算', '量子通信', '量子保密', '国盾量子', '中科曙光', '本源量子', '玻色量子'],
    policy_keywords: ['量子科技', '量子技术突破', '量子通信网', '量子计算原型机']
  }
};

/**
 * 研报级核验：评估个股逻辑完整度（0~100分）
 * 来自《优化文档》逻辑层：从"Factor-Driven"到"Logic-Driven"
 */
function verifyResearchLogic(stock, hotSectors = []) {
  const name = stock.name || '';
  const code = stock.code || '';
  let score = 50;
  const findings = [];
  const checks = [];

  // 1. 行业逻辑
  const matchedChain = Object.entries(INDUSTRY_CHAIN_MAP).find(([chainName, chain]) => {
    const allKeywords = [...chain.keywords, ...chain.upstream, ...chain.downstream];
    return allKeywords.some(kw => name.includes(kw) || code.includes(kw));
  });

  if (matchedChain) {
    const [chainName, chain] = matchedChain;
    score += 20;
    checks.push({ item: '行业归属', result: chainName, pass: true });
    findings.push(`✅ 归属产业链: ${chainName}`);

    if (hotSectors.some(hs => chainName.includes(hs) || hs.includes(chainName))) {
      score += 15;
      findings.push(`✅ 产业链处于热点: ${chainName}`);
      checks.push({ item: '热点共振', result: chainName, pass: true });
    } else {
      score -= 5;
      findings.push(`⚠️ ${chainName}不在热点板块中`);
    }

    const upstreamMatched = chain.upstream.some(kw => name.includes(kw));
    const downstreamMatched = chain.downstream.some(kw => name.includes(kw));
    if (upstreamMatched && downstreamMatched) {
      score += 15;
      findings.push(`✅ 具备上下游完整传导逻辑`);
      checks.push({ item: '产业链传导', result: '上下游贯通', pass: true });
    } else if (upstreamMatched || downstreamMatched) {
      score += 10;
      findings.push(`✅ 具备上下游传导逻辑`);
      checks.push({ item: '产业链传导', result: '具备', pass: true });
    }
  } else {
    score -= 10;
    findings.push(`⚠️ 未匹配到产业链`);
    checks.push({ item: '行业归属', result: '未匹配', pass: false });
  }

  // 2. 政策共振
  const policyKeywords = Object.values(INDUSTRY_CHAIN_MAP)
    .flatMap(c => c.policy_keywords);
  const policyMatch = policyKeywords.filter(pkw => name.includes(pkw));
  if (policyMatch.length > 0) {
    score += 15;
    findings.push(`✅ 政策关键词: ${policyMatch.join(', ')}`);
    checks.push({ item: '政策共振', result: policyMatch[0], pass: true });
  }

  // 3. 风险检查
  const riskKeywords = ['ST', '*ST', '退市', '暂停上市', '重大亏损', '债务违约', '商誉爆雷'];
  const hasRisk = riskKeywords.some(rk => name.includes(rk));
  if (hasRisk) {
    score -= 30;
    findings.push('🚨 风险预警：含风险关键词');
    checks.push({ item: '风险筛查', result: '含风险词', pass: false });
  }

  // 4. 涨停风险
  if ((stock.chg || stock.change_percent || 0) >= 9.5) {
    score -= 15;
    findings.push('⚠️ 已涨停，短线追高风险较大');
    checks.push({ item: '涨停风险', result: '已涨停', pass: false });
  }

  // 5. 流动性检查
  const dailyAmount = (stock.price || 0) * (stock.volume || 0);
  if (dailyAmount < 50000000) {
    score -= 10;
    findings.push(`⚠️ 流动性偏低（日成交额约${(dailyAmount/1e8).toFixed(1)}亿 < 0.5亿）`);
    checks.push({ item: '流动性', result: '偏低', pass: false });
  } else {
    checks.push({ item: '流动性', result: '正常', pass: true });
  }

  score = Math.max(0, Math.min(100, score));
  const passed = score >= 70;

  return {
    score,
    passed,
    level: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D',
    findings,
    checks,
    matchedChain: matchedChain?.[0] || null,
    policyMatched: policyMatch,
    _source: 'llm_simulation_v2'
  };
}

function getCurrentHotSectors() {
  return ['新能源', '半导体', '医药', '白酒', '军工', 'AI', '光伏', '消费'];
}

export {
  INDUSTRY_CHAIN_MAP,
  verifyResearchLogic,
  getCurrentHotSectors
};
