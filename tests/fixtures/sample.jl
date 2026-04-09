# Bioscratch Julia fixture — tests Julia syntax highlighting.

module BioscratchDemo

using Statistics
using Printf

const LARGE_FILE_THRESHOLD = 1_000_000  # bytes

# ── Types ─────────────────────────────────────────────────────────────────────

"""
    Document(path, content, dirty)

A simple in-memory representation of an open file.
"""
mutable struct Document
    path::Union{String, Nothing}
    content::String
    dirty::Bool

    Document(; path=nothing, content="", dirty=false) = new(path, content, dirty)
end

filename(doc::Document) = isnothing(doc.path) ? "Untitled" : basename(doc.path)

function word_count(doc::Document)
    isempty(strip(doc.content)) ? 0 : length(split(strip(doc.content)))
end

Base.show(io::IO, doc::Document) =
    @printf(io, "<Document '%s' — %d words>", filename(doc), word_count(doc))

# ── I/O ───────────────────────────────────────────────────────────────────────

function load_document(path::String)::Document
    sz = filesize(path)
    if sz > LARGE_FILE_THRESHOLD
        print("'$path' is $(round(sz / 1e6; digits=1)) MB. Open anyway? [y/N] ")
        ans = readline()
        lowercase(strip(ans)) == "y" || error("Aborted.")
    end
    content = read(path, String)
    Document(; path, content)
end

# ── Statistics example ────────────────────────────────────────────────────────

function demo_statistics()
    data = randn(500)
    println("n       = ", length(data))
    println("mean    = ", round(mean(data); digits=4))
    println("std     = ", round(std(data); digits=4))
    println("median  = ", round(median(data); digits=4))

    bins = range(-4, 4; length=9)
    hist = [count(x -> b <= x < b + step(bins), data) for b in bins[1:end-1]]
    println("\nHistogram (rough):")
    for (b, n) in zip(bins, hist)
        bar = repeat("█", n ÷ 5)
        @printf("  %+.1f  %s (%d)\n", b, bar, n)
    end
end

end  # module BioscratchDemo

BioscratchDemo.demo_statistics()
