#!/usr/bin/env python3
"""Build the illustrated report from its adjacent Markdown source.

Run with the bundled Python runtime.  --check-only validates inputs and fonts
without creating a PDF.  The caller must run the artifact operation marker
exactly once immediately before the first actual authoring invocation.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlparse

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent
PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT_MARGIN = RIGHT_MARGIN = 47.0
TOP_MARGIN = 56.0
BOTTOM_MARGIN = 47.0
CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN
CONTENT_HEIGHT = PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN
PINE = colors.HexColor("#315E51")
INK = colors.HexColor("#263D35")
MUTED = colors.HexColor("#64756E")
RULE = colors.HexColor("#DCE5DD")
PALE = colors.HexColor("#F2F6F1")
FONT_REGULAR = "PetReportCJK"
FONT_BOLD = "PetReportCJKBold"
IMAGE_PATTERN = re.compile(r"!\[([^\]]*)\]\(([^\n]+?)\)")
HEADING_PATTERN = re.compile(r"^(#{1,4})\s+(.+?)\s*#*\s*$")
LIST_PATTERN = re.compile(r"^\s*(?:(\d+)[.)]|([-+*]))\s+(.+)$")


@dataclass
class Block:
    kind: str
    text: str = ""
    level: int = 0
    key: str = ""
    rows: list[list[str]] = field(default_factory=list)
    marker: str = ""
    path: Path | None = None
    size: tuple[int, int] | None = None


def register_fonts(font_path: Path | None = None) -> dict[str, str]:
    """Register real embeddable Chinese TTF/TTC faces; never open a PDF here."""
    candidates = ([font_path] if font_path else []) + [
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
    ]
    failures: list[str] = []
    regular_path = None
    for path in candidates:
        if path is None or not path.is_file():
            continue
        try:
            pdfmetrics.registerFont(
                TTFont(FONT_REGULAR, str(path), subfontIndex=0)
            )
            regular_path = path
            break
        except Exception as exc:
            failures.append(f"{path}: {exc}")
    if regular_path is None:
        raise ValueError("No embeddable Chinese font found. " + "; ".join(failures))

    bold_path = Path(r"C:\Windows\Fonts\msyhbd.ttc")
    if regular_path.name.lower().startswith("msyh") and bold_path.is_file():
        try:
            pdfmetrics.registerFont(TTFont(FONT_BOLD, str(bold_path), subfontIndex=0))
        except Exception:
            bold_path = regular_path
            pdfmetrics.registerFont(TTFont(FONT_BOLD, str(bold_path), subfontIndex=0))
    else:
        bold_path = regular_path
        pdfmetrics.registerFont(TTFont(FONT_BOLD, str(bold_path), subfontIndex=0))
    pdfmetrics.registerFontFamily(
        FONT_REGULAR,
        normal=FONT_REGULAR,
        bold=FONT_BOLD,
        italic=FONT_REGULAR,
        boldItalic=FONT_BOLD,
    )
    glyphs = pdfmetrics.getFont(FONT_REGULAR).face.charToGlyph
    if any(ord(char) not in glyphs for char in "食探宠物成长图文报告"):
        raise ValueError(f"Selected font lacks required Chinese glyphs: {regular_path}")
    return {"regular": str(regular_path), "bold": str(bold_path)}


def normalized_text(value: str) -> str:
    # Keep punctuation printable in standard export tools.
    return value.replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-")


def plain_text(value: str) -> str:
    value = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", value)
    value = value.replace("**", "").replace("`", "")
    return normalized_text(value)


def link_target(target: str) -> str | None:
    target = target.strip()
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1]
    if target.startswith("#"):
        return target
    parsed = urlparse(target)
    if parsed.scheme.lower() in {"http", "https", "mailto"}:
        return target
    # Local references remain readable labels. Only image paths are opened.
    return None


def inline_xml(value: str) -> str:
    """Escape all source text, then emit only our known ReportLab markup."""
    value = normalized_text(value)
    output: list[str] = []
    index = 0
    while index < len(value):
        if value.startswith("**", index):
            end = value.find("**", index + 2)
            if end >= 0:
                output.append("<b>" + inline_xml(value[index + 2 : end]) + "</b>")
                index = end + 2
                continue
        if value[index] == "*" and not value.startswith("**", index):
            end = value.find("*", index + 1)
            if end > index + 1:
                output.append("<i>" + inline_xml(value[index + 1 : end]) + "</i>")
                index = end + 1
                continue
        if value[index] == "`":
            end = value.find("`", index + 1)
            if end >= 0:
                output.append(
                    '<font color="#466A5D">'
                    + html.escape(value[index + 1 : end], quote=True)
                    + "</font>"
                )
                index = end + 1
                continue
        if value[index] == "[":
            close = value.find("](", index + 1)
            if close >= 0:
                position = close + 2
                depth = 1
                quoted_angle = position < len(value) and value[position] == "<"
                while position < len(value):
                    char = value[position]
                    if char == ")" and (not quoted_angle or value[position - 1] == ">"):
                        depth -= 1
                        if depth == 0:
                            break
                    elif char == "(" and not quoted_angle:
                        depth += 1
                    position += 1
                if depth == 0:
                    label = inline_xml(value[index + 1 : close])
                    target = link_target(value[close + 2 : position])
                    if target:
                        output.append(
                            '<link href="'
                            + html.escape(target, quote=True)
                            + '" color="#315E51">'
                            + label
                            + "</link>"
                        )
                    else:
                        output.append(label)
                    index = position + 1
                    continue
        if value.startswith("<br>", index) or value.startswith("<br/>", index):
            length = 4 if value.startswith("<br>", index) else 5
            output.append("<br/>")
            index += length
            continue
        output.append(html.escape(value[index], quote=True))
        index += 1
    return "".join(output)


def table_cells(line: str) -> list[str]:
    line = line.strip().strip("|")
    return [part.strip().replace(r"\|", "|") for part in re.split(r"(?<!\\)\|", line)]


def table_separator(line: str) -> bool:
    cells = table_cells(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def parse_markdown(source: str) -> list[Block]:
    lines = source.splitlines()
    blocks: list[Block] = []
    paragraph: list[str] = []
    heading_number = 0

    def flush() -> None:
        if paragraph:
            blocks.append(Block("paragraph", text=" ".join(paragraph)))
            paragraph.clear()

    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            flush()
            index += 1
            continue
        # Use a supplied figure caption instead of printing both alt text and
        # a second caption paragraph. It stays attached to the actual image.
        if (not paragraph and blocks and blocks[-1].kind == "image"
                and re.fullmatch(r"\*[^*]+\*", line)):
            blocks[-1].text = line[1:-1].strip()
            index += 1
            continue
        heading = HEADING_PATTERN.match(line)
        if heading:
            flush()
            heading_number += 1
            blocks.append(
                Block("heading", text=heading.group(2), level=len(heading.group(1)),
                      key=f"section-{heading_number:03d}")
            )
            index += 1
            continue
        if index + 1 < len(lines) and "|" in line and table_separator(lines[index + 1]):
            flush()
            rows = [table_cells(line)]
            index += 2
            while index < len(lines) and lines[index].strip() and "|" in lines[index]:
                rows.append(table_cells(lines[index]))
                index += 1
            columns = len(rows[0])
            if any(len(row) != columns for row in rows):
                raise ValueError(f"Markdown table has inconsistent column counts near {rows[0]}")
            blocks.append(Block("table", rows=rows))
            continue
        image_matches = list(IMAGE_PATTERN.finditer(line))
        if image_matches:
            flush()
            position = 0
            for match in image_matches:
                before = line[position : match.start()].strip()
                if before:
                    blocks.append(Block("paragraph", text=before))
                blocks.append(Block("image", text=match.group(1), marker=match.group(2)))
                position = match.end()
            after = line[position:].strip()
            if after:
                blocks.append(Block("paragraph", text=after))
            index += 1
            continue
        listing = LIST_PATTERN.match(line)
        if listing:
            flush()
            marker = f"{listing.group(1)}." if listing.group(1) else "•"
            blocks.append(Block("list", text=listing.group(3), marker=marker))
            index += 1
            continue
        if line.startswith("```"):
            flush()
            index += 1
            code_lines: list[str] = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index].rstrip())
                index += 1
            blocks.append(Block("code", text="\n".join(code_lines)))
            index += 1
            continue
        if re.fullmatch(r"[-*_]{3,}", line):
            flush()
            blocks.append(Block("rule"))
            index += 1
            continue
        if line.startswith(">"):
            flush()
            blocks.append(Block("quote", text=line.lstrip("> ")))
            index += 1
            continue
        paragraph.append(line)
        index += 1
    flush()
    return blocks


def image_path(raw: str, source_dir: Path) -> Path:
    raw = raw.strip()
    if raw.startswith("<"):
        end = raw.find(">")
        if end < 0:
            raise ValueError(f"Malformed image path: {raw}")
        raw = raw[1:end]
    else:
        raw = re.sub(r'\s+[\"\'][^\"\']*[\"\']$', "", raw)
    # Images are local input artifacts; no remote downloads or placeholder URLs.
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", raw):
        raise ValueError(f"Only real local image files are supported: {raw}")
    path = Path(unquote(raw.replace("\\", "/")))
    if not path.is_absolute():
        path = source_dir / path
    if path.suffix.lower() == ".svg":
        path = path.with_suffix(".png")
    return path.resolve()


def preflight(blocks: list[Block], source_dir: Path) -> list[dict]:
    images: list[dict] = []
    errors: list[str] = []
    for block in blocks:
        if block.kind != "image":
            continue
        try:
            path = image_path(block.marker, source_dir)
            if not path.is_file():
                raise ValueError(f"Missing image: {path}")
            with PILImage.open(path) as picture:
                width, height = picture.size
                if width <= 0 or height <= 0:
                    raise ValueError(f"Invalid image dimensions: {path}")
                picture.verify()
            block.path = path
            block.size = (width, height)
            images.append({"path": str(path), "width": width, "height": height})
        except Exception as exc:
            errors.append(str(exc))
    if errors:
        raise ValueError("Input images are not ready:\n" + "\n".join(errors))
    return images


def styles() -> dict[str, ParagraphStyle]:
    base = dict(fontName=FONT_REGULAR, fontSize=10.5, leading=17.0,
                textColor=INK, wordWrap="CJK", splitLongWords=True,
                allowWidows=0, allowOrphans=0)
    result = {
        "body": ParagraphStyle("Body", spaceAfter=7.5, **base),
        "list": ParagraphStyle("List", leftIndent=17, firstLineIndent=0,
                               bulletIndent=1, bulletFontName=FONT_REGULAR,
                               bulletFontSize=10.5, spaceAfter=5.5, **base),
        "quote": ParagraphStyle("Quote", leftIndent=12, rightIndent=10,
                                borderColor=RULE, borderWidth=0.4,
                                borderPadding=8, backColor=PALE,
                                spaceBefore=4, spaceAfter=9, **base),
        "caption": ParagraphStyle("Caption", fontName=FONT_REGULAR,
                                  fontSize=9, leading=13.5, textColor=MUTED,
                                  wordWrap="CJK", alignment=TA_CENTER,
                                  spaceBefore=5, spaceAfter=13),
        "code": ParagraphStyle("Code", fontName=FONT_REGULAR, fontSize=9,
                               leading=14, textColor=MUTED, wordWrap="CJK",
                               leftIndent=10, rightIndent=10, borderPadding=7,
                               backColor=PALE, spaceAfter=9),
        "toc": ParagraphStyle("Contents", fontName=FONT_REGULAR,
                              fontSize=10, leading=16, textColor=PINE,
                              wordWrap="CJK", spaceAfter=5),
    }
    for level, size, leading in [(1, 24, 34), (2, 16, 24), (3, 12.5, 20), (4, 11, 18)]:
        result[f"h{level}"] = ParagraphStyle(
            f"Heading{level}", fontName=FONT_BOLD, fontSize=size,
            leading=leading, textColor=PINE, wordWrap="CJK",
            spaceBefore=15 if level > 1 else 5,
            spaceAfter=8 if level > 1 else 13,
            keepWithNext=True,
        )
    return result


class Rule(Flowable):
    def __init__(self):
        super().__init__()
        self.width = CONTENT_WIDTH
        self.height = 13

    def draw(self):
        self.canv.setStrokeColor(RULE)
        self.canv.setLineWidth(0.6)
        self.canv.line(0, 7, self.width, 7)


class ReportDocument(BaseDocTemplate):
    def __init__(self, filename: str, title: str):
        super().__init__(filename, pagesize=A4, leftMargin=LEFT_MARGIN,
                         rightMargin=RIGHT_MARGIN, topMargin=TOP_MARGIN,
                         bottomMargin=BOTTOM_MARGIN, title=title,
                         author="食探", allowSplitting=1,
                         pageCompression=1)
        self.outline_level = -1
        frame = Frame(LEFT_MARGIN, BOTTOM_MARGIN, CONTENT_WIDTH, CONTENT_HEIGHT,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
                      id="report")
        self.addPageTemplates(PageTemplate(id="Report", frames=[frame], onPage=self.page_chrome))

    def page_chrome(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(MUTED)
        canvas.setFont(FONT_REGULAR, 8)
        canvas.drawString(LEFT_MARGIN, PAGE_HEIGHT - 32, "食探 / 宠物设计报告")
        canvas.drawRightString(PAGE_WIDTH - RIGHT_MARGIN, PAGE_HEIGHT - 32,
                               "设计方案 · 以正文状态标注为准")
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(LEFT_MARGIN, PAGE_HEIGHT - 40, PAGE_WIDTH - RIGHT_MARGIN, PAGE_HEIGHT - 40)
        canvas.line(LEFT_MARGIN, 34, PAGE_WIDTH - RIGHT_MARGIN, 34)
        canvas.drawString(LEFT_MARGIN, 22, "食探 · 成长与收集")
        canvas.drawRightString(PAGE_WIDTH - RIGHT_MARGIN, 22, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        heading = getattr(flowable, "report_heading", None)
        if not heading:
            return
        key, title, desired_level = heading
        level = min(desired_level, self.outline_level + 1)
        level = max(level, 0)
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(title, key, level=level, closed=True)
        self.outline_level = level


def column_weights(rows: list[list[str]]) -> list[float]:
    weights: list[float] = []
    for column in zip(*rows):
        units = []
        for value in column:
            plain = plain_text(value)
            units.append(sum(0.52 if ord(char) < 128 else 1.0 for char in plain))
        largest = sorted(units)[max(0, math.ceil(len(units) * 0.85) - 1)]
        # Short ID columns remain compact; prose columns receive more width.
        weights.append(max(5.0, min(36.0, max(units[0], largest))))
    return weights


def table_flowable(block: Block) -> LongTable:
    count = len(block.rows[0])
    font_size = 8.5 if count >= 6 else 9.25
    cell_style = ParagraphStyle("TableCell", fontName=FONT_REGULAR,
                               fontSize=font_size, leading=font_size * 1.5,
                               textColor=INK, wordWrap="CJK", splitLongWords=True,
                               allowWidows=1, allowOrphans=1, spaceAfter=0)
    header_style = ParagraphStyle("TableHeader", parent=cell_style,
                                 fontName=FONT_BOLD, textColor=PINE)
    data = [[Paragraph(inline_xml(value), header_style if row_number == 0 else cell_style)
             for value in row] for row_number, row in enumerate(block.rows)]
    weights = column_weights(block.rows)
    widths = [CONTENT_WIDTH * weight / sum(weights) for weight in weights]
    table = LongTable(data, colWidths=widths, repeatRows=1, splitByRow=1,
                      splitInRow=1, hAlign="LEFT", spaceBefore=4, spaceAfter=13)
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E7EFE7")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("LINEBELOW", (0, 0), (-1, 0), 0.75, colors.HexColor("#9EB8A6")),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def image_flowable(block: Block, style_map: dict) -> KeepTogether:
    if block.path is None or block.size is None:
        raise ValueError("Images must pass preflight before authoring")
    width, height = block.size
    maximum_height = min(510.0, CONTENT_HEIGHT - 100)
    scale = min(CONTENT_WIDTH / width, maximum_height / height)
    figure = Image(str(block.path), width=width * scale, height=height * scale,
                   hAlign="CENTER", mask="auto")
    items = [Spacer(1, 5), figure]
    if block.text:
        items.append(Paragraph(inline_xml(block.text), style_map["caption"]))
    else:
        items.append(Spacer(1, 12))
    return KeepTogether(items)


def contents_flowables(blocks: list[Block], style_map: dict) -> list[Flowable]:
    headings = [block for block in blocks if block.kind == "heading" and block.level in {2, 3}]
    if not headings:
        return []
    result: list[Flowable] = [Paragraph("阅读导航", style_map["h2"])]
    for heading in headings:
        indent = 13 if heading.level == 3 else 0
        style = ParagraphStyle(f"Contents{heading.key}", parent=style_map["toc"], leftIndent=indent)
        result.append(Paragraph(
            f'<link href="#{heading.key}" color="#315E51">{inline_xml(heading.text)}</link>', style
        ))
    result.append(PageBreak())
    return result


def build_story(blocks: list[Block]) -> list[Flowable]:
    style_map = styles()
    story: list[Flowable] = []
    navigation_added = False
    # Replace an existing plain-text contents list with the linked navigation.
    # The Markdown remains unchanged and continues to be readable on its own.
    clean_blocks: list[Block] = []
    index = 0
    while index < len(blocks):
        block = blocks[index]
        if block.kind == "paragraph" and re.fullmatch(r"(?:阅读)?目录\s*[:：]?", block.text):
            index += 1
            while index < len(blocks) and blocks[index].kind == "list":
                index += 1
            continue
        clean_blocks.append(block)
        index += 1
    for block in clean_blocks:
        if block.kind == "heading":
            if not navigation_added and block.level == 2:
                if story:
                    story.append(PageBreak())
                story.extend(contents_flowables(blocks, style_map))
                navigation_added = True
            paragraph = Paragraph(inline_xml(block.text), style_map[f"h{block.level}"])
            paragraph.report_heading = (block.key, plain_text(block.text), block.level - 1)
            story.append(paragraph)
        elif block.kind == "paragraph":
            story.append(Paragraph(inline_xml(block.text), style_map["body"]))
        elif block.kind == "list":
            story.append(Paragraph(inline_xml(block.text), style_map["list"], bulletText=block.marker))
        elif block.kind == "table":
            story.append(table_flowable(block))
        elif block.kind == "image":
            story.append(image_flowable(block, style_map))
        elif block.kind == "quote":
            story.append(Paragraph(inline_xml(block.text), style_map["quote"]))
        elif block.kind == "code":
            code = "<br/>".join(html.escape(line, quote=True) or "&#160;" for line in block.text.splitlines())
            story.append(Paragraph(code, style_map["code"]))
        elif block.kind == "rule":
            story.append(Rule())
    return story


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "report.md")
    parser.add_argument("--output", type=Path, default=ROOT / "pet-companion-design-report.pdf")
    parser.add_argument("--font", type=Path, default=None)
    parser.add_argument("--check-only", action="store_true",
                        help="Validate source, referenced local images and fonts; do not create a PDF")
    arguments = parser.parse_args(argv)
    source = arguments.source.resolve()
    output = arguments.output.resolve()
    if not source.is_file():
        raise ValueError(f"Markdown input does not exist: {source}")
    source_text = source.read_text(encoding="utf-8-sig")
    blocks = parse_markdown(source_text)
    if not blocks:
        raise ValueError("Markdown input is empty")
    images = preflight(blocks, source.parent)
    fonts = register_fonts(arguments.font)
    summary = {"source": str(source), "output": str(output), "blocks": len(blocks),
               "headings": sum(block.kind == "heading" for block in blocks),
               "tables": sum(block.kind == "table" for block in blocks),
               "images": images, "fonts": fonts}
    if arguments.check_only:
        summary["check_only"] = True
        summary["pdf_created"] = False
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    title = next((plain_text(block.text) for block in blocks
                  if block.kind == "heading" and block.level == 1), "食探宠物设计报告")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.stem + ".building.pdf")
    try:
        document = ReportDocument(str(temporary), title)
        document.build(build_story(blocks))
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()
    summary["pdf_created"] = True
    summary["bytes"] = output.stat().st_size
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
