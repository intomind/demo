"""Age Detector as a script: the open source AI head for age in slot 0, running on your IntoMind One.

    python3 age.py ["Ada's IntoMind One"]
"""
import asyncio
import sys

from common import name_arg
from published import AGE
from shipped_head import run

asyncio.run(run(AGE["slot"], name_arg(sys.argv)))
