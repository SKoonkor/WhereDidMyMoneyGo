# Download & run — step-by-step guide

This guide is for anyone who just wants to **use** Money Tracker without installing Python or
touching a terminal. You download one file for your operating system, open it, and the app runs in
your web browser. (Developers who want to run from source should follow the
[main README](../README.md#install--run) instead.)

Everything runs **on your own computer** — no account, no sign-up, no cloud. Your data stays in a
folder on your machine (see [Where your data lives](#4-where-your-data-lives)).

---

## 1. Download the file for your OS

Go to the [**Releases**](https://github.com/SKoonkor/WhereDidMyMoneyGo/releases) page and, under the
latest release's **Assets**, download the one file that matches your system:

| Your system | Download this file |
|---|---|
| **macOS** (Apple Silicon or Intel Mac) | `MoneyTracker-macOS.dmg` |
| **Windows** 10 / 11 | `MoneyTracker-Windows.exe` |
| **Linux** (most desktops) | `MoneyTracker-Linux.AppImage` |

> **Heads-up:** these builds are **not code-signed yet**, so the first time you open the app your OS
> will show a "this is from an unidentified developer" warning. That's expected — the steps below
> show exactly how to get past it. (Signing/notarization is planned for a future release.)

---

## 2. Install and open it (first launch)

### 🍎 macOS

1. Double-click the downloaded **`MoneyTracker-macOS.dmg`**. A window opens showing the
   **Money Tracker** icon next to an **Applications** folder.
2. **Drag** the Money Tracker icon **onto the Applications folder**. This installs it.
3. Open **Applications** (Finder → Go → Applications), then **right-click** (or Control-click)
   **Money Tracker** and choose **Open**.
4. A dialog says *"macOS cannot verify the developer…"*. Click **Open** to confirm. You only have
   to do this **once** — after that you can open it normally.

   - **On newer macOS** (Sonoma / Sequoia) the right-click option may be blocked. If so, try to
     open the app once (it will be refused), then go to  **System Settings → Privacy & Security**,
     scroll down, and click **Open Anyway** next to the Money Tracker message. Confirm with
     **Open**.

### 🪟 Windows

1. Double-click the downloaded **`MoneyTracker-Windows.exe`**.
2. Windows **SmartScreen** may show *"Windows protected your PC"*. Click **More info**, then
   **Run anyway**. (This appears only until the app becomes widely recognized.)
3. Your antivirus might scan it briefly on first run — that's normal for a new, unsigned program.

### 🐧 Linux

1. Make the downloaded file executable — either right-click → **Properties → Permissions → Allow
   executing file as program**, or in a terminal:
   ```bash
   chmod +x MoneyTracker-Linux.AppImage
   ```
2. Double-click it, or run `./MoneyTracker-Linux.AppImage`.
3. If it doesn't start, your system may be missing **FUSE**. Either install it
   (`sudo apt install libfuse2` on Debian/Ubuntu) or run without it:
   ```bash
   ./MoneyTracker-Linux.AppImage --appimage-extract-and-run
   ```

---

## 3. What happens when it launches

- Your **default web browser opens automatically** at <http://127.0.0.1:8050> with the app loaded.
  (If port 8050 is already used by something else, the app quietly picks another free port and
  opens the browser at the right address for you.)
- A small **Money Tracker icon appears in your system tray / menu bar** (top-right menu bar on
  macOS, the notification area on Windows, the tray on Linux). Click it for a menu:
  - **Open Money Tracker** — reopens the app in your browser (use this any time).
  - **Quit** — stops the app completely.

**Closing the browser tab does _not_ stop the app** — it keeps running quietly behind the tray
icon, so you can reopen it instantly. When you're truly done, click the tray icon and choose
**Quit**.

The very first launch starts with **no transactions** — head to the **Transactions** page and add
your first one.

---

## 4. Where your data lives

The app keeps all your settings and records in a per-user folder on your computer:

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/MoneyTracker` |
| Windows | `%APPDATA%\MoneyTracker` (e.g. `C:\Users\<you>\AppData\Roaming\MoneyTracker`) |
| Linux | `~/.local/share/money-tracker` |

Inside you'll find:
- `config/` — your accounts, categories, and settings.
- `data/raw/ledger.db` — your transactions (a single SQLite file).
- `data/backups/` — automatic timestamped backups.

Back up your records any time by copying this folder. It survives app updates.

---

## 5. Moving in from another app (Realbyte Money Manager, or an older version)

If you have an exported `transactions.xlsx` (for example from Realbyte Money Manager):

1. Launch the app **once** so it creates the data folder above, then **Quit** it.
2. Copy your `transactions.xlsx` into that folder's **`data/raw/`** subfolder.
3. Launch the app again. If no `ledger.db` exists yet, it converts the spreadsheet automatically on
   startup and archives the original to `data/backups/transactions_legacy_<timestamp>.xlsx`.

> An existing ledger is never overwritten — to re-import, remove `ledger.db` first.

---

## 6. Updating to a newer version

1. Download the newer file from the [Releases](https://github.com/SKoonkor/WhereDidMyMoneyGo/releases)
   page.
2. **macOS:** drag the new app into Applications, replacing the old one. **Windows:** just run the
   new `.exe` (delete the old one if you keep it elsewhere). **Linux:** replace the old
   `.AppImage`.

Your data folder is separate, so **all your records carry over** automatically.

---

## 7. Uninstalling

- **Remove the app:** delete it from **Applications** (macOS), delete the `.exe` (Windows), or
  delete the `.AppImage` (Linux).
- **Remove your data too (optional):** delete the data folder listed in
  [section 4](#4-where-your-data-lives). ⚠️ This permanently deletes your transactions — copy it
  first if you might want it later.

---

## 8. Troubleshooting

**The browser didn't open.**
Click the tray / menu-bar icon → **Open Money Tracker**. Or open your browser and visit
<http://127.0.0.1:8050> manually.

**"Port already in use" / a different address.**
The app automatically switches to another free port if 8050 is taken, and opens the browser at the
correct one — always use the **Open Money Tracker** tray menu to get the right link.

**macOS says the app "is damaged and can't be opened."**
This is Gatekeeper being strict with an unsigned download. Re-do the **right-click → Open** step, or
use **System Settings → Privacy & Security → Open Anyway**. If it persists, you can clear the
quarantine flag in Terminal: `xattr -dr com.apple.quarantine "/Applications/Money Tracker.app"`.

**Nothing seems to happen after I open it.**
Look for the **Money Tracker icon in your menu bar / system tray** — the app may already be running
there. Click it → **Open Money Tracker**.

**How do I fully quit?**
Click the tray / menu-bar icon → **Quit**. (Closing the browser tab alone leaves it running.)

---

Questions or problems? Open an issue on the
[GitHub repository](https://github.com/SKoonkor/WhereDidMyMoneyGo/issues).
