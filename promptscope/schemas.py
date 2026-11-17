"""Explicit contracts for model tools, imported results and bounded agent plans."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Detection(StrictModel):
    label: str = Field(min_length=1, max_length=160)
    score: float = Field(ge=0, le=1)
    box: list[float] = Field(min_length=4, max_length=4)

    @field_validator("box")
    @classmethod
    def valid_box(cls, v):
        if not all(0 <= x <= 1 for x in v) or v[0] >= v[2] or v[1] >= v[3]:
            raise ValueError("box must be normalized xyxy with positive area")
        return v


class InferenceRequest(StrictModel):
    image_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    prompts: list[str] = Field(min_length=1, max_length=6)
    model: Literal["tiny", "base"] = "tiny"
    text_threshold: float = Field(default=0.25, ge=0.05, le=0.9)

    @field_validator("prompts")
    @classmethod
    def valid_prompts(cls, values):
        values = [x.strip().lower().rstrip(". ") + "." for x in values if x.strip(". ")]
        if not values or any(len(x) > 200 for x in values):
            raise ValueError("Use 1–6 nonempty prompts, each at most 200 characters")
        return list(dict.fromkeys(values))


class ImportRequest(StrictModel):
    image_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    prompt: str = Field(min_length=1, max_length=200)
    model: str = Field(default="external", min_length=1, max_length=120)
    detections: list[Detection] = Field(max_length=1000)


class PlanItem(StrictModel):
    prompt: str = Field(min_length=1, max_length=200)
    rationale: str = Field(min_length=1, max_length=400)


class Plan(StrictModel):
    goal: str = Field(min_length=1, max_length=1000)
    experiments: list[PlanItem] = Field(min_length=2, max_length=4)
    caveat: str = Field(min_length=1, max_length=600)


class PlanRequest(StrictModel):
    goal: str = Field(min_length=2, max_length=1000)
    target: str = Field(min_length=1, max_length=80)
    mode: Literal["template", "llm"] = "template"


class CompareRequest(StrictModel):
    run_a: str = Field(pattern=r"^[a-f0-9]{32}$")
    run_b: str = Field(pattern=r"^[a-f0-9]{32}$")
    threshold: float = Field(default=0.25, ge=0.05, le=1)
    iou_threshold: float = Field(default=0.5, gt=0, le=1)


class Annotation(StrictModel):
    label: str = Field(min_length=1, max_length=160)
    box: list[float] = Field(min_length=4, max_length=4)

    @field_validator("box")
    @classmethod
    def valid_box(cls, v):
        return Detection.valid_box(v)


class EvaluationRequest(StrictModel):
    run_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    ground_truth: list[Annotation] = Field(max_length=1000)
    label_map: dict[str, str] = Field(default_factory=dict, max_length=1000)
    iou_threshold: float = Field(default=0.5, gt=0, le=1)
    threshold: float = Field(default=0.25, ge=0.05, le=1)
