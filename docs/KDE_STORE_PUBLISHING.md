# 🛍️ Publishing Tessera to the KDE Store & Discover

The **KDE Store** (powered by the Open Collaboration Services / Pling / OCS network) is the official "App Store" built into every KDE Plasma desktop in the world.

When you upload Tessera to the KDE Store, it immediately becomes searchable and downloadable via:
1. **KDE System Settings** → *Window Management* → *KWin Scripts* → **"Get New Scripts..."**
2. **KDE Discover Software Center** (under Plasma Add-ons)
3. **Pling.com** / **Store.kde.org**

---

## Step 1: Generate the Distribution Package

Run the packaging script in the repository root:

```bash
./package.sh
```

This generates:
```
dist/tessera-v1.0.1.kwinscript
```
*(A standard `.kwinscript` bundle formatted for KDE Plasma 6).*

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
   - **Name**: `Tessera - Dynamic Tiling Window Manager (Plasma 6 & NVIDIA)`
   - **Version**: `1.0.1` (or your current tag)
   - **Summary**: `Modern, GPU-optimized dynamic tiling window manager for KDE Plasma 6 with an intuitive visual configuration control center.`
   - **License**: `GPL-3.0`
   - **Homepage / Source Code**: `https://github.com/<your-username>/tessera`
4. **Description**:
   - You can copy and paste the Markdown content from `README.md`. Highlight the key features:
     - 6 dynamic layouts (Master-Stack, BSP/Dwindle, Columns, Rows, Monocle, Floating)
     - NVIDIA GPU stutter-free debouncing
     - Dedicated Control Center with live gap canvas preview
     - 1-click active window rule capture
5. **Media & Screenshots**:
   - Upload screenshots of:
     - The live preview canvas and gap sliders from Tessera Control Center.
     - Tiled windows on a KDE desktop.
     - The vector icon (`desktop/tessera.svg`).

---

## Step 4: Upload the File

1. In the **Files** section of your product page, click **Add File**.
2. Upload `dist/tessera-v1.0.1.kwinscript`.
3. Set the download name to `tessera-v1.0.1.kwinscript`.
4. Click **Save & Publish**.

---

## Step 5: How Users Will Install It

Once published on store.kde.org:
- Users open **System Settings** → **Window Management** → **KWin Scripts**.
- Click **"Get New Scripts..."**.
- Search for **Tessera**.
- Click **Install**.
- KDE Plasma downloads and activates it automatically!
