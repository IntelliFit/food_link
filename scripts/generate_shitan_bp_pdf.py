from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUT_PDF = DOCS / "食探-商业计划书-精简版.pdf"
OUT_PDF_ASCII = DOCS / "shitan-business-plan-brief.pdf"
PREVIEW_DIR = DOCS / "business_plan_preview"

FONT_REGULAR = Path(r"C:\Windows\Fonts\NotoSansSC-VF.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\NotoSansSC-VF.ttf")

PAGE_W = 1240
PAGE_H = 1754
MARGIN_X = 96
TOP = 92
BOTTOM = 88

INK = "#172033"
MUTED = "#667085"
TEAL = "#0F766E"
LIGHT_TEAL = "#ECFEFF"
PALE = "#F8FAFC"
LINE = "#D5DEE8"
ACCENT = "#14B8A6"


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_REGULAR), size=size)


def text_width(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> int:
    if not text:
        return 0
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0]


def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        para = para.strip()
        if not para:
            lines.append("")
            continue
        current = ""
        for ch in para:
            candidate = current + ch
            if text_width(draw, candidate, fnt) <= max_w:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = ch
        if current:
            lines.append(current)
    return lines


class Page:
    def __init__(self, number: int):
        self.number = number
        self.image = Image.new("RGB", (PAGE_W, PAGE_H), "white")
        self.draw = ImageDraw.Draw(self.image)
        self.y = TOP
        self.draw.rectangle([0, 0, PAGE_W, 26], fill=TEAL)

    def footer(self):
        f = font(18)
        label = f"食探（智健食探）商业计划书  ·  第 {self.number} 页"
        self.draw.text(((PAGE_W - text_width(self.draw, label, f)) / 2, PAGE_H - 54), label, font=f, fill="#98A2B3")

    def h1(self, title: str):
        f = font(39)
        self.draw.text((MARGIN_X, self.y), title, font=f, fill=TEAL)
        self.y += 66

    def h2(self, title: str):
        f = font(29)
        self.draw.text((MARGIN_X, self.y), title, font=f, fill=INK)
        self.y += 45

    def p(self, text: str, size: int = 25, color: str = INK, gap: int = 12, max_w: int | None = None):
        f = font(size)
        max_w = max_w or (PAGE_W - MARGIN_X * 2)
        for line in wrap_text(self.draw, text, f, max_w):
            if line:
                self.draw.text((MARGIN_X, self.y), line, font=f, fill=color)
            self.y += int(size * 1.65)
        self.y += gap

    def bullet(self, items: Iterable[str], size: int = 24):
        f = font(size)
        bullet_x = MARGIN_X + 8
        text_x = MARGIN_X + 34
        max_w = PAGE_W - text_x - MARGIN_X
        for item in items:
            lines = wrap_text(self.draw, item, f, max_w)
            self.draw.ellipse([bullet_x, self.y + 13, bullet_x + 9, self.y + 22], fill=ACCENT)
            for index, line in enumerate(lines):
                self.draw.text((text_x, self.y), line, font=f, fill=INK)
                self.y += int(size * 1.55)
            self.y += 7
        self.y += 8

    def callout(self, title: str, body: str):
        x1 = MARGIN_X
        x2 = PAGE_W - MARGIN_X
        y1 = self.y
        body_lines = wrap_text(self.draw, body, font(24), x2 - x1 - 48)
        h = 88 + len(body_lines) * 39
        self.draw.rounded_rectangle([x1, y1, x2, y1 + h], radius=14, fill=LIGHT_TEAL, outline="#99F6E4", width=2)
        self.draw.text((x1 + 24, y1 + 20), title, font=font(28), fill=TEAL)
        yy = y1 + 66
        for line in body_lines:
            self.draw.text((x1 + 24, yy), line, font=font(24), fill=INK)
            yy += 39
        self.y += h + 34

    def table(self, headers: list[str], rows: list[list[str]], col_widths: list[int]):
        x = MARGIN_X
        y = self.y
        row_h = 62
        total_w = sum(col_widths)
        self.draw.rounded_rectangle([x, y, x + total_w, y + row_h * (len(rows) + 1)], radius=10, fill="white", outline=LINE, width=2)
        self.draw.rounded_rectangle([x, y, x + total_w, y + row_h], radius=10, fill=LIGHT_TEAL)
        cx = x
        for i, header in enumerate(headers):
            self.draw.text((cx + 18, y + 17), header, font=font(23), fill=INK)
            cx += col_widths[i]
        for r_i, row in enumerate(rows):
            yy = y + row_h * (r_i + 1)
            if r_i % 2 == 0:
                self.draw.rectangle([x, yy, x + total_w, yy + row_h], fill=PALE)
            self.draw.line([x, yy, x + total_w, yy], fill=LINE, width=1)
            cx = x
            for c_i, cell in enumerate(row):
                color = TEAL if c_i == len(row) - 1 and any(ch.isdigit() for ch in cell) else INK
                self.draw.text((cx + 18, yy + 17), cell, font=font(22), fill=color)
                if c_i > 0:
                    self.draw.line([cx, yy, cx, yy + row_h], fill=LINE, width=1)
                cx += col_widths[c_i]
        self.y += row_h * (len(rows) + 1) + 34


def cover() -> Page:
    p = Page(1)
    p.y = 225
    p.draw.text((MARGIN_X, p.y), "食探（智健食探）", font=font(58), fill=INK)
    p.y += 88
    p.draw.text((MARGIN_X, p.y), "AI 饮食记录与体重管理微信小程序", font=font(31), fill=MUTED)
    p.y += 82
    p.callout("一句话定位", "用 AI 降低饮食记录门槛，用趋势与建议帮助用户长期管理体重。")
    p.table(
        ["项目", "内容"],
        [
            ["核心关键词", "AI 饮食记录 / 体重管理 / 微信小程序 / 订阅制"],
            ["当前阶段", "需求已验证，进入会员与留存验证阶段"],
            ["品牌表达", "品牌简称：食探；小程序名称建议：智健食探"],
        ],
        [250, 794],
    )
    p.footer()
    return p


def build_pages() -> list[Page]:
    pages = [cover()]

    p = Page(2)
    p.h1("一、项目概述")
    p.h2("用户真正的痛点不是不知道热量，而是坚持不下来")
    p.bullet([
        "手动搜索食物和估算份量太麻烦，很多用户记录几天就放弃。",
        "单次拍照识别有新鲜感，但如果没有后续趋势和建议，很难形成习惯。",
        "体重管理需要的是持续反馈：今天吃了什么、哪里偏了、下周怎么调整。",
    ])
    p.callout("产品定位", "食探不是一个只看热量的小工具，而是围绕饮食记录、体重趋势和执行建议展开的轻量体重管理助手。")
    p.h2("核心闭环")
    p.p("AI 识别记录 -> 每日摄入总览 -> 体重与趋势洞察 -> 执行建议", size=28, color=TEAL)
    p.footer()
    pages.append(p)

    p = Page(3)
    p.h1("二、市场机会")
    p.h2("中国体重管理正在进入长期需求期")
    p.bullet([
        "超重、肥胖和代谢健康问题持续扩大，年轻用户正在寻找更轻量的管理工具。",
        "微信小程序打开即用，不需要下载 App，适合饮食记录这类高频低门槛场景。",
        "用户对每月十元左右、能明显提升效率的订阅产品，接受度已经成熟。",
    ])
    p.h2("市场空缺")
    p.table(
        ["现有方案", "主要问题"],
        [
            ["手动记录工具", "录入太重，用户很难坚持"],
            ["运动平台", "更偏训练，不擅长饮食闭环"],
            ["单次 AI 识别工具", "有新鲜感，但缺少长期价值"],
        ],
        [330, 714],
    )
    p.callout("切入点", "用 AI 让饮食记录足够轻，再用体重管理和周度复盘建立持续价值。")
    p.footer()
    pages.append(p)

    p = Page(4)
    p.h1("三、产品方案")
    p.table(
        ["模块", "价值"],
        [
            ["AI 拍照分析", "识别餐食，估算热量和三大营养素"],
            ["AI 文字分析", "一句话补记录，适合外卖、食堂和家常菜"],
            ["手动记录", "永久免费，作为稳定兜底能力"],
            ["每日总览", "展示今日热量、营养素和餐次分布"],
            ["身体数据", "体重、喝水、运动等基础管理"],
            ["周报复盘", "从记录工具走向管理助手"],
        ],
        [300, 744],
    )
    p.h2("产品原则")
    p.bullet([
        "少一步操作，就多一点留存。",
        "先做饮食记录主链路，再逐步强化体重管理闭环。",
        "会员卖的是持续管理价值，不是单纯拍照次数。",
    ])
    p.footer()
    pages.append(p)

    p = Page(5)
    p.h1("四、当前验证")
    p.h2("早期数据表明，主需求已经成立")
    p.table(
        ["指标", "当前数据"],
        [
            ["累计注册用户", "622"],
            ["近 30 天活跃用户", "约 270"],
            ["近 30 天 AI 分析任务", "3,408"],
            ["近 30 天饮食记录", "2,278"],
            ["分析后形成记录的用户转化率", "66.1%"],
        ],
        [515, 529],
    )
    p.h2("数据说明")
    p.bullet([
        "用户并不是只试一下 AI 识别，而是真的会把结果落成记录。",
        "AI 拍照和文字分析已经证明是有效入口。",
        "下一阶段重点，是把短期使用变成长期管理习惯。",
    ])
    p.callout("阶段判断", "食探已经验证了“会有人用”，接下来要验证的是用户是否愿意长期留下，并为持续管理付费。")
    p.footer()
    pages.append(p)

    p = Page(6)
    p.h1("五、商业模式")
    p.h2("以订阅会员制为主")
    p.bullet([
        "体重管理是持续性需求，天然适合订阅制。",
        "中国用户对会员权益比积分计费更熟悉。",
        "后台保留额度控制，用于约束 AI 成本，但不制造复杂前台心智。",
    ])
    p.table(
        ["层级", "建议价格", "核心权益"],
        [
            ["免费版", "0 元", "手动记录、基础总览、少量 AI 体验"],
            ["月度会员", "9.9 元/月", "更高 AI 额度、趋势洞察、周报复盘"],
            ["年度会员", "68 元/年", "同月度权益，强调长期使用性价比"],
        ],
        [260, 240, 544],
    )
    p.callout("商业逻辑", "免费层负责降低体验门槛，会员层负责售卖持续价值。真正卖点不是拍照次数，而是更轻松地坚持饮食和体重管理。")
    p.footer()
    pages.append(p)

    p = Page(7)
    p.h1("六、90 天重点")
    p.h2("只聚焦三件事")
    p.bullet([
        "完成会员体系正式验证：上线更清晰的会员页，以订阅制验证真实付费意愿。",
        "增强持续使用理由：上线周报复盘，强化体重趋势与饮食建议。",
        "建立低成本获客模型：通过小红书、抖音、微信搜一搜测试内容获客。",
    ])
    p.table(
        ["关键指标", "目标"],
        [
            ["D30 留存", "提升至 20% 左右"],
            ["订阅付费率", "达到 3% 左右"],
            ["MAU", "突破 1,000"],
        ],
        [420, 624],
    )
    p.h2("结论")
    p.p("食探（智健食探）已经找到清晰入口：用 AI 降低饮食记录门槛，用趋势和建议建立长期管理价值。下一阶段的关键，不是继续堆功能，而是把体重管理价值做深，把订阅模型跑通。")
    p.footer()
    pages.append(p)
    return pages


def main() -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    pages = build_pages()
    images = [p.image for p in pages]
    for idx, image in enumerate(images, start=1):
        image.save(PREVIEW_DIR / f"page-{idx:02d}.png", quality=95)
    images[0].save(OUT_PDF, "PDF", resolution=150.0, save_all=True, append_images=images[1:])
    images[0].save(OUT_PDF_ASCII, "PDF", resolution=150.0, save_all=True, append_images=images[1:])
    print(OUT_PDF)
    print(PREVIEW_DIR / "page-01.png")


if __name__ == "__main__":
    main()
