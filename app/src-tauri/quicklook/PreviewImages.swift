import Foundation
import UniformTypeIdentifiers

/// Embed only explicitly referenced images within the selected note's folder.
/// No WebView file grants or Tauri bridge are needed for local image rendering.
func previewImageData(markdown: String, documentURL: URL,
                      maxImages: Int = 32,
                      maxImageBytes: Int = 8 * 1024 * 1024,
                      maxTotalBytes: Int = 32 * 1024 * 1024) -> [String: String] {
    guard maxImages > 0, maxImageBytes > 0, maxTotalBytes > 0,
          let pattern = try? NSRegularExpression(
            pattern: #"!\[[^\[\]]*\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\s*\)"#)
    else { return [:] }
    let parent = documentURL.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL
    let parentParts = parent.pathComponents
    let text = markdown as NSString
    var images: [String: String] = [:]
    var references = 0
    var totalBytes = 0

    pattern.enumerateMatches(in: markdown, range: NSRange(location: 0, length: text.length)) { match, _, stop in
        guard references < maxImages, totalBytes < maxTotalBytes else {
            stop.pointee = true
            return
        }
        references += 1
        guard let match = match else { return }
        let source = text.substring(with: match.range(at: 1))
        guard images[source] == nil, !source.hasPrefix("/"),
              URL(string: source)?.scheme == nil else { return }

        let candidate = URL(fileURLWithPath: source, relativeTo: parent)
            .standardizedFileURL.resolvingSymlinksInPath()
        let parts = candidate.pathComponents
        guard parts.count > parentParts.count,
              Array(parts.prefix(parentParts.count)) == parentParts,
              let type = UTType(filenameExtension: candidate.pathExtension),
              type.conforms(to: .image), let mime = type.preferredMIMEType,
              mime.hasPrefix("image/"),
              let values = try? candidate.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
              values.isRegularFile == true, let size = values.fileSize,
              size > 0, size <= min(maxImageBytes, maxTotalBytes - totalBytes),
              let handle = try? FileHandle(forReadingFrom: candidate) else { return }
        defer { try? handle.close() }
        let allowance = min(maxImageBytes, maxTotalBytes - totalBytes)
        // Bounded read also handles a file growing after the metadata check.
        guard let data = try? handle.read(upToCount: allowance + 1),
              !data.isEmpty, data.count <= allowance else { return }
        images[source] = "data:\(mime);base64,\(data.base64EncodedString())"
        totalBytes += data.count
    }
    return images
}
