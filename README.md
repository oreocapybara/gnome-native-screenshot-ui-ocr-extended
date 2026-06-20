# Native Screenshot UI OCR Extended

![alt text](demo.gif)

A GNOME Shell extension that adds OCR (text extraction) to GNOME's native
screenshot picker. Select an area of the screen, and the recognized text
is copied straight to your clipboard — no separate screenshot tool, no
saved image left behind.

## Features

- **Three ways to trigger it:**
  - A panel icon in the top bar.
  - A global keyboard shortcut (`Super+Shift+O` by default, rebindable).
  - An "Extract Text" button added directly into GNOME's native `PrtSc`
    screenshot overlay, alongside Screen/Window/Selection.
- While an OCR capture is active, Screen capture, Window capture, the
  screencast toggle, and the cursor-visibility toggle are disabled (cursor
  is always excluded from OCR captures) — only area selection makes sense
  for OCR, so that's all that's enabled.
- No screenshot file is left behind: the capture is written to a
  temporary file purely for OCR, then deleted. Nothing is saved to
  `~/Pictures/Screenshots`, and your clipboard isn't overwritten with the
  captured image — only the recognized text.
- A notification shows a snippet of the extracted text after each
  capture (toggleable).
- Preferences let you independently turn off the panel icon and/or the
  notification banner.

## Requirements

- GNOME Shell 45–50.
- [`tesseract`](https://github.com/tesseract-ocr/tesseract) must be
  installed separately — it is **not** bundled with the extension (GNOME
  extensions can't ship compiled binaries). Install it via your distro's
  package manager, e.g.:

  ```sh
  sudo dnf install tesseract        # Fedora
  sudo apt install tesseract-ocr    # Debian/Ubuntu
  ```

  If tesseract isn't found, the extension will tell you via a
  notification rather than failing silently.

## Installation

1. Clone or download this repository into
   `~/.local/share/gnome-shell/extensions/ocr-to-clipboard@oreocapybara`.
2. Compile the settings schema:

   ```sh
   glib-compile-schemas schemas/
   ```

3. Enable the extension:

   ```sh
   gnome-extensions enable ocr-to-clipboard@oreocapybara
   ```

4. Log out and back in (GNOME Shell needs a full session restart to load
   extension code — disabling/re-enabling alone won't pick up changes).

## Usage

Click the panel icon, press `Super+Shift+O`, or press `PrtSc` and click
the "Extract Text" button in the overlay. Drag to select an area; the
extracted text is copied to your clipboard and a notification shows a
preview.

## Preferences

Open via the GNOME Extensions app (gear icon next to this extension) or
`gnome-extensions prefs ocr-to-clipboard@oreocapybara`:

- **Show Panel Icon** — show/hide the top bar icon.
- **Show Notifications** — enable/disable the post-capture notification.

## License

GPL-2.0-or-later.
