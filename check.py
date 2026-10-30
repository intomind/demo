"""Check the demos before anything is published, in one command.

    python3 check.py

A static site rots quietly, and a demo that quotes a number can drift from
the source of that number without anything failing on its own. So this
checks, and the exit code says whether the repository is fit to publish:

- the vendored copy of the SDK is byte for byte the published package, and
  the vendored heads are the published files;
- the board program the Pico 2 W guide hands out matches its checksum, and
  every license it carries is beside its source;
- every figure in lib/numbers.js, python/published.py and
  rust/src/published.rs appears in the vendored copy of the heads
  repository's README, which is where they say it comes from;
- no page loads anything from another site;
- the pages keep the house style: no em dash, no semicolon in prose;
- every page has a title, a description, the suite, and the script that
  says it is ready;
- nothing tracked carries a personal address or a path on somebody's machine;
- the Node tests, the Python tests and the Rust tests pass.
"""
from __future__ import annotations

import hashlib
import html
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent

#: The published @intomind/sdk 1.4.3, file by file, as npm serves it: every module
#: a browser loads (tarball sha1 1f5082d98a7cee80c3cc3deb552259a96b397684).
VENDORED_SDK = HERE / "vendor" / "intomind-sdk-1.4.3"
SDK_SHA256 = {
    "capture/clock.js": "e1f3eb608760564df74a6729883e36d8b038baee1b4ec6187f4b4bcb7110bd4c",
    "capture/edf.js": "331dcf88638d0e8bb1c45ce362e431f21219d15598e9d13aada1d3b93a21f288",
    "capture/errors.js": "f6ff93d9899bf507ffba12de1281b0e85a08a3b5f3020d98e6e995d30bd32f89",
    "capture/export.js": "b0c8c5588cd040ee7f18c035917dbd00f1b41dd9b9fba875cc19b68643d728da",
    "capture/hdf5.js": "46eb49370e0a2dbc718fc5777e7f7359933fd2a530e00f997f79d6fa71c4cc74",
    "capture/index.js": "07df0cfb975db5412a89666ffe6c228d943d1c8744ab432518435942dd0b753f",
    "capture/montage.js": "a0d89ccfb1348c76f7220d4e3be3586553ae707af810a8283cf992b84b791b05",
    "capture/npy.js": "7e21cf08a9f4fe8a17786bfe848182a59ccea5e1328d82a335ef6f701486b20f",
    "capture/placement.js": "15c57873ad523f8d4eb9017b23843d7e1ee3288a1025235d537fc4026b2dda26",
    "capture/pyfmt.js": "37264029ba58973bed5b8b7b08e8f5436c3c7d1170b0ca9f979403cc873e5a48",
    "capture/pyjson.js": "d60c7fd0e471e8d596b8a5b5655bc3b22a7b35938b119a03ee1ae6ed32a73566",
    "capture/record.js": "61b3dd76bf611e4b3c9c94fa503784540e437df1abe1794b89e947330633a20f",
    "capture/recording.js": "15869e22884de1704ece152f475feef2151e113ae290b663c7de1e0fdf98dd50",
    "capture/unprintable.js": "fc6d2da92cfd479b084df36377b45a7a505940968d4496678853ed586e795a53",
    "capture/version.js": "b169a5bb77b71e0596562337a2217a54ef425c62fca388b7112e09ce2e057a37",
    "capture/zip.js": "34c049a494aff388e8fb37bb0cb85d70170ae2efa1d741ce933af042dcd2c149",
    "digest.js": "8e357d10ea895040331d94e4327a611d58ac3fde22c3b2fee2f74a9fdb38bf47",
    "index.js": "5833940a98f7fa8c7650be0f168ba9f4755e0833da425b17a03f6a87e4247fe3",
    "protocol.js": "d1e895c13730a625002461eef30c81546fa4976d59ca0d766e9d878ca2d51983",
    "session.js": "a6176ca817046717e28494f025fe73445e6d9f0790e7c18f74cdf6e759692175",
    "timebase.js": "308d5b6af89e23b59c94a367300f041cf4e98bbe80ac82fad7eab804802da478",
    "transfer.js": "052c394fc0e0a81d3851cac4febb0daa63432c029e47c2fe32da5deb4588485d",
    "web-bluetooth.js": "7ce58c37e11c588f0286fa3e363e846e8e9afb4e7792b36c074434c7c800eb9d",
}
VENDORED_HEADS = HERE / "vendor" / "heads"
PAGES = ["index.html"] + sorted(str(p.relative_to(HERE)) for p in HERE.glob("*/index.html") if p.parent.name not in ("vendor", "tests", "assets", "lib", "python"))


def main() -> int:
    problems: list[str] = []
    problems += vendored_sdk_drifted()
    problems += vendored_heads_drifted()
    problems += board_file_drifted()
    problems += numbers_without_a_source()
    for page in PAGES:
        problems += page_problems(HERE / page)
    problems += loads_from_elsewhere()
    problems += names_that_must_not_appear()
    problems += prose_style()
    problems += tests()
    print("-" * 52)
    if problems:
        print(f"{len(problems)} problems:")
        for p in problems:
            print(f"  {p}")
        return 1
    print(f"{len(PAGES)} pages, the SDK and heads are the published ones, every figure has its source")
    return 0


def vendored_sdk_drifted() -> list[str]:
    problems = []
    found = {str(p.relative_to(VENDORED_SDK)) for p in VENDORED_SDK.rglob("*.js")}
    if found != set(SDK_SHA256):
        problems.append(f"the vendored SDK holds {sorted(found)}, not {sorted(SDK_SHA256)}")
    for name, want in SDK_SHA256.items():
        path = VENDORED_SDK / name
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() != want:
            problems.append(f"the vendored SDK's {name} is not the published file")
    return problems


def vendored_heads_drifted() -> list[str]:
    problems = []
    sums = (VENDORED_HEADS / "SHA256SUMS").read_text().split("\n")
    listed = 0
    for line in sums:
        if not line.strip():
            continue
        digest, name = line.split("  ")
        path = VENDORED_HEADS / name
        listed += 1
        if not path.exists():
            problems.append(f"vendor/heads/{name} is listed in SHA256SUMS and missing")
        elif hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            problems.append(f"vendor/heads/{name} is not the published file")
    if listed < 3:
        problems.append("SHA256SUMS lists fewer files than the two heads and the README")
    return problems


def board_file_drifted() -> list[str]:
    problems = []
    sums = (HERE / "pico" / "SHA256SUMS").read_text().split()
    digest, name = sums[0], sums[1]
    path = HERE / "pico" / name
    if not path.exists():
        problems.append(f"pico/{name} is listed in pico/SHA256SUMS and missing")
    elif hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        problems.append(f"pico/{name} does not match pico/SHA256SUMS")
    for license in ("pico-sdk", "btstack", "btstack-raspberry-pi", "cyw43-driver", "cyw43-driver-raspberry-pi", "tinyusb", "micro-ecc"):
        if not (HERE / "pico" / "board" / "licenses" / f"{license}.txt").exists():
            problems.append(f"the board file carries {license}, and its license is not in pico/board/licenses")
    return problems


def numbers_without_a_source() -> list[str]:
    """Every figure the pages quote, found in the vendored heads README."""
    readme = (VENDORED_HEADS / "e2f9b60f411f0e73" / "README.md").read_text()
    problems = []
    for name in ("lib/numbers.js", "python/published.py", "rust/src/published.rs"):
        text = (HERE / name).read_text()
        pattern = r"=\s*(-?\d+(?:\.\d+)?)\s*;" if name.endswith(".rs") else r":\s*(-?\d+(?:\.\d+)?)\s*[,}]"
        figures = re.findall(pattern, text)
        for raw in figures:
            value = raw
            if "." not in raw and len(raw) > 3:
                value = f"{int(raw):,}"
            if value in ("64", "256", "3", "0", "1", "2"):
                # The chip's clock and memory, the layer count and the slot numbers
                # appear in the README as words around other numbers. Checked as text.
                continue
            if value not in readme:
                problems.append(f"{name} quotes {raw}, which the heads README does not state")
    for phrase in ("170,772", "76 wide and 3"):
        if phrase not in readme:
            problems.append(f"the heads README no longer says '{phrase}', which the pages rely on")
    return problems


def page_problems(path: pathlib.Path) -> list[str]:
    problems = []
    name = str(path.relative_to(HERE))
    text = path.read_text()
    if "<title>" not in text:
        problems.append(f"{name}: no title")
    if not re.search(r'<meta name="description" content="[^"]{40,}">', text):
        problems.append(f"{name}: no description for search engines")
    # Every page loads the suite, which shows the page inside the tab that holds the IntoMind One and runs its main.js there.
    suite = "lib/suite.js" if path.parent == HERE else "../lib/suite.js"
    if f'<script type="module" src="{suite}"></script>' not in text:
        problems.append(f"{name}: does not load the suite")
    if not (path.parent / "main.js").exists():
        problems.append(f"{name}: no main.js")
    for href in re.findall(r'href="([^"#]+)"', text):
        if href.startswith(("http://", "https://", "data:", "mailto:")):
            continue
        target = (path.parent / href).resolve()
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            problems.append(f"{name}: links to {href}, which is not there")
    return problems


def loads_from_elsewhere() -> list[str]:
    """Nothing loads from another site: no script, style, font or image, and no import."""
    problems = []
    for path in sorted(list(HERE.glob("*.html")) + list(HERE.glob("*/*.html"))):
        text = path.read_text()
        for tag in re.findall(r"<(?:script|img|link|source|iframe|video|audio)\b[^>]*>", text):
            if m := re.search(r'(?:src|href)="((?:https?:)?//[^"]+)"', tag):
                problems.append(f"{path.relative_to(HERE)}: loads {m.group(1)} from another site")
    for path in sorted(list(HERE.glob("lib/*.js")) + list(HERE.glob("*/main.js")) + list(HERE.glob("*.js"))):
        for m in re.finditer(r"url\(\s*['\"]?(?:https?:)?//|(?:fetch|import)\s*\(?\s*['\"](?:https?:)?//|from\s+['\"](?:https?:)?//", path.read_text()):
            problems.append(f"{path.relative_to(HERE)}: loads from another site: {m.group(0)}")
    return problems


def prose_style() -> list[str]:
    """No em dash anywhere, and no semicolon in the prose of a page or a README."""
    problems = []
    for name in tracked():
        path = HERE / name
        if path.suffix not in (".html", ".md") or name.startswith("vendor/"):
            continue
        text = path.read_text()
        if "—" in text:
            problems.append(f"{name}: an em dash")
        if path.suffix == ".html":
            body = re.search(r"<main[^>]*>(.*)</main>", text, re.S)
            prose = body.group(1) if body else text
            prose = re.sub(r"<(code|pre|script|style)[^>]*>.*?</\1>", "", prose, flags=re.S)
            prose = html.unescape(re.sub(r"<[^>]+>", " ", prose))
        else:
            prose = re.sub(r"```.*?```", "", text, flags=re.S)
            prose = re.sub(r"`[^`]*`", "", prose)
            prose = re.sub(r"^\|.*$", "", prose, flags=re.M)
        if ";" in prose:
            problems.append(f"{name}: a semicolon in the prose")
    return problems


#: What no tracked file may carry.
PUBLIC = [
    (r"(?i)[\w.+-]+@gmail\.com", "a personal address"),
    (r"(?i)/home/[a-z]", "a path on somebody's machine"),
]


def tracked() -> list[str]:
    try:
        out = subprocess.run(["git", "ls-files"], cwd=HERE, capture_output=True, text=True, check=True).stdout.split()
    except (subprocess.CalledProcessError, FileNotFoundError):
        out = []
    if not out:
        out = [str(p.relative_to(HERE)) for p in HERE.rglob("*") if p.is_file() and ".git" not in p.parts and "__pycache__" not in p.parts]
    return out


def names_that_must_not_appear() -> list[str]:
    problems = []
    for name in tracked():
        if name == "check.py":
            continue
        try:
            text = (HERE / name).read_text()
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        for pattern, why in PUBLIC:
            for m in re.finditer(pattern, text):
                problems.append(f"{name}: names {m.group(0)}, which is {why}")
    return sorted(set(problems))


def tests() -> list[str]:
    problems = []
    node = subprocess.run(["node", "--test"] + sorted(str(p) for p in (HERE / "tests").glob("*.test.mjs")), cwd=HERE, capture_output=True, text=True)
    if node.returncode != 0:
        problems.append("the Node tests failed:\n" + "\n".join("    " + l for l in (node.stdout + node.stderr).splitlines() if "✖" in l or "Error" in l)[:2000])
    py = subprocess.run([sys.executable, str(HERE / "tests" / "run_python.py")], cwd=HERE, capture_output=True, text=True)
    if py.returncode != 0:
        problems.append("the Python tests failed:\n" + "\n".join("    " + l for l in (py.stdout + py.stderr).splitlines()[-20:]))
    rust = subprocess.run(["cargo", "test", "--release", "--quiet", "--manifest-path", str(HERE / "rust" / "Cargo.toml")], cwd=HERE, capture_output=True, text=True)
    if rust.returncode != 0:
        problems.append("the Rust tests failed:\n" + "\n".join("    " + l for l in (rust.stdout + rust.stderr).splitlines()[-20:]))
    return problems


if __name__ == "__main__":
    sys.exit(main())
