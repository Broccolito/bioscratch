/**
 * Resolves a relative image path against the document's file path.
 */
export function resolveImagePath(
  src: string,
  documentPath: string | null
): string {
  if (!src) return src;
  // Already absolute or data URL
  if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/")) {
    return src;
  }

  if (!documentPath) return src;

  // Get directory of the document
  const lastSlash = Math.max(
    documentPath.lastIndexOf("/"),
    documentPath.lastIndexOf("\\")
  );
  const dir = documentPath.substring(0, lastSlash + 1);

  // Use Tauri asset protocol for local files
  const resolved = dir + src;
  return `asset://${resolved}`;
}

export function isDataUrl(src: string): boolean {
  return src.startsWith("data:");
}
