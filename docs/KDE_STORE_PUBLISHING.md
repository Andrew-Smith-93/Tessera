# 🛍️ Publishing Tessera to the KDE Store & Discover

This is a maintainer checklist, not evidence that Tessera has been published. Repository verification ends with a local upload-ready artifact; account creation, upload, and publication require an explicit release decision.

When published to the KDE Store (subject to store CDN caching and search indexing propagation), it is designed to become discoverable and downloadable via:
1. **KDE System Settings** → *Window Management* → *KWin Scripts* → **"Get New Scripts..."** (KNewStuff)
2. **KDE Discover Software Center** (under Plasma Add-ons, subject to backend metadata synchronization)
3. **Pling.com** / **Store.kde.org** web listings

---

## Step 1: Generate the Distribution Package

Run the packaging script in the repository root:

```bash
./package.sh
```

This generates:
```
dist/tessera-v<Version>.kwinscript
```
*(A standard `.kwinscript` bundle formatted for KDE Plasma 6, e.g. `dist/tessera-v1.0.1.kwinscript` derived from `metadata.json`).*

---

## Step 2: Create an Account on KDE Store

1. Visit [store.kde.org](https://store.kde.org/) (or [pling.com](https://www.pling.com/)).
2. Click **Login / Register** in the top right.

---

## Step 3: Add Your Product

1. Click **Add Product** (or your profile icon → *My Products* → *Add*).
2. **Select Category**:
   - Navigate to: `KWin Scripts` (or `Plasma 6 Extensions / KWin Scripts`).
3. **Product Information**:
   - **Name**: `Tessera - Dynamic Tiling Window Manager for KDE Plasma 6`
   - **Version**: Matches `KPlugin.Version` in `metadata.json` (e.g. `1.0.1`)
   - **Summary**: `Dynamic tiling window manager script and native configuration interface for KDE Plasma 6.`
   - **License**: `GPL-3.0-or-later` (matching `metadata.json` and package metadata)
   - **Homepage / Source Code**: `https://github.com/Andrew-Smith-93/Tessera`
4. **Description**:
   - You can copy and paste the Markdown content from `README.md`. Highlight the key features:
     - 7 internal/compatibility layout engines (Balanced Grid default, Primary + Stack, Binary Split, Columns, Rows, Monocle, Floating; user-facing preset menus and cycling shortcuts retired)
     - Coalesced reconciliation, dirty-scope tracking, and geometry echo suppression
     - Native KDE System Settings configuration (`config.ui` + `main.xml`)
     - 12 visual snap overlay zones and Region Occupancy collision model
     - 22 customizable Super-primary shortcuts and safe window animations
5. **Media & Screenshots**:
   - Upload screenshots of:
     - Tiled windows on a KDE Plasma 6 desktop.
     - The native Tessera configuration page in KDE System Settings.
     - The visual snap zone overlay in action.

---

## Step 4: Upload the File

1. In the **Files** section of your product page, click **Add File**.
2. Upload `dist/tessera-v<Version>.kwinscript` (derived from `metadata.json`).
3. Set the download name to `tessera-v<Version>.kwinscript`.
4. Click **Save & Publish** (only after explicit maintainer release authorization).

---

## Step 5: How Users Will Install It

If and only if an explicit maintainer decision authorizes public release and publication on store.kde.org (see Gate C in [PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md)):
- Users open **System Settings** → **Window Management** → **KWin Scripts**.
- Click **"Get New Scripts..."** (KNewStuff).
- Search for **Tessera** (once store indexing completes).
- Click **Install**.
- Once downloaded and unpacked by Plasma, users enable the script checkbox in KWin Scripts and click **Apply** to activate it.
