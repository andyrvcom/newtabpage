# NewTabPage - Chrome New Tab Extension

**A beautiful, fast, and privacy-first new tab page for Chrome.** Organize your browser tabs, AI tools, bookmarks, and projects into clean workspaces — like a personal dashboard every time you open a new tab.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ladnoighalojhajpbbachmcjmfbkileh?label=Chrome%20Web%20Store&logo=googlechrome)](https://chrome.google.com/webstore/detail/ladnoighalojhajpbbachmcjmfbkileh)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)

![NewTabPage Screenshot](demo/screenshot.png)

---

## What is NewTabPage?

NewTabPage replaces Chrome's default new tab page with a fully customizable workspace dashboard. Group your most visited sites, AI tools, and bookmarks by project or context. Add productivity widgets like a world clock, weather, stock prices, and browsing activity charts — all without leaving your new tab.

**Perfect for:** developers, designers, remote workers, AI power users, productivity enthusiasts.

---

## Features

### 🗂 Workspaces & Groups
- Create multiple **folders** (workspaces) — switch between Work, Personal, Research with one click
- Organize sites into **groups** with 3 view modes: **List**, **Icons**, **Cards**
- Drag & drop to reorder groups and sites
- Section titles to organize within groups

### 🧩 Widgets
- **🕐 Clock** — multiple world time zones
- **🌤 Weather** — current conditions with auto location or custom city, °C / °F
- **📈 Stocks** — real-time price chart & ticker (top stocks, crypto, or custom symbols)
- **🎨 Pantone Color** — random color of the day with hex code
- **⬛ Activity** — browsing activity heatmap grid (last 30 or 90 days)
- **🗓 Life in Weeks** — your life visualized in a week grid

### 📊 Analytics
- Page visits & unique pages counter
- Top sites by visit count with favicons
- Activity by day (bar chart) and by hour (heatmap)
- Period filter: Yesterday / 7 days / 30 days

### 🎨 Customization
- **Dark / Light / Auto** theme
- **Custom background image** with adaptive backdrop blur on groups
- **Open in new tab** toggle for all links
- Per-group settings: view type, show/hide URL, show/hide names

### 🌍 Internationalization
- 7 languages: **English, Español, Português (BR), Deutsch, Français, 日本語, 中文 (简体)**
- Auto-detects browser language or manual selection
- Fully localized UI including tooltips, modals, widgets, and toasts

### 🔒 Privacy First
- **No data leaves your browser** — everything stored locally via Chrome Storage & IndexedDB
- No analytics, no tracking, no external accounts
- No server-side processing — all logic runs client-side

---

## Install

### Chrome Web Store
[**→ Install from Chrome Web Store**](https://chrome.google.com/webstore/detail/ladnoighalojhajpbbachmcjmfbkileh)

### Load from Source (Developer Mode)
```bash
git clone https://github.com/malinovskyi/newtabpage.git
```
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `_extension` folder

---

## Project Structure

```
_extension/
├── newtab.html          # Main HTML shell
├── newtab.js            # All app logic (vanilla JS, no framework)
├── styles.css           # All styles
├── favicon-init.js      # Theme detection + adaptive favicon (runs in <head>)
├── inline-init.js       # Icons + i18n initialization
├── background.js        # Service worker (MV3)
├── manifest.json        # Extension manifest
├── icons/               # Extension icons (16, 48, 128px) + favicon.svg
├── _locales/            # i18n translations
│   ├── en/messages.json
│   ├── es/messages.json
│   ├── pt_BR/messages.json
│   ├── de/messages.json
│   ├── fr/messages.json
│   ├── ja/messages.json
│   └── zh_CN/messages.json
└── [vendor]             # sortable.min.js, coloris.min.js, lucide.min.js
```

---

## Tech Stack

| | |
|---|---|
| **Runtime** | Vanilla JS — no framework, no bundler |
| **Extension** | Chrome MV3 |
| **Drag & Drop** | [SortableJS](https://sortablejs.github.io/Sortable/) |
| **Color Picker** | [Coloris](https://github.com/mdbassit/Coloris) |
| **Icons** | [Lucide](https://lucide.dev/) |
| **Storage** | Chrome Storage API + IndexedDB |
| **Chrome APIs** | `storage`, `history`, `tabs`, `bookmarks`, `geolocation` |

---

## Contributing

Pull requests are welcome! For major changes, please open an issue first.

```bash
# Fork & clone
git clone https://github.com/YOUR_USERNAME/newtabpage.git

# Create a branch
git checkout -b feature/my-feature

# Make changes, then open a PR
```

### Adding a new language
1. Create `_extension/_locales/{locale}/messages.json`
2. Copy from `en/messages.json` and translate all `message` values
3. Add locale to `SUPPORTED_LANGS` array in `newtab.js`
4. Add `<option>` to the language `<select>` in `newtab.html`

---

## License

[MIT](LICENSE) © [Andy Malinovskyi](https://x.com/malinovskyi)
