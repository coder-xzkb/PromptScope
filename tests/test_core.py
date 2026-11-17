import unittest
from pydantic import ValidationError
from promptscope.analysis import iou, compare, evaluate
from promptscope.schemas import Detection, InferenceRequest, Plan
from promptscope.agent import make_plan


def detection(box=None, score=.8, label="cat"):
    return {"label": label, "score": score, "box": box or [.1,.1,.5,.5]}


class GeometryTests(unittest.TestCase):
    def test_identity_disjoint_and_touching(self):
        self.assertEqual(iou([0,0,1,1],[0,0,1,1]),1)
        self.assertEqual(iou([0,0,.4,.4],[.5,.5,1,1]),0)
        self.assertEqual(iou([0,0,.5,.5],[.5,0,1,.5]),0)

    def test_analytic_overlap(self):
        self.assertAlmostEqual(iou([0,0,1,1],[.5,0,1.5,1]),1/3)

    def test_matching_is_one_to_one_and_class_agnostic(self):
        result=compare([detection(),detection(score=.6)],[detection(label="kitten")])
        self.assertEqual(result["matched"],1)
        self.assertEqual(len(result["only_a"]),1)
        self.assertEqual(result["only_b"],[])

    def test_empty_and_threshold_boundary(self):
        result=compare([detection(score=.25)],[],threshold=.25)
        self.assertEqual(result["count_a"],1)
        self.assertIsNone(result["mean_score_b"])


class EvaluationTests(unittest.TestCase):
    def test_perfect_and_duplicate(self):
        gt=[{"label":"cat","box":[.1,.1,.5,.5]}]
        r=evaluate([detection(),detection(score=.6)],gt)
        self.assertEqual(r["map"],1)
        self.assertEqual(r["classes"][0]["tp"],1)
        self.assertEqual(r["classes"][0]["fp"],1)

    def test_high_confidence_fp_reduces_ap(self):
        gt=[{"label":"cat","box":[.1,.1,.5,.5]}]
        r=evaluate([detection([.7,.7,.9,.9],.95),detection()],gt)
        self.assertAlmostEqual(r["map"],.5)

    def test_label_mapping_and_missing_gt_classes(self):
        gt=[{"label":"cat","box":[.1,.1,.5,.5]}]
        unmapped=evaluate([detection(label="kitten")],gt)
        self.assertEqual(unmapped["map"],0)
        self.assertIsNone(unmapped["classes"][1]["ap"])
        self.assertEqual(evaluate([detection(label="kitten")],gt,{"kitten":"cat"})["map"],1)

    def test_ap_uses_all_candidates_precision_uses_threshold(self):
        gt=[{"label":"cat","box":[.1,.1,.5,.5]}]
        r=evaluate([detection(score=.2)],gt,threshold=.5)
        self.assertEqual(r["map"],1)
        self.assertEqual(r["classes"][0]["tp"],0)
        self.assertEqual(r["classes"][0]["fn"],1)

    def test_no_ground_truth_does_not_invent_map(self):
        self.assertIsNone(evaluate([detection()],[])["map"])
        self.assertEqual(evaluate([], [{"label":"cat","box":[0,0,1,1]}])["map"],0)


class ContractTests(unittest.TestCase):
    def test_invalid_boxes_and_nonfinite_scores(self):
        for box in ([.5,.5,.1,.1],[-1,0,1,1],[0,0,float("nan"),1],[0,0,0,1]):
            with self.assertRaises(ValidationError): Detection(**detection(box))
        with self.assertRaises(ValidationError): Detection(**detection(score=float("inf")))

    def test_prompt_normalization_and_limits(self):
        r=InferenceRequest(image_id="a"*32,prompts=[" Cat ","cat."])
        self.assertEqual(r.prompts,["cat."])
        for prompts in (["  "],["a"]*7,["x"*201]):
            with self.assertRaises(ValidationError): InferenceRequest(image_id="a"*32,prompts=prompts)

    def test_template_is_labeled_and_bounded(self):
        p=make_plan("compare category wording","astronaut","template")
        self.assertEqual(p["mode"],"template")
        self.assertLessEqual(len(p["experiments"]),4)
        Plan.model_validate({k:v for k,v in p.items() if k!="mode"})


if __name__=="__main__": unittest.main()
