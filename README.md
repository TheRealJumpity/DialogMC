# Dialog MC

A dark, minimalist builder for **Minecraft Java dialogs** (the pop-up screens added in 1.21.6), for **1.21.11** and **26.2**. Switch versions at the top; checks, pickers and exports follow the version.

- Every dialog type: notice, confirmation, multi action, server links, dialog list
- Body text and item elements, all four input types (text, toggle, option picker, slider)
- All action types, including `dynamic/run_command` with `$(key)` inputs and `dynamic/custom`
- Rich text: colors, styles, fonts, translatable, keybind, sprites, heads, click and hover events
- Pickers for items, entities, effects, keybinds, language keys, colors and other dialogs
- Warnings when something won't work: unknown commands, missing permissions, commands that can't run from a click, missing ids, version-only features
- Live Minecraft-style preview you can click through
- Export: JSON, compact JSON, SNBT, a `/dialog show` command, or a data pack `.zip`
- Import JSON / SNBT / `/dialog show …` / project files; share links (`#p=…`); undo/redo; autosave in the browser

No build step and no dependencies — plain HTML, CSS and JavaScript.

## Publish on GitHub Pages

1. Create a repository and upload everything in this folder (keep `index.html` at the top level and the `.nojekyll` file).
2. In the repository go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then save.
4. After a minute the site is live at `https://<your-name>.github.io/<repo>/`.

To try it locally: `python3 -m http.server` in this folder, then open http://localhost:8000.

## Notes

- Item icons are generated placeholders. No Mojang textures are bundled.
- Fonts (IBM Plex Sans, JetBrains Mono, Jersey 10) are self-hosted; see `fonts/LICENSES.txt`.
- Tests for the engine: `for f in tests/*.test.js; do node $f; done` (Node 18+).
- Not affiliated with Mojang or Microsoft. Minecraft is a trademark of Mojang AB.
