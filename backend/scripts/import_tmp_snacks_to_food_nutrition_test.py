import importlib.util
import sys
import types
import unittest
from dataclasses import replace
from pathlib import Path

# Unit validation does not need a database, dotenv installation, or disk fixtures.
psycopg2 = types.ModuleType("psycopg2")
extras = types.ModuleType("psycopg2.extras")
extras.Json = lambda value: value
extras.execute_values = lambda *args, **kwargs: None
sys.modules.setdefault("psycopg2", psycopg2)
sys.modules.setdefault("psycopg2.extras", extras)
dotenv = types.ModuleType("dotenv")
dotenv.load_dotenv = lambda *args, **kwargs: None
sys.modules.setdefault("dotenv", dotenv)
spec = importlib.util.spec_from_file_location("snack_import", Path(__file__).with_name("import_tmp_snacks_to_food_nutrition.py"))
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class SnackImportValidationTest(unittest.TestCase):
    def raw(self, **changes):
        value = {"食物名称": "测试食物", "食物ID": "test", "计量基准": "每100克可食部", "能量": "400kJ", "蛋白质": "4g", "脂肪": "5g", "碳水化合物": "9g", "饱和脂肪酸": "2g"}
        value.update(changes)
        return value

    def test_percent_is_not_grams(self):
        for text in ["66%", "66％", "66", "NaN", "-1g", "hello 3g"]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                module.build_row(self.raw(**{"饱和脂肪酸": text}), "test")

    def test_mass_units_are_converted(self):
        row = module.build_row(self.raw(**{"饱和脂肪酸": "65mg", "钠": "130000μg"}), "test")
        self.assertAlmostEqual(.065, row.saturated_fat_per_100g)
        self.assertAlmostEqual(130, row.sodium_mg_per_100g)

    def test_basis_and_missing_core_are_rejected(self):
        for changes in [{"计量基准": "每100毫升"}, {"计量基准": "每份"}, {"蛋白质": "—"}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                module.build_row(self.raw(**changes), "test")

    def test_detects_all_three_original_failures(self):
        row = module.build_row(self.raw(), "test")
        for changes in [dict(protein_per_100g=28.8, carbs_per_100g=34, fat_per_100g=48.7), dict(sugar_per_100g=65, carbs_per_100g=5.6), dict(saturated_fat_per_100g=100, fat_per_100g=.6)]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                module.validate_row(replace(row, **changes))

    def test_current_percent_batch_is_rejected_before_connect(self):
        import csv
        source = Path(__file__).parents[2] / "tmp" / "snacks_filtered.csv"
        if not source.exists():
            self.skipTest("local source CSV is not part of the checkout")
        with source.open(encoding="utf-8-sig", newline="") as file:
            rows = [row for row in csv.DictReader(file) if "%" in row.get("饱和脂肪酸", "")]
        self.assertEqual(110, len(rows))
        for row in rows:
            with self.assertRaises(ValueError):
                module.build_row(row, "test")


if __name__ == "__main__":
    unittest.main()
