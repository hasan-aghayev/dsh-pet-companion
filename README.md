# Lokki Companion for DSH

A floating pet for DeepSeek Harness. Lokki stays in a separate desktop window while DSH is minimized, follows live agent activity, and can switch between a built-in pet and a growing local pet library.

## What makes it different

- **Quiet activity cues:** Lokki changes its animation while DSH agents are working. It listens only to public agent lifecycle events; no title or status bubble is shown.
- **A pet shelf, not a one-character plugin:** Lokki is included. Add new companions later by placing one pet folder in the local library; there is no plugin rebuild or edit to the plugin source.
- **Two art formats:** animated Hatch-Pet v2 atlases and transparent PNG/WebP portraits. A portrait gets a gentle breathing motion; a v2 atlas uses its native idle and working animation rows.
- **Separate desktop window:** transparent, movable, resizable, and optionally kept above other windows. Under WSLg, a small Windows bridge keeps it above Windows apps and hides the pet from the taskbar without taking focus. DSH can be minimized independently.
- **Companion controls:** hover for Settings, Type a message, and Close. The message composer sends to the most recently active live DSH session through DSH's public agent API; press Enter to send and Shift+Enter for a new line. Choose a pet, language, appearance, size, opacity, reduced motion, and always-on-top behavior in Settings.

The plugin downloads a pinned Electron runtime from the official Electron release host on first start and uses Electron's checksum verification. It is cached under $DSH_HOME/cache/lokki-companion; the package has no install-time build script. A graphical session is required. WSL2 should have WSLg enabled.

## Install

```sh
dsh plugin --profile web add github:hasan-aghayev/dsh-lokki-companion
```

The first start downloads the desktop runtime. After it finishes, Lokki opens in a separate window. Remove the bundle with:

```sh
dsh plugin --profile web remove dsh-lokki-companion
```

Change web to the DSH profile you use. Removing the plugin keeps your pet library and settings under $DSH_HOME/lokki-companion, so they are available if you install it again. To remove your personal data too, delete that directory yourself. DSH's plugin manager can disable the bundle without removing it.

## Settings

Hover the pet and choose the gear icon, or double-click the pet, to open settings. English is the default language; Simplified Chinese is also available. Choose Light, Dark, or System appearance to match the DSH theme options. The settings window uses a small local subset of DSH ui-theme tokens because it runs in its own desktop window. Settings include pet selection, size, opacity, always-on-top, reduced motion, opening the pet folder, and rescanning the library.

You can also disable the companion in DSH configuration:

```yaml
- id: lokki-companion
  config:
    enabled: false
```

## Add another pet

Open the library from settings. Create a folder whose name matches its pet id, then place pet.json and the image inside. The plugin checks the folder every few seconds and notices new pets without a restart; the Refresh button rescans immediately.

### Animated atlas

Use a Hatch-Pet v2 atlas, exactly 1536×2288 pixels (8 columns × 11 rows), plus a manifest:

```json
{
  "id": "miso",
  "displayName": "Miso",
  "description": "A small lunar cat.",
  "descriptionZh": "一只小小的月亮猫。",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

Folder: .../lokki-companion/pets/miso/. The atlas follows the standard Hatch-Pet v2 rows: row 0 is idle and row 7 is working.

### Portrait

A single transparent PNG/WebP needs no animation atlas:

```json
{
  "id": "miso-portrait",
  "displayName": "Miso",
  "description": "A portrait with gentle motion.",
  "descriptionZh": "一张带有轻柔动态效果的肖像。",
  "format": "portrait",
  "imagePath": "portrait.png"
}
```

Use the optional descriptionZh field to localize a pet description for Simplified Chinese. Each pet folder is validated before display. Names use lowercase letters, digits, and hyphens; image paths must remain inside that pet's folder; PNG/WebP files must be under 25 MB. The built-in lokki id is reserved.

## Data and privacy

Pet art, settings, window position, and session IDs stay on the local machine. Lokki observes only DSH agent lifecycle status and never reads conversation history, files, or credentials. Text entered in the companion is sent only to the most recently active live DSH session, through DSH's public agent API, and then follows that session's configured provider route. The plugin downloads Electron once from the official release host; it makes no other network requests itself.

## Development

```sh
pnpm install
pnpm check
```

The package contains ready-to-run JavaScript and static desktop files. GitHub installation therefore needs no prepare script or build-script approval. The root package declares dsh.bundle and cordis.patch.yml.

## License

MIT. The Lokki sprite art is included with permission from its creator, Hasan Aghayev; do not redistribute the artwork separately from this plugin without permission.
