# ADR 003: Unified Launcher-First Architecture and Hybrid Distribution Strategy

**Status:** Accepted  
**Date:** 2026-03-27  
**Context:**  
The application must support both power users (who prefer portable software) and casual users (who expect a standard Windows installation experience). Traditional self-updating apps often fail due to file locks or corruption. We need a robust, script-free solution that works identically for both ZIP and Installer distributions.

## 1. Decision: "Launcher-First" Hybrid Model

We will implement a **Launcher/App separation** within a single Cargo Workspace. The distribution will follow the "Telegram Desktop" model: a single executable that acts as a portable-friendly installer/launcher.

## 2. Technical Architecture

### 2.1. Component Separation

- **Launcher.exe (The Foundation):** A lightweight Rust binary (no Tauri/GUI) responsible for checking updates via GitHub API, downloading assets, and verifying integrity.
- **App.exe (The Payload):** The main Tauri v2 application located in a relative subdirectory (e.g., `bin/app.exe`).

### 2.2. Distribution Formats

1.  **Portable ZIP:** A simple archive containing `Launcher.exe` and the `bin/` folder.
2.  **Smart Installer (Single EXE):** A lightweight wrapper (using Inno Setup) that mimics a standard installation but maintains the portable file structure in `%LocalAppData%`.

## 3. Update Workflow (The "Zero-Script" Method)

### 3.1. Main App Update

1. User starts the app via `Launcher.exe`.
2. Launcher checks for updates. Since `bin/app.exe` is not yet running, it is not locked.
3. Launcher downloads the new binary and performs a native `std::fs::rename` to replace the old version.
4. Launcher spawns the updated `app.exe`.

### 3.2. Launcher Self-Update (Dual-Binary Swap)

1. If `Launcher.exe` needs an update, it downloads `Launcher_new.exe`.
2. `Launcher.exe` spawns `Launcher_new.exe` and exits.
3. `Launcher_new.exe` detects its name, waits 1s, copies itself over the original `Launcher.exe`, and restarts the original process.

## 4. GitHub Actions CI/CD Workflow

The automation pipeline will handle the entire packaging process:

1.  **Build Phase:** Compiles both the `Launcher` and the `Main App` targets.
2.  **Packaging Phase:**
    - Creates the Portable ZIP.
    - Runs **Inno Setup (ISCC)** to wrap the binaries into a `Setup.exe`.
3.  **Release Phase:** Uploads both artifacts to GitHub Releases.

## 5. Consequences

### Pros:

- **Reliability:** Updates happen _before_ the main app locks resources.
- **Seamless UX:** Casual users get a familiar installer with Desktop/Start Menu shortcuts.
- **Portable Core:** The "installed" app is just a folder in `AppData`; it can be moved to a USB drive and remain fully functional.
- **No Admin Rights:** By targeting `%LocalAppData%` (PrivilegesRequired=lowest), the app can update itself without UAC prompts.

### Cons:

- **Two Binaries:** Adds a few megabytes of overhead for the secondary Rust binary.
- **Heuristics:** Spawning processes to replace files might require Code Signing to avoid Antivirus warnings.

## 6. Security & Integrity

- **SHA-256 Validation:** The Launcher will verify the hash of the downloaded `app.exe` before replacement to ensure it wasn't corrupted during transit.
- **HTTPS Only:** All communications with GitHub API/CDN must use TLS.
