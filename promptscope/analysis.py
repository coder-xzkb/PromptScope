"""Geometry and audit metrics. Scores are never described as accuracy."""


def iou(a, b):
    w = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    h = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    overlap = w * h
    union = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - overlap
    return overlap / union if union > 0 else 0.0


def compare(a, b, threshold=0.25, iou_threshold=0.5):
    """Greedy maximum-IoU, one-to-one, class-agnostic spatial correspondence.

    Not an optimal assignment, identity tracker, precision or recall measure.
    """
    left = [x for x in a if x["score"] >= threshold]
    right = [x for x in b if x["score"] >= threshold]
    candidates = sorted(((iou(x["box"], y["box"]), i, j)
                         for i, x in enumerate(left) for j, y in enumerate(right)),
                        key=lambda x: (-x[0], x[1], x[2]))
    used_a, used_b, pairs = set(), set(), []
    for overlap, i, j in candidates:
        if overlap >= iou_threshold and i not in used_a and j not in used_b:
            used_a.add(i)
            used_b.add(j)
            pairs.append({"a": i, "b": j, "iou": round(overlap, 6),
                          "score_delta": round(right[j]["score"]-left[i]["score"], 6)})
    return {"count_a": len(left), "count_b": len(right), "matched": len(pairs),
            "only_a": [i for i in range(len(left)) if i not in used_a],
            "only_b": [i for i in range(len(right)) if i not in used_b], "pairs": pairs,
            "mean_score_a": sum(x["score"] for x in left)/len(left) if left else None,
            "mean_score_b": sum(x["score"] for x in right)/len(right) if right else None,
            "method": "class-agnostic greedy IoU correspondence; not accuracy"}


def evaluate(detections, ground_truth, label_map=None, threshold=0.25, iou_threshold=0.5):
    """Single-image, class-aware all-points AP; not COCO AP.

    AP uses every stored candidate (>= inference floor). Precision/recall use
    the selected display threshold. Map free-form phrases explicitly to GT labels.
    GT-free classes are reported with null AP and excluded from mAP.
    """
    mapping = label_map or {}
    preds = [{**d, "label": mapping.get(d["label"], d["label"])} for d in detections]
    labels = sorted({d["label"] for d in preds + ground_truth})
    rows = []
    for label in labels:
        gt = [d for d in ground_truth if d["label"] == label]
        pd = sorted([d for d in preds if d["label"] == label], key=lambda d: -d["score"])
        used, tp_flags = set(), []
        for d in pd:
            candidates = [(iou(d["box"], g["box"]), j) for j, g in enumerate(gt)]
            overlap, j = max(candidates, default=(0, -1))
            hit = overlap >= iou_threshold and j not in used
            tp_flags.append(int(hit))
            if hit:
                used.add(j)
        tp, precisions, recalls = 0, [], []
        for k, hit in enumerate(tp_flags, 1):
            tp += hit
            precisions.append(tp / k)
            recalls.append(tp / len(gt) if gt else 0)
        envelope = precisions[:]
        for k in range(len(envelope)-2, -1, -1):
            envelope[k] = max(envelope[k], envelope[k+1])
        ap, last = 0.0, 0.0
        for r, p in zip(recalls, envelope):
            ap += (r-last) * p
            last = r
        visible = [hit for d, hit in zip(pd, tp_flags) if d["score"] >= threshold]
        t = sum(visible)
        rows.append({"label": label, "gt": len(gt), "tp": t, "fp": len(visible)-t,
                     "fn": len(gt)-t, "ap": ap if gt else None,
                     "precision": t/len(visible) if visible else 0.0,
                     "recall": t/len(gt) if gt else None,
                     "curve": {"precision": precisions, "recall": recalls}})
    aps = [r["ap"] for r in rows if r["ap"] is not None]
    return {"classes": rows, "map": sum(aps)/len(aps) if aps else None,
            "iou_threshold": iou_threshold, "display_threshold": threshold,
            "protocol": "single-image all-points AP on stored candidates; not COCO AP"}
