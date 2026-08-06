#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_INPUT =
  'docs/campus-directory-proofreading/beijing-wechat-dining-platform-evidence.json'
const DEFAULT_OUTPUT =
  'docs/campus-directory-proofreading/beijing-wechat-dining-platform-review.json'
const DEFAULT_ROSTER =
  'docs/campus-directory-proofreading/beijing-orientation-official-source-crawl.json'
const USER_OVERRIDE_CODES = new Set(['4111010001', '4111010003'])

const VERIFIED_ACCOUNTS = new Map([
  [
    '北京工业大学|北工大后勤',
    {
      account_scope: 'school_logistics',
      verification_status: 'official_site_verified',
      verification_note: '北京工业大学新生入学材料明确列出“北工大后勤”微信公众号。',
      verification_url: 'https://admissions.bjut.edu.cn/2024xinshengxuzhi.pdf',
    },
  ],
  [
    '北京服装学院|北服后勤基建处',
    {
      account_scope: 'school_logistics',
      verification_status: 'official_site_verified',
      verification_note: '北京服装学院官网明确称发布平台为“北服后勤基建处”微信公众号。',
      verification_url:
        'https://www.bift.edu.cn/xwgg/bfxw/697b1bdbae344027914aaccb2fe043de.htm',
    },
  ],
  [
    '中国科学院大学|国科大餐饮',
    {
      account_scope: 'school_dining',
      verification_status: 'official_site_verified',
      verification_note: '中国科学院大学信息公开年报将“国科大餐饮”列为校内部门专属微信账号。',
      verification_url:
        'https://www.ucas.ac.cn/xxgk1/ndbg/3775d9adbf5745b39ec9021eba3de2be.htm',
    },
  ],
  [
    '中国传媒大学|中国传媒大学后勤保障处',
    {
      account_scope: 'school_logistics',
      verification_status: 'official_site_verified',
      verification_note:
        '中国传媒大学后勤服务指南明确列出官方微信公众号名称和微信号 cuc_houqin。',
      verification_url:
        'https://zchq.cuc.edu.cn/2019/0627/c351a126242/page.htm',
    },
  ],
  [
    '北京科技大学|贝壳后勤',
    {
      account_scope: 'school_logistics',
      verification_status: 'official_site_verified',
      verification_note:
        '北京科技大学昌平创新园区官网明确说明宿舍检查结果在“贝壳后勤”公众号公示；该账号属于后勤平台，但不是餐饮中心专号。',
      verification_url:
        'https://cpcxyq.ustb.edu.cn/yqdt/cc98f44b69094956bf6a4900b50eff76.htm',
    },
  ],
])

const MANUAL_RELATION_RULES = [
  {
    school_name: '北京工业大学',
    article_title: '北工大 奥运二层餐厅里的年味',
    relations: [
      {
        canteen: '奥运餐厅',
        floor: '二层',
        window: '',
        relation_status: 'verified_account_index_relation_candidate',
        review_note: '账号归属已由学校官网确认；索引标题和摘要直接对应奥运餐厅二层。',
      },
    ],
  },
  {
    school_name: '北京工业大学',
    article_title: '校会·迎新丨你期待已久的本部美食指南终于来啦!',
    relations: [
      {
        canteen: '清真餐厅',
        floor: '二层',
        window: '',
        relation_status: 'strong_school_account_relation_candidate',
        review_note: '北京工业大学学生会迎新文章摘要直接写明北区学生综合服务中心二层清真餐厅。',
      },
    ],
  },
  {
    school_name: '北京工商大学',
    article_title: '舌尖上的 北工商 !校园美食地图来了,这些你都打卡了吗?',
    relations: [
      {
        canteen: '东区勤苑餐厅',
        floor: '一层',
        window: '',
        relation_status: 'strong_school_account_relation_candidate',
        review_note:
          '学校公众号摘要直接写明东区勤苑餐厅位于师生服务中心一楼；自动抽取的“二楼”来自附近建筑“工二楼”，已排除。',
      },
    ],
  },
  {
    school_name: '中国科学院大学',
    article_title: '当习惯成自然,才明白我有多爱国科大!',
    relations: [
      {
        canteen: '雁栖湖校区东区三食堂',
        floor: '二层',
        window: '',
        relation_status: 'strong_school_account_relation_candidate',
        review_note: '中国科学院大学学生会摘要直接写明东区三食堂二层基本伙。',
      },
    ],
  },
  {
    school_name: '中国社会科学院大学',
    article_title: '良乡校区一周食谱',
    relations: [
      {
        canteen: '良乡校区学生食堂',
        floor: '一层',
        window: '',
        relation_status: 'exact_school_logistics_account_candidate',
        review_note: '账号名完整对应学校后勤处，食谱摘要列出学生食堂一层。',
      },
      {
        canteen: '良乡校区学生食堂',
        floor: '二层',
        window: '',
        relation_status: 'exact_school_logistics_account_candidate',
        review_note: '账号名完整对应学校后勤处，食谱摘要列出学生食堂二层。',
      },
      {
        canteen: '民族餐厅',
        floor: '',
        window: '',
        relation_status: 'exact_school_logistics_account_name_only',
        review_note: '食谱摘要确认餐厅名称，但未显示楼层，不猜测。',
      },
      {
        canteen: '风味餐厅',
        floor: '',
        window: '',
        relation_status: 'exact_school_logistics_account_name_only',
        review_note: '食谱摘要确认餐厅名称，但未显示楼层，不猜测。',
      },
    ],
  },
]

function normalizeTitle(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function findManualRule(schoolName, title) {
  const normalized = normalizeTitle(title)
  return MANUAL_RELATION_RULES.find(
    (rule) =>
      rule.school_name === schoolName &&
      normalizeTitle(rule.article_title) === normalized,
  )
}

function classifyArticle(school, source) {
  const verified = VERIFIED_ACCOUNTS.get(
    `${school.name}|${source.account_name}`,
  )
  if (source.negative_context) {
    return {
      review_status: 'rejected_negative_or_procurement_context',
      review_reason: '招聘、招标、采购或供应商语境，不作为食堂层级事实。',
      account_verification: verified || null,
    }
  }
  if (verified) {
    return {
      review_status:
        verified.account_scope === 'school_dining'
          ? 'verified_school_dining_account'
          : 'verified_school_logistics_account',
      review_reason: verified.verification_note,
      account_verification: verified,
    }
  }
  if (source.account_classification === 'exact_school_account_name') {
    return {
      review_status: 'strong_exact_school_account',
      review_reason: '账号名包含学校全称，归属较强，但仍需原文或学校官网最终确认。',
      account_verification: null,
    }
  }
  if (source.dining_platform_account_candidate) {
    return {
      review_status: 'platform_account_ownership_unverified',
      review_reason:
        '账号名带餐饮/后勤关键词，但可能属于另一所学校或第三方协会，不能仅凭关键词认定归属。',
      account_verification: null,
    }
  }
  return {
    review_status: 'other_school_related_candidate',
    review_reason: '保留为学校相关候选，尚未证明属于目标学校餐饮或后勤平台。',
    account_verification: null,
  }
}

async function main() {
  const inputPath = path.resolve(process.argv[2] || DEFAULT_INPUT)
  const outputPath = path.resolve(process.argv[3] || DEFAULT_OUTPUT)
  const rosterPath = path.resolve(process.argv[4] || DEFAULT_ROSTER)
  const [input, roster] = await Promise.all([
    fs.readFile(inputPath, 'utf8').then(JSON.parse),
    fs.readFile(rosterPath, 'utf8').then(JSON.parse),
  ])
  const articles = []
  const curatedRelations = []
  const articleKeys = new Set()
  const relationKeys = new Set()
  for (const school of input.schools || []) {
    for (const source of school.sources || []) {
      const articleKey = [
        school.official_code,
        source.account_name,
        normalizeTitle(source.title),
        source.published_at || '',
      ].join('|')
      if (articleKeys.has(articleKey)) continue
      articleKeys.add(articleKey)
      const classification = classifyArticle(school, source)
      const manualRule = findManualRule(school.name, source.title)
      const row = {
        school_id: school.school_id,
        official_code: school.official_code,
        school_name: school.name,
        account_name: source.account_name,
        account_classification: source.account_classification,
        review_status: classification.review_status,
        review_reason: classification.review_reason,
        account_verification: classification.account_verification,
        article_title: source.title,
        article_snippet: source.snippet,
        published_at: source.published_at,
        negative_context: source.negative_context,
        cover_image_url: source.cover_image_url,
        sogou_redirect_url: source.sogou_redirect_url,
        matched_queries: source.matched_queries || [],
        owner_action_required: false,
      }
      articles.push(row)
      if (manualRule && !source.negative_context) {
        for (const relation of manualRule.relations) {
          const relationKey = [
            school.official_code,
            relation.canteen,
            relation.floor,
            relation.window,
          ].join('|')
          if (relationKeys.has(relationKey)) continue
          relationKeys.add(relationKey)
          curatedRelations.push({
            ...row,
            ...relation,
          })
        }
      }
    }
  }
  const reviewStatus = articles.reduce((counts, article) => {
    counts[article.review_status] = (counts[article.review_status] || 0) + 1
    return counts
  }, {})
  const verifiedAccountKeys = [...VERIFIED_ACCOUNTS.keys()].filter((key) => {
    const [schoolName, accountName] = key.split('|')
    return articles.some(
      (article) =>
        article.school_name === schoolName &&
        article.account_name === accountName,
    )
  })
  const inputByCode = new Map(
    (input.schools || []).map((school) => [school.official_code, school]),
  )
  const blockedOrUnprocessedSchools = (roster.schools || [])
    .filter((school) => !USER_OVERRIDE_CODES.has(school.official_code))
    .map((school) => {
      const captured = inputByCode.get(school.official_code)
      if (captured && captured.status !== 'search_blocked') return null
      return {
        school_id: school.school_id,
        official_code: school.official_code,
        school_name: school.name,
        status: captured?.status || 'not_processed_after_circuit_breaker',
        error: captured?.error || '',
      }
    })
    .filter(Boolean)
  const output = {
    generated_at: new Date().toISOString(),
    scope:
      '北京高校餐饮/后勤微信公众号公开索引专项审核；不进入 mp.weixin 正文，不写数据库',
    safety: {
      raw_evidence_only: true,
      database_written: false,
      user_image_override_codes: input.user_image_overrides || [],
      blocked_schools_are_retryable: true,
    },
    summary: {
      target_schools: 90,
      processed_schools: input.schools?.length || 0,
      unprocessed_or_blocked_schools: blockedOrUnprocessedSchools.length,
      candidate_articles: articles.length,
      verified_account_keys: verifiedAccountKeys.length,
      curated_relation_rows: curatedRelations.length,
      curated_floor_relation_rows: curatedRelations.filter(
        (relation) => relation.floor,
      ).length,
      curated_name_only_relation_rows: curatedRelations.filter(
        (relation) => !relation.floor,
      ).length,
      review_status: reviewStatus,
    },
    verified_accounts: verifiedAccountKeys.map((key) => {
      const [school_name, account_name] = key.split('|')
      return {
        school_name,
        account_name,
        ...VERIFIED_ACCOUNTS.get(key),
      }
    }),
    curated_relations: curatedRelations,
    articles,
    blocked_or_unprocessed_schools: blockedOrUnprocessedSchools,
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(output.summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
