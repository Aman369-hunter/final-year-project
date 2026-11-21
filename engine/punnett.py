#!/usr/bin/env python3
"""Punnett square inheritance probabilities.

Autosomal recessive and X-linked, which covers all six diseases in scope:
  AR  -- Gaucher, Pompe, MPS I, Niemann-Pick C, Krabbe
  XL  -- Fabry
"""

GENOTYPES_AR = {"unaffected": "AA", "carrier": "Aa", "affected": "aa"}


def _alleles(genotype, parent, mode):
    """Return the two alleles a parent can contribute."""
    g = (genotype or "").strip().lower()
    if mode == "AR":
        return {"unaffected": ["A", "A"], "carrier": ["A", "a"],
                "affected": ["a", "a"]}.get(g, ["A", "a"])
    # X-linked
    if parent == "mother":
        return {"unaffected": ["X", "X"], "carrier": ["X", "x"],
                "affected": ["x", "x"]}.get(g, ["X", "x"])
    return {"unaffected": ["X", "Y"], "affected": ["x", "Y"]}.get(g, ["X", "Y"])


def punnett(mode, mother_genotype, father_genotype, child_sex=None):
    mode = (mode or "AR").upper()
    mode = "XL" if mode.startswith("X") else "AR"

    m = _alleles(mother_genotype, "mother", mode)
    f = _alleles(father_genotype, "father", mode)

    cells = [(a, b) for a in m for b in f]
    total = len(cells)
    affected = carrier = unaffected = 0

    for a, b in cells:
        if mode == "AR":
            pair = sorted([a, b])
            if pair == ["a", "a"]:
                affected += 1
            elif "a" in pair:
                carrier += 1
            else:
                unaffected += 1
        else:
            if "Y" in (a, b):                       # male offspring
                xal = a if a != "Y" else b
                if xal == "x":
                    affected += 1
                else:
                    unaffected += 1
            else:                                   # female offspring
                if a == "x" and b == "x":
                    affected += 1
                elif "x" in (a, b):
                    # Heterozygous females in Fabry are frequently symptomatic,
                    # so they are reported as carriers who may be affected.
                    carrier += 1
                else:
                    unaffected += 1

    pct = lambda n: round(100.0 * n / total, 1)
    note = ("Both parents contribute one allele; 25% risk applies when both are carriers."
            if mode == "AR" else
            "X-linked: sons of a carrier mother have 50% risk; daughters are obligate "
            "carriers if the father is affected. Heterozygous females are frequently "
            "symptomatic in Fabry disease.")

    return {
        "mode": "autosomal_recessive" if mode == "AR" else "x_linked",
        "mother_genotype": mother_genotype, "father_genotype": father_genotype,
        "probabilities": {"affected_pct": pct(affected),
                          "carrier_pct": pct(carrier),
                          "unaffected_pct": pct(unaffected)},
        "grid": [{"mother_allele": a, "father_allele": b} for a, b in cells],
        "note": note,
    }


if __name__ == "__main__":
    import json
    print(json.dumps(punnett("AR", "carrier", "carrier"), indent=2))
    print(json.dumps(punnett("XL", "carrier", "unaffected"), indent=2))
