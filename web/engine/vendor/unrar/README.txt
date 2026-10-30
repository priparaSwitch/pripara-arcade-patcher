node-unrar-js 2.0.2 (https://github.com/YuJianrong/node-unrar.js)
Pinned npm: https://registry.npmjs.org/node-unrar-js/-/node-unrar-js-2.0.2.tgz
The npm tarball's SHA-512 matches its official registry integrity record.
Those upstream links document provenance only. The runtime uses the vendored
files in this directory; it never downloads code from an external registry.

unrar.wasm is unchanged, 207593 bytes.
SHA-256: c7d79f869196e3c79c053ba74a8f629116de8293a94f60cc851bbcd7977d0c2b
Extractor.js is unchanged. The application subclasses its I/O layer.
unrar.js: two Emscripten embind dynamic function constructors were replaced
with equivalent closures (createNamedFunction and craftInvokerFunction).
This preserves the site's script-src 'self' 'wasm-unsafe-eval' CSP and does not
enable JavaScript eval. No executable or code from the input RAR is executed.

The JS wrapper is MIT: LICENSE-MIT.txt.
The UnRAR decoder has its own license: LICENSE-UnRAR.txt (upstream
UnRarDLL_Doc/license.txt). It may unpack RAR but must not be used to develop a
RAR-compatible archiver. The virtual single-member input is only an in-memory
view used for decoding existing compressed bodies, not an archive compressor.

Original input is non-solid RAR5 compression version 0. Solid archives and
compressed algorithm version 1 are rejected. Dictionaries above 64 MiB are
rejected. Stored files use selected byte ranges; compressed members use the
decoder's bounded memory callbacks with at most 1 MiB read/write buffers.
The application does not require OPFS, SharedArrayBuffer, FileReaderSync,
cross-origin isolation or custom server headers. It runs in a dedicated Worker
which the UI terminates when cancelling. See SELECTED_ADAPTER.txt for details.
