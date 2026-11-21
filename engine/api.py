#!/usr/bin/env python3
"""FastAPI wrapper for the scoring engine.

Runs on :8000. Never exposed to the browser -- Node proxies to it on an internal
port, per spec Section 2.

    uvicorn api:app --reload --port 8000
"""
import os, sys, uuid, json
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import Any, Optional

from score import predict, DISEASES, DISPLAY, PROFILE
from punnett import punnett

app = FastAPI(title="LSD-CDSS scoring engine", version="0.3.0")


class PredictRequest(BaseModel):
    patient: dict[str, Any] = Field(default_factory=dict)
    symptoms: list[dict[str, Any]] = Field(default_factory=list)
    labs: dict[str, Any] = Field(default_factory=dict)
    genetics: dict[str, Any] = Field(default_factory=dict)
    vitals: dict[str, Any] = Field(default_factory=dict)


class PunnettRequest(BaseModel):
    mode: str = "AR"
    mother_genotype: Optional[str] = None
    father_genotype: Optional[str] = None
    child_sex: Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok", "engine_version": "0.3.0"}


@app.get("/reference/diseases")
def reference_diseases():
    out = []
    for d in DISEASES:
        enzyme, genes, biomarker, inh = PROFILE[d]
        out.append({"disease": d, "display_name": DISPLAY[d], "genes": genes,
                    "enzyme": enzyme, "biomarker": biomarker, "inheritance": inh})
    return {"diseases": out}


# Spec 3.1b: one spelling per name across contract, engine and UI. `mps1` is
# canonical, and score.py normalises analyte synonyms itself, so no translation
# layer sits here any more.


@app.post("/predict")
def do_predict(req: PredictRequest):
    payload = req.model_dump()
    result = predict(payload)
    result["request_id"] = uuid.uuid4().hex[:12]
    result["generated_at"] = datetime.now(timezone.utc).isoformat()

    # Inheritance block, where parent genotypes were supplied.
    g = payload.get("genetics") or {}
    parents = g.get("parents") or {}
    top = result["predictions"][0]["disease"]
    _, _, _, inh = PROFILE[top]
    if parents.get("mother_genotype") and parents.get("father_genotype"):
        pr = punnett(inh, parents["mother_genotype"], parents["father_genotype"],
                     (payload.get("patient") or {}).get("sex"))
        result["inheritance"] = {"applicable": True, "mode": pr["mode"],
                                 "punnett": pr["probabilities"], "note": pr["note"]}
    else:
        result["inheritance"] = {"applicable": False, "mode": inh,
                                 "punnett": None,
                                 "note": "Parent genotypes not supplied."}

    result["recommendations"] = recommend(top, result)
    return result


@app.post("/punnett")
def do_punnett(req: PunnettRequest):
    return punnett(req.mode, req.mother_genotype, req.father_genotype, req.child_sex)


CONFIRM = {
    "gaucher": ("GBA1 sequencing", "Confirms Gaucher where glucocerebrosidase is reduced."),
    "fabry": ("GLA sequencing", "Required in females, where enzyme activity may be near-normal."),
    "pompe": ("GAA sequencing", "Distinguishes true deficiency from pseudodeficiency alleles."),
    "mps1": ("IDUA sequencing + urinary GAG", "Confirms alpha-L-iduronidase deficiency."),
    "niemann_pick_c": ("NPC1/NPC2 sequencing + oxysterols",
                       "No diagnostic enzyme assay exists; genetics and biomarkers are required."),
    "krabbe": ("GALC sequencing + psychosine", "Confirms galactocerebrosidase deficiency."),
}
TREATMENT = {
    "gaucher": ["Enzyme Replacement Therapy (ERT)", "Substrate Reduction Therapy (SRT)"],
    "fabry": ["Enzyme Replacement Therapy (ERT)", "Chaperone therapy where amenable"],
    "pompe": ["Enzyme Replacement Therapy (ERT)", "Respiratory support"],
    "mps1": ["Enzyme Replacement Therapy (ERT)", "Haematopoietic stem cell transplant"],
    "niemann_pick_c": ["Miglustat", "Supportive neurological care"],
    "krabbe": ["Haematopoietic stem cell transplant (pre-symptomatic)"],
}


def recommend(disease, result):
    test, why = CONFIRM[disease]
    band = result["risk_level"]
    priority = {"CRITICAL": "urgent", "HIGH": "high",
                "MODERATE": "routine", "LOW": "consider"}[band]
    return {
        "confirmatory_tests": [{"test": test, "priority": priority, "rationale": why}],
        "treatment_pathways": [{"name": t, "stage": "post-confirmation"}
                               for t in TREATMENT[disease]],
        "referral": ("Refer to a medical geneticist or metabolic specialist."
                     if band in ("HIGH", "CRITICAL")
                     else "Clinical correlation advised; refer if suspicion persists."),
    }
