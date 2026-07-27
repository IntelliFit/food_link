import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const defaultInput = resolve(
  rootDir,
  "outputs/campus-dining-normalized-20260727/北京92所高校食堂统一关系清单-2026-07-27.xlsx.inspect.ndjson",
);
const defaultOutput = resolve(
  rootDir,
  "backend/data/beijing_owner_verified_dining_seed.json",
);

const inputPath = resolve(process.argv[2] || defaultInput);
const outputPath = resolve(process.argv[3] || defaultOutput);

const text = await readFile(inputPath, "utf8");
const tableRecord = text
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .find(
    (record) =>
      record.kind === "table" &&
      record.sheet === "统一关系清单" &&
      Array.isArray(record.values),
  );

if (!tableRecord) {
  throw new Error("未在检查文件中找到“统一关系清单”表格");
}

const [header, ...dataRows] = tableRecord.values;
const columns = new Map(header.map((name, index) => [String(name).trim(), index]));
for (const required of [
  "学校",
  "食堂",
  "楼层",
  "区域/子餐厅",
  "类型",
  "核验状态",
  "证据文件/URL",
  "是否必须人工核对",
]) {
  if (!columns.has(required)) {
    throw new Error(`统一关系清单缺少必需列：${required}`);
  }
}

const cell = (row, name) => String(row[columns.get(name)] ?? "").trim();
const schoolMap = new Map();
const floorOrder = new Map([
  ["负五楼", -5],
  ["负四楼", -4],
  ["负三楼", -3],
  ["负二楼", -2],
  ["负一楼", -1],
  ["平层", 0],
  ["一楼", 1],
  ["二楼", 2],
  ["三楼", 3],
  ["四楼", 4],
  ["五楼", 5],
]);

function normalizeFloor(value) {
  const raw = value.trim();
  if (!raw) return "";
  const basement = raw.match(/^(?:地下|负|B)([一二三四五12345])(?:层|楼)?$/i);
  if (basement) return `负${toChineseNumber(basement[1])}楼`;
  const above = raw.match(/^([一二三四五12345])(?:层|楼)$/);
  if (above) return `${toChineseNumber(above[1])}楼`;
  if (raw === "平层") return raw;
  throw new Error(`出现尚未支持的楼层写法：${raw}`);
}

function toChineseNumber(value) {
  return (
    {
      1: "一",
      2: "二",
      3: "三",
      4: "四",
      5: "五",
    }[value] || value
  );
}

function splitCanteen(raw) {
  const parts = raw.split("｜").map((part) => part.trim());
  if (parts.length <= 1) return { campus: "", name: raw.trim() };
  return {
    campus: parts.slice(0, -1).join("｜"),
    name: parts.at(-1),
  };
}

function sanitizeEvidenceRef(value) {
  if (/^[a-z]:\\/i.test(value)) {
    return "产品负责人提供的本地图片证据（清单已归档）";
  }
  return value;
}

for (const row of dataRows) {
  const schoolName = cell(row, "学校");
  const rawCanteen = cell(row, "食堂");
  if (!schoolName || !rawCanteen) continue;

  let school = schoolMap.get(schoolName);
  if (!school) {
    school = {
      name: schoolName,
      campuses: new Set(),
      canteens: new Map(),
      notes: [],
    };
    schoolMap.set(schoolName, school);
  }

  if (cell(row, "类型") === "食堂数量确认") {
    school.notes.push(
      `${rawCanteen}：${cell(row, "区域/子餐厅") || "仅确认数量"}；正式名称未披露，未生成虚构下拉项`,
    );
    continue;
  }

  const { campus, name } = splitCanteen(rawCanteen);
  if (!name) continue;
  if (campus) school.campuses.add(campus);
  const key = `${campus}\u0000${name}`;
  let canteen = school.canteens.get(key);
  if (!canteen) {
    canteen = {
      campus,
      name,
      floors: new Set(),
      areas: new Set(),
      serviceTypes: new Set(),
      statuses: new Set(),
      evidenceRefs: new Set(),
    };
    school.canteens.set(key, canteen);
  }

  const floor = normalizeFloor(cell(row, "楼层"));
  if (floor) canteen.floors.add(floor);
  const area = cell(row, "区域/子餐厅");
  if (area) canteen.areas.add(floor ? `${floor}：${area}` : area);
  const serviceType = cell(row, "类型");
  if (serviceType) canteen.serviceTypes.add(serviceType);
  const status = cell(row, "核验状态");
  if (status) canteen.statuses.add(status);
  const evidenceRef = cell(row, "证据文件/URL");
  if (evidenceRef) canteen.evidenceRefs.add(sanitizeEvidenceRef(evidenceRef));
}

const schools = [...schoolMap.values()]
  .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  .map((school) => ({
    school: school.name,
    review_status: "pending_review",
    campuses: [...school.campuses]
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
      .map((name) => ({
        name,
        aliases: [],
        address: "",
        source_url: "",
      })),
    canteens: [...school.canteens.values()]
      .sort(
        (a, b) =>
          a.campus.localeCompare(b.campus, "zh-CN") ||
          a.name.localeCompare(b.name, "zh-CN"),
      )
      .map((canteen) => {
        const identity = `${school.name}\u0000${canteen.campus}\u0000${canteen.name}`;
        const digest = createHash("sha256").update(identity).digest("hex").slice(0, 24);
        const floors = [...canteen.floors].sort(
          (a, b) =>
            (floorOrder.get(a) ?? 999) - (floorOrder.get(b) ?? 999) ||
            a.localeCompare(b, "zh-CN"),
        );
        const evidenceParts = [
          `核验结论：${[...canteen.statuses].join("；")}`,
          canteen.areas.size > 0
            ? `楼层区域：${[...canteen.areas].join("；")}`
            : "",
          canteen.evidenceRefs.size > 0
            ? `原始证据：${[...canteen.evidenceRefs].join("；")}`
            : "",
        ].filter(Boolean);
        return {
          campus: canteen.campus,
          name: canteen.name,
          aliases: [],
          location_text: [...canteen.areas].join("；"),
          building_or_floor: floors.join("、"),
          service_type: [...canteen.serviceTypes].join("、") || "食堂",
          audience: "",
          opening_hours_raw: "",
          source_url: `owner-confirmation://beijing-campus-dining/2026-07-27/${digest}`,
          source_title: "北京92所高校食堂统一关系清单（产品负责人确认）",
          source_org: "food_link 产品负责人",
          source_type: "user_verified_owner_approved_compilation",
          evidence_level: "D",
          evidence_excerpt: evidenceParts.join("\n"),
          review_status: "pending_review",
        };
      }),
    windows: [],
    notes: [
      "产品负责人于2026-07-27批准北京高校目录入库；未披露楼层保持为空，不写成已确认一楼",
      ...school.notes,
    ],
  }));

const canteenCount = schools.reduce(
  (sum, school) => sum + school.canteens.length,
  0,
);
const floorKnownCount = schools.reduce(
  (sum, school) =>
    sum +
    school.canteens.filter((canteen) => canteen.building_or_floor).length,
  0,
);
if (schools.length !== 92) {
  throw new Error(`北京高校数量应为92，实际为${schools.length}`);
}
if (schools.some((school) => school.canteens.length === 0)) {
  throw new Error("存在未生成任何食堂目录项的高校");
}

const output = [
  {
    batch_name: "北京92所高校食堂目录-产品负责人确认-20260727",
    region: "北京市",
    source_scope:
      "产品负责人确认、校方官网、迎新材料、后勤及餐饮服务中心公开资料的统一关系清单",
    schools,
  },
];
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      input: inputPath,
      output: outputPath,
      schools: schools.length,
      canteens: canteenCount,
      canteens_with_known_floors: floorKnownCount,
      canteens_without_known_floors: canteenCount - floorKnownCount,
    },
    null,
    2,
  ),
);
