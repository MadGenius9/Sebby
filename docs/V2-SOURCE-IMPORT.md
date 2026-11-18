# Source ZIP import

Choose **Import source ZIP**, select an archive and inspect it. The review shows the proposed project name, included paths, total source bytes, skipped paths/reasons and original archive SHA-256. The optional shared outer-folder removal is enabled in the UI and reported explicitly; disable it when a common directory such as `src/` should remain part of the project. Inspection creates no project. **Create project from reviewed files** uses the existing authenticated project importer to create revision 1; it never overwrites an existing project. The editor can then save revisions, show Git diffs, prepare source previews and request configured isolated builds.

This is a small source-only importer, including ZIP downloads and Git source archives. A separate public GitHub URL snapshot importer is now available (V2-GITHUB-IMPORT.md). ZIP import does not clone a GitHub URL, access private repositories or preserve history, remotes, branches or archive provenance in the project database. The displayed checksum identifies the inspected archive; it is not an authenticity signature. Code does not run and dependencies are not installed during inspection or import.

## Limits and exclusions

- ZIP upload: 4,000,000 bytes; inspection deadline: 10 seconds.
- At most 512 archive entries, 40 included files, 100,000 bytes per included file and 600,000 included bytes total.
- The JSON-encoded candidate must fit a 900,000-byte budget beneath the existing 1 MB project save/import limit.
- Included files must be valid UTF-8 without binary control characters and use supported source/text extensions or recognized text filenames.
- Included project paths must satisfy the existing project schema: relative ASCII paths, up to 180 characters, with components made of letters, digits, `_`, `@`, `.`, and `-`. An outer archive folder may contain spaces when it is removed.
- Generated folders, dependency folders, `.git`, common environment/credential filenames, images and other binary/unsupported formats are excluded and listed. Filtering does not discover every credential embedded in source or arbitrarily named files. Inspect your files before importing sensitive material.

The implementation uses lazy ZIP entry processing and bounded decompression streams. It rejects traversal, absolute/backslash paths, duplicate/case-colliding paths, file/directory overlaps, Windows device names, symlinks/special files and encrypted entries. Included file sizes and CRC-32 are checked against actual decompressed bytes. Corrupt or oversized included content rejects the entire candidate. Excluded content is not decompressed or integrity-checked. Archive files are never extracted onto the application filesystem.

The review route is session-authenticated and follows the existing same-origin write checks. JSON writes retain their 1 MB limit; only ZIP inspection gets the 4 MB cap. Candidates stay in the browser until imported or dismissed. The standard project API validates the document again when creating it.

## Verification

Seven new tests cover filtering, optional root removal, integrity, unsafe paths/links, duplicate/overlapping paths, forged decompressed sizes, limits, UTF-8 checks, session/origin checks and inspection without persistence. The imported document is then saved, previewed, diffed and materialized as a private Git snapshot. A real `git archive --format=zip` fixture also imports successfully. HTTP smoke exercises ZIP inspection, reviewed creation and saved source preview through the built server.

API, parser and Git checks are complemented by hosted desktop Chromium source ZIP selection/review/import acceptance in run 44082103270. A scripted project tool then proposes a scene change on that imported project and the browser reviews/applies it. This is not a live-provider call. Mobile file-picker interaction and live AI-driven changes on an imported repository remain unverified. Binary asset storage and larger repository limits require a later increment.
