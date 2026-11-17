"""Experiment groups: one job per group, plus explicitly labeled sample/import groups."""
from .schemas import StrictModel


class KeepRequest(StrictModel):
    kept: bool


class Experiments:
    def __init__(self, store, lock):
        self.store, self.lock = store, lock
        self.migrate_ungrouped()

    def migrate_ungrouped(self):
        groups = self.store.list("job") + self.store.list("collection")
        assigned = {rid for group in groups for rid in group.get("run_ids", [])}
        buckets = {}
        for run in self.store.list("run"):
            if run["id"] not in assigned:
                buckets.setdefault((run["image_id"], run.get("source", "imported")), []).append(run)
        for (image_id, source), runs in buckets.items():
            self.collection(image_id, sorted(runs, key=lambda r: r["created_at"]), source)

    def collection(self, image_id, runs, source):
        return self.store.put("collection", {
            "request": {"image_id": image_id, "prompts": [r["prompt"] for r in runs],
                        "model": runs[0]["model"], "text_threshold": runs[0].get("text_threshold", .25)},
            "run_ids": [r["id"] for r in runs], "created_at": runs[0]["created_at"],
            "source": source, "status": "complete", "completed": len(runs), "plan": None,
            "events": [], "message": "Saved sample/import results; no new inference was run."})

    def sample(self, image_id):
        with self.lock:
            if any(g["request"]["image_id"] == image_id and g.get("source") == "recorded_inference"
                   for g in self.store.list("collection")):
                return
            runs = [r for r in self.store.list("run")
                    if r["image_id"] == image_id and r.get("source") == "recorded_inference"]
            if runs:
                self.collection(image_id, sorted(runs, key=lambda r: r["created_at"]), "recorded_inference")

    def metadata(self, identifier):
        try:
            return self.store.get("experiment_meta", "meta-" + identifier)
        except KeyError:
            return {"id": "meta-" + identifier, "kept": False, "deleted": False}

    def get(self, identifier):
        try:
            group = self.store.get("job", identifier)
        except KeyError:
            group = self.store.get("collection", identifier)
        meta = self.metadata(identifier)
        return {**group, "kept": meta.get("kept", False), "deleted": meta.get("deleted", False),
                "mode": "agent" if group.get("plan") else "manual"}

    def list(self, deleted=False):
        images = {i["id"]: i for i in self.store.list("image")}
        groups = self.store.list("job") + self.store.list("collection")
        groups.sort(key=lambda g: (g["created_at"], g["id"]))
        result = []
        for index, group in enumerate(groups, 1):
            meta = self.metadata(group["id"])
            if bool(meta.get("deleted")) != deleted:
                continue
            req = group["request"]
            result.append({"id": group["id"], "number": index, "image_id": req["image_id"],
                           "image_name": images.get(req["image_id"], {}).get("name", "image"),
                           "created_at": group["created_at"], "status": group["status"],
                           "completed": group["completed"], "prompts": req["prompts"],
                           "model": req["model"], "mode": "agent" if group.get("plan") else "manual",
                           "source": group.get("source", "inference"),
                           "kept": meta.get("kept", False), "deleted": deleted})
        return sorted(result, key=lambda g: (g["kept"], g["created_at"], g["id"]), reverse=True)

    def change(self, identifier, **changes):
        with self.lock:
            group = self.get(identifier)
            if changes.get("deleted") and group["status"] in ("queued", "running"):
                raise ValueError("Wait for the running experiment to finish or cancel it before deleting.")
            self.store.put("experiment_meta", {**self.metadata(identifier), **changes})
            return self.get(identifier)
