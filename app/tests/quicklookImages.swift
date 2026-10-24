import Foundation

@main
struct QuickLookImageTests {
    static func main() throws {
        let manager = FileManager.default
        let root = manager.temporaryDirectory.appendingPathComponent("bioscratch-ql-\(UUID().uuidString)")
        try manager.createDirectory(at: root.appendingPathComponent("notes/img"), withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }
        let parent = root.appendingPathComponent("notes")
        let doc = parent.appendingPathComponent("note.md")
        let image = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWj8AAAAASUVORK5CYII=")!
        try image.write(to: parent.appendingPathComponent("img/ok.png"))
        try image.write(to: parent.appendingPathComponent("img/second.png"))
        try image.write(to: root.appendingPathComponent("outside.png"))
        try manager.createSymbolicLink(at: parent.appendingPathComponent("escape.png"), withDestinationURL: root.appendingPathComponent("outside.png"))
        try Data("not an image".utf8).write(to: parent.appendingPathComponent("secret.txt"))
        let markdown = """
        ![ok](img/ok.png "label")
        ![outside](../outside.png)
        ![symlink](escape.png)
        ![text](secret.txt)
        ![remote](https://example.com/image.png)
        """
        let images = previewImageData(markdown: markdown, documentURL: doc)
        precondition(images.count == 1 && images["img/ok.png"] == "data:image/png;base64,\(image.base64EncodedString())")
        precondition(previewImageData(markdown: markdown, documentURL: doc, maxImageBytes: image.count - 1).isEmpty)
        precondition(previewImageData(markdown: markdown, documentURL: doc, maxTotalBytes: image.count - 1).isEmpty)
        precondition(previewImageData(markdown: markdown, documentURL: doc, maxImages: 0).isEmpty)
        let twoImages = "![one](img/ok.png)\n![two](img/second.png)"
        precondition(previewImageData(markdown: twoImages, documentURL: doc, maxImages: 1).count == 1)
        precondition(previewImageData(markdown: twoImages, documentURL: doc, maxTotalBytes: image.count).count == 1)
        // A lookalike sibling path must not pass the parent containment test.
        try manager.createDirectory(at: root.appendingPathComponent("notes-evil"), withIntermediateDirectories: true)
        try image.write(to: root.appendingPathComponent("notes-evil/image.png"))
        precondition(previewImageData(markdown: "![x](../notes-evil/image.png)", documentURL: doc).isEmpty)
        print("Quick Look image containment and bounds passed")
    }
}
