// Bioscratch TypeScript fixture — tests TypeScript syntax highlighting.

interface Document {
  path: string | null;
  content: string;
  dirty: boolean;
}

type FileMode = "markdown" | "plaintext" | "code";

const LARGE_FILE_THRESHOLD = 1_000_000; // bytes

function getFilename(doc: Document): string {
  if (!doc.path) return "Untitled";
  return doc.path.split(/[\\/]/).at(-1) ?? doc.path;
}

function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

async function loadDocument(path: string): Promise<Document> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
  const content = await response.text();

  const byteSize = new TextEncoder().encode(content).length;
  if (byteSize > LARGE_FILE_THRESHOLD) {
    const ok = confirm(
      `'${path.split("/").at(-1)}' is ${(byteSize / 1e6).toFixed(1)} MB.\n` +
        "Loading large files may be slow. Continue?"
    );
    if (!ok) throw new Error("Cancelled by user.");
  }

  return { path, content, dirty: false };
}

function detectMode(path: string): FileMode {
  const ext = path.split(".").at(-1)?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "txt" || ext === "text") return "plaintext";
  return "code";
}

// ── Generic LRU cache ────────────────────────────────────────────────────────

class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxSize) {
      this.map.delete(this.map.keys().next().value!);
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}

export { Document, FileMode, loadDocument, detectMode, LruCache };
