#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

const repoRoot = path.resolve(process.argv[2] || process.cwd())
const docs = path.join(repoRoot, 'docs', 'campus-directory-proofreading')
const readJson = async (name) =>
  JSON.parse(await fs.readFile(path.join(docs, name), 'utf8'))

const [wechat, userImages] = await Promise.all([
  readJson('beijing-wechat-public-index-evidence.json'),
  readJson('beijing-user-image-dining-evidence.json'),
])

const curatedSpecs = [
  {
    school: '北京科技大学',
    title: '食堂大上新',
    review_status: 'parent_canteen_unresolved',
    note: '官方校级公众号，楼层和窗口名称明确，但搜索摘要未显示所属食堂名称',
    relations: [
      { canteen: '', floor: '三层', window: '鱼籽饭团3号窗口' },
      { canteen: '', floor: '三层', window: '咸蛋黄饭团3号窗口' },
    ],
  },
  {
    school: '北京工商大学',
    title: '良乡校区学生食堂二层西厅',
    review_status: 'strong_account_candidate',
    relations: [
      { campus: '良乡校区', canteen: '学生食堂', floor: '二层', area: '西厅', window: '' },
    ],
  },
  {
    school: '北京林业大学',
    title: '我的北林故事',
    review_status: 'strong_account_candidate',
    relations: [
      { canteen: '一食堂', floor: '', window: '贵州风味窗口' },
    ],
  },
  {
    school: '中国传媒大学',
    title: '最全中传生活指南',
    review_status: 'strong_account_candidate',
    relations: [
      { canteen: '北苑餐厅', floor: '一层', window: '' },
      { canteen: '南苑餐厅', floor: '一层', window: '' },
    ],
  },
  {
    school: '中央财经大学',
    title: '两校区食堂同步上新',
    review_status: 'account_verification_needed',
    note: '摘要称信息来自中央财经大学后勤处官网，但索引账号名为“中小财”，需代理核验账号归属',
    relations: [
      { canteen: '东区学生食堂', floor: '一层', window: '8号窗口' },
    ],
  },
  {
    school: '对外经济贸易大学',
    title: '校园封闭管理期间',
    review_status: 'strong_account_candidate',
    relations: [
      { canteen: '一食堂', floor: '一层', window: '' },
      { canteen: '清真食堂', floor: '', window: '' },
    ],
  },
  {
    school: '对外经济贸易大学',
    title: '新生宝典2017',
    review_status: 'school_related_account_candidate',
    relations: [
      { canteen: '一食堂', floor: '二楼', window: '' },
    ],
  },
  {
    school: '国际关系学院',
    title: '2019年寒假工作安排',
    review_status: 'strong_account_candidate',
    relations: [
      { canteen: '清真食堂', floor: '二层', window: '' },
      { canteen: '二层食堂', floor: '二层', window: '' },
    ],
  },
  {
    school: '北京第二外国语学院',
    title: '北二外校园导览',
    review_status: 'strong_account_candidate',
    note: '北京第二外国语学院本科招生官网明确列出“北二外文传院”为文化与传播学院微信公众号',
    relations: [
      { canteen: '第三食堂', floor: '一层', window: '' },
    ],
  },
  {
    school: '北京邮电大学',
    title: '北京高校迎新季',
    review_status: 'school_related_account_candidate',
    note: '来源账号为北京学联，属于学校外部的学生组织索引，需代理核对原文',
    relations: [
      { canteen: '食堂', floor: '一至五层', window: '' },
      { canteen: '清真餐厅', floor: '二楼', window: '' },
    ],
  },
  {
    school: '北京财贸职业学院',
    title: '新“家”攻略',
    review_status: 'account_verification_needed',
    relations: [
      { canteen: '食堂', floor: '一层', window: '' },
      { canteen: '食堂', floor: '二层', window: '' },
    ],
  },
  {
    school: '北京戏曲艺术职业学院',
    title: '2020年中专新生入学须知',
    review_status: 'account_verification_needed',
    relations: [
      { canteen: '学生餐厅', floor: '一至三层', window: '' },
    ],
  },
  {
    school: '北京电影学院',
    title: '北影老司机给新生们指指路',
    review_status: 'account_verification_needed',
    relations: [
      { canteen: '食堂', floor: '二楼', window: '' },
    ],
  },
]

const normalize = (value) =>
  String(value || '')
    .replace(/&[^;]+;/g, '')
    .replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '')
    .toLowerCase()

const curatedCandidates = []
const otherCandidates = []
for (const school of wechat.schools || []) {
  for (const source of school.sources || []) {
    const spec = curatedSpecs.find(
      (candidate) =>
        candidate.school === school.name &&
        normalize(source.title).includes(normalize(candidate.title)),
    )
    if (spec) {
      curatedCandidates.push({
        school_id: school.school_id,
        official_code: school.official_code,
        school_name: school.name,
        account_name: source.account_name,
        account_classification: source.account_classification,
        article_title: source.title,
        article_snippet: source.snippet,
        published_at: source.published_at,
        cover_image_url: source.cover_image_url,
        sogou_redirect_url: source.sogou_redirect_url,
        review_status: spec.review_status,
        note: spec.note || '',
        owner_action_required: false,
        relations: spec.relations.map((relation) => ({
          campus: '',
          canteen: '',
          floor: '',
          area: '',
          window: '',
          ...relation,
        })),
      })
      continue
    }
    let reviewStatus = 'agent_followup_article_or_image'
    let reason = '文章与学校餐饮相关，但公开索引摘要没有足够的父子层级关系'
    if (source.negative_context) {
      reviewStatus = 'rejected_negative_context'
      reason = '招聘、招标或采购语境不能直接证明现行食堂结构'
    } else if (
      /同一楼层的同一窗口|食堂最贵的单品|宿舍楼层|教学楼层|图书馆.*六层|食堂五层学生活动中心/.test(
        `${source.title}${source.snippet}`,
      )
    ) {
      reviewStatus = 'rejected_context_mismatch'
      reason = '楼层或窗口描述不属于可绑定的食堂层级'
    }
    otherCandidates.push({
      school_id: school.school_id,
      official_code: school.official_code,
      school_name: school.name,
      account_name: source.account_name,
      account_classification: source.account_classification,
      article_title: source.title,
      article_snippet: source.snippet,
      published_at: source.published_at,
      cover_image_url: source.cover_image_url,
      sogou_redirect_url: source.sogou_redirect_url,
      review_status: reviewStatus,
      reason,
      owner_action_required: false,
    })
  }
}

const userImageRelations = []
for (const school of userImages.schools || []) {
  for (const canteen of school.canteens || []) {
    if ((canteen.floors || []).length === 0) {
      userImageRelations.push({
        official_code: school.official_code,
        school_name: school.name,
        canteen: canteen.name,
        floor: '',
        area: '',
        entity_type: canteen.entity_type || 'canteen',
        evidence_file: canteen.evidence_file,
        review_status: 'user_image_name_confirmed_floor_not_shown',
        owner_action_required: false,
      })
    } else {
      for (const floor of canteen.floors) {
        userImageRelations.push({
          official_code: school.official_code,
          school_name: school.name,
          canteen: canteen.name,
          floor,
          area: '',
          entity_type: canteen.entity_type || 'canteen',
          evidence_file: canteen.evidence_file,
          review_status: 'user_image_relation_confirmed',
          owner_action_required: false,
        })
      }
    }
    for (const area of canteen.areas || []) {
      if ((area.floors || []).length === 0) {
        userImageRelations.push({
          official_code: school.official_code,
          school_name: school.name,
          canteen: canteen.name,
          floor: '',
          area: area.name,
          entity_type: 'canteen_area',
          evidence_file: canteen.evidence_file,
          review_status: 'user_image_area_confirmed_floor_not_shown',
          owner_action_required: false,
        })
      } else {
        for (const floor of area.floors) {
          userImageRelations.push({
            official_code: school.official_code,
            school_name: school.name,
            canteen: canteen.name,
            floor,
            area: area.name,
            entity_type: 'canteen_area',
            evidence_file: canteen.evidence_file,
            review_status: 'user_image_relation_confirmed',
            owner_action_required: false,
          })
        }
      }
    }
  }
}

const output = {
  generated_at: new Date().toISOString(),
  scope:
    '北京大学、清华大学用户图片优先关系，以及其余北京高校微信公众号公开索引的代理初审结果；不写数据库',
  summary: {
    user_image_schools: userImages.schools.length,
    user_image_relation_rows: userImageRelations.length,
    user_image_floor_relation_rows: userImageRelations.filter((row) => row.floor).length,
    wechat_index_schools: wechat.schools.length,
    wechat_candidate_articles: (wechat.schools || []).reduce(
      (sum, school) => sum + (school.sources?.length || 0),
      0,
    ),
    curated_high_value_articles: curatedCandidates.length,
    curated_relation_rows: curatedCandidates.reduce(
      (sum, article) => sum + article.relations.length,
      0,
    ),
    strong_account_articles: curatedCandidates.filter((row) =>
      ['strong_account_candidate', 'school_related_account_candidate'].includes(
        row.review_status,
      ),
    ).length,
    account_verification_needed_articles: curatedCandidates.filter(
      (row) => row.review_status === 'account_verification_needed',
    ).length,
    parent_canteen_unresolved_articles: curatedCandidates.filter(
      (row) => row.review_status === 'parent_canteen_unresolved',
    ).length,
    agent_followup_articles: otherCandidates.filter(
      (row) => row.review_status === 'agent_followup_article_or_image',
    ).length,
    rejected_articles: otherCandidates.filter((row) =>
      row.review_status.startsWith('rejected_'),
    ).length,
    owner_action_required_rows: 0,
  },
  user_image_relations: userImageRelations,
  curated_wechat_candidates: curatedCandidates,
  other_wechat_candidates: otherCandidates,
}

await fs.writeFile(
  path.join(docs, 'beijing-wechat-public-index-auto-review.json'),
  `${JSON.stringify(output, null, 2)}\n`,
  'utf8',
)
console.log(JSON.stringify(output.summary, null, 2))
