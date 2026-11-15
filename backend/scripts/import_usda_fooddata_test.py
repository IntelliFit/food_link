import importlib.util
import sys
import types
import unittest
from pathlib import Path


sys.modules.setdefault("httpx", types.ModuleType("httpx"))
dotenv = types.ModuleType("dotenv")
dotenv.load_dotenv = lambda *args, **kwargs: None
sys.modules.setdefault("dotenv", dotenv)

MODULE_PATH = Path(__file__).with_name("import_usda_fooddata.py")
SPEC = importlib.util.spec_from_file_location("import_usda_fooddata", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class PickMacrosTest(unittest.TestCase):
    def test_saturated_fat_does_not_match_unsaturated_and_prefers_id(self) -> None:
        for rows in [
            [
                {"nutrientId": 1292, "nutrientName": "Fatty acids, total monounsaturated", "value": 3.71, "unitName": "g"},
                {"nutrientId": 1293, "nutrientName": "Fatty acids, total polyunsaturated", "value": 1.82, "unitName": "g"},
                {"nutrientId": 1258, "nutrientName": "Fatty acids, total saturated", "value": .6, "unitName": "g"},
            ],
            [
                {"nutrientName": "Saturated fat", "value": .7, "unitName": "g"},
                {"nutrientId": 1258, "nutrientName": "Fatty acids, total saturated", "value": .6, "unitName": "g"},
            ],
        ]:
            values = MODULE._pick_macros({"foodNutrients": rows})
            self.assertEqual(.6, values["saturatedFat"])
        values = MODULE._pick_macros({"foodNutrients": [
            {"nutrientId": 1292, "nutrientName": "Fatty acids, total monounsaturated", "value": 3.71, "unitName": "g"},
        ]})
        self.assertEqual(0, values["saturatedFat"])

    def test_normalizes_actual_nutrient_units_and_rejects_percentage(self) -> None:
        values = MODULE._pick_macros({"foodNutrients": [
            {"nutrientId": 1003, "nutrientName": "Protein", "value": 6500, "unitName": "mg"},
            {"nutrientId": 1008, "nutrientName": "Energy", "value": 418.4, "unitName": "kJ"},
        ]})
        self.assertEqual(6.5, values["protein"])
        self.assertEqual(100, values["calories"])
        with self.assertRaises(ValueError):
            MODULE._pick_macros({"foodNutrients": [{"nutrientId": 1258, "nutrientName": "Fatty acids, total saturated", "value": 66, "unitName": "%"}]})

    def test_invalid_rows_do_not_open_database(self) -> None:
        from unittest.mock import patch
        invalid = types.SimpleNamespace(protein_per_100g=28.8, carbs_per_100g=34, fat_per_100g=48.7)
        with patch.object(MODULE, "_get_supabase_client", side_effect=AssertionError("must not connect")):
            with self.assertRaises(ValueError):
                MODULE._insert_rows([invalid], 10, True)

    def test_vitamin_d_uses_micrograms_not_iu_or_25_hydroxy_d2(self) -> None:
        macros = MODULE._pick_macros({
            "foodNutrients": [
                {"nutrientId": 1110, "nutrientName": "Vitamin D (D2 + D3), International Units", "value": 200},
                {"nutrientId": 1115, "nutrientName": "25-hydroxycholecalciferol", "value": 9},
                {"nutrientId": 1114, "nutrientName": "Vitamin D (D2 + D3)", "value": 5},
            ]
        })

        self.assertEqual(5, macros["vitaminDMcg"])

    def test_folate_uses_total_folate_not_dfe(self) -> None:
        macros = MODULE._pick_macros({
            "foodNutrients": [
                {"nutrientId": 1190, "nutrientName": "Folate, DFE", "value": 400},
                {"nutrientId": 1177, "nutrientName": "Folate, total", "value": 240},
            ]
        })

        self.assertEqual(240, macros["folateMcg"])

    def test_usda_rows_record_the_nutrient_mapping_version(self) -> None:
        evidence = MODULE._usda_quality_evidence(12345, "Foundation")

        self.assertEqual("v3_1114_1177_1258", evidence["usda_nutrient_mapping_version"])
        self.assertEqual(12345, evidence["usda_fdc_id"])
        self.assertEqual("Foundation", evidence["usda_data_type"])


if __name__ == "__main__":
    unittest.main()
