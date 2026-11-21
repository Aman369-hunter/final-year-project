#!/usr/bin/env python3
"""LSD scoring engine.

Takes the API-contract payload (spec Section 3.1) and returns the response
shape, including the factors array that drives the explainability panel.

Design rules that must not be quietly changed:
  * absolute_risk (raw/max) drives the risk band; softmax only ranks
  * every fired rule appends a factor with its points AND a citation
  * missing inputs lower confidence, they never silently score zero
  * Fabry heterozygous females score meaningfully, never zero
  * Niemann-Pick C has no enzyme rule, by design
"""
from __future__ import annotations
import math, json, os

from weights import (DISEASES, CATEGORY_CEILINGS, SYMPTOM_POINTS,
                     SYMPTOM_SCALE, SYMPTOM_LABELS)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("LSD_DATA", os.path.join(HERE, "..", "data"))

DISPLAY = {
    "gaucher": "Gaucher disease",
    "fabry": "Fabry disease",
    "pompe": "Pompe disease",
    "mps1": "Mucopolysaccharidosis type I",
    "niemann_pick_c": "Niemann-Pick disease type C",
    "krabbe": "Krabbe disease",
}

# disease -> (enzyme analyte, gene list, biomarker, inheritance)
PROFILE = {
    "gaucher":        ("GBA", ["GBA1", "GBA"], "lyso_Gb1", "AR"),
    "fabry":          ("alpha_Gal_A", ["GLA"], "lyso_Gb3", "XL"),
    "pompe":          ("GAA", ["GAA"], "CK", "AR"),
    "mps1":           ("IDUA", ["IDUA"], "urinary_GAG", "AR"),
    "niemann_pick_c": (None, ["NPC1", "NPC2"], "lyso_SM_509", "AR"),
    "krabbe":         ("GALC", ["GALC"], "psychosine", "AR"),
}

CITE = {
    "enzyme": "Italy NBS IJNS 10:00003; Missouri IJNS 11:00048",
    "symptom": "HPO phenotype.hpoa v2026-09-02 (incl. Orphanet)",
    "biomarker_gaucher": "Lyso-Gb1 cutoff 9 ng/mL, IJMS 23:01627",
    "biomarker_fabry": "Lyso-Gb3 DBS reference <0.8 ng/mL, Clin Chem 69:hvad097.533",
    "biomarker": "Published DBS biomarker cutoffs (see data/README.md)",
    "genetic": "ClinVar pathogenic / likely pathogenic, retrieved 2026-11-15",
    "xlinked": "Fabry Outcome Survey, Deegan 2006 J Med Genet 43:347",
    "vitals": "Supporting evidence only; not diagnostic",
}

# Vitals are linked to specific diseases, never free-floating.
VITAL_LINKS = {
    "arrhythmia":    (["fabry", "pompe"], 4, "Cardiac arrhythmia"),
    "low_spo2":      (["pompe"], 3, "Reduced oxygen saturation"),
    "high_resp":     (["pompe"], 3, "Elevated respiratory rate"),
    "tremor":        (["krabbe", "niemann_pick_c"], 3, "Tremor / movement abnormality"),
    "low_mobility":  (["pompe", "krabbe"], 3, "Reduced mobility"),
}

RISK_BANDS = [(0.30, "LOW"), (0.60, "MODERATE"), (0.80, "HIGH"), (1.01, "CRITICAL")]
SOFTMAX_T = 15.0


# --------------------------------------------------------------------------- #
def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def score_symptoms(payload, disease, factors):
    pts = 0.0
    scale = SYMPTOM_SCALE.get(disease, 1.0)
    table = SYMPTOM_POINTS.get(disease, {})
    for s in payload.get("symptoms", []) or []:
        if not s.get("present"):
            continue
        hpo = s.get("hpo_id")
        if hpo not in table:
            continue
        sev = s.get("severity")
        sev_mult = 1.0 if sev in (None, "") else 0.6 + 0.2 * max(0, min(3, int(sev)))
        p = table[hpo] * scale * sev_mult
        pts += p
        factors.append({
            "category": "symptom", "feature": hpo,
            "label": s.get("label") or SYMPTOM_LABELS.get(hpo, hpo),
            "value": f"severity {sev}" if sev not in (None, "") else "present",
            "points": round(p, 2), "direction": "increases",
            "disease": disease, "citation": CITE["symptom"],
        })
    return min(pts, CATEGORY_CEILINGS["symptom"])


# Analyte naming. The contract, the lab dashboard and the engine must agree, so
# every accepted spelling maps to one canonical key.
ENZYME_ALIASES = {
    "GBA": "GBA", "GBA1": "GBA", "glucocerebrosidase": "GBA",
    "beta-glucocerebrosidase": "GBA", "GCase": "GBA",
    "alpha_Gal_A": "alpha_Gal_A", "GLA": "alpha_Gal_A",
    "alpha-galactosidase A": "alpha_Gal_A", "a-Gal A": "alpha_Gal_A",
    "GAA": "GAA", "acid alpha-glucosidase": "GAA", "acid maltase": "GAA",
    "IDUA": "IDUA", "alpha-L-iduronidase": "IDUA",
    "GALC": "GALC", "galactocerebrosidase": "GALC",
    "galactosylceramidase": "GALC",
}
BIOMARKER_ALIASES = {
    "lyso_Gb1": "lyso_Gb1", "lyso-Gb1": "lyso_Gb1",
    "glucosylsphingosine": "lyso_Gb1", "GlcSph": "lyso_Gb1",
    "lyso_Gb3": "lyso_Gb3", "lyso-Gb3": "lyso_Gb3",
    "globotriaosylsphingosine": "lyso_Gb3",
    "CK": "CK", "creatine_kinase": "CK", "creatine kinase": "CK",
    "urinary_GAG": "urinary_GAG", "urinary_GAGs": "urinary_GAG",
    "urinary GAG": "urinary_GAG", "GAG": "urinary_GAG",
    "psychosine": "psychosine", "galactosylsphingosine": "psychosine",
    "lyso_SM_509": "lyso_SM_509", "lyso-SM-509": "lyso_SM_509",
    "oxysterols": "oxysterols",
    "chitotriosidase": "chitotriosidase",
}


def canon(name, table):
    if not name:
        return None
    if name in table:
        return table[name]
    low = str(name).strip().lower()
    for k, v in table.items():
        if k.lower() == low:
            return v
    return name


def enzyme_pct(entry):
    """Percent of laboratory normal, from whichever form the lab reported.

    Accepted, in order of preference:
      pct_of_normal                      -- already normalised
      value + reference_mean             -- lab's own mean
      value + reference_low/_high        -- lab's own interval, midpoint used

    A bare value with no reference interval CANNOT be interpreted: absolute
    enzyme activity is assay- and lab-specific, and inventing a range here would
    put an uncited clinical number into the scoring path. Such a result is
    treated as not supplied, and confidence reflects that.
    """
    pct = _f(entry.get("pct_of_normal"))
    if pct is not None:
        return pct, "pct_of_normal"
    val = _f(entry.get("value"))
    if val is None:
        return None, "no_value"
    mean = _f(entry.get("reference_mean"))
    if mean:
        return 100.0 * val / mean, "value/reference_mean"
    lo, hi = _f(entry.get("reference_low")), _f(entry.get("reference_high"))
    if lo is not None and hi is not None and (lo + hi) > 0:
        return 100.0 * val / ((lo + hi) / 2.0), "value/reference_interval"
    if hi:
        return 100.0 * val / hi, "value/reference_high"
    return None, "no_reference_range"


def score_enzyme(payload, disease, factors):
    analyte, _, _, _ = PROFILE[disease]
    if analyte is None:
        return 0.0                       # NPC has no diagnostic enzyme assay
    for e in (payload.get("labs", {}) or {}).get("enzymes", []) or []:
        if canon(e.get("analyte"), ENZYME_ALIASES) != analyte:
            continue
        pct, how = enzyme_pct(e)
        if pct is None:
            continue
        if pct < 15:
            p, desc = 40, "critically low"
        elif pct < 30:
            p, desc = 28, "markedly reduced"
        elif pct < 50:
            p, desc = 14, "reduced"
        elif pct < 70:
            p, desc = 4, "borderline"
        else:
            factors.append({
                "category": "enzyme", "feature": analyte,
                "label": f"{analyte} within normal range",
                "value": f"{pct:.1f}% of normal", "points": -12,
                "direction": "decreases", "disease": disease,
                "citation": CITE["enzyme"],
            })
            return -12.0                 # normal enzyme argues against
        factors.append({
            "category": "enzyme", "feature": analyte,
            "label": f"{analyte} {desc}",
            "value": f"{pct:.1f}% of normal ({how})",
            "points": p, "direction": "increases", "disease": disease,
            "citation": CITE["enzyme"],
        })
        return float(p)
    return 0.0


# Secondary biomarkers: supportive but not disease-defining, so they score less
# than the primary marker. Chitotriosidase is markedly raised in Gaucher but also
# in other storage and inflammatory states, hence the reduced weight.
SECONDARY_BIOMARKERS = {"gaucher": [("chitotriosidase", 6)]}


def biomarker_fold(entry):
    fold = _f(entry.get("fold_uln"))
    if fold is not None:
        return fold
    val = _f(entry.get("value"))
    uln = _f(entry.get("reference_high")) or _f(entry.get("upper_limit_normal"))
    if val is not None and uln:
        return val / uln
    return None


def score_biomarker(payload, disease, factors):
    _, _, marker, _ = PROFILE[disease]
    entries = (payload.get("labs", {}) or {}).get("biomarkers", []) or []

    # secondary markers first, so the primary can still overwrite the total
    secondary = 0.0
    for sec_name, sec_max in SECONDARY_BIOMARKERS.get(disease, []):
        for b in entries:
            if canon(b.get("analyte"), BIOMARKER_ALIASES) != sec_name:
                continue
            fold = biomarker_fold(b)
            if fold is None or fold < 1.5:
                continue
            p = sec_max if fold >= 5 else sec_max * 0.5
            secondary += p
            factors.append({
                "category": "biomarker", "feature": sec_name,
                "label": f"{sec_name} elevated (supportive)",
                "value": f"{fold:.1f}x ULN", "points": round(p, 1),
                "direction": "increases", "disease": disease,
                "citation": "Chitotriosidase in Gaucher, Orphanet J Rare Dis 18:12",
            })
            break

    for b in entries:
        if canon(b.get("analyte"), BIOMARKER_ALIASES) != marker:
            continue
        fold = biomarker_fold(b)
        if fold is None:
            continue
        if fold >= 10:
            p, desc = 15, "markedly elevated"
        elif fold >= 3:
            p, desc = 10, "elevated"
        elif fold >= 1.5:
            p, desc = 5, "mildly elevated"
        else:
            return min(secondary, CATEGORY_CEILINGS["biomarker"])
        cite = CITE.get(f"biomarker_{disease}", CITE["biomarker"])
        factors.append({
            "category": "biomarker", "feature": marker,
            "label": f"{marker} {desc}", "value": f"{fold:.1f}x ULN",
            "points": p, "direction": "increases", "disease": disease,
            "citation": cite,
        })
        return min(float(p) + secondary, CATEGORY_CEILINGS["biomarker"])
    return min(secondary, CATEGORY_CEILINGS["biomarker"])


def score_genetics(payload, disease, factors):
    _, genes, _, inh = PROFILE[disease]
    g = payload.get("genetics", {}) or {}
    total = 0.0
    for f in g.get("findings", []) or []:
        if f.get("gene") not in genes:
            continue
        cls = (f.get("classification") or "").lower()
        if "pathogenic" not in cls:
            continue
        zyg = (f.get("zygosity") or "").lower()
        base = 35 if "likely" not in cls else 28

        if inh == "XL":
            sex = (payload.get("patient", {}) or {}).get("sex", "").lower()
            if "hemizygous" in zyg or sex == "male":
                p, note = base, "hemizygous"
            elif "homozygous" in zyg:
                p, note = base, "homozygous"
            else:
                # Heterozygous females are frequently symptomatic in Fabry.
                p, note = base * 0.55, "heterozygous female"
        else:
            if "homozygous" in zyg or "compound" in zyg:
                p, note = base, zyg or "biallelic"
            elif "heterozygous" in zyg:
                p, note = base * 0.30, "single allele (carrier pattern)"
            else:
                p, note = base * 0.6, "zygosity not stated"

        total += p
        factors.append({
            "category": "genetic", "feature": f.get("gene"),
            "label": f"{cls.title()} variant in {f.get('gene')} ({note})",
            "value": f.get("variant") or "variant reported",
            "points": round(p, 1), "direction": "increases", "disease": disease,
            "citation": CITE["xlinked"] if inh == "XL" else CITE["genetic"],
        })
    return min(total, CATEGORY_CEILINGS["genetic"])


def score_vitals(payload, disease, factors):
    v = payload.get("vitals") or {}
    if not v:
        return 0.0
    flags = []
    if v.get("ecg", {}).get("arrhythmia_flag"):
        flags.append("arrhythmia")
    spo2 = _f(v.get("spo2_pct"))
    if spo2 is not None and spo2 < 94:
        flags.append("low_spo2")
    rr = _f(v.get("respiratory_rate_bpm"))
    if rr is not None and rr > 24:
        flags.append("high_resp")
    tr = _f((v.get("activity") or {}).get("tremor_index"))
    if tr is not None and tr > 0.2:
        flags.append("tremor")
    mb = _f((v.get("activity") or {}).get("mobility_score"))
    if mb is not None and mb < 0.6:
        flags.append("low_mobility")

    pts = 0.0
    for fl in flags:
        diseases, p, label = VITAL_LINKS[fl]
        if disease in diseases:
            pts += p
            factors.append({
                "category": "vitals", "feature": fl, "label": label,
                "value": "detected", "points": p, "direction": "increases",
                "disease": disease, "citation": CITE["vitals"],
            })
    return min(pts, CATEGORY_CEILINGS["vitals"])


def max_possible(disease):
    c = CATEGORY_CEILINGS
    enzyme = c["enzyme"] if PROFILE[disease][0] else 0
    return enzyme + c["genetic"] + c["symptom"] + c["biomarker"] + c["vitals"]


def softmax(scores, t=SOFTMAX_T):
    mx = max(scores.values()) if scores else 0
    exp = {k: math.exp((v - mx) / t) for k, v in scores.items()}
    tot = sum(exp.values()) or 1.0
    return {k: v / tot for k, v in exp.items()}


def risk_band(absolute_risk):
    for threshold, name in RISK_BANDS:
        if absolute_risk < threshold:
            return name
    return "CRITICAL"


def assess_confidence(payload):
    missing = []
    labs = payload.get("labs") or {}
    usable_enz = [e for e in (labs.get("enzymes") or [])
                  if enzyme_pct(e)[0] is not None]
    if not usable_enz:
        missing.append("enzyme_assay")
    usable_bio = [b for b in (labs.get("biomarkers") or [])
                  if biomarker_fold(b) is not None]
    if not usable_bio:
        missing.append("biomarkers")
    if not ((payload.get("genetics") or {}).get("findings")):
        missing.append("genetics")
    if not (payload.get("vitals")):
        missing.append("vitals")
    n_sx = sum(1 for s in payload.get("symptoms", []) or [] if s.get("present"))
    if n_sx < 3:
        missing.append("detailed_symptoms")

    if len(missing) <= 1:
        level = "high"
    elif len(missing) <= 3:
        level = "moderate"
    else:
        level = "low"
    notes = {
        "high": "Most diagnostic inputs supplied.",
        "moderate": "Some diagnostic inputs missing; interpret with caution.",
        "low": "Few diagnostic inputs supplied; this is a weak screening signal only.",
    }
    return {"level": level, "missing_inputs": missing, "note": notes[level]}


def predict(payload):
    """Main entry point. Returns the Section 3.1 response dict."""
    raw, all_factors = {}, {}
    for d in DISEASES:
        f = []
        total = (score_symptoms(payload, d, f) + score_enzyme(payload, d, f)
                 + score_biomarker(payload, d, f) + score_genetics(payload, d, f)
                 + score_vitals(payload, d, f))
        raw[d] = max(0.0, total)
        all_factors[d] = f

    rel = softmax(raw)
    preds = []
    for d in DISEASES:
        mx = max_possible(d)
        preds.append({
            "disease": d, "display_name": DISPLAY[d],
            "raw_score": round(raw[d], 1), "max_possible_score": mx,
            "absolute_risk": round(min(1.0, raw[d] / mx), 3),
            "relative_probability": round(rel[d], 3),
        })
    preds.sort(key=lambda p: -p["absolute_risk"])
    for i, p in enumerate(preds, 1):
        p["rank"] = i

    top = preds[0]
    # Every fired rule for every disease: differential cards #2 and #3 need
    # their own factors, not an empty list.
    factors = sorted((f for fl in all_factors.values() for f in fl),
                     key=lambda f: -abs(f["points"]))

    # category_scores describes the TOP-ranked disease only; the radar chart
    # compares evidence categories for the leading hypothesis.
    cat = {k: 0.0 for k in ["enzyme", "genetic", "symptom", "biomarker", "vitals"]}
    for f in all_factors[top["disease"]]:
        if f["points"] > 0:
            cat[f["category"]] += f["points"]

    return {
        "predictions": preds,
        "risk_level": risk_band(top["absolute_risk"]),
        "risk_basis": "absolute_risk",
        "confidence": assess_confidence(payload),
        "factors": [dict(f) for f in factors],
        "category_scores": {k: round(v, 1) for k, v in cat.items()},
        "model": {"engine_version": "0.3.0", "mode": "rule_based",
                  "weights_version": "2026-11-15"},
        "disclaimer": ("This output is a screening aid, not a diagnosis. All "
                       "results must be reviewed by a qualified clinician and "
                       "confirmed by laboratory testing."),
    }


if __name__ == "__main__":
    import sys
    data = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else {}
    print(json.dumps(predict(data), indent=2)[:3000])
