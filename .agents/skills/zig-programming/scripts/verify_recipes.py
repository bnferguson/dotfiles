#!/usr/bin/env python3
"""Compile every recipe in this skill against a real Zig toolchain.

The recipes claim to be tested. This script is what makes that claim checkable:
it extracts each recipe's "Full Tested Code" block into a buildable project --
resolving the sibling modules the recipe defines, writing the fixtures it embeds,
and linking the C libraries it binds -- then compiles them all and reports what
fails.

Usage:
    python scripts/verify_recipes.py [--recipes DIR] [--zig ZIG] [--work DIR]
                                     [--filter PREFIX] [--verbose]

Exit status is non-zero when any recipe fails to compile.
"""
import argparse
import collections
import concurrent.futures
import json
import pathlib
import re
import shutil
import subprocess
import sys

recipe_h = re.compile(r'^## Recipe ([\d.]+): (.*?) \{#', re.M)
# A block whose first line names a .zig file is a sibling module for that recipe.
# Recipes label a module fragment as "// math.zig" or "// In math.zig".
file_hint = re.compile(r'^//\s*(?:[Ii]n\s+)?([\w./-]+\.zig)[:\s]*$', re.M)

FIXTURES = {
    "data/sample_config.txt": "name=MyApp\nversion=1.0.0\nenabled=true\n",
    "data/sample_template.txt": "Hello, {{name}}! Welcome to {{app}}.\n",
    "data/sample_messages.txt": "greeting=Hello\nfarewell=Goodbye\n",
    "assets/message.txt": "Hello from an embedded asset.\n",
    "assets/config.txt": "name=MyApp\nversion=1.0.0\ndebug=false\n",
}

def joinable(block):
    """True if a labelled fragment is a whole file rather than an illustration.

    Recipes mix real module source with snippets like a bare `@import(...)`
    line; joining the latter produces code that cannot parse.
    """
    if block.count("{") != block.count("}"):
        return False
    for line in block.split("\n"):
        if not line.strip() or line.startswith((" ", "\t", "//", "}")):
            continue
        if not re.match(r'(pub\s+)?(const|var|fn|test|comptime|export|extern|inline|threadlocal|usingnamespace)\b', line):
            return False
    return True

def build_projects(recipes, work):
    if work.exists():
        shutil.rmtree(work)
    entries = []
    for md in sorted(recipes.glob("*.md")):
        text = md.read_text()
        heads = list(recipe_h.finditer(text))
        for i, h in enumerate(heads):
            body = text[h.end(): heads[i+1].start() if i+1 < len(heads) else len(text)]
            m = re.search(r'^### Full Tested Code\s*$(.*?)(?=^### |\Z)', body, re.M | re.S)
            if not m:
                continue
            blocks = re.findall(r'```zig\n(.*?)```', m.group(1), re.S)
            if not blocks:
                continue
            main = max(blocks, key=len)
            slug = f"{md.stem}__{h.group(1).replace('.', '_')}"
            proj = work / slug
            proj.mkdir(parents=True, exist_ok=True)
            (proj / "main.zig").write_text(main)

            # Sibling modules the recipe defines in its own blocks, keyed by the
            # `// name.zig` header line and looked up by basename, because a
            # recipe declares `// math.zig` but imports `recipe_10_1/math.zig`.
            defined = {}
            for blk in re.findall(r'```zig\n(.*?)```', body, re.S):
                fh = file_hint.match(blk.split("\n")[0] + "\n")
                if fh and joinable(blk):
                    # A recipe presents a module in fragments across several
                    # blocks, so join them into one file and keep a single
                    # import prelude.
                    key = pathlib.PurePath(fh.group(1)).name
                    body = "\n".join(
                        line for line in blk.split("\n")
                        if not (key in defined and line.startswith('const std = @import("std")'))
                    )
                    defined[key] = (defined.get(key, "") + "\n" + body) if key in defined else body

            # Resolve imports transitively: a module the recipe defines can
            # itself import another one.
            # An import path is relative to the file that contains it.
            pending = [("main.zig", main)]
            written = set()
            while pending:
                src_rel, src = pending.pop()
                base = pathlib.PurePath(src_rel).parent
                for imp in set(re.findall(r'@import\("([\w./-]+\.zig)"\)', src)):
                    rel = str(base / imp) if str(base) != "." else imp
                    if rel in written:
                        continue
                    written.add(rel)
                    imp = rel
                    dest = proj / imp
                    if dest.resolve() == (proj / "main.zig").resolve():
                        continue
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    content = defined.get(pathlib.PurePath(imp).name)
                    if content is None:
                        # Nothing in the recipe defines it; stub it so a missing
                        # file cannot masquerade as a 0.16 error.
                        content = '// stub\nconst std = @import("std");\n'
                    dest.write_text(content)
                    pending.append((imp, content))
            for name, content in FIXTURES.items():
                if f'@embedFile("{name}")' in main:
                    dest = proj / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_text(content)
            entries.append({"topic": md.stem, "recipe": h.group(1),
                            "title": h.group(2), "slug": slug,
                            # Where the main block lives, so a repair can be
                            # written back into the recipe it came from.
                            "md": str(md), "block": main})
    return entries

# A recipe that binds a C library needs that library on the link line.
C_LIBS = {
    "sqlite3.h": ["-lsqlite3"],
    "unicode/unorm2.h": ["-licuuc", "-licui18n"],
    "unicode/ustring.h": ["-licuuc", "-licui18n"],
    "zlib.h": ["-lz"],
    "math.h": ["-lm"],
}

def flags_for(code, slug):
    if slug.startswith("webassembly__"):
        return ["-target", "wasm32-freestanding", "-fno-entry", "-rdynamic"]
    if ("@cImport" in code or "std.heap.c_allocator" in code
            or "std.c." in code or "linkLibC" in code):
        # -fllvm: the self-hosted x86 backend miscompiles these relocations.
        extra = []
        for header, libs in C_LIBS.items():
            if header in code:
                extra += libs
        return ["-lc", "-fllvm"] + extra
    return []

def check(e, zig, work, cache):
    proj = work / e["slug"]
    code = (proj / "main.zig").read_text()
    cache_args = ["--cache-dir", str(cache), "--global-cache-dir", str(cache)]
    extra = flags_for(code, e["slug"])
    errs = []
    def run(args, flags):
        return subprocess.run(zig + args + cache_args + flags, cwd=proj,
                              capture_output=True, text=True, timeout=600)
    has_main = re.search(r'^pub fn main\b', code, re.M)
    has_test = re.search(r'^test[ "]', code, re.M)
    is_wasm = e["slug"].startswith("webassembly__")
    if has_main or is_wasm:
        verb = "build-obj" if (is_wasm and not has_main) else "build-exe"
        r = run([verb, "main.zig", "-fno-emit-bin"], extra)
        if r.returncode: errs.append((verb, r.stderr))
    # A recipe that imports host functions has no native link target; its wasm
    # surface is checked above instead.
    host_imports = re.search(r'^extern "\w+"', code, re.M) is not None
    if has_test and not (is_wasm and host_imports):
        # The test runner pulls in std.Io.Threaded, which 0.16 cannot build for
        # wasm-freestanding, so wasm recipes get their tests checked natively.
        r = run(["test", "main.zig", "--test-no-exec"], [] if is_wasm else extra)
        if r.returncode: errs.append(("test", r.stderr))
    if not has_main and not has_test and not is_wasm:
        r = run(["build-obj", "main.zig", "-fno-emit-bin"], extra)
        if r.returncode: errs.append(("build-obj", r.stderr))
    return {**e, "errors": errs, "pass": not errs}

def main(argv=None):
    here = pathlib.Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--recipes", type=pathlib.Path, default=here / "recipes",
                    help="directory of recipe markdown (default: the skill's recipes/)")
    ap.add_argument("--zig", default="zig",
                    help="zig executable, or a command such as 'mise x zig@0.16.0 -- zig'")
    ap.add_argument("--work", type=pathlib.Path,
                    default=pathlib.Path("/tmp/zig-recipe-verify"),
                    help="scratch directory for the generated projects")
    ap.add_argument("--filter", default="",
                    help="only check recipes whose slug starts with this prefix")
    ap.add_argument("--jobs", type=int, default=8, help="parallel compilations")
    ap.add_argument("--verbose", action="store_true", help="print each failure's errors")
    args = ap.parse_args(argv)

    zig = args.zig.split()
    work = args.work / "projects"
    cache = args.work / "zig-cache"

    version = subprocess.run(zig + ["version"], capture_output=True, text=True)
    if version.returncode != 0:
        print(f"cannot run {' '.join(zig)}: {version.stderr.strip()}", file=sys.stderr)
        return 2
    zig_version = version.stdout.strip()

    entries = build_projects(args.recipes, work)
    if args.filter:
        entries = [e for e in entries if e["slug"].startswith(args.filter)]
    if not entries:
        print(f"no recipes found under {args.recipes}", file=sys.stderr)
        return 2

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda e: check(e, zig, work, cache), entries))

    passed = [r for r in results if r["pass"]]
    failed = [r for r in results if not r["pass"]]
    print(f"{len(passed)}/{len(results)} recipes compile on zig {zig_version}")
    for topic, n in collections.Counter(r["topic"] for r in failed).most_common():
        print(f"  {n:3d} failing  {topic}")
    if args.verbose:
        for r in failed:
            print(f"\n### {r['slug']}")
            for kind, err in r["errors"]:
                print(f"  [{kind}]")
                for line in err.splitlines():
                    if "error:" in line:
                        print(f"    {line}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
