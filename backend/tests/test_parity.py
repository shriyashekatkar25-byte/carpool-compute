"""The browser engine (JS) and backend engine (NumPy) use different RNGs; their estimates must agree within MC error."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from carpool.engine import Params, evaluate

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_js_and_python_engines_agree():
    script = f"import {{evaluate}} from '{(ROOT / 'app/engine.js').as_uri()}';" \
             "const e=evaluate({nRuns:20000});console.log(JSON.stringify(e.sweep.map(r=>[r.savings,r.savingsSE,r.conflict])));"
    js = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout)
    py = evaluate(Params(n_runs=20_000)).sweep
    for (js_sav, js_se, js_conf), r in zip(js, py):
        if r.k == 1:
            continue
        se = (js_se ** 2 + r.savings_se ** 2) ** 0.5
        assert abs(js_sav - r.savings) < 4 * se + 1e-9, (r.k, js_sav, r.savings)
        pooled = ((js_conf * (1 - js_conf) + r.conflict * (1 - r.conflict)) / 20_000) ** 0.5
        assert abs(js_conf - r.conflict) < 4 * pooled + 1e-9, (r.k, js_conf, r.conflict)
