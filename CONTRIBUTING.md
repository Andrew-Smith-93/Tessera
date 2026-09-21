# Contributing to Tessera

Thank you for your interest in improving Tessera! We welcome bug reports, layout algorithms, performance optimizations, and feature pull requests.

---

## 🛠️ Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Andrew-Smith-93/tiling-window-manager.git
   cd tiling-window-manager
   ```

2. **Run tests**:
   ```bash
   python3 tests/test_layouts.py
   ```

3. **Build the release package**:
   ```bash
   ./package.sh
   ```

---

## 📐 Adding New Layouts

All layout geometry functions are pure mathematical routines located in:
[`contents/code/layouts.js`](contents/code/layouts.js).

To contribute a new layout:
1. Define your calculation function in `contents/code/layouts.js` taking `(area, count, options)` and returning an array of `{ x, y, width, height }`.
2. Add your layout name to `supportedLayouts`.
3. Register the layout in `tessera-control/ui_preview.py` to support real-time canvas previewing in the Control Center.

---

## 🚀 Submitting Pull Requests

1. Create a descriptive feature branch:
   ```bash
   git checkout -b feat/my-new-layout
   ```
2. Commit your changes with concise, conventional commit messages.
3. Push to your fork and open a Pull Request against `main`.
4. Ensure all CI checks pass.
