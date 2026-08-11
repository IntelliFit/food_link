import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inputPath = path.join(
  repoRoot,
  'docs',
  'research',
  'capital-city-campus-canteen-floor-confirmed-2026-08-11.json',
)
const outputPath = path.join(repoRoot, 'backend', 'data', 'capital_city_verified_dining_seed_20260811.json')
const batchName = '省会高校已核验食堂楼层-20260811'
const excludedCities = new Set(['北京市', '上海市', '武汉市', '南京市'])

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const records = source.records ?? []
const schools = new Map()

for (const record of records) {
  if (excludedCities.has(record.city)) {
    throw new Error(`排除城市不应进入发布种子：${record.city}/${record.school_name}`)
  }
  const school = schools.get(record.school_name) ?? {
    school: record.school_name,
    review_status: 'pending_review',
    campuses: [],
    canteens: [],
    windows: [],
    notes: ['2026-08-11按高校官方来源复核；只发布明确到校区、餐饮点及楼层的记录'],
  }
  schools.set(record.school_name, school)

  if (!school.campuses.some((campus) => campus.name === record.campus_name)) {
    school.campuses.push({
      name: record.campus_name,
      aliases: [],
      address: record.campus_address,
      source_url: record.campus_source_url,
    })
  }

  const common = {
    campus: record.campus_name,
    aliases: [],
    source_url: record.source_url,
    source_title: `${record.school_name}官方校园餐饮资料`,
    source_org: record.school_name,
    source_type: 'official_university',
    evidence_level: 'A',
    evidence_excerpt: `餐饮点：${record.dining_venue}；楼层：${record.floor}。${record.verification_basis}`,
    review_status: 'pending_review',
  }

  if (record.school_name === '东北农业大学' && record.dining_venue === '棘园一楼清真窗口') {
    school.windows.push({
      ...common,
      canteen: '棘园餐厅',
      name: record.dining_venue,
      floor: record.floor,
    })
    continue
  }

  school.canteens.push({
    ...common,
    name: record.dining_venue,
    location_text: record.floor,
    building_or_floor: record.floor,
    service_type: '食堂/餐厅',
    audience: '',
    opening_hours_raw: '',
  })
}

const seed = [
  {
    batch_name: batchName,
    region: '全国省会及自治区首府（不含北京、上海、武汉、南京）',
    source_scope: '高校官网、官方后勤、官方招生材料、官方采购公告及官方校园地图',
    schools: [...schools.values()].sort((a, b) => a.school.localeCompare(b.school, 'zh-CN')),
  },
]

fs.writeFileSync(outputPath, `${JSON.stringify(seed, null, 2)}\n`)
console.log(
  JSON.stringify({
    output: path.relative(repoRoot, outputPath),
    batch_name: batchName,
    schools: seed[0].schools.length,
    campuses: seed[0].schools.reduce((sum, school) => sum + school.campuses.length, 0),
    canteens: seed[0].schools.reduce((sum, school) => sum + school.canteens.length, 0),
    windows: seed[0].schools.reduce((sum, school) => sum + school.windows.length, 0),
  }),
)
