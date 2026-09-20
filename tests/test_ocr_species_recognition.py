# -*- coding: utf-8 -*-
"""Unit tests for Pollen Taxa OCR Recognition, Botanical Dictionary, and Spatial Column Snapping.

Conforms to Section 3 of the OCR & Review Specification:
1. Exact match for Chinese botanical names and Latin binomials.
2. APG family modern nomenclature mapping (e.g. 禾本科 -> Poaceae, Compositae -> Asteraceae).
3. Fuzzy edit-distance tolerance (e.g. 'Querous' auto-suggested as 'Quercus').
4. Custom user dictionary import (.txt plain text).
5. 45-degree oblique label strip affine rotation and reverse coordinate mapping.
6. Baseline anchor point calculation and spatial column snapping (X_anchor -> Column.startX).
7. End-to-end Session RPC workflow integration.
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import os
import tempfile
import unittest
import numpy as np
from PIL import Image

from straditize_core.ocr import (
    PollenDictionary,
    OcrTaxaRecognitionEngine,
    rotate_label_strip,
    map_box_to_original,
    compute_baseline_anchor,
)
from straditize_core.session import StraditizeSession


class TestOcrTaxaRecognitionSuite(unittest.TestCase):
    def setUp(self):
        self.dict = PollenDictionary()

    def test_01_botanical_dictionary_exact_and_apg_mapping(self):
        """Verify exact matches for Chinese genera and APG family nomenclature."""
        # Exact Chinese lookup
        res_pinus = self.dict.match_text("松属")
        self.assertEqual(res_pinus["suggested_name"], "Pinus")
        self.assertEqual(res_pinus["status"], "auto")
        self.assertEqual(res_pinus["confidence"], 1.0)

        res_abies = self.dict.match_text("冷杉属")
        self.assertEqual(res_abies["suggested_name"], "Abies")
        self.assertEqual(res_abies["status"], "auto")

        # APG modernization
        res_poaceae = self.dict.match_text("禾本科")
        self.assertEqual(res_poaceae["suggested_name"], "Poaceae")
        self.assertEqual(res_poaceae["status"], "auto")

        res_aster = self.dict.match_text("Compositae")
        self.assertEqual(res_aster["suggested_name"], "Asteraceae")
        self.assertEqual(res_aster["status"], "auto")

    def test_02_fuzzy_levenshtein_error_tolerance(self):
        """Verify edit-distance resilience against OCR typos."""
        # OCR typo: 'Querous' instead of 'Quercus'
        res_typo = self.dict.match_text("Querous")
        self.assertEqual(res_typo["suggested_name"], "Quercus")
        self.assertIn(res_typo["status"], ("auto", "confirm"))
        self.assertGreaterEqual(res_typo["confidence"], 0.80)

        # Chinese slight OCR blur: '云彬属' instead of '云杉属'
        res_zh_blur = self.dict.match_text("云彬属")
        self.assertEqual(res_zh_blur["suggested_name"], "Picea")
        self.assertIn(res_zh_blur["status"], ("auto", "confirm"))

    def test_03_custom_user_dictionary_import(self):
        """Verify importing domain-specific taxa from plain .txt file."""
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as f:
            f.write("新疆落叶松,Larix sibirica,地方特有种\n")
            f.write("准噶尔乌头,Aconitum soongaricum,高山草甸\n")
            custom_txt_path = f.name

        custom_dict = PollenDictionary(custom_dict_path=custom_txt_path)
        res_custom = custom_dict.match_text("新疆落叶松")
        self.assertEqual(res_custom["suggested_name"], "Larix sibirica")
        self.assertEqual(res_custom["group"], "地方特有种")
        self.assertEqual(res_custom["status"], "auto")

    def test_07_npp_microfossil_dictionary_coverage(self):
        """Verify NPP (non-pollen palynomorph) coverage: algae, diatoms, chironomids,
        ostracods and coprophilous fungal spores."""
        cases = {
            "盘星藻属": ("Pediastrum", "npp"),
            "葡萄藻属": ("Botryococcus", "npp"),
            "硅藻": ("Diatom", "npp"),
            "小环藻属": ("Cyclotella", "npp"),
            "摇蚊": ("Chironomidae", "npp"),
            "摇蚊头壳": ("Chironomid head capsule", "npp"),
            "介形虫": ("Ostracoda", "npp"),
            "土星介属": ("Ilyocypris", "npp"),
            "粪生菌孢": ("Coprophilous fungal spore", "npp"),
            "粪球壳孢": ("Sporormiella", "npp"),
            "粪壳科": ("Sordariaceae", "npp"),
        }
        for query, (expected_latin, expected_cls) in cases.items():
            with self.subTest(query=query):
                res = self.dict.match_text(query)
                self.assertEqual(res["suggested_name"], expected_latin)
                self.assertEqual(res["status"], "auto")
                self.assertEqual(res["cls"], expected_cls)

        # Latin names must also resolve directly
        self.assertEqual(self.dict.match_text("Sporormiella")["suggested_name"], "Sporormiella")
        self.assertEqual(self.dict.match_text("Ostracoda")["suggested_name"], "Ostracoda")

    def test_08_no_cross_class_false_positive(self):
        """An unknown NPP name must never be 'corrected' into an unrelated pollen family.

        Regression: 'Sordariaceae' used to be greedily fuzzy-matched to the
        unrelated pollen family 'Apiaceae' (only the shared suffix 'aceae'
        matched), which silently produced a wrong taxon name.
        """
        # Now covered by the dictionary, so must be an exact hit instead of a pollen hit
        res_sord = self.dict.match_text("Sordariaceae")
        self.assertEqual(res_sord["suggested_name"], "Sordariaceae")
        self.assertEqual(res_sord["cls"], "npp")

        # Genuinely unlisted names must stay unrecognized rather than become pollen
        for unknown in ["Anabaena", "Gloeotrichia", "Nostoc", "Neorhabdocoela"]:
            with self.subTest(unknown=unknown):
                res = self.dict.match_text(unknown)
                self.assertEqual(res["status"], "unrecognized")
                self.assertEqual(res["suggested_name"], unknown)

        # OCR typos of known taxa must still be repaired
        self.assertEqual(self.dict.match_text("Querous")["suggested_name"], "Quercus")
        self.assertEqual(self.dict.match_text("Artemesia")["suggested_name"], "Artemisia")
        self.assertEqual(self.dict.match_text("Pediastrm")["suggested_name"], "Pediastrum")

    def test_09_session_custom_taxa_dict_persistence(self):
        """Verify Session-level custom vocabulary save/load round-trip via RPC."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            dict_path = os.path.join(tmp_dir, "taxa_custom.txt")
            old_env = os.environ.get("STRADITIZE_TAXA_DICT")
            os.environ["STRADITIZE_TAXA_DICT"] = dict_path
            try:
                session = StraditizeSession()
                self.assertEqual(session.user_taxa_dict_path(), os.path.abspath(dict_path))

                empty = session.ocr_get_taxa_dict()
                self.assertEqual(empty["custom_count"], 0)
                self.assertGreaterEqual(empty["builtin_pollen_count"], 100)
                self.assertGreaterEqual(empty["builtin_npp_count"], 60)

                saved = session.ocr_save_custom_taxa(
                    entries=[
                        {"zh_name": "四角藻属", "latin_name": "Tetraedron", "group": "绿藻类"},
                        {"zh_name": "新疆落叶松", "latin_name": "Larix sibirica", "group": "地方特有种"},
                    ]
                )
                self.assertEqual(saved["added"], 2)
                self.assertTrue(os.path.exists(dict_path))

                after = session.ocr_get_taxa_dict()
                self.assertEqual(after["custom_count"], 2)

                # Reloaded dictionary must contain the custom entries
                merged = PollenDictionary(custom_dict_path=dict_path)
                self.assertEqual(merged.match_text("四角藻属")["suggested_name"], "Tetraedron")
                self.assertEqual(merged.match_text("新疆落叶松")["suggested_name"], "Larix sibirica")
                # Built-in NPP entries remain available alongside custom ones
                self.assertEqual(merged.match_text("盘星藻属")["suggested_name"], "Pediastrum")

                # Replace mode drops previous custom entries
                replaced = session.ocr_save_custom_taxa(
                    entries=[{"zh_name": "水绵属", "latin_name": "Spirogyra", "group": "绿藻类"}],
                    mode="replace",
                )
                self.assertEqual(replaced["custom_count"], 1)

                # CONTRACT: `entries` in the response is always the *post-operation
                # full* custom set, in every mode. The frontend rebuilds its
                # correction glossary from it with replace semantics, so a response
                # that only echoed the newly added rows would silently leave
                # deleted entries alive on the client.
                self.assertEqual([e["latin"] for e in replaced["entries"]], ["Spirogyra"])

                appended_again = session.ocr_save_custom_taxa(
                    entries=[{"zh_name": "四角藻属", "latin_name": "Tetraedron", "group": "绿藻类"}]
                )
                self.assertEqual(
                    sorted(e["latin"] for e in appended_again["entries"]),
                    ["Spirogyra", "Tetraedron"],
                )
                self.assertEqual(appended_again["added"], 1)

                cleared = session.ocr_save_custom_taxa(clear=True)
                self.assertEqual(cleared["custom_count"], 0)
                self.assertEqual(cleared["entries"], [])
            finally:
                if old_env is None:
                    os.environ.pop("STRADITIZE_TAXA_DICT", None)
                else:
                    os.environ["STRADITIZE_TAXA_DICT"] = old_env

    def test_04_affine_45_degree_rotation_and_coordinate_inversion(self):
        """Verify rotating oblique strip to horizontal and mapping bounding box back to original space."""
        # Create a synthetic image with oblique content
        img = Image.new("RGB", (400, 100), color=(255, 255, 255))
        rot_arr, meta = rotate_label_strip(img, angle_deg=-45.0)

        self.assertEqual(meta["angle_deg"], -45.0)
        self.assertGreater(rot_arr.shape[0], 0)
        self.assertGreater(rot_arr.shape[1], 0)

        # Map a test box from rotated coordinates back to original coordinates
        test_box_rot = [(50.0, 30.0), (100.0, 30.0), (100.0, 60.0), (50.0, 60.0)]
        orig_box = map_box_to_original(test_box_rot, meta, global_offset=(100.0, 20.0))

        self.assertEqual(len(orig_box), 4)
        for pt in orig_box:
            self.assertEqual(len(pt), 2)
            # Coordinate must be within reasonable offset range
            self.assertGreaterEqual(pt[0], 0.0)
            self.assertGreaterEqual(pt[1], 0.0)

    def test_10_pediastrum_plate_taxa_and_caption_parsing(self):
        """Regression for the Pediastrum plate vocabulary (China & western Mongolia
        lake/reservoir surface sediments, plates I and II).

        Two defects are locked down here:
        (a) every plate taxon must resolve exactly, and
        (b) an *unlisted* 'Pediastrum <epithet>' must not be pulled to a listed
            one merely because they share the 10-character genus prefix.
        """
        plate1 = [
            "Pediastrum simplex var. simplex",
            "Pediastrum simplex var. sturmmi",
            "Pediastrum simplex var. clathratum",
            "Pediastrum simplex var. biwaense",
            "Pediastrum simplex var. echinulatum",
            "Pediastrum duplex var. duplex",
            "Pediastrum duplex var. gracillim",
            "Pediastrum duplex var. rugulosum",
            "Pediastrum tetras",
        ]
        plate2 = [
            "Pediastrum boryanum var. boryanum",
            "Pediastrum boryanum var. longicorne type 1",
            "Pediastrum boryanum var. longicorne type 2",
            "Pediastrum cf. argentinense",
            "Pediastrum alternans",
            "Pediastrum boryanum var. brevicorne",
            "Pediastrum kawraiskyi",
            "Pediastrum angulosum var. angulosum",
            "Pediastrum asymmetricum",
        ]
        for name in plate1 + plate2:
            with self.subTest(taxon=name):
                res = self.dict.match_text(name)
                self.assertEqual(res["suggested_name"], name)
                self.assertEqual(res["status"], "auto")
                self.assertEqual(res["cls"], "npp")
                self.assertIn("绿藻", res["group"])

        # Infra-generic guard: unlisted epithets must stay unanswered,
        # NOT be greedily reassigned to a listed congener.
        for unlisted in ["Pediastrum integrum", "Pediastrum muticum", "Pediastrum angulosum"]:
            with self.subTest(unlisted=unlisted):
                res = self.dict.match_text(unlisted)
                self.assertEqual(res["status"], "unrecognized")
                self.assertEqual(res["suggested_name"], unlisted)

        # Full plate captions as they appear in the paper (hard-wrapped mid-name,
        # multi-key prefixes such as 'c), d)', and a leading Chinese header).
        caption_plate1 = (
            "中国和蒙古西部水体（湖泊和水库）表层沉积物中盘星藻分类单元图版Ⅰ。a) Pediastrum\n"
            "simplex var. simplex; b) Pediastrum simplex var. sturmmi; c), d) Pediastrum simplex var.\n"
            "clathratum; e), f) Pediastrum simplex var. biwaense; g) Pediastrum simplex var. echinulatum; h)\n"
            "Pediastrum duplex var. duplex; i), j) Pediastrum duplex var. gracillim; k) Pediastrum duplex var.\n"
            "rugulosum; l) Pediastrum tetras."
        )
        caption_plate2 = (
            "S2. 中国和蒙古西部水体（湖泊和水库）表层沉积物中盘星藻分类单元图版Ⅱ。a), b)\n"
            "Pediastrum boryanum var. boryanum; c) Pediastrum boryanum var. longicorne type 1; d), e)\n"
            "Pediastrum boryanum var. longicorne type 2; f) Pediastrum cf. argentinense; g) Pediastrum\n"
            "alternans; h) Pediastrum boryanum var. brevicorne; i) Pediastrum kawraiskyi; j) Pediastrum\n"
            "angulosum var. angulosum; k), l) Pediastrum asymmetricum"
        )
        self.assertEqual(PollenDictionary.extract_caption_taxa(caption_plate1), plate1)
        self.assertEqual(PollenDictionary.extract_caption_taxa(caption_plate2), plate2)

        # 'cf.' inside a name must survive; it is not a panel key
        self.assertIn("Pediastrum cf. argentinense", PollenDictionary.extract_caption_taxa(caption_plate2))

        # parse_taxa_text routes captions to the caption parser
        parsed = PollenDictionary.parse_taxa_text(caption_plate1)
        self.assertEqual([p["latin_name"] for p in parsed], plate1)

        # A plain name list must NOT be mistaken for a caption
        plain = PollenDictionary.parse_taxa_text("水绵属,Spirogyra,绿藻类\n新疆落叶松,Larix sibirica")
        self.assertEqual(len(plain), 2)
        self.assertEqual(plain[0]["latin_name"], "Spirogyra")
        self.assertEqual(plain[1]["group"], "用户自定义 (User Custom)")

    def test_11_caption_import_via_session_rpc(self):
        """A pasted figure caption must round-trip through the session vocabulary RPC."""
        caption = (
            "图版Ⅱ。a), b) Pediastrum boryanum var. boryanum; c) Pediastrum boryanum var. "
            "longicorne type 1; f) Pediastrum cf. argentinense; k), l) Pediastrum asymmetricum"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            dict_path = os.path.join(tmp_dir, "taxa_custom.txt")
            old_env = os.environ.get("STRADITIZE_TAXA_DICT")
            os.environ["STRADITIZE_TAXA_DICT"] = dict_path
            try:
                session = StraditizeSession()

                preview = session.ocr_parse_taxa_text(caption)
                self.assertTrue(preview["success"])
                self.assertEqual(preview["format"], "figure_caption")
                self.assertEqual(
                    [e["latin_name"] for e in preview["entries"]],
                    [
                        "Pediastrum boryanum var. boryanum",
                        "Pediastrum boryanum var. longicorne type 1",
                        "Pediastrum cf. argentinense",
                        "Pediastrum asymmetricum",
                    ],
                )

                saved = session.ocr_save_custom_taxa(raw_text=caption)
                self.assertEqual(saved["added"], 4)
                self.assertEqual(saved["custom_count"], 4)

                # Reloaded dictionary resolves the imported names
                merged = PollenDictionary(custom_dict_path=dict_path)
                for entry in preview["entries"]:
                    self.assertEqual(
                        merged.match_text(entry["latin_name"])["suggested_name"],
                        entry["latin_name"],
                    )
                # Built-in plate taxa remain available alongside the custom entries
                self.assertEqual(
                    merged.match_text("Pediastrum duplex var. rugulosum")["suggested_name"],
                    "Pediastrum duplex var. rugulosum",
                )
            finally:
                if old_env is None:
                    os.environ.pop("STRADITIZE_TAXA_DICT", None)
                else:
                    os.environ["STRADITIZE_TAXA_DICT"] = old_env

    def test_12_diatom_genus_vocabulary(self):
        """Verify the harvested CAS diatom genus key is usable as OCR vocabulary.

        Source: plant.yic.ac.cn inland key (152 genera, Round 1990) and marine key
        (114 genera, 金德祥 1982); harvested by support/harvest_diatom_genera.py.
        """
        data = PollenDictionary.diatom_genera_data()
        genera = data.get("genera", [])
        aliases = data.get("aliases", {})

        # Both keys were harvested and the union is complete
        self.assertGreaterEqual(len(genera), 227, f"expected >=227 genera, got {len(genera)}")
        habitats = {g["habitat"] for g in genera}
        self.assertIn("inland", habitats)
        self.assertIn("marine", habitats)
        self.assertIn("both", habitats, "genera listed in both keys must be marked 'both'")

        # Latin names resolve, with a diatom group label
        for latin in ("Aulacoseira", "Cocconeis", "Surirella", "Nitzschia", "Chaetoceros"):
            with self.subTest(latin=latin):
                res = self.dict.match_text(latin)
                self.assertEqual(res["suggested_name"], latin)
                self.assertEqual(res["status"], "auto")
                self.assertEqual(res["cls"], "npp")
                self.assertIn("硅藻", res["group"])

        # Chinese genus names resolve to the matching Latin name
        for zh, latin in (("小环藻属", "Cyclotella"), ("直链藻属", "Melosira"), ("菱形藻属", "Nitzschia")):
            with self.subTest(zh=zh):
                res = self.dict.match_text(zh)
                self.assertEqual(res["suggested_name"], latin)
                self.assertEqual(res["status"], "auto")

        # A genus present in both keys must report the union label
        self.assertIn("硅藻类", self.dict.match_text("Thalassiosira")["group"])

        # Source spelling slips resolve to the accepted name instead of becoming
        # separate entries, and they keep the corrected name's metadata.
        for slip, accepted in aliases.items():
            with self.subTest(slip=slip):
                res = self.dict.match_text(slip)
                self.assertEqual(res["suggested_name"], accepted)
                self.assertEqual(res["status"], "auto")
                self.assertFalse(
                    any(e["latin"] == slip for e in self.dict.entries.values()),
                    f"source slip {slip} must not be a canonical entry",
                )
        self.assertIn("Thalasiosira", aliases)
        self.assertEqual(self.dict.match_text("Thalasiosira")["suggested_name"], "Thalassiosira")
        self.assertIn("硅藻", self.dict.match_text("Thalasiosira")["group"])

        # Entries are keyed by Chinese name, so a Chinese label shared by two
        # genera must not silently drop one of them (the source key labels both
        # Acanthoceras and Attheya as 四棘藻属).
        for latin in ("Acanthoceras", "Attheya"):
            with self.subTest(shared_label=latin):
                res = self.dict.match_text(latin)
                self.assertEqual(res["suggested_name"], latin)
                self.assertEqual(res["status"], "auto")
        self.assertIn("四棘藻属", self.dict.name_collisions)
        self.assertEqual(
            self.dict.name_collisions["四棘藻属"], ["Acanthoceras", "Attheya"]
        )

        # Every canonical genus in the data file must be reachable in the dictionary
        canonical = {
            g["latin"] for g in genera if g["latin"].lower() not in {a.lower() for a in aliases}
        }
        missing = sorted(
            c for c in canonical
            if not any(m["latin"].lower() == c.lower() for m in self.dict.entries.values())
        )
        self.assertEqual(missing, [], f"diatom genera missing from the dictionary: {missing}")

    def test_13_diatom_typos_still_repair_without_intra_genus_conflation(self):
        """The enlarged diatom vocabulary must not make distinct genera collide."""
        # Genuine OCR slips of diatom genera are repaired
        for typo, expected in (
            ("Cyclotela", "Cyclotella"),
            ("Melosira", "Melosira"),
            ("Navicla", "Navicula"),
            ("Nitzchia", "Nitzschia"),
            ("Aulacoseir", "Aulacoseira"),
        ):
            with self.subTest(typo=typo):
                self.assertEqual(self.dict.match_text(typo)["suggested_name"], expected)

        # Look-alike but distinct genera must not be silently merged
        for name in ("Navicula", "Navicymbula", "Gomphonema", "Gomphoneis",
                     "Achnanthes", "Achnanthidium", "Fragilaria", "Fragilariforma",
                     "Staurosira", "Staurosirella"):
            with self.subTest(name=name):
                self.assertEqual(self.dict.match_text(name)["suggested_name"], name)

        # A non-existent genus must stay unanswered rather than land on a neighbour
        for unknown in ("Naviculopsis", "Melosiropsis", "Coscinodiscopsis"):
            with self.subTest(unknown=unknown):
                self.assertEqual(self.dict.match_text(unknown)["status"], "unrecognized")

        # A real but unlisted neighbour sitting 2 edits away is inherently
        # ambiguous: it may be suggested, but never as a silent confident 'auto'.
        for neighbour in ("Cyclotellina",):
            with self.subTest(neighbour=neighbour):
                res = self.dict.match_text(neighbour)
                self.assertNotEqual(
                    res["status"], "auto",
                    f"{neighbour} must not be auto-accepted as {res['suggested_name']}",
                )
                self.assertIn(res["status"], ("confirm", "unrecognized"))

    def test_05_baseline_anchor_calculation_and_column_snapping(self):
        """Verify lowest point calculation and matching with Column.startX."""
        # Oblique bounding box: lowest Y point is the bottom anchor
        box = [[120.0, 50.0], [150.0, 20.0], [170.0, 40.0], [140.0, 70.0]]
        ax, ay = compute_baseline_anchor(box)
        self.assertEqual(ay, 70.0)
        self.assertEqual(ax, 140.0)

        # Test snapping with engine
        engine = OcrTaxaRecognitionEngine()
        labels = [
            {
                "id": "label_001",
                "anchor_x": 142.0,
                "anchor_y": 70.0,
                "associated_column_id": None,
                "associated_column_index": None,
            },
            {
                "id": "label_002",
                "anchor_x": 260.0,
                "anchor_y": 70.0,
                "associated_column_id": None,
                "associated_column_index": None,
            }
        ]
        columns = [
            {"id": "taxa_0", "col_index": 0, "name": "Col_1", "startX": 140.0},
            {"id": "taxa_1", "col_index": 1, "name": "Col_2", "startX": 258.0},
        ]

        engine._snap_labels_to_columns(labels, columns)

        self.assertEqual(labels[0]["associated_column_id"], "taxa_0")
        self.assertEqual(labels[0]["associated_column_name"], "Col_1")
        self.assertEqual(labels[1]["associated_column_id"], "taxa_1")
        self.assertEqual(labels[1]["associated_column_name"], "Col_2")

    def test_06_session_ocr_full_workflow_integration(self):
        """Verify Session.ocr_recognize_labels and Session.ocr_apply_labels."""
        session = StraditizeSession()
        session.load_image(sample_key="hoya")
        session.detect_columns([315, 1946], [511, 1311])

        # Execute OCR recognition on top header region
        ocr_res = session.ocr_recognize_labels(label_row_bbox=[315, 200, 1946, 510], angle_deg=-45.0)
        self.assertTrue(ocr_res["success"])
        data = ocr_res["data"]
        self.assertIn("labels", data)
        self.assertIn("label_row_image", data)
        self.assertTrue(data["label_row_image"].startswith("data:image/png;base64,"))
        self.assertIn("summary", data)

        # Apply reviewed labels to columns
        sample_confirmed = [
            {"associated_column_id": "taxa_0", "suggested_name": "Pinus", "ocr_text": "松属"},
            {"associated_column_id": "taxa_1", "suggested_name": "Abies", "ocr_text": "冷杉属"},
            {"associated_column_id": "taxa_2", "suggested_name": "Picea", "ocr_text": "云杉属"},
        ]
        apply_res = session.ocr_apply_labels(sample_confirmed)
        self.assertTrue(apply_res["success"])
        self.assertGreaterEqual(apply_res["applied_count"], 3)

        # Verify column names updated in session
        col0 = next(c for c in session.columns if c["id"] == "taxa_0")
        self.assertEqual(col0["name"], "Pinus")
        self.assertEqual(col0["species"], "Pinus")


if __name__ == "__main__":
    unittest.main()
