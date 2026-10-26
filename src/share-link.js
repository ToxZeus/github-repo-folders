/**
 * Shareable config link: gzip-compress the exported JSON (browser-native
 * CompressionStream, no new dependency) and base64url-encode it into a URL
 * fragment. Fragments are never transmitted anywhere, which matters here
 * since the "server" receiving it is literally this same extension.
 *
 * No manifest "key" is pinned, so the extension's id (and therefore the
 * chrome-extension://<id>/... origin used below) is only guaranteed stable
 * on the machine/profile the extension was loaded on — a generated link is
 * only expected to open correctly on that same machine. Cross-machine
 * transfer still goes through the existing JSON file export/import.
 *
 * Loaded by both popup.html and import.html.
 */
(function (global) {
  const SOFT_LIMIT_BYTES = 8 * 1024;
  const HARD_LIMIT_BYTES = 32 * 1024;

  function base64UrlEncode(bytes) {
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlDecode(str) {
    const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "===".slice((normalized.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function compress(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function decompress(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(buf);
  }

  async function buildShareLink(jsonStr) {
    const compressed = await compress(jsonStr);
    if (compressed.byteLength > HARD_LIMIT_BYTES) {
      const err = new Error(
        `Configuration trop volumineuse pour un lien (${Math.round(compressed.byteLength / 1024)} Ko compressés, ` +
          `limite ${Math.round(HARD_LIMIT_BYTES / 1024)} Ko). Utilise plutôt « Exporter (JSON) ».`
      );
      err.code = "GHRF_SHARE_LINK_TOO_LARGE";
      throw err;
    }
    const encoded = base64UrlEncode(compressed);
    return {
      url: `${location.origin}/src/import.html#d=${encoded}`,
      bytes: compressed.byteLength,
      soft: compressed.byteLength > SOFT_LIMIT_BYTES
    };
  }

  function extractFragmentData(input) {
    const trimmed = (input || "").trim();
    const match = trimmed.match(/[#&]d=([^&\s]+)/);
    return match ? match[1] : trimmed; // allow pasting the bare fragment too
  }

  async function readShareLink(input) {
    const encoded = extractFragmentData(input);
    if (!encoded) throw new Error("Aucune donnée trouvée dans ce lien.");
    const bytes = base64UrlDecode(encoded);
    return decompress(bytes);
  }

  global.GHRFShareLink = {
    buildShareLink,
    readShareLink,
    extractFragmentData,
    SOFT_LIMIT_BYTES,
    HARD_LIMIT_BYTES
  };
})(typeof window !== "undefined" ? window : this);
