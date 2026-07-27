#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_ROSTER =
  'docs/campus-directory-proofreading/beijing-orientation-official-source-crawl.json'
const DEFAULT_GAP =
  'docs/campus-directory-proofreading/beijing-wechat-dining-platform-review.json'
const DEFAULT_OUTPUT =
  'docs/campus-directory-proofreading/beijing-dining-platform-official-gap-review.json'

const SOURCE = {
  buptDining: {
    title: '北京邮电大学后勤处：餐饮服务',
    url: 'https://hq.bupt.edu.cn/info/1006/1096.htm',
    source_type: 'school_official_dining_page',
    published_at: '2025-09-04',
  },
  buptAccount: {
    title: '北京邮电大学后勤处暑假服务通知',
    url: 'https://hq.bupt.edu.cn/info/1010/1537.htm',
    source_type: 'school_official_logistics_notice',
    published_at: '2026-07-14',
  },
  centuryAccount: {
    title: '北京邮电大学世纪学院2026年报考指南',
    url: 'https://zhaoban.ccbupt.cn/zsdt/b1bd37f7678b496cb546b668315efcfb.htm',
    source_type: 'school_official_admissions_page',
    published_at: '2026-07-09',
  },
  centuryFacility: {
    title: '北京邮电大学世纪学院食堂后厨送风系统改造项目招标公告',
    url: 'https://www.ccbupt.cn/tzgg/c6d22a130a1f415393fc52d0ccdb167b.htm',
    source_type: 'school_official_procurement_supporting_only',
    published_at: '2026-06-05',
  },
  ncutCurrent: {
    title: '北方工业大学：校领导检查新学期开学准备工作',
    url: 'https://www.ncut.edu.cn/info/1086/24001.htm',
    source_type: 'school_official_news',
    published_at: '2025-09-09',
  },
  ncutHistorical: {
    title: '北方工业大学：校领导检查秋季开学准备工作',
    url: 'https://www.ncut.edu.cn/info/1086/14526.htm',
    source_type: 'school_official_news',
    published_at: '2022-08-25',
  },
  ncepuDining: {
    title: '华北电力大学后勤服务集团：餐饮服务',
    url: 'https://hqjt.ncepu.edu.cn/wsbsdt/105929.htm',
    source_type: 'school_official_dining_service_page',
    published_at: '',
  },
  ncepuAccountA: {
    title: '华北电力大学后勤服务集团通知',
    url: 'https://hqjt.ncepu.edu.cn/tztg1/tztg2/77b65e8742bd462492b6923705ec5b4f.htm',
    source_type: 'school_official_logistics_notice',
    published_at: '2021-07-14',
  },
  ncepuAccountB: {
    title: '华北电力大学新闻网转载后勤服务信息',
    url: 'https://news.ncepu.edu.cn/mthd/2bc21004d6f94d939abc36d670ce855b.htm',
    source_type: 'school_official_news',
    published_at: '2021-02-05',
  },
  uibeGuide: {
    title: '对外经济贸易大学新生入学指南：校园服务设施指南',
    url: 'https://aeo.uibe.edu.cn/uploadfile/zjc_v3/front/default/upload_file_68242.pdf',
    source_type: 'school_official_newcomer_guide_pdf',
    published_at: '',
    page: 44,
  },
  cuebDining: {
    title: '首都经济贸易大学招生办公室：校园生活—餐饮服务',
    url: 'https://zs.cueb.edu.cn/dcjm/xysh/64401.htm',
    source_type: 'school_official_admissions_page',
    published_at: '2023-11-03',
  },
  cuebCurrent: {
    title: '首都经济贸易大学2026年考试服务信息',
    url: 'https://mba.cueb.edu.cn/zsxx/81efaa7256234a438505af65929d8275.htm',
    source_type: 'school_official_notice',
    published_at: '2026-03-11',
  },
  kedeDining: {
    title: '首都师范大学科德学院校园新闻：科德食堂',
    url: 'https://www.kdcnu.com/xwzx/xwjx/webinfo/2025/11/1765734082073526.htm',
    source_type: 'school_official_news',
    published_at: '2025-11-20',
  },
  shougangReport: {
    title: '首钢工学院高等职业教育质量年度报告（2025年度）',
    url: 'https://jw.beijing.gov.cn/bjzj/gdzyreport/gdreport/202605/P020260507560030966729.pdf',
    source_type: 'education_authority_hosted_school_report',
    published_at: '2026-05-07',
  },
  policeProcurement: {
    title: '北京警察学院食堂管理服务项目成交公告',
    url: 'https://ggzyfw.beijing.gov.cn/jyxxzbjggg/20211213/2391339.html',
    source_type: 'government_procurement_result',
    published_at: '2021-12-13',
  },
  policeCurrentFacility: {
    title: '北京警察学院物业管理服务项目公开招标文件',
    url: 'https://ggzyfw.beijing.gov.cn/cmsbj/u/cms/cn.gov.bjggzyfw.www/202602/14112028faqn.pdf',
    source_type: 'government_procurement_current_facility',
    published_at: '2026-02-14',
    page: 37,
  },
  uirHoliday: {
    title: '国际关系学院2019年寒假期间值班等有关工作汇总',
    url: 'https://wlzx.uir.cn/info/1162/1351.htm',
    source_type: 'school_official_notice',
    published_at: '2019-01-11',
  },
  capitalSportsGuide: {
    title: '首都体育学院国际教育学院招生手册',
    url: 'https://sie-lb.cupes.edu.cn/docs/2019-04/ad9d333b92774c4bbc58aaa1b69ab325.pdf',
    source_type: 'school_official_brochure_pdf',
    published_at: '2019-04-01',
  },
  capitalSportsCenter: {
    title: '首都体育学院餐饮服务中心采购公告',
    url: 'https://www.cupes.edu.cn/docs/2025-01/3b6b52f543a341d3ab5787bc0c1c5845.pdf',
    source_type: 'school_official_procurement',
    published_at: '2025-01-01',
  },
  capitalSportsCurrent: {
    title: '首都体育学院2025年博士研究生招生考试初试安排',
    url: 'https://gs.cupes.edu.cn/zsgz/zstz/499de0dad5b746eeacb16b4a67ebe511.htm',
    source_type: 'school_official_graduate_notice',
    published_at: '2025-04-15',
  },
  artMediaReport: {
    title: '北京艺术传媒职业学院教育质量年度报告（2025年度）',
    url: 'https://jw.beijing.gov.cn/bjzj/gdzyreport/gdreport/202605/P020260507560027816893.pdf',
    source_type: 'education_authority_hosted_school_report',
    published_at: '2026-05-07',
  },
  youthNews: {
    title: '北京青年政治学院秋季学期开学准备工作',
    url: 'https://www.bjypc.edu.cn/xww/bqyw/4c89920696a849fdb5721340e2122e17.htm',
    source_type: 'school_official_news',
    published_at: '',
  },
  uirDisclosure: {
    title: '国际关系学院信息公开：后勤保障',
    url: 'https://www.uir.edu.cn/xxgkw.htm',
    source_type: 'school_official_information_disclosure',
    published_at: '',
  },
  uirAnniversary: {
    title: '国际关系学院75周年校庆期间活动提醒',
    url: 'https://www.uir.cn/info/1331/21031.htm',
    source_type: 'school_official_notice',
    published_at: '2024-10-17',
  },
  cfauOffice: {
    title: '外交学院后勤办公室职责简介',
    url: 'https://www.cfau.edu.cn/col2842/col2854/col3793/col3804/index.htm',
    source_type: 'school_official_organization_page',
    published_at: '2025-05-01',
  },
  cfauExhibitionHalal: {
    title: '外交学院展览路校区清真餐厅翻新项目采购公告',
    url: 'https://www.cfau.edu.cn/col2842/col2854/col3793/col3806/1f0de4d4ba1f4dabb3b0446ad0c83962.htm',
    source_type: 'school_official_procurement_current_facility',
    published_at: '2024-12-02',
  },
  cfauShaheDiningFirst: {
    title: '外交学院沙河校区餐饮中心首层供暖管线维修公告',
    url: 'https://www.cfau.edu.cn/col2842/col2854/col3793/col3806/718cf29e673a4f8e8e814fc25fd67e32.htm',
    source_type: 'school_official_procurement_current_floor',
    published_at: '2024-06-27',
  },
  shougangCurrent: {
    title: '首钢工学院微信校园电子校园卡绑定通知',
    url: 'https://www.sgit.edu.cn/info/1067/3135.htm',
    source_type: 'school_official_notice',
    published_at: '2024-04-17',
  },
  cnuDiningTender: {
    title: '首都师范大学食堂（餐厅）委托经营服务项目-比选公告',
    url: 'https://www.cnu.edu.cn/tzgg/cggg/b165eb0d0d0e4bfdb9fe76939200ef93.htm',
    source_type: 'school_official_current_dining_procurement',
    published_at: '2026-07-03',
  },
  cnuCurrentFacilities: {
    title: '首都师范大学2025年学校实事工程完成公告',
    url: 'https://www.cnu.edu.cn/tzgg/xygg/3f3741a229da488c8ff5bc95e46f6bc1.blk.htm',
    source_type: 'school_official_logistics_current_facility',
    published_at: '2025-12-30',
  },
  cnuIndexedCampusList: {
    title: '首都师范大学食堂分校区公开索引介绍',
    url: 'https://www.sohu.com/a/625890367_121394263',
    source_type: 'public_index_secondary_repost',
    published_at: '2023-01-06',
  },
  cnuIndexedLiangxiang: {
    title: '首都师范大学良乡校区食堂公开索引介绍',
    url: 'https://www.sohu.com/a/831496650_121867189',
    source_type: 'public_index_secondary_repost',
    published_at: '2024-12-02',
  },
  youthCurrent: {
    title: '北京青年政治学院欢迎2024级新同学',
    url: 'https://www.bjypc.edu.cn/xww/bqyw/4c89920696a849fdb5721340e2122e17.htm',
    source_type: 'school_official_current_news',
    published_at: '2024-09-07',
  },
  bftcCenterCurrent: {
    title: '北京财贸职业学院产教融合实训中心建设项目南门开口树木伐移工程比选公告',
    url: 'https://www.bjczy.edu.cn/folder57/folder94/2026-07-06/I4bzh0VlOHR8KEJu.html',
    source_type: 'school_official_current_procurement_location',
    published_at: '2026-07-06',
  },
  bftcCenterSupply: {
    title: '北京财贸职业学院校本部中心食堂原材料供应商校内比选结果公示',
    url: 'https://www.bjczy.edu.cn/folder57/folder94/2024-08-23/zEN7vrJs01dhrJmL.html',
    source_type: 'school_official_dining_procurement',
    published_at: '2024-08-23',
  },
  bftcIndexedGuide: {
    title: '北京财贸职业学院云探校食堂公开索引',
    url: 'https://www.sohu.com/a/700045177_121118944',
    source_type: 'public_index_secondary_repost',
    published_at: '2023-07-14',
  },
  financeTechAdmissions: {
    title: '北京金融科技学院本科招生网校园环境',
    url: 'https://zsb.canvard.net.cn/',
    source_type: 'school_official_admissions_current',
    published_at: '2026-01-01',
  },
  financeTechIndexedAccount: {
    title: '北京金融科技学院校园活动公众号公开索引镜像',
    url: 'https://kandian.sina.cn/article_7857201856_1d45362c001902s5m0.html?from=cul',
    source_type: 'public_account_index_secondary_mirror',
    published_at: '2026-05-20',
  },
  centuryHistoricalDining: {
    title: '北京邮电大学世纪学院学生食堂经营项目公开招标公告',
    url: 'https://ccbupt.cn/tzgg/0c461a2693c24726967000418a21b440.htm',
    source_type: 'school_official_historical_dining_procurement',
    published_at: '2016-12-13',
  },
  civilDaxingCurrent: {
    title: '民政职业大学教工餐厅服务商比选公告',
    url: 'https://www.bcsa.edu.cn/info/1021/8612.htm',
    source_type: 'school_official_current_dining_procurement',
    published_at: '2026-01-19',
  },
  civilDaxingStructure: {
    title: '民政职业大学大兴校区餐厅信息化建设项目采购公告',
    url: 'https://www.bcsa.edu.cn/info/1021/8328.htm',
    source_type: 'school_official_current_facility',
    published_at: '2025-10-29',
  },
  civilDaxingFloorMap: {
    title: '大兴校区餐厅一层学生基本伙食堂劳务派遣服务采购公告',
    url: 'https://www.bcsa.edu.cn/info/1021/2053.htm',
    source_type: 'school_official_dining_floor_map',
    published_at: '2023-08-08',
  },
  civilYanjiaoCurrent: {
    title: '民政职业大学燕郊校区风味食堂承包项目成交公告',
    url: 'https://www.bcsa.edu.cn/info/1021/9839.htm',
    source_type: 'school_official_current_dining_procurement',
    published_at: '2026-07-08',
  },
  artMediaCurrentCanteen: {
    title: '北艺传媒校园食堂：舌尖上的温暖，记忆中的家',
    url: 'http://www.bjamu.cn/view.html?id=21972',
    source_type: 'school_official_current_canteen_feature',
    published_at: '2025-05-30',
  },
  artMediaCurrentLogistics: {
    title: '北艺传媒后勤管理：温馨服务，打造师生满意校园',
    url: 'http://www.bjamu.cn/view.html?id=21997',
    source_type: 'school_official_current_logistics_feature',
    published_at: '2025-06-09',
  },
}

const GAP_REVIEW = {
  '4111010009': {
    audit_status: 'partial_current_relations',
    relations: [
      ['毓秀餐厅', '一层', '一层休闲区', 'current_official_relation', SOURCE.ncutCurrent],
      ['尚德餐厅', '', '', 'current_official_name_only', SOURCE.ncutCurrent],
      ['金鼎学生食堂', '', '', 'current_official_name_only', SOURCE.ncutCurrent],
    ],
    sources: [SOURCE.ncutCurrent, SOURCE.ncutHistorical],
    remaining_gap: '毓秀餐厅二层只在2022年材料出现；尚德餐厅、金鼎学生食堂当前材料未给出楼层。',
  },
  '4111010013': {
    audit_status: 'usable_current_relation_and_account',
    accounts: [
      {
        account_name: '后勤服务',
        account_scope: 'school_logistics',
        verification_status: 'official_site_verified_current',
        verification_note: '北邮后勤处2026年暑假通知明确写明“北邮后勤部公众号‘后勤服务’”。',
        verification_url: SOURCE.buptAccount.url,
      },
    ],
    relations: [
      ['学生食堂', '一层', '学一餐厅', 'current_official_relation', SOURCE.buptDining],
      ['学生食堂', '二层', '学二清真餐厅', 'current_official_relation', SOURCE.buptDining],
      ['学生食堂', '三层', '楼上楼餐厅', 'current_official_relation', SOURCE.buptDining],
      ['新食堂', '一层', '风味餐厅', 'current_official_relation', SOURCE.buptDining],
      ['新食堂', '二层', '学宜餐厅／智慧餐厅', 'current_official_relation', SOURCE.buptDining],
      ['新食堂', '三层', '食尚餐厅（教工餐厅）', 'current_official_relation', SOURCE.buptDining],
      ['新食堂', '四层', '民族餐厅', 'current_official_relation', SOURCE.buptDining],
      ['学苑风味餐厅', '平层', '', 'current_official_relation', SOURCE.buptDining],
      ['南区学生食堂', '一层', '南区学生餐厅一层', 'current_official_relation', SOURCE.buptDining],
      ['南区学生食堂', '二层', '南区学生餐厅二层／智慧餐厅', 'current_official_relation', SOURCE.buptDining],
      ['教工食堂', '一层', '教工一层餐厅', 'current_official_relation', SOURCE.buptDining],
      ['教工食堂', '二层', '教工二层餐厅', 'current_official_relation', SOURCE.buptDining],
      ['教工食堂', '三层', '教工三层餐厅', 'current_official_relation', SOURCE.buptDining],
      ['教工食堂', '四层', '教工四层餐厅', 'current_official_relation', SOURCE.buptDining],
      ['教工食堂', '五层', '教工五层餐厅', 'current_official_relation', SOURCE.buptDining],
      ['风味食堂', '二层', '风味餐厅二层', 'current_official_relation', SOURCE.buptDining],
      ['风味食堂', '三层', '风味餐厅三层', 'current_official_relation', SOURCE.buptDining],
      ['风味食堂', '四层', '风味餐厅四层', 'current_official_relation', SOURCE.buptDining],
      ['风味食堂', '五层', '风味餐厅五层', 'current_official_relation', SOURCE.buptDining],
    ],
    sources: [SOURCE.buptDining, SOURCE.buptAccount],
    remaining_gap: '',
  },
  '4111010025': {
    audit_status: 'owner_confirmed_existing',
    sources: [],
    remaining_gap: '',
    note: '沿用用户已确认结构：一个食堂；一楼第一餐厅、清真食堂；二楼第二餐厅；三楼第三餐厅。本轮不重复覆盖。',
  },
  '4111010028': {
    audit_status: 'official_organization_only',
    sources: [],
    remaining_gap: '已确认学校后勤保障部门存在，但尚未找到校方页面明确列出食堂名称与楼层，也未核实餐饮专属公众号名称。',
  },
  '4111010029': {
    audit_status: 'partial_current_relations',
    relations: [
      ['学校食堂', '二层', '', 'current_official_relation', SOURCE.capitalSportsCurrent],
      ['学生食堂', '', '', 'historical_official_name_only', SOURCE.capitalSportsGuide],
      ['穆斯林餐厅', '', '', 'historical_official_name_only', SOURCE.capitalSportsGuide],
    ],
    sources: [
      SOURCE.capitalSportsCurrent,
      SOURCE.capitalSportsGuide,
      SOURCE.capitalSportsCenter,
    ],
    remaining_gap: '2025年研究生招生通知确认学校食堂二层当前对外供餐；2019年手册中的“学生食堂、穆斯林餐厅”未与当前楼层建立唯一对应，仍只作历史参考。',
  },
  '4111010036': {
    audit_status: 'usable_current_relations',
    relations: [
      ['第一食堂', '一楼', '', 'current_official_relation', SOURCE.uibeGuide],
      ['第一食堂', '二楼', '', 'current_official_relation', SOURCE.uibeGuide],
      ['第一食堂', '三楼', '', 'current_official_relation', SOURCE.uibeGuide],
      ['第一食堂', '四楼', '教工餐厅', 'current_official_relation', SOURCE.uibeGuide],
      ['第二食堂', '', '', 'current_official_name_only', SOURCE.uibeGuide],
      ['清真食堂', '一楼', '部分窗口提供基本伙食保障', 'current_official_relation', SOURCE.uibeGuide],
      ['清真食堂', '二楼', '', 'current_official_relation', SOURCE.uibeGuide],
      ['惠园餐厅', '', '博学楼东侧', 'current_official_name_only', SOURCE.uibeGuide],
      ['汇美食代美食广场', '负一层', '国际交流大厦A座', 'current_official_relation', SOURCE.uibeGuide],
    ],
    sources: [SOURCE.uibeGuide],
    remaining_gap: '第二食堂、惠园餐厅的校方指南未给出楼层。',
  },
  '4111010038': {
    audit_status: 'usable_current_relations',
    relations: [
      ['第二餐厅', '一层', '', 'current_official_relation', SOURCE.cuebDining],
      ['第二餐厅', '二层', '', 'current_official_relation', SOURCE.cuebDining],
      ['第二餐厅', '三层', '', 'current_official_relation', SOURCE.cuebDining],
      ['第三餐厅', '一层', '', 'current_official_relation', SOURCE.cuebDining],
      ['第三餐厅', '二层', '', 'current_official_relation', SOURCE.cuebDining],
      ['第三餐厅', '三层', '', 'current_official_relation', SOURCE.cuebDining],
      ['华侨学院餐厅', '', '', 'current_official_name_only', SOURCE.cuebDining],
      ['红庙校区餐厅', '一层', '', 'current_official_relation', SOURCE.cuebDining],
      ['红庙校区餐厅', '二层', '', 'current_official_relation', SOURCE.cuebDining],
    ],
    sources: [SOURCE.cuebDining, SOURCE.cuebCurrent],
    remaining_gap: '华侨学院餐厅的校方页面未给出楼层。',
  },
  '4111010040': {
    audit_status: 'partial_current_relations',
    relations: [
      ['清真餐厅', '', '展览路校区', 'current_official_name_only', SOURCE.cfauExhibitionHalal],
      ['餐饮中心', '一层', '沙河校区', 'current_official_relation', SOURCE.cfauShaheDiningFirst],
    ],
    sources: [
      SOURCE.cfauExhibitionHalal,
      SOURCE.cfauShaheDiningFirst,
      SOURCE.cfauOffice,
    ],
    remaining_gap: '当前校方后勤公告已确认展览路校区清真餐厅及沙河校区餐饮中心一层；展览路清真餐厅楼层、沙河餐饮中心其他楼层与窗口仍待官方材料补齐。',
  },
  '4111010042': {
    audit_status: 'current_names_floor_mapping_missing',
    relations: [
      ['学一食堂', '', '', 'current_official_name_only', SOURCE.uirAnniversary],
      ['学二食堂', '', '', 'current_official_name_only', SOURCE.uirAnniversary],
      ['教工食堂', '', '', 'current_official_name_only', SOURCE.uirAnniversary],
      ['一层食堂', '一层', '', 'historical_official_relation', SOURCE.uirHoliday],
      ['二层清真食堂', '二层', '', 'historical_official_relation', SOURCE.uirHoliday],
    ],
    sources: [SOURCE.uirAnniversary, SOURCE.uirDisclosure, SOURCE.uirHoliday],
    remaining_gap: '2024年校庆通知确认学一、学二、教工食堂当前名称；2019年“一层食堂、二层清真食堂”不能与这些当前名称安全合并，因此当前楼层映射仍空缺。',
  },
  '4111011626': {
    audit_status: 'generic_canteen_only',
    sources: [SOURCE.youthNews],
    remaining_gap: '当前校方新闻只写“学生食堂”，未证明这是正式名称，也未列楼层或餐饮公众号。',
  },
  '4111011831': {
    audit_status: 'partial_current_relations',
    relations: [
      ['东食堂', '', '基本伙窗口2个（数量信息，不生成窗口名）', 'current_official_name_only', SOURCE.shougangCurrent],
      ['西食堂', '一层', '基本伙窗口范围', 'current_official_relation', SOURCE.shougangCurrent],
      ['西食堂', '二层', '清真拉面窗口', 'current_official_relation', SOURCE.shougangCurrent],
    ],
    sources: [SOURCE.shougangCurrent, SOURCE.shougangReport],
    remaining_gap: '2024年校方通知已确认西食堂一层、二层及东食堂名称；东食堂楼层未给出，窗口数量不转换为虚构窗口名。',
  },
  '4111012561': {
    audit_status: 'no_official_relation_found',
    sources: [],
    remaining_gap: '只找到非校方转载和智慧食堂建设信息，未找到可核验的正式食堂名称、楼层或餐饮公众号。',
  },
  '4111013629': {
    audit_status: 'current_name_only_floor_missing',
    relations: [
      ['科德食堂', '', '', 'current_official_name_only', SOURCE.kedeDining],
    ],
    sources: [SOURCE.kedeDining],
    remaining_gap: '校方页面确认“科德食堂”及后勤商业中心，但未给楼层。',
  },
  '4111013630': {
    audit_status: 'no_official_relation_found',
    sources: [],
    remaining_gap: '检索到的招生公众号和继续教育页面不能证明餐饮平台归属；“世界厨房”未达到校方主站核验标准。',
  },
  '4111013901': {
    audit_status: 'account_only_relation_missing',
    accounts: [
      {
        account_name: '世纪后勤',
        account_scope: 'school_logistics',
        verification_status: 'official_site_verified_current',
        verification_note: '学院2026年官方报考指南明确列出微信平台“世纪后勤”。',
        verification_url: SOURCE.centuryAccount.url,
      },
    ],
    sources: [SOURCE.centuryAccount, SOURCE.centuryFacility],
    remaining_gap: '公众号归属已核实。2026年校方工程公告提到“食堂1、2、3层后厨”，只能证明后厨设施分布，不能证明一至三层均为对外就餐楼层，因此未转成下拉关系。',
  },
  '4111014019': {
    audit_status: 'current_name_only_floor_missing',
    relations: [
      ['处研餐厅', '', '处级研修楼内', 'current_official_name_only', SOURCE.policeCurrentFacility],
      ['教工食堂', '', '', 'historical_official_name_only', SOURCE.policeProcurement],
      ['学生食堂', '', '', 'historical_official_name_only', SOURCE.policeProcurement],
      ['培训餐厅', '', '', 'historical_official_name_only', SOURCE.policeProcurement],
    ],
    sources: [SOURCE.policeCurrentFacility, SOURCE.policeProcurement],
    remaining_gap: '2026年政府采购文件确认处研餐厅仍位于处级研修楼内，但未给楼层；教工食堂、学生食堂、培训餐厅仅有2021年材料，继续保留为历史参考。',
  },
  '4111014139': {
    audit_status: 'no_official_relation_found',
    sources: [],
    remaining_gap: '已确认现校名和官网，但未找到校方迎新、后勤或研会页面公开食堂名称与楼层。',
  },
  '4111014140': {
    audit_status: 'generic_canteen_only',
    sources: [SOURCE.artMediaReport],
    remaining_gap: '北京市教委托管的学校年报只写“食堂”，没有正式名称、楼层或餐饮公众号。',
  },
}

GAP_REVIEW['4111010028'] = {
  audit_status: 'current_names_verified_floors_partial_candidates',
  relations: [
    ['学三食堂', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['本部民族餐厅', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['学四食堂', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['学五食堂（民族餐厅）', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['东一校区食堂', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['北二区学生食堂', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['北三区学生食堂', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['东二区学生食堂', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['来广营校区学生食堂', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['良乡校区学生食堂', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['国文大厦西餐厅', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['校本部西餐厅', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['膳园餐厅', '', '', 'current_official_name_only', SOURCE.cnuDiningTender],
    ['北二区学生食堂（公开索引称学六食堂）', '一层', '', 'indexed_secondary_relation', SOURCE.cnuIndexedCampusList],
    ['北二区学生食堂（公开索引称学六食堂）', '二层', '', 'indexed_secondary_relation', SOURCE.cnuIndexedCampusList],
    ['良乡校区学生食堂', '一层', '', 'indexed_secondary_relation', SOURCE.cnuIndexedLiangxiang],
    ['良乡校区学生食堂', '二层', '', 'indexed_secondary_relation', SOURCE.cnuIndexedLiangxiang],
    ['良乡校区学生食堂', '三层', '清真餐厅', 'indexed_secondary_relation', SOURCE.cnuIndexedLiangxiang],
  ],
  sources: [
    SOURCE.cnuDiningTender,
    SOURCE.cnuCurrentFacilities,
    SOURCE.cnuIndexedCampusList,
    SOURCE.cnuIndexedLiangxiang,
  ],
  remaining_gap: '2026年校方采购表已确认13个当前食堂或餐厅名称。北二区与良乡楼层仅有公开索引转载，已作为暂缓入库候选；其余11个当前名称仍缺校方楼层材料。',
}

GAP_REVIEW['4111011626'] = {
  audit_status: 'current_generic_name_only_floor_missing',
  relations: [
    ['学生食堂', '', '', 'current_official_generic_name_only', SOURCE.youthCurrent],
  ],
  sources: [SOURCE.youthCurrent],
  remaining_gap: '2024年校方迎新新闻确认当前“学生食堂”，可作为当前通用名称候选；尚未找到品牌化名称、楼层或窗口清单。',
}

GAP_REVIEW['4111012561'] = {
  audit_status: 'current_center_name_with_indexed_floor_candidates',
  relations: [
    ['中心食堂', '', '学生食堂', 'current_official_name_only', SOURCE.bftcCenterSupply],
    ['中心食堂', '', '教工食堂', 'current_official_name_only', SOURCE.bftcCenterSupply],
    ['中心食堂（公开索引候选映射）', '一层', '基本伙、清真餐厅', 'indexed_secondary_relation', SOURCE.bftcIndexedGuide],
    ['中心食堂（公开索引候选映射）', '二层', '风味餐厅', 'indexed_secondary_relation', SOURCE.bftcIndexedGuide],
  ],
  sources: [SOURCE.bftcCenterCurrent, SOURCE.bftcCenterSupply, SOURCE.bftcIndexedGuide],
  remaining_gap: '2026年校方页面确认“中心食堂”仍在使用，2024年校方采购确认其含学生食堂和教工食堂。公开索引给出学生食堂一、二层分区，但尚缺校方原文证明该楼层结构与中心食堂完全同一。',
}

GAP_REVIEW['4111013630'] = {
  audit_status: 'current_name_with_indexed_floor_candidate',
  relations: [
    ['味林西餐厅', '', '', 'current_official_name_only', SOURCE.financeTechAdmissions],
    ['食堂（公开索引候选）', '二层', '世界厨房', 'indexed_public_account_relation', SOURCE.financeTechIndexedAccount],
  ],
  sources: [SOURCE.financeTechAdmissions, SOURCE.financeTechIndexedAccount],
  remaining_gap: '学校当前招生网已确认“味林西餐厅”。公众号公开索引镜像出现“食堂二层世界厨房”，但尚未在校方主站核实其归属与“味林西餐厅”的对应关系，因此保持暂缓入库。',
}

GAP_REVIEW['4111013901'] = {
  audit_status: 'account_current_historical_floor_map_only',
  accounts: [
    {
      account_name: '世纪后勤',
      account_scope: 'school_logistics',
      verification_status: 'official_site_verified_current',
      verification_note: '学院2026年官方报考指南明确列出微信平台“世纪后勤”。',
      verification_url: SOURCE.centuryAccount.url,
    },
  ],
  relations: [
    ['学生食堂', '一层', '', 'historical_official_relation', SOURCE.centuryHistoricalDining],
    ['学生食堂', '二层', '', 'historical_official_relation', SOURCE.centuryHistoricalDining],
    ['学生食堂', '三层', '', 'historical_official_relation', SOURCE.centuryHistoricalDining],
  ],
  sources: [SOURCE.centuryAccount, SOURCE.centuryFacility, SOURCE.centuryHistoricalDining],
  remaining_gap: '2016年校方招标确认学生食堂一至三层，2026年工程公告也确认1、2、3层后厨设施仍存在；但当前对外就餐楼层与窗口未被校方正文重新确认，三层关系仅作历史参考。',
}

GAP_REVIEW['4111014139'] = {
  audit_status: 'usable_current_relations',
  relations: [
    ['大兴校区餐厅', '一层', '学生基本伙食堂（部分风味及水吧）', 'current_official_relation', SOURCE.civilDaxingFloorMap],
    ['大兴校区餐厅', '二层', '风味餐厅', 'current_official_relation', SOURCE.civilDaxingFloorMap],
    ['大兴校区餐厅', '三层', '民族餐厅', 'current_official_relation', SOURCE.civilDaxingCurrent],
    ['大兴校区餐厅', '三层', '教工餐厅', 'current_official_relation', SOURCE.civilDaxingCurrent],
    ['风味食堂', '二层', '燕郊校区7号楼（风味档口、水吧）', 'current_official_relation', SOURCE.civilYanjiaoCurrent],
  ],
  sources: [
    SOURCE.civilDaxingCurrent,
    SOURCE.civilDaxingStructure,
    SOURCE.civilDaxingFloorMap,
    SOURCE.civilYanjiaoCurrent,
  ],
  remaining_gap: '大兴校区餐厅一至三层与燕郊校区风味食堂二层已形成当前可审核关系；尚缺各层具体窗口名称。',
}

GAP_REVIEW['4111014140'] = {
  audit_status: 'current_generic_name_only_floor_missing',
  relations: [
    ['校园食堂', '', '', 'current_official_generic_name_only', SOURCE.artMediaCurrentCanteen],
  ],
  sources: [
    SOURCE.artMediaCurrentCanteen,
    SOURCE.artMediaCurrentLogistics,
    SOURCE.artMediaReport,
  ],
  remaining_gap: '2025年学校官网专题确认校园食堂由学校后勤部统一管理，且2024年完成升级改造；页面未给出独立品牌名称、楼层或窗口。',
}

const NCEPU_ACCOUNT_FINDINGS = [
  {
    account_name: '华电后勤',
    account_scope: 'school_logistics',
    verification_status: 'official_historical_name',
    verification_note: '2021年后勤服务集团校方通知使用“华电后勤”。',
    verification_url: SOURCE.ncepuAccountA.url,
  },
  {
    account_name: '华电微后勤',
    account_scope: 'school_logistics',
    verification_status: 'official_historical_name_conflict',
    verification_note: '2021年学校新闻网使用“华电微后勤”；与同年另一校方页面名称不一致，当前名称暂不定。',
    verification_url: SOURCE.ncepuAccountB.url,
  },
]

GAP_REVIEW['4111010054'] = {
  audit_status: 'usable_current_relations_account_name_conflict',
  account_findings: NCEPU_ACCOUNT_FINDINGS,
  relations: [
    ['第一学生食堂', '一层', '', 'current_official_relation', SOURCE.ncepuDining],
    ['第一学生食堂', '二层', '', 'current_official_relation', SOURCE.ncepuDining],
    ['第一学生食堂', '三层', '华美食苑（含教工食堂、风味餐厅）', 'current_official_relation', SOURCE.ncepuDining],
    ['第二学生食堂', '一层', '清真餐厅', 'current_official_relation', SOURCE.ncepuDining],
    ['第二学生食堂', '二层', '自选餐厅', 'current_official_relation', SOURCE.ncepuDining],
    ['第二学生食堂', '三层', '风味食堂', 'current_official_relation', SOURCE.ncepuDining],
    ['第三学生食堂', '一层', '', 'current_official_relation', SOURCE.ncepuDining],
    ['第三学生食堂', '二层', '', 'current_official_relation', SOURCE.ncepuDining],
    ['第三学生食堂', '三层', '风味食堂', 'current_official_relation', SOURCE.ncepuDining],
  ],
  sources: [SOURCE.ncepuDining, SOURCE.ncepuAccountA, SOURCE.ncepuAccountB],
  remaining_gap: '食堂层级已由当前校方服务页确认；公众号当前名称因校方历史页面存在“华电后勤/华电微后勤”冲突而不定。',
}

function relationFromTuple(tuple) {
  const [canteen, floor, area, relation_status, source] = tuple
  const current = relation_status.startsWith('current_')
  const indexed = relation_status.startsWith('indexed_')
  return {
    canteen,
    floor,
    area,
    relation_status,
    freshness_status: current
      ? 'current_or_undated_official'
      : indexed
        ? 'indexed_candidate_only'
        : 'historical_reference_only',
    import_readiness: current
      ? (floor ? 'reviewable_with_floor' : 'reviewable_name_only')
      : 'hold',
    source_title: source.title,
    source_url: source.url,
    source_type: source.source_type,
    source_published_at: source.published_at,
    source_page: source.page || null,
    owner_action_required: false,
  }
}

async function main() {
  const rosterPath = path.resolve(process.argv[2] || DEFAULT_ROSTER)
  const gapPath = path.resolve(process.argv[3] || DEFAULT_GAP)
  const outputPath = path.resolve(process.argv[4] || DEFAULT_OUTPUT)
  const [roster, gap] = await Promise.all([
    fs.readFile(rosterPath, 'utf8').then(JSON.parse),
    fs.readFile(gapPath, 'utf8').then(JSON.parse),
  ])
  const rosterByCode = new Map(
    (roster.schools || []).map((school) => [school.official_code, school]),
  )
  const targetCodes = (gap.blocked_or_unprocessed_schools || []).map(
    (school) => school.official_code,
  )
  const schools = targetCodes.map((officialCode) => {
    const rosterSchool = rosterByCode.get(officialCode)
    const review = GAP_REVIEW[officialCode]
    if (!rosterSchool) throw new Error(`roster missing ${officialCode}`)
    if (!review) throw new Error(`gap review missing ${officialCode}`)
    return {
      school_id: rosterSchool.school_id,
      official_code: officialCode,
      school_name: rosterSchool.name,
      audit_status: review.audit_status,
      official_accounts: review.accounts || [],
      account_findings: review.account_findings || [],
      relations: (review.relations || []).map(relationFromTuple),
      sources: review.sources || [],
      remaining_gap: review.remaining_gap,
      note: review.note || '',
      owner_action_required: false,
    }
  })
  const relations = schools.flatMap((school) =>
    school.relations.map((relation) => ({
      school_id: school.school_id,
      official_code: school.official_code,
      school_name: school.school_name,
      ...relation,
    })),
  )
  const verifiedAccounts = schools.flatMap((school) =>
    school.official_accounts.map((account) => ({
      school_id: school.school_id,
      official_code: school.official_code,
      school_name: school.school_name,
      ...account,
      owner_action_required: false,
    })),
  )
  const currentRelations = relations.filter(
    (relation) => relation.freshness_status === 'current_or_undated_official',
  )
  const indexedCandidateRelations = relations.filter(
    (relation) => relation.freshness_status === 'indexed_candidate_only',
  )
  const historicalRelations = relations.filter(
    (relation) => relation.freshness_status === 'historical_reference_only',
  )
  const output = {
    generated_at: new Date().toISOString(),
    scope:
      '北京高校餐饮/后勤公众号首轮受限或未处理的19所学校：改用学校官网、后勤官网、招生/迎新材料、信息公开和教育主管部门托管校方报告复核',
    safety: {
      raw_evidence_only: true,
      database_written: false,
      user_image_overrides_preserved: ['4111010001', '4111010003'],
      owner_confirmed_preserved: ['4111010025'],
      third_party_relations_import_excluded: true,
    },
    summary: {
      target_schools: schools.length,
      schools_with_current_formal_relations: schools.filter((school) =>
        school.relations.some(
          (relation) =>
            relation.freshness_status === 'current_or_undated_official',
        ),
      ).length,
      owner_confirmed_existing_schools: schools.filter(
        (school) => school.audit_status === 'owner_confirmed_existing',
      ).length,
      schools_without_current_formal_relations: schools.filter(
        (school) =>
          school.audit_status !== 'owner_confirmed_existing' &&
          !school.relations.some(
            (relation) =>
              relation.freshness_status === 'current_or_undated_official',
          ),
      ).length,
      verified_current_account_names: verifiedAccounts.length,
      current_relation_rows: currentRelations.length,
      current_floor_relation_rows: currentRelations.filter(
        (relation) => relation.floor,
      ).length,
      current_name_only_relation_rows: currentRelations.filter(
        (relation) => !relation.floor,
      ).length,
      indexed_candidate_rows: indexedCandidateRelations.length,
      historical_reference_rows: historicalRelations.length,
      current_floor_relation_schools: schools.filter((school) =>
        school.relations.some(
          (relation) =>
            relation.freshness_status === 'current_or_undated_official' &&
            relation.floor,
        ),
      ).length,
    },
    verified_accounts: verifiedAccounts,
    relations,
    schools,
  }
  const schoolIds = schools.map((school) => school.school_id)
  const relationKeys = relations.map((relation) =>
    [
      relation.official_code,
      relation.canteen,
      relation.floor,
      relation.area,
      relation.freshness_status,
    ].join('|'),
  )
  if (schools.length !== 19) throw new Error(`expected 19 schools, got ${schools.length}`)
  if (new Set(schoolIds).size !== schoolIds.length) {
    throw new Error('duplicate school_id')
  }
  if (new Set(relationKeys).size !== relationKeys.length) {
    throw new Error('duplicate relation')
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(output.summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
