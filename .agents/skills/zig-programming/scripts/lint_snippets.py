#!/usr/bin/env python3
"""Scan the recipes' illustrative snippets for APIs that Zig 0.16 removed.

`verify_recipes.py` compiles the "Full Tested Code" block of each recipe, which
is 218 of the ~3360 Zig blocks in `recipes/`. The rest are fragments -- partial
struct bodies, `build.zig` excerpts, before/after pairs -- that cannot compile
standalone, so nothing catches it when they keep using an API that no longer
exists. This scanner is the cheap substitute: a token blacklist over exactly the
blocks the compiler never sees.

It reports, it does not fix, and it is deliberately conservative. A hit is a
strong hint, not a proof -- `getWritten` is a removed stdlib method and also a
perfectly good name for a method on your own type.

    python scripts/lint_snippets.py                 # unverified blocks only
    python scripts/lint_snippets.py --all           # every block
    python scripts/lint_snippets.py --file concurrency.md
"""

import argparse
import pathlib
import re
import sys

# (regex, what to use instead). Ordered roughly by how often it bites.
RULES = [
    (r"std\.Thread\.(Mutex|RwLock|Condition|Semaphore|ResetEvent|WaitGroup)",
     "moved to std.Io (WaitGroup -> std.Io.Group)"),
    (r"std\.fs\.cwd\(\)", "std.Io.Dir.cwd()"),
    (r"std\.fs\.(File|Dir)\b", "std.Io.File / std.Io.Dir"),
    (r"std\.fs\.(openFileAbsolute|createFileAbsolute|openDirAbsolute)",
     "std.Io.Dir equivalents"),
    (r"std\.io\.(getStdOut|getStdIn|getStdErr)",
     "std.Io.File.stdout() / .stdin() / .stderr()"),
    (r"std\.io\.(AnyReader|AnyWriter)", "std.Io.Reader / std.Io.Writer"),
    (r"(std\.io\.)?fixedBufferStream|FixedBufferStream",
     "std.Io.Reader.fixed / std.Io.Writer.fixed"),
    (r"std\.io\.(bufferedWriter|bufferedReader)",
     "the buffer argument to file.writer(io, &buf)"),
    (r"std\.time\.(milliTimestamp|nanoTimestamp|timestamp|sleep|Timer)",
     "std.Io.Timestamp.now(io, clock) / io.sleep (std.time keeps only constants)"),
    (r"GeneralPurposeAllocator", "std.heap.DebugAllocator, or init.gpa in main"),
    (r"@Type\(", "@Struct / @Enum / @Int / @Union / @Pointer"),
    (r"callconv\(\.C\)", "callconv(.c)"),
    (r"\bc_(float|double)\b", "f32 / f64"),
    (r"addStaticLibrary|addSharedLibrary",
     "b.addLibrary(.{ .linkage = .static/.dynamic, ... })"),
    (r"std\.net\.", "std.Io.net"),
    (r"std\.posix\.(close|socket|dup|fcntl|pipe)\b", "std.Io equivalents"),
    (r"std\.process\.Child", "std.process.run(gpa, io, options)"),
    (r"std\.mem\.(trimLeft|trimRight)", "std.mem.trimStart / trimEnd"),
    (r"std\.fmt\.format\(", "writer.print(...)"),
    (r"std\.fmt\.FormatOptions",
     "gone -- format(self, w: *std.Io.Writer) std.Io.Writer.Error!void"),
    # The hook shape specifically -- `fn format(self, writer: anytype)`. A
    # helper named `format` that takes a format string and args is unrelated.
    (r"fn format\(\s*\w+: [\w.@()]+,\s*\w+: anytype\s*\)",
     "format hooks take a concrete *std.Io.Writer"),
    (r"getDocumentationStep", "compile.getEmittedDocs() (returns a LazyPath)"),
    (r"\.readUntilDelimiter|\.readNoEof\b", "reader.takeDelimiterExclusive / readSliceAll"),
    (r"\.getWritten\(\)", "writer.buffered()"),
    (r"std\.crypto\.random|std\.rand\b", "io.random(&buf)"),
    # Scoped to `std.` -- a recipe defining its own `ArrayList` generic may
    # legitimately give it an `init(allocator)`.
    (r"std\.ArrayList\([^)]*\)\.init\(", "std.ArrayList(T).empty, allocator per method"),
    # `std.Io.Mutex` and friends have no default field values, so `.{}` is a
    # compile error; they expose a decl literal instead.
    (r"(Mutex|RwLock|Condition|Semaphore)\s*=\s*\.\{\}", "= .init"),
    (r"\.(mutex|lock|rwlock|cond|condition|semaphore)\s*=\s*\.\{\}", "= .init"),
    # `lock`/`lockShared` return Cancelable!void, so a bare call is discarded.
    (r"^\s*[\w.]*\.(lock|lockShared)\(io\);", "try ...lock(io) or lockUncancelable(io)"),
]
COMPILED = [(re.compile(p, re.M), fix) for p, fix in RULES]

BLOCK = re.compile(r"```zig\n(.*?)```", re.S)
HEADING = re.compile(r"^#{2,4} .*$", re.M)
COMMENT = re.compile(r"//.*$", re.M)


def strip_comments(body: str) -> str:
    """Blank out comment text, keeping line numbers intact.

    A migration note legitimately names the API it is telling you to stop
    using, so scanning comments produces false positives. Naive: a `//` inside
    a string literal is treated as a comment too, which costs a missed hit, not
    a wrong one.
    """
    return COMMENT.sub(lambda m: " " * len(m.group(0)), body)


def blocks(source: str, include_tested: bool):
    """Yield (line_number, body) for each Zig block worth scanning."""
    headings = [(m.start(), m.group(0)) for m in HEADING.finditer(source)]
    for match in BLOCK.finditer(source):
        if not include_tested:
            preceding = [h for h in headings if h[0] < match.start()]
            if preceding and "Full Tested Code" in preceding[-1][1]:
                continue
        yield source.count("\n", 0, match.start(1)) + 1, strip_comments(match.group(1))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipes", default="recipes", type=pathlib.Path)
    parser.add_argument("--file", help="only this recipe file")
    parser.add_argument("--all", action="store_true",
                        help="also scan Full Tested Code blocks")
    args = parser.parse_args()

    paths = sorted(args.recipes.glob("*.md"))
    if args.file:
        paths = [p for p in paths if p.name == args.file]
    if not paths:
        print(f"no recipes found under {args.recipes}", file=sys.stderr)
        return 2

    total = 0
    for path in paths:
        source = path.read_text()
        hits = []
        for start_line, body in blocks(source, args.all):
            for pattern, fix in COMPILED:
                for hit in pattern.finditer(body):
                    line = start_line + body.count("\n", 0, hit.start())
                    hits.append((line, hit.group(0).strip(), fix))
        if hits:
            print(f"\n{path}")
            for line, text, fix in sorted(hits):
                print(f"  {line:>6}  {text:<44} -> {fix}")
        total += len(hits)

    scope = "all blocks" if args.all else "unverified snippets"
    print(f"\n{total} hit(s) across {len(paths)} file(s) ({scope})")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
