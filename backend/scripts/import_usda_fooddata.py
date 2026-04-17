"""
浠?USDA FoodData Central 瀹樻柟 API 鎵归噺瀵煎叆椋熺墿钀ュ吇鏁版嵁鍒?food_nutrition_library銆?
閫傜敤鍦烘櫙锛?1. 鐢ㄥ畼鏂规暟鎹壒閲忚ˉ鍏呭熀纭€椋熺墿鏁版嵁搴?2. 閲嶅鎵ц锛屾寔缁閲忓鍏?3. 鍏?dry-run 棰勮锛屽啀鍐冲畾鏄惁鍐欏簱
4. 鍙鍑?SQL锛屼氦缁?Supabase SQL Editor 鎵ц

瀹樻柟鍙傝€冿細
- API Guide: https://fdc.nal.usda.gov/api-guide
- Data homepage: https://fdc.nal.usda.gov/

閲嶈璇存槑锛?- USDA FoodData Central 鏁版嵁涓哄畼鏂瑰叕寮€鏁版嵁锛屽畼缃戞爣娉ㄤ负 CC0 1.0 / public domain銆?- 璇ヨ剼鏈粯璁や紭鍏堝鍏?Foundation + SR Legacy銆?- 濡傛灉寮€鍚?Branded锛屼細瀵煎叆闈炲父澶氱殑鍖呰椋熷搧锛屼綋閲忎細鏄庢樉澧炲ぇ銆?- USDA 鐨勯鐗╁悕涓昏鏄嫳鏂囨弿杩帮紱杩欒兘鏄捐憲鎻愬崌鈥滃簱鐨勫箍搴︹€濓紝浣嗕笉鐩存帴瑙ｅ喅涓枃鍒悕闂銆?"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import sys
import time
import zipfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import httpx
from dotenv import load_dotenv


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


DEFAULT_DATA_TYPES = ["Foundation", "SR Legacy"]
API_BASE_URL = "https://api.nal.usda.gov/fdc/v1"
DEFAULT_PAGE_SIZE = 200
DEFAULT_BATCH_SIZE = 200
DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_RATE_SLEEP_SECONDS = 0.15

DEFAULT_DATASET_URLS = {
    "Foundation": "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2025-12-18.zip",
    "SR Legacy": "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip",
    "Survey (FNDDS)": "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip",
}

# USDA 甯歌钀ュ吇瀛楁銆傝剼鏈細鍚屾椂鎸?nutrient id / 鍚嶇О鍋氬厹搴曡瘑鍒€?ENERGY_IDS = {1008, 2047, 2048}
PROTEIN_IDS = {1003}
CARBS_IDS = {1005}
FAT_IDS = {1004}
FIBER_IDS = {1079}
SUGAR_IDS = {2000}
SATURATED_FAT_IDS = {1258}
CHOLESTEROL_IDS = {1253}
SODIUM_IDS = {1093}
POTASSIUM_IDS = {1092}
CALCIUM_IDS = {1087}
IRON_IDS = {1089}
MAGNESIUM_IDS = {1090}
ZINC_IDS = {1095}
VITAMIN_A_IDS = {1106}
VITAMIN_C_IDS = {1162}
VITAMIN_D_IDS = {1114, 1115}
VITAMIN_E_IDS = {1109}
VITAMIN_K_IDS = {1185}
THIAMIN_IDS = {1165}
RIBOFLAVIN_IDS = {1166}
NIACIN_IDS = {1167}
VITAMIN_B6_IDS = {1175}
FOLATE_IDS = {1177}
VITAMIN_B12_IDS = {1178}


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        out = float(value)
        if math.isnan(out) or math.isinf(out):
            return None
        return out
    except Exception:
        return None


def _chunked(items: Sequence[Any], size: int) -> Iterable[Sequence[Any]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _usda_source_label(data_type: str) -> str:
    normalized = _clean_text(data_type).lower()
    if normalized == "foundation":
        return "美国农业部食物数据中心（Foundation）"
    if normalized == "sr legacy":
        return "美国农业部食物数据中心（SR Legacy）"
    if normalized == "survey (fndds)":
        return "美国农业部食物数据中心（Survey/FNDDS）"
    if normalized == "experimental":
        return "美国农业部食物数据中心（Experimental）"
    if normalized in {"branded", "branded foods"}:
        return "美国农业部食物数据中心（Branded Foods）"
    return "美国农业部食物数据中心"


def _normalize_food_name(name: str) -> str:
    raw = str(name or "").strip().lower()
    if not raw:
        return ""
    normalized = re.sub(r"[\s\r\n\t]+", "", raw)
    normalized = re.sub(r"[()锛堬級銆愩€慭[\]{}路,锛屻€?!锛?锛?锛?\"`~\-_/\\|]+", "", normalized)
    return normalized


def _sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _extract_nutrient_meta(nutrient: Dict[str, Any]) -> Tuple[Optional[int], str, Optional[float]]:
    nutrient_id = nutrient.get("nutrientId")
    if nutrient_id is None and isinstance(nutrient.get("nutrient"), dict):
        nutrient_id = nutrient["nutrient"].get("id")
    try:
        nutrient_id = int(nutrient_id) if nutrient_id is not None else None
    except Exception:
        nutrient_id = None

    name = (
        nutrient.get("name")
        or nutrient.get("nutrientName")
        or (nutrient.get("nutrient") or {}).get("name")
        or ""
    )
    unit = (
        nutrient.get("unitName")
        or nutrient.get("unit")
        or (nutrient.get("nutrient") or {}).get("unitName")
        or None
    )
    return nutrient_id, str(name or "").strip().lower(), _safe_float(unit)  # type: ignore[return-value]


def _extract_nutrient_value(nutrient: Dict[str, Any]) -> Optional[float]:
    for key in ("amount", "value"):
        value = _safe_float(nutrient.get(key))
        if value is not None:
            return value
    return None


def _looks_like_energy_kcal(name: str) -> bool:
    return (
        "energy" == name
        or "metabolizable energy" in name
        or "energy (atwater" in name
    )


def _looks_like_protein(name: str) -> bool:
    return name == "protein"


def _looks_like_carbs(name: str) -> bool:
    return (
        "carbohydrate, by difference" in name
        or name == "carbohydrate"
        or "total carbohydrate" in name
    )


def _looks_like_fat(name: str) -> bool:
    return (
        "total lipid (fat)" in name
        or name == "fat"
        or "total fat" in name
        or "lipid" in name
    )


def _looks_like_fiber(name: str) -> bool:
    return "fiber" in name


def _looks_like_sugar(name: str) -> bool:
    return "sugars, total" in name or name == "sugars"


def _looks_like_saturated_fat(name: str) -> bool:
    return "fatty acids, total saturated" in name or "saturated" in name


def _looks_like_cholesterol(name: str) -> bool:
    return "cholesterol" == name


def _looks_like_exact(name: str, target: str) -> bool:
    return name == target


def _pick_macros(food: Dict[str, Any]) -> Dict[str, float]:
    nutrients = food.get("foodNutrients") or []
    if not isinstance(nutrients, list):
        nutrients = []

    energy_candidates: List[Tuple[int, float]] = []
    protein_value: Optional[float] = None
    carbs_value: Optional[float] = None
    fat_value: Optional[float] = None
    fiber_value: Optional[float] = None
    sugar_value: Optional[float] = None
    saturated_fat_value: Optional[float] = None
    cholesterol_value: Optional[float] = None
    sodium_value: Optional[float] = None
    potassium_value: Optional[float] = None
    calcium_value: Optional[float] = None
    iron_value: Optional[float] = None
    magnesium_value: Optional[float] = None
    zinc_value: Optional[float] = None
    vitamin_a_value: Optional[float] = None
    vitamin_c_value: Optional[float] = None
    vitamin_d_value: Optional[float] = None
    vitamin_e_value: Optional[float] = None
    vitamin_k_value: Optional[float] = None
    thiamin_value: Optional[float] = None
    riboflavin_value: Optional[float] = None
    niacin_value: Optional[float] = None
    vitamin_b6_value: Optional[float] = None
    folate_value: Optional[float] = None
    vitamin_b12_value: Optional[float] = None

    for nutrient in nutrients:
        if not isinstance(nutrient, dict):
            continue
        nutrient_id = nutrient.get("nutrientId")
        if nutrient_id is None and isinstance(nutrient.get("nutrient"), dict):
            nutrient_id = nutrient["nutrient"].get("id")
        try:
            nutrient_id = int(nutrient_id) if nutrient_id is not None else None
        except Exception:
            nutrient_id = None

        name = (
            nutrient.get("name")
            or nutrient.get("nutrientName")
            or (nutrient.get("nutrient") or {}).get("name")
            or ""
        )
        name = str(name or "").strip().lower()
        value = _extract_nutrient_value(nutrient)
        if value is None:
            continue

        if nutrient_id in ENERGY_IDS or _looks_like_energy_kcal(name):
            priority = 0
            if nutrient_id == 2048 or "specific factor" in name:
                priority = 3
            elif nutrient_id == 2047 or "general factor" in name:
                priority = 2
            elif nutrient_id == 1008:
                priority = 1
            energy_candidates.append((priority, value))
            continue

        if protein_value is None and (nutrient_id in PROTEIN_IDS or _looks_like_protein(name)):
            protein_value = value
            continue

        if carbs_value is None and (nutrient_id in CARBS_IDS or _looks_like_carbs(name)):
            carbs_value = value
            continue

        if fat_value is None and (nutrient_id in FAT_IDS or _looks_like_fat(name)):
            fat_value = value
            continue

        if fiber_value is None and (nutrient_id in FIBER_IDS or _looks_like_fiber(name)):
            fiber_value = value
            continue

        if sugar_value is None and (nutrient_id in SUGAR_IDS or _looks_like_sugar(name)):
            sugar_value = value
            continue

        if saturated_fat_value is None and (nutrient_id in SATURATED_FAT_IDS or _looks_like_saturated_fat(name)):
            saturated_fat_value = value
            continue

        if cholesterol_value is None and (nutrient_id in CHOLESTEROL_IDS or _looks_like_cholesterol(name)):
            cholesterol_value = value
            continue

        if sodium_value is None and (nutrient_id in SODIUM_IDS or _looks_like_exact(name, "sodium, na")):
            sodium_value = value
            continue

        if potassium_value is None and (nutrient_id in POTASSIUM_IDS or _looks_like_exact(name, "potassium, k")):
            potassium_value = value
            continue

        if calcium_value is None and (nutrient_id in CALCIUM_IDS or _looks_like_exact(name, "calcium, ca")):
            calcium_value = value
            continue

        if iron_value is None and (nutrient_id in IRON_IDS or _looks_like_exact(name, "iron, fe")):
            iron_value = value
            continue

        if magnesium_value is None and (nutrient_id in MAGNESIUM_IDS or _looks_like_exact(name, "magnesium, mg")):
            magnesium_value = value
            continue

        if zinc_value is None and (nutrient_id in ZINC_IDS or _looks_like_exact(name, "zinc, zn")):
            zinc_value = value
            continue

        if vitamin_a_value is None and (nutrient_id in VITAMIN_A_IDS or "vitamin a, rae" in name):
            vitamin_a_value = value
            continue

        if vitamin_c_value is None and (nutrient_id in VITAMIN_C_IDS or "vitamin c" in name):
            vitamin_c_value = value
            continue

        if vitamin_d_value is None and (nutrient_id in VITAMIN_D_IDS or "vitamin d" in name):
            vitamin_d_value = value
            continue

        if vitamin_e_value is None and (nutrient_id in VITAMIN_E_IDS or "vitamin e" in name):
            vitamin_e_value = value
            continue

        if vitamin_k_value is None and (nutrient_id in VITAMIN_K_IDS or "vitamin k" in name):
            vitamin_k_value = value
            continue

        if thiamin_value is None and (nutrient_id in THIAMIN_IDS or "thiamin" in name):
            thiamin_value = value
            continue

        if riboflavin_value is None and (nutrient_id in RIBOFLAVIN_IDS or "riboflavin" in name):
            riboflavin_value = value
            continue

        if niacin_value is None and (nutrient_id in NIACIN_IDS or "niacin" in name):
            niacin_value = value
            continue

        if vitamin_b6_value is None and (nutrient_id in VITAMIN_B6_IDS or "vitamin b-6" in name):
            vitamin_b6_value = value
            continue

        if folate_value is None and (nutrient_id in FOLATE_IDS or "folate, dfe" in name):
            folate_value = value
            continue

        if vitamin_b12_value is None and (nutrient_id in VITAMIN_B12_IDS or "vitamin b-12" in name):
            vitamin_b12_value = value
            continue

    energy_candidates.sort(key=lambda x: x[0], reverse=True)
    calories = energy_candidates[0][1] if energy_candidates else None

    return {
        "calories": round(calories or 0.0, 2),
        "protein": round(protein_value or 0.0, 2),
        "carbs": round(carbs_value or 0.0, 2),
        "fat": round(fat_value or 0.0, 2),
        "fiber": round(fiber_value or 0.0, 2),
        "sugar": round(sugar_value or 0.0, 2),
        "saturatedFat": round(saturated_fat_value or 0.0, 2),
        "cholesterolMg": round(cholesterol_value or 0.0, 2),
        "sodiumMg": round(sodium_value or 0.0, 2),
        "potassiumMg": round(potassium_value or 0.0, 2),
        "calciumMg": round(calcium_value or 0.0, 2),
        "ironMg": round(iron_value or 0.0, 2),
        "magnesiumMg": round(magnesium_value or 0.0, 2),
        "zincMg": round(zinc_value or 0.0, 2),
        "vitaminARaeMcg": round(vitamin_a_value or 0.0, 2),
        "vitaminCMg": round(vitamin_c_value or 0.0, 2),
        "vitaminDMcg": round(vitamin_d_value or 0.0, 2),
        "vitaminEMg": round(vitamin_e_value or 0.0, 2),
        "vitaminKMcg": round(vitamin_k_value or 0.0, 2),
        "thiaminMg": round(thiamin_value or 0.0, 2),
        "riboflavinMg": round(riboflavin_value or 0.0, 2),
        "niacinMg": round(niacin_value or 0.0, 2),
        "vitaminB6Mg": round(vitamin_b6_value or 0.0, 2),
        "folateMcg": round(folate_value or 0.0, 2),
        "vitaminB12Mcg": round(vitamin_b12_value or 0.0, 2),
    }


@dataclass
class ImportFoodRow:
    canonical_name: str
    normalized_name: str
    kcal_per_100g: float
    protein_per_100g: float
    carbs_per_100g: float
    fat_per_100g: float
    fiber_per_100g: float
    sugar_per_100g: float
    saturated_fat_per_100g: float
    cholesterol_mg_per_100g: float
    sodium_mg_per_100g: float
    potassium_mg_per_100g: float
    calcium_mg_per_100g: float
    iron_mg_per_100g: float
    magnesium_mg_per_100g: float
    zinc_mg_per_100g: float
    vitamin_a_rae_mcg_per_100g: float
    vitamin_c_mg_per_100g: float
    vitamin_d_mcg_per_100g: float
    vitamin_e_mg_per_100g: float
    vitamin_k_mcg_per_100g: float
    thiamin_mg_per_100g: float
    riboflavin_mg_per_100g: float
    niacin_mg_per_100g: float
    vitamin_b6_mg_per_100g: float
    folate_mcg_per_100g: float
    vitamin_b12_mcg_per_100g: float
    source: str
    usda_fdc_id: int
    usda_data_type: str
    brand_owner: Optional[str] = None

    def to_insert_row(self) -> Dict[str, Any]:
        return {
            "canonical_name": self.canonical_name,
            "normalized_name": self.normalized_name,
            "kcal_per_100g": self.kcal_per_100g,
            "protein_per_100g": self.protein_per_100g,
            "carbs_per_100g": self.carbs_per_100g,
            "fat_per_100g": self.fat_per_100g,
            "fiber_per_100g": self.fiber_per_100g,
            "sugar_per_100g": self.sugar_per_100g,
            "saturated_fat_per_100g": self.saturated_fat_per_100g,
            "cholesterol_mg_per_100g": self.cholesterol_mg_per_100g,
            "sodium_mg_per_100g": self.sodium_mg_per_100g,
            "potassium_mg_per_100g": self.potassium_mg_per_100g,
            "calcium_mg_per_100g": self.calcium_mg_per_100g,
            "iron_mg_per_100g": self.iron_mg_per_100g,
            "magnesium_mg_per_100g": self.magnesium_mg_per_100g,
            "zinc_mg_per_100g": self.zinc_mg_per_100g,
            "vitamin_a_rae_mcg_per_100g": self.vitamin_a_rae_mcg_per_100g,
            "vitamin_c_mg_per_100g": self.vitamin_c_mg_per_100g,
            "vitamin_d_mcg_per_100g": self.vitamin_d_mcg_per_100g,
            "vitamin_e_mg_per_100g": self.vitamin_e_mg_per_100g,
            "vitamin_k_mcg_per_100g": self.vitamin_k_mcg_per_100g,
            "thiamin_mg_per_100g": self.thiamin_mg_per_100g,
            "riboflavin_mg_per_100g": self.riboflavin_mg_per_100g,
            "niacin_mg_per_100g": self.niacin_mg_per_100g,
            "vitamin_b6_mg_per_100g": self.vitamin_b6_mg_per_100g,
            "folate_mcg_per_100g": self.folate_mcg_per_100g,
            "vitamin_b12_mcg_per_100g": self.vitamin_b12_mcg_per_100g,
            "source": self.source,
            "is_active": True,
        }


class UsdaFoodDataImporter:
    def __init__(
        self,
        api_key: str,
        data_types: Sequence[str],
        page_size: int,
        batch_size: int,
        rate_sleep_seconds: float,
        timeout_seconds: float,
    ) -> None:
        self.api_key = api_key
        self.data_types = list(data_types)
        self.page_size = page_size
        self.batch_size = batch_size
        self.rate_sleep_seconds = rate_sleep_seconds
        self.client = httpx.Client(timeout=timeout_seconds)

    def close(self) -> None:
        self.client.close()

    def fetch_food_page(self, page_number: int) -> List[Dict[str, Any]]:
        payload = {
            "pageSize": self.page_size,
            "pageNumber": page_number,
            "dataType": self.data_types,
        }
        response = self.client.post(
            f"{API_BASE_URL}/foods/list",
            params={"api_key": self.api_key},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        if isinstance(data, list):
            return data

        if isinstance(data, dict):
            # 鏌愪簺鐗堟湰/缃戝叧杩斿洖 {"foods": [...], ...}
            foods = data.get("foods")
            if isinstance(foods, list):
                return foods

            # 閿欒瀵硅薄灏介噺鎶婂叧閿俊鎭洿鎺ユ姏鍑烘潵锛岄伩鍏嶅彧鐪嬪埌 dict
            error_message = (
                data.get("error")
                or data.get("message")
                or data.get("detail")
                or data.get("errors")
            )
            if error_message:
                raise RuntimeError(f"USDA /foods/list 杩斿洖閿欒: {error_message}")

            preview = json.dumps(data, ensure_ascii=False)[:500]
            raise RuntimeError(
                f"USDA /foods/list 杩斿洖鏍煎紡寮傚父: dict keys={list(data.keys())} body={preview}"
            )

        raise RuntimeError(f"USDA /foods/list 杩斿洖鏍煎紡寮傚父: {type(data).__name__}")

    def iter_foods(self, max_pages: Optional[int] = None) -> Iterable[Dict[str, Any]]:
        page_number = 1
        while True:
            if max_pages is not None and page_number > max_pages:
                return
            foods = self.fetch_food_page(page_number)
            if not foods:
                return
            for food in foods:
                yield food
            page_number += 1
            if self.rate_sleep_seconds > 0:
                time.sleep(self.rate_sleep_seconds)

    def _extract_foods_from_dataset_json(self, data: Any) -> List[Dict[str, Any]]:
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]

        if not isinstance(data, dict):
            return []

        preferred_keys = [
            "FoundationFoods",
            "SRLegacyFoods",
            "SurveyFoods",
            "BrandedFoods",
            "foods",
        ]
        for key in preferred_keys:
            value = data.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]

        for _, value in data.items():
            if isinstance(value, list) and value and isinstance(value[0], dict):
                sample = value[0]
                if "description" in sample or "foodNutrients" in sample:
                    return [item for item in value if isinstance(item, dict)]
        return []

    def _download_dataset_foods(self, data_type: str) -> List[Dict[str, Any]]:
        url = DEFAULT_DATASET_URLS.get(data_type)
        if not url:
            raise RuntimeError(f"鏆備笉鏀寔閫氳繃涓嬭浇鏂瑰紡瀵煎叆鏁版嵁绫诲瀷: {data_type}")

        print(f"[import_usda_fooddata] downloading dataset: {data_type} -> {url}")
        response = self.client.get(url, follow_redirects=True)
        response.raise_for_status()

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            json_names = [name for name in zf.namelist() if name.lower().endswith(".json")]
            if not json_names:
                raise RuntimeError(f"鏁版嵁闆嗗帇缂╁寘涓湭鎵惧埌 JSON 鏂囦欢: {url}")

            # 浼樺厛閫変綋绉渶澶х殑 JSON锛屼竴鑸氨鏄富鏁版嵁鏂囦欢
            json_names.sort(key=lambda name: zf.getinfo(name).file_size, reverse=True)
            target_name = json_names[0]
            with zf.open(target_name) as fp:
                raw = fp.read()
                data = json.loads(raw.decode("utf-8"))

        foods = self._extract_foods_from_dataset_json(data)
        if not foods:
            raise RuntimeError(f"鏃犳硶浠庢暟鎹泦 JSON 涓彁鍙?foods 鍒楄〃: {url}")
        print(f"[import_usda_fooddata] dataset foods={len(foods)} type={data_type}")
        return foods

    def iter_foods_from_datasets(self) -> Iterable[Dict[str, Any]]:
        for data_type in self.data_types:
            foods = self._download_dataset_foods(data_type)
            for food in foods:
                yield food

    def build_rows(self, max_pages: Optional[int] = None) -> List[ImportFoodRow]:
        return self.build_rows_from_iterable(self.iter_foods(max_pages=max_pages))

    def build_rows_from_datasets(self) -> List[ImportFoodRow]:
        return self.build_rows_from_iterable(self.iter_foods_from_datasets())

    def build_rows_from_iterable(self, foods_iter: Iterable[Dict[str, Any]]) -> List[ImportFoodRow]:
        deduped: Dict[str, ImportFoodRow] = {}
        source_priority = {
            "Foundation": 5,
            "SR Legacy": 4,
            "Survey (FNDDS)": 3,
            "Experimental": 2,
            "Branded": 1,
        }

        count = 0
        for food in foods_iter:
            count += 1
            description = _clean_text(food.get("description"))
            if not description:
                continue

            normalized_name = _normalize_food_name(description)
            if not normalized_name:
                continue

            macros = _pick_macros(food)
            if macros["calories"] <= 0:
                continue

            data_type = _clean_text(food.get("dataType")) or "Unknown"
            fdc_id = int(food.get("fdcId") or 0)
            row = ImportFoodRow(
                canonical_name=description,
                normalized_name=normalized_name,
                kcal_per_100g=macros["calories"],
                protein_per_100g=macros["protein"],
                carbs_per_100g=macros["carbs"],
                fat_per_100g=macros["fat"],
                fiber_per_100g=macros["fiber"],
                sugar_per_100g=macros["sugar"],
                saturated_fat_per_100g=macros["saturatedFat"],
                cholesterol_mg_per_100g=macros["cholesterolMg"],
                sodium_mg_per_100g=macros["sodiumMg"],
                potassium_mg_per_100g=macros["potassiumMg"],
                calcium_mg_per_100g=macros["calciumMg"],
                iron_mg_per_100g=macros["ironMg"],
                magnesium_mg_per_100g=macros["magnesiumMg"],
                zinc_mg_per_100g=macros["zincMg"],
                vitamin_a_rae_mcg_per_100g=macros["vitaminARaeMcg"],
                vitamin_c_mg_per_100g=macros["vitaminCMg"],
                vitamin_d_mcg_per_100g=macros["vitaminDMcg"],
                vitamin_e_mg_per_100g=macros["vitaminEMg"],
                vitamin_k_mcg_per_100g=macros["vitaminKMcg"],
                thiamin_mg_per_100g=macros["thiaminMg"],
                riboflavin_mg_per_100g=macros["riboflavinMg"],
                niacin_mg_per_100g=macros["niacinMg"],
                vitamin_b6_mg_per_100g=macros["vitaminB6Mg"],
                folate_mcg_per_100g=macros["folateMcg"],
                vitamin_b12_mcg_per_100g=macros["vitaminB12Mcg"],
                source=_usda_source_label(data_type),
                usda_fdc_id=fdc_id,
                usda_data_type=data_type,
                brand_owner=_clean_text(food.get("brandOwner")) or None,
            )

            existing = deduped.get(normalized_name)
            if existing is None:
                deduped[normalized_name] = row
                continue

            current_priority = source_priority.get(row.usda_data_type, 0)
            existing_priority = source_priority.get(existing.usda_data_type, 0)
            if current_priority > existing_priority:
                deduped[normalized_name] = row

        rows = list(deduped.values())
        rows.sort(key=lambda x: (x.usda_data_type, x.canonical_name))
        print(f"[import_usda_fooddata] fetched_foods={count} deduped_rows={len(rows)}")
        return rows


def _load_env() -> None:
    load_dotenv(BACKEND_DIR / ".env", override=False)
    load_dotenv(BACKEND_DIR / ".env.local", override=False)


def _get_supabase_client():
    from database import get_supabase_client

    return get_supabase_client()


def _get_existing_names(canonical_names: Sequence[str], batch_size: int) -> set[str]:
    supabase = _get_supabase_client()
    existing: set[str] = set()
    names = [name for name in canonical_names if name]
    for chunk in _chunked(names, batch_size):
        response = (
            supabase.table("food_nutrition_library")
            .select("normalized_name")
            .in_("normalized_name", list(chunk))
            .execute()
        )
        for row in list(response.data or []):
            normalized_name = str(row.get("normalized_name") or "").strip()
            if normalized_name:
                existing.add(normalized_name)
    return existing


def _insert_rows(rows: Sequence[ImportFoodRow], batch_size: int, update_existing: bool) -> Tuple[int, int]:
    supabase = _get_supabase_client()
    normalized_names = [row.normalized_name for row in rows]
    existing_names = _get_existing_names(normalized_names, batch_size=batch_size)

    to_insert = [row for row in rows if row.normalized_name not in existing_names]
    to_update = [row for row in rows if row.normalized_name in existing_names] if update_existing else []

    inserted = 0
    updated = 0

    for chunk in _chunked([row.to_insert_row() for row in to_insert], batch_size):
        supabase.table("food_nutrition_library").insert(list(chunk)).execute()
        inserted += len(chunk)

    if update_existing:
        for row in to_update:
            supabase.table("food_nutrition_library").update({
                "canonical_name": row.canonical_name,
                "kcal_per_100g": row.kcal_per_100g,
                "protein_per_100g": row.protein_per_100g,
                "carbs_per_100g": row.carbs_per_100g,
                "fat_per_100g": row.fat_per_100g,
                "fiber_per_100g": row.fiber_per_100g,
                "sugar_per_100g": row.sugar_per_100g,
                "saturated_fat_per_100g": row.saturated_fat_per_100g,
                "cholesterol_mg_per_100g": row.cholesterol_mg_per_100g,
                "sodium_mg_per_100g": row.sodium_mg_per_100g,
                "potassium_mg_per_100g": row.potassium_mg_per_100g,
                "calcium_mg_per_100g": row.calcium_mg_per_100g,
                "iron_mg_per_100g": row.iron_mg_per_100g,
                "magnesium_mg_per_100g": row.magnesium_mg_per_100g,
                "zinc_mg_per_100g": row.zinc_mg_per_100g,
                "vitamin_a_rae_mcg_per_100g": row.vitamin_a_rae_mcg_per_100g,
                "vitamin_c_mg_per_100g": row.vitamin_c_mg_per_100g,
                "vitamin_d_mcg_per_100g": row.vitamin_d_mcg_per_100g,
                "vitamin_e_mg_per_100g": row.vitamin_e_mg_per_100g,
                "vitamin_k_mcg_per_100g": row.vitamin_k_mcg_per_100g,
                "thiamin_mg_per_100g": row.thiamin_mg_per_100g,
                "riboflavin_mg_per_100g": row.riboflavin_mg_per_100g,
                "niacin_mg_per_100g": row.niacin_mg_per_100g,
                "vitamin_b6_mg_per_100g": row.vitamin_b6_mg_per_100g,
                "folate_mcg_per_100g": row.folate_mcg_per_100g,
                "vitamin_b12_mcg_per_100g": row.vitamin_b12_mcg_per_100g,
                "source": row.source,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }).eq("normalized_name", row.normalized_name).execute()
            updated += 1

    return inserted, updated


def _write_json_snapshot(rows: Sequence[ImportFoodRow], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = [asdict(row) for row in rows]
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_sql(rows: Sequence[ImportFoodRow], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    values_sql: List[str] = []
    for row in rows:
        values_sql.append(
            "("
            f"{_sql_quote(row.canonical_name)}, "
            f"{_sql_quote(row.normalized_name)}, "
            f"{row.kcal_per_100g}, "
            f"{row.protein_per_100g}, "
            f"{row.carbs_per_100g}, "
            f"{row.fat_per_100g}, "
            f"{row.fiber_per_100g}, "
            f"{row.sugar_per_100g}, "
            f"{row.saturated_fat_per_100g}, "
            f"{row.cholesterol_mg_per_100g}, "
            f"{row.sodium_mg_per_100g}, "
            f"{row.potassium_mg_per_100g}, "
            f"{row.calcium_mg_per_100g}, "
            f"{row.iron_mg_per_100g}, "
            f"{row.magnesium_mg_per_100g}, "
            f"{row.zinc_mg_per_100g}, "
            f"{row.vitamin_a_rae_mcg_per_100g}, "
            f"{row.vitamin_c_mg_per_100g}, "
            f"{row.vitamin_d_mcg_per_100g}, "
            f"{row.vitamin_e_mg_per_100g}, "
            f"{row.vitamin_k_mcg_per_100g}, "
            f"{row.thiamin_mg_per_100g}, "
            f"{row.riboflavin_mg_per_100g}, "
            f"{row.niacin_mg_per_100g}, "
            f"{row.vitamin_b6_mg_per_100g}, "
            f"{row.folate_mcg_per_100g}, "
            f"{row.vitamin_b12_mcg_per_100g}, "
            f"{_sql_quote(row.source)}"
            ")"
        )

    body = (
        "-- Auto-generated by backend/scripts/import_usda_fooddata.py\n"
        "-- Source: USDA FoodData Central official data\n\n"
        "insert into public.food_nutrition_library (\n"
        "  canonical_name,\n"
        "  normalized_name,\n"
        "  kcal_per_100g,\n"
        "  protein_per_100g,\n"
        "  carbs_per_100g,\n"
        "  fat_per_100g,\n"
        "  fiber_per_100g,\n"
        "  sugar_per_100g,\n"
        "  saturated_fat_per_100g,\n"
        "  cholesterol_mg_per_100g,\n"
        "  sodium_mg_per_100g,\n"
        "  potassium_mg_per_100g,\n"
        "  calcium_mg_per_100g,\n"
        "  iron_mg_per_100g,\n"
        "  magnesium_mg_per_100g,\n"
        "  zinc_mg_per_100g,\n"
        "  vitamin_a_rae_mcg_per_100g,\n"
        "  vitamin_c_mg_per_100g,\n"
        "  vitamin_d_mcg_per_100g,\n"
        "  vitamin_e_mg_per_100g,\n"
        "  vitamin_k_mcg_per_100g,\n"
        "  thiamin_mg_per_100g,\n"
        "  riboflavin_mg_per_100g,\n"
        "  niacin_mg_per_100g,\n"
        "  vitamin_b6_mg_per_100g,\n"
        "  folate_mcg_per_100g,\n"
        "  vitamin_b12_mcg_per_100g,\n"
        "  source\n"
        ")\nvalues\n"
        + ",\n".join(values_sql)
        + "\n"
        "on conflict (normalized_name) do update set\n"
        "  canonical_name = excluded.canonical_name,\n"
        "  kcal_per_100g = excluded.kcal_per_100g,\n"
        "  protein_per_100g = excluded.protein_per_100g,\n"
        "  carbs_per_100g = excluded.carbs_per_100g,\n"
        "  fat_per_100g = excluded.fat_per_100g,\n"
        "  fiber_per_100g = excluded.fiber_per_100g,\n"
        "  sugar_per_100g = excluded.sugar_per_100g,\n"
        "  saturated_fat_per_100g = excluded.saturated_fat_per_100g,\n"
        "  cholesterol_mg_per_100g = excluded.cholesterol_mg_per_100g,\n"
        "  sodium_mg_per_100g = excluded.sodium_mg_per_100g,\n"
        "  potassium_mg_per_100g = excluded.potassium_mg_per_100g,\n"
        "  calcium_mg_per_100g = excluded.calcium_mg_per_100g,\n"
        "  iron_mg_per_100g = excluded.iron_mg_per_100g,\n"
        "  magnesium_mg_per_100g = excluded.magnesium_mg_per_100g,\n"
        "  zinc_mg_per_100g = excluded.zinc_mg_per_100g,\n"
        "  vitamin_a_rae_mcg_per_100g = excluded.vitamin_a_rae_mcg_per_100g,\n"
        "  vitamin_c_mg_per_100g = excluded.vitamin_c_mg_per_100g,\n"
        "  vitamin_d_mcg_per_100g = excluded.vitamin_d_mcg_per_100g,\n"
        "  vitamin_e_mg_per_100g = excluded.vitamin_e_mg_per_100g,\n"
        "  vitamin_k_mcg_per_100g = excluded.vitamin_k_mcg_per_100g,\n"
        "  thiamin_mg_per_100g = excluded.thiamin_mg_per_100g,\n"
        "  riboflavin_mg_per_100g = excluded.riboflavin_mg_per_100g,\n"
        "  niacin_mg_per_100g = excluded.niacin_mg_per_100g,\n"
        "  vitamin_b6_mg_per_100g = excluded.vitamin_b6_mg_per_100g,\n"
        "  folate_mcg_per_100g = excluded.folate_mcg_per_100g,\n"
        "  vitamin_b12_mcg_per_100g = excluded.vitamin_b12_mcg_per_100g,\n"
        "  source = excluded.source,\n"
        "  updated_at = now();\n"
    )
    output_path.write_text(body, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="浠?USDA FoodData Central 瀹樻柟 API 瀵煎叆椋熺墿钀ュ吇鏁版嵁"
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("USDA_FDC_API_KEY") or os.getenv("DATA_GOV_API_KEY") or "",
        help="USDA FoodData Central API key锛涢粯璁よ鍙?USDA_FDC_API_KEY / DATA_GOV_API_KEY",
    )
    parser.add_argument(
        "--data-types",
        nargs="+",
        default=DEFAULT_DATA_TYPES,
        help="瑕佸鍏ョ殑鏁版嵁绫诲瀷锛屽 Foundation 'SR Legacy' 'Survey (FNDDS)' Branded",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=DEFAULT_PAGE_SIZE,
        help=f"姣忛〉鎷夊彇鏁伴噺锛岄粯璁?{DEFAULT_PAGE_SIZE}",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"鍐欏簱鎵规澶у皬锛岄粯璁?{DEFAULT_BATCH_SIZE}",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="鏈€澶氭媺鍙栭〉鏁帮紝渚夸簬娴嬭瘯锛涢粯璁や笉闄?,
    )
    parser.add_argument(
        "--rate-sleep-seconds",
        type=float,
        default=DEFAULT_RATE_SLEEP_SECONDS,
        help=f"姣忛〉璇锋眰鍚庣殑绛夊緟绉掓暟锛岄粯璁?{DEFAULT_RATE_SLEEP_SECONDS}",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"HTTP 瓒呮椂绉掓暟锛岄粯璁?{DEFAULT_TIMEOUT_SECONDS}",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="鍙姄鍙栧拰瑙ｆ瀽锛屼笉鍐欏叆鏁版嵁搴?,
    )
    parser.add_argument(
        "--update-existing",
        action="store_true",
        help="鑻?normalized_name 宸插瓨鍦紝鍒欐洿鏂扮幇鏈夎褰曪紱榛樿鍙柊澧?,
    )
    parser.add_argument(
        "--json-output",
        default="",
        help="鍙€夛細鎶婅В鏋愮粨鏋滆緭鍑轰负 JSON 鏂囦欢",
    )
    parser.add_argument(
        "--sql-output",
        default="",
        help="鍙€夛細鎶婅В鏋愮粨鏋滆緭鍑轰负 SQL 鏂囦欢",
    )
    parser.add_argument(
        "--source-mode",
        choices=["auto", "api", "datasets"],
        default="auto",
        help="鏁版嵁鏉ユ簮妯″紡锛歛uto(浼樺厛 API锛屽け璐ユ椂鍥為€€涓嬭浇鏁版嵁闆? / api / datasets",
    )
    return parser.parse_args()


def main() -> int:
    _load_env()
    args = parse_args()

    if args.source_mode in {"api", "auto"} and not args.api_key:
        print("缂哄皯 USDA API Key銆傝璁剧疆 USDA_FDC_API_KEY 鎴栭€氳繃 --api-key 浼犲叆銆?, file=sys.stderr)
        return 2

    importer = UsdaFoodDataImporter(
        api_key=args.api_key,
        data_types=args.data_types,
        page_size=max(1, int(args.page_size)),
        batch_size=max(1, int(args.batch_size)),
        rate_sleep_seconds=max(0.0, float(args.rate_sleep_seconds)),
        timeout_seconds=max(1.0, float(args.timeout_seconds)),
    )

    try:
        if args.source_mode == "datasets":
            rows = importer.build_rows_from_datasets()
        elif args.source_mode == "api":
            rows = importer.build_rows(max_pages=args.max_pages)
        else:
            try:
                rows = importer.build_rows(max_pages=args.max_pages)
            except Exception as api_err:
                print(f"[import_usda_fooddata] API mode failed, fallback to datasets: {api_err}")
                rows = importer.build_rows_from_datasets()
    finally:
        importer.close()

    if args.json_output:
        json_path = Path(args.json_output)
        _write_json_snapshot(rows, json_path)
        print(f"[import_usda_fooddata] wrote_json={json_path}")

    if args.sql_output:
        sql_path = Path(args.sql_output)
        _write_sql(rows, sql_path)
        print(f"[import_usda_fooddata] wrote_sql={sql_path}")

    preview = rows[:10]
    print("[import_usda_fooddata] preview:")
    for row in preview:
        print(
            f"  - {row.canonical_name} | {row.usda_data_type} | "
            f"{row.kcal_per_100g} kcal/100g | P{row.protein_per_100g} "
            f"C{row.carbs_per_100g} F{row.fat_per_100g}"
        )

    if args.dry_run:
        print(f"[import_usda_fooddata] dry_run rows={len(rows)}")
        return 0

    inserted, updated = _insert_rows(
        rows,
        batch_size=max(1, int(args.batch_size)),
        update_existing=bool(args.update_existing),
    )
    print(
        f"[import_usda_fooddata] done total={len(rows)} inserted={inserted} updated={updated}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

