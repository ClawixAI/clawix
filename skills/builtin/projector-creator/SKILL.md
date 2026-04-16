---
name: projector-creator
description: Create polished, functional projector tools. Use when building any projector item — ensures correct styling, real functionality, and proper structure.
version: 1.0.0
author: clawix
tags: [meta, tooling, projector]
---

# Projector Creator

Projectors are interactive tools that appear in the user's Projector page where they can be launched instantly.
Good examples: calculators, converters, image editors, data visualizers, form builders, timers.

**Sandbox constraints:** Projectors run in a sandboxed iframe with NO network access — they CANNOT use `fetch()` or any API calls.
If the tool needs live data (exchange rates, etc.), YOU must fetch it first with `web_search`/`web_fetch`, then embed it as hardcoded JSON in the HTML.

**Save to Workspace:** Projectors CAN save files to the workspace via postMessage bridge (see below).

---

## Coordination Workflow (For Primary Agents)

You are a COORDINATOR for projector tasks. **NEVER create or modify projector items yourself.**
When the user asks to create, modify, or fix a projector item:

Split into exactly 3 sequential spawns. Run ALL automatically — NEVER ask the user for permission between steps.

**Spawn #1 (HTML + CSS):**

```
spawn(agent_name="coder", prompt="read_file(\"/skills/builtin/projector-creator/SKILL.md\"). read_file(\"/skills/builtin/projector-creator/references/starter-template.html\"). Copy starter template to /workspace/projector/<NAME>/index.html. Replace ALL placeholders. Build the COMPLETE HTML structure with all controls, inputs, buttons, sliders, dropzone, content areas. Add ALL needed CSS. The <script> should contain ONLY: <script>// JAVASCRIPT GOES HERE</script>. Do NOT write any JS yet. Verify file ends with </html>. TASK: <user requirements>")
```

**Spawn #2 (JavaScript):**

```
spawn(agent_name="coder", prompt="FIRST: read_file(\"/skills/builtin/projector-creator/references/js-patterns.md\") — this contains ready-to-use JS code blocks for all common features. THEN: read_file /workspace/projector/<NAME>/index.html to see the HTML element IDs. THEN: use edit_file to replace '// JAVASCRIPT GOES HERE' with COMPLETE JavaScript. Copy the patterns from the skill and adapt element IDs to match the HTML. Every function must be real working code — no stubs, no TODOs. Verify after.")
```

**Spawn #3 (Review):**

```
spawn(agent_name="coder", prompt="read_file /workspace/projector/<NAME>/index.html. Verify: (1) ends with </html>. (2) No empty functions or // STUB or // TODO. (3) All buttons and sliders have working handlers. (4) No syntax errors. Fix any issues with edit_file.")
```

**Then report:** "Your projector **<name>** is ready! It allows you to <what it does>. Find it on your Projector page."

**For modifications:** spawn one coder: "FIRST: read_file /workspace/projector/<NAME>/index.html and write_file a backup to /workspace/projector/<NAME>/index.backup.html. THEN: edit_file to apply <changes>. Verify after."

---

## Implementation Guide (For Sub-Agents / Coder)

Use this skill whenever creating or modifying a projector item. It ensures every tool is polished, functional, and follows the design system.

### Process

1. **Read the starter template**: `read_file("/skills/builtin/projector-creator/references/starter-template.html")`
   This is a ready-to-use HTML skeleton with all the correct CSS styling already included.
2. **Copy the starter template** to `/workspace/projector/<tool-name>/index.html` using `write_file`.
   Replace TOOL_TITLE, TOOL, TOOL_SUBTITLE placeholders with real values.
   Replace the sidebar sections with the actual controls needed.
   Replace the content-main with the actual display area.
   Keep ALL the existing CSS — do NOT rewrite it.
3. **For JavaScript**: read `/skills/builtin/projector-creator/references/js-patterns.md` for ready-to-use code blocks.
   Use `edit_file` to replace the placeholder JavaScript with real, working functions.
   Each `edit_file` call should add one function at a time if the JS is complex.
4. **Verify** by reading the file back — check it ends with `</html>` and has no empty functions.

For complex tools, also read the reference example for inspiration:
`read_file("/skills/builtin/projector-creator/references/template-image-sharpener.html")`

## Output Location

- Tool: `/workspace/projector/<tool-name>/index.html`
- Output files (if the tool generates downloads): `/workspace/Output/Projector/`

## MANDATORY CSS Base

Every projector MUST include this exact CSS reset and theme:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #0f0f1a;
  color: #e0e0e0;
  min-height: 100vh;
}

.header {
  background: linear-gradient(135deg, #1a1a2e, #16213e);
  padding: 20px 30px;
  border-bottom: 1px solid #2a2a4a;
}
.header h1 {
  font-size: 22px;
  color: #fff;
}
.header h1 span {
  color: #e94560;
}
.header .subtitle {
  color: #888;
  font-size: 13px;
}
```

## Color Palette

| Element                  | Color                                       |
| ------------------------ | ------------------------------------------- |
| Body background          | `#0f0f1a`                                   |
| Panel/sidebar            | `#16213e` or `#1a1a2e`                      |
| Borders                  | `1px solid #2a2a4a`                         |
| Primary text             | `#e0e0e0`                                   |
| Muted text               | `#888`                                      |
| Label text               | `#aaa`                                      |
| Accent (buttons, active) | `#e94560`                                   |
| Accent hover             | `#ff6b81`                                   |
| Input backgrounds        | `#2a2a4a`                                   |
| Section headers          | `#e94560`, uppercase, letter-spacing: 1px   |
| Active items             | border `#e94560`, bg `rgba(233,69,96,0.15)` |

## UI Patterns

### Buttons

```css
.btn {
  padding: 12px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-primary {
  background: #e94560;
  color: white;
}
.btn-primary:hover {
  background: #ff6b81;
}
.btn-secondary {
  background: #2a2a4a;
  color: #ccc;
}
.btn-secondary:hover {
  background: #3a3a5a;
  color: #fff;
}
```

### Range Sliders

```css
input[type='range'] {
  width: 100%;
  -webkit-appearance: none;
  height: 6px;
  background: #2a2a4a;
  border-radius: 3px;
  outline: none;
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #e94560;
  cursor: pointer;
}
```

### Slider Labels (show current value)

```css
.control label {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #aaa;
  margin-bottom: 6px;
}
.control label .val {
  color: #e94560;
  font-weight: 600;
}
```

### Sidebar Layout

```css
.main {
  display: flex;
  height: calc(100vh - 70px);
}
.sidebar {
  width: 300px;
  min-width: 300px;
  background: #16213e;
  padding: 20px;
  overflow-y: auto;
  border-right: 1px solid #2a2a4a;
}
.section {
  margin-bottom: 24px;
}
.section h3 {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #e94560;
  margin-bottom: 12px;
}
```

### Preset Buttons Grid

```css
.preset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.preset-btn {
  padding: 10px 8px;
  border: 1px solid #2a2a4a;
  background: #1a1a2e;
  color: #ccc;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  text-align: center;
  transition: all 0.2s;
}
.preset-btn:hover {
  border-color: #e94560;
  color: #fff;
}
.preset-btn.active {
  border-color: #e94560;
  background: rgba(233, 69, 96, 0.15);
  color: #e94560;
}
```

### Drop Zone

```css
.dropzone {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: rgba(15, 15, 26, 0.95);
  cursor: pointer;
}
.drop-icon {
  width: 80px;
  height: 80px;
  border: 3px dashed #e94560;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 20px;
}
.dropzone h2 {
  color: #fff;
  margin-bottom: 8px;
}
.dropzone p {
  color: #888;
  font-size: 14px;
}
```

## Building Strategy (IMPORTANT — prevents truncation)

Complex projectors (>100 lines) MUST be built incrementally to avoid output truncation:

1. **Step 1**: Write the HTML skeleton with ALL the CSS using `write_file` — include the full `<style>` block and the HTML structure, but use a minimal `<script>` placeholder: `<script>// JS will be added next</script>`
2. **Step 2**: Use `edit_file` to replace the placeholder script with the complete JavaScript. If JS is still too long, split into multiple `edit_file` calls (e.g. add event handlers first, then core logic, then download functions).
3. **Step 3**: Read the file back to verify it's complete and functional.

**NEVER try to write the entire file in one `write_file` call if it exceeds ~200 lines.** The output will be truncated silently.

For simple projectors (<100 lines), a single `write_file` is fine.

## Save to Workspace (postMessage Bridge)

Projector tools can save files directly to the user's workspace via `postMessage`.
When a tool has a Download button, ALWAYS add a "Save to Workspace" button next to it.

### How it works

The iframe sends a message to the parent page, which saves the file to `/workspace/Output/Projector/`.

```javascript
// Save text file to workspace
function saveToWorkspace(filename, textContent) {
  window.parent.postMessage(
    {
      type: 'projector:save',
      filename: filename,
      content: textContent,
      encoding: 'text',
    },
    '*',
  );
}

// Save binary file (image, etc.) to workspace
function saveBinaryToWorkspace(filename, canvas) {
  canvas.toBlob(function (blob) {
    const reader = new FileReader();
    reader.onload = function () {
      const base64 = reader.result.split(',')[1];
      window.parent.postMessage(
        {
          type: 'projector:save',
          filename: filename,
          content: base64,
          encoding: 'base64',
        },
        '*',
      );
    };
    reader.readAsDataURL(blob);
  });
}

// Listen for save result (optional, for UI feedback)
window.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'projector:save-result') {
    if (event.data.success) {
      alert('Saved to workspace: ' + event.data.path);
    } else {
      alert('Save failed: ' + event.data.error);
    }
  }
});
```

### Button styling for Save to Workspace

```css
.btn-save-workspace {
  background: #16213e;
  color: #e94560;
  border: 1px solid #e94560;
}
.btn-save-workspace:hover {
  background: rgba(233, 69, 96, 0.15);
}
```

Always place the "Save to Workspace" button right next to the "Download" button.

## Data Strategy (IMPORTANT)

Projector tools run in a sandboxed iframe with NO network access. They cannot use `fetch()`, `XMLHttpRequest`, or any external API calls.

If the tool needs external data (e.g. exchange rates, weather, news):

1. The **agent** must fetch the data FIRST using `web_search` or `web_fetch` tools (before building the HTML)
2. Embed the data as a **hardcoded JSON object** inside the `<script>` tag
3. Add a comment with the date: `// Rates as of YYYY-MM-DD`
4. The tool works offline with the embedded data

Example for currency converter:

```javascript
// Exchange rates as of 2026-04-12 (embedded by agent via web_fetch)
const RATES = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 151.5,
  HKD: 7.82,
  CNY: 7.24,
  TWD: 32.1,
};
```

NEVER use `fetch()` or any network calls inside projector HTML.

## Responsive Layout (IMPORTANT)

Projector tools run inside a modal iframe. The tool MUST fill the available space responsively:

- Use `height: 100vh` on the main layout container, NOT fixed pixel heights.
- For sidebar layouts: use `display: flex; height: calc(100vh - header_height)`.
- For simple tools without a sidebar: center the content using `display: flex; justify-content: center; align-items: center; min-height: calc(100vh - 70px)`.
- All content areas should use `flex: 1; overflow: auto` to handle variable sizes.
- NEVER set a fixed width on the overall layout — let it fill 100% of the iframe width.

## Critical Rules

1. **Every feature must WORK** — no placeholder functions, no `// TODO`, no empty handlers
2. **All JavaScript must be real, tested logic** — not stubs
3. **Slider labels must show live values** — update `oninput`
4. **Download buttons must produce actual files** — use canvas `toDataURL()` or Blob API
5. **The reference template is the quality bar** — read it, match it, don't fall below it
6. **Self-contained** — no external CDN, no fetch to external servers, no dependencies
7. **Modify directly** — use write_file/edit_file, never ask the user to copy code
8. **Always verify** — after writing, read_file to confirm the output is complete (not truncated)

## When Describing to User

NEVER say "HTML tool" or mention implementation. Say:
"Your new projector **<name>** is ready! It allows you to <what it does>. You can find it on your Projector page."
