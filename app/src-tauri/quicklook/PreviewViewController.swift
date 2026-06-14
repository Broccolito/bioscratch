import Cocoa
import Quartz
import WebKit

// Bioscratch Quick Look preview extension.
//
// Renders a Markdown file using Bioscratch's own read-only web preview
// (dist-preview/preview.html) inside a WKWebView, so the spacebar Quick Look
// looks identical to opening the file in the app — just not editable.
@objc(PreviewViewController)
class PreviewViewController: NSViewController, QLPreviewingController {

    private var webView: WKWebView?

    override func loadView() {
        self.view = NSView(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
    }

    func preparePreviewOfFile(at url: URL,
                              completionHandler handler: @escaping (Error?) -> Void) {
        // Read the markdown (fall back to lossy decoding for odd encodings).
        var markdown = ""
        if let s = try? String(contentsOf: url, encoding: .utf8) {
            markdown = s
        } else if let data = try? Data(contentsOf: url),
                  let s = String(data: data, encoding: .utf8) {
            markdown = s
        } else if let data = try? Data(contentsOf: url) {
            markdown = String(decoding: data, as: UTF8.self)
        }

        let bundle = Bundle(for: PreviewViewController.self)
        guard let previewURL = bundle.url(forResource: "preview",
                                          withExtension: "html",
                                          subdirectory: "dist-preview") else {
            handler(NSError(domain: "com.bioscratch.quicklook", code: 1,
                            userInfo: [NSLocalizedDescriptionKey:
                                        "Bundled preview.html not found"]))
            return
        }
        let baseDir = previewURL.deletingLastPathComponent()

        // Inject the file contents as globals before the page scripts run, so the
        // preview renders without any need for a server or Tauri runtime.
        let injected = """
        window.__QL_MARKDOWN__ = \(jsStringLiteral(markdown));
        window.__QL_FILEPATH__ = \(jsStringLiteral(url.path));
        """

        let config = WKWebViewConfiguration()
        // The preview bundle uses ES modules; without these, module/fetch loads
        // from the file:// bundle are CORS-blocked and the page renders blank.
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: injected,
                                       injectionTime: .atDocumentStart,
                                       forMainFrameOnly: true))
        config.userContentController = ucc

        let wv = WKWebView(frame: self.view.bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.setValue(false, forKey: "drawsBackground")
        self.view.addSubview(wv)
        self.webView = wv

        wv.loadFileURL(previewURL, allowingReadAccessTo: baseDir)

        // The page renders synchronously on load; report success immediately.
        handler(nil)
    }

    /// JSON-encode a string into a safe JS string literal (handles quotes,
    /// backslashes, newlines, unicode).
    private func jsStringLiteral(_ s: String) -> String {
        if let data = try? JSONSerialization.data(withJSONObject: [s]),
           let arr = String(data: data, encoding: .utf8) {
            // arr is `["..."]`; strip the surrounding brackets.
            return String(arr.dropFirst().dropLast())
        }
        return "\"\""
    }
}
