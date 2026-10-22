"""Biological Sex Detector as a script: the open source AI head for biological sex in slot 1, running on your IntoMind One.

    python3 biological_sex.py ["Ada's IntoMind One"]
"""
import asyncio
import sys

from common import name_arg
from published import SEX
from shipped_head import run

asyncio.run(run(SEX["slot"], name_arg(sys.argv)))
