"""python -m carpool.cli analyze  -> regenerates data/sensitivity.json and data/evaluation.json"""
from __future__ import annotations

import argparse
import json
import time

from .analysis import write_artifacts
from .db import ROOT


def main() -> None:
    ap = argparse.ArgumentParser(prog="carpool")
    ap.add_argument("command", choices=["analyze"])
    ap.parse_args()
    t0 = time.perf_counter()
    rep = write_artifacts(ROOT)
    ev = rep["evaluation"]
    print(json.dumps({"kstar": ev["kstar"], "kstar_point": ev["kstar_point"], "sampler_ks_p": rep["sampler"]["ks_p"],
                      "seconds": round(time.perf_counter() - t0, 1)}))


if __name__ == "__main__":
    main()
