# Technical Specification: XBOCT Chat - Multplatform Chat Aggregator for Streamers

**Version:** 1.0  
**Based on:** ADR 001  
**Status:** Draft for Review  
**Target:** MVP Implementation

---

## 1. Technology Stack

### 1.1 Backend Framework

**Decision:** Axum  
**Rationale:**

- Built on Tokio, excellent async support
- Lightweight, modular design
- Good WebSocket support via `tower-websockets`
- Actix has heavier runtime and more complex API

### 1.2 WebSocket Library

**Decision:** `tower-websockets` (integrated with Axum)  
**Rationale:**

- Native integration with Axum/Tower ecosystem
- Supports both client and server
- Composable with other tower services

### 1.3 OAuth 2.0 Crate

**Decision:** `oauth2` crate  
**Rationale:**

- Mature, well-maintained
- Supports multiple flows including Authorization Code
- Good documentation and examples

### 1.4 HTML Sanitization

**Decision:** `ammonia` crate  
**Rationale:**

- Rust's primary HTML sanitization library
- Based on Mozilla's bleach sanitizer
- Configurable whitelist of tags/attributes
- Actively maintained

---

## 2. Core Data Structures

### 2.1 UnifiedChatMessage

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedChatMessage {
    pub id: String,                    // UUID v4
    pub platform: ChatPlatform,        // Twitch, YouTube, etc.
    pub author: String,                // Display name
    pub author_id: String,             // Platform-specific user ID
    pub author_avatar: Option<Url>,    // Avatar URL (optional)
    pub content: Vec<ContentToken>,    // Array of text + emotes
    pub metadata: MessageMetadata,     // Moderator, subscriber, badges
    pub timestamp: DateTime<Utc>,      // Message time
    pub raw: Option<serde_json::Value>, // Original platform data (debug)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ContentToken {
    Text { text: String },
    Emote {
        id: String,           // Emote ID (platform-specific)
        name: String,         // Emote name/code
        url: Url,             // Direct image URL
        provider: EmoteProvider, // 7TV, BTTV, FFZ, or platform-native
    },
    Link {
        url: Url,
        text: Option<String>, // Display text if different from URL
    },
    Mention {
        user_id: String,
        name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageMetadata {
    pub is_moderator: bool,
    pub is_subscriber: bool,
    pub is_vip: bool,
    pub is_broadcaster: bool,
    pub badges: Vec<Badge>,    // Platform-specific badges
    pub color: Option<String>, // Author's chat color (hex)
    pub first_message: bool,   // First message indicator
    pub returning_chatter: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Badge {
    pub id: String,
    pub name: String,
    pub url: Option<Url>,
    pub version: Option<String>,
}
```

### 2.2 ChatPlatform Enum

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ChatPlatform {
    Twitch,
    YouTube,
    // Future: Kick, Facebook, etc.
}

impl ChatPlatform {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Twitch => "twitch",
            Self::YouTube => "youtube",
        }
    }
}
```

### 2.3 EmoteProvider Enum

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EmoteProvider {
    Platform,  // Native platform emotes (Twitch, YT)
    SevenTV,
    BTTV,
    FFZ,
}
```

---

## 3. WebSocket Message Format

### 3.1 Server → Client (OBS Overlay)

```json
{
  "type": "message|backlog_start|backlog_end|heartbeat|error",
  "timestamp": "2025-01-15T10:30:00Z",
  "data": {
    // For type="message":
    "message": { /* UnifiedChatMessage object */ }

    // For type="backlog_start":
    "count": 50,
    "platform": "twitch"

    // For type="heartbeat":
    "seq": 12345

    // For type="error":
    "code": "CONNECTOR_FAILED",
    "message": "Twitch connector crashed",
    "platform": "twitch"
  }
}
```

### 3.2 Client → Server (Read-only)

Any message from client results in immediate connection closure.

---

## 4. OAuth 2.0 Implementation

### 4.1 Local OAuth Server

**Port:** 17601 (configurable)  
**Binding:** 127.0.0.1 only (security)  
**Purpose:** Intercept OAuth redirects from browser

**Flow:**

1. User clicks "Connect Twitch" in Tauri UI
2. Frontend opens system browser to Twitch OAuth URL with redirect_uri=http://localhost:17601/callback
3. Local HTTP server (Axum) receives callback with authorization code
4. Server exchanges code for access token and refresh token
5. Tokens stored securely (see section 4.2)
6. Frontend notified via Tauri event that auth succeeded

**Multi-platform handling:**

- Each platform gets its own OAuth endpoint: `/oauth/{platform}/callback`
- State parameter includes platform identifier and CSRF token
- Concurrent OAuth flows supported (user can connect multiple platforms simultaneously)

### 4.2 Token Storage

**Method:** OS-specific secure storage via `keyring` crate  
**Rationale:**

- Windows: Credential Manager
- macOS: Keychain
- Linux: libsecret/gnome-keyring

**Storage keys:**

- `xboct-chat:twitch:access_token`
- `xboct-chat:twitch:refresh_token`
- `xboct-chat:youtube:access_token`
- etc.

**Fallback:** If keyring unavailable, encrypted file in app data directory (AES-256-GCM with key derived from machine-specific secret).

### 4.3 Token Refresh Strategy

**Automatic refresh:**

- Check token expiry 5 minutes before expiration
- Use refresh token to obtain new access token
- Update stored tokens atomically
- If refresh fails (401/invalid_grant), mark connector as disconnected and notify user

**Manual re-auth:** User can re-initiate OAuth flow if refresh fails.

---

## 5. Theme System

### 5.1 Themes Directory

**Portable mode (default):**

- Themes directory is relative to the application executable: `./themes/`
- This allows the app to be run from a USB drive or any location without installation
- The directory is created automatically if it doesn't exist

**Configurable path:**

- Users can override the themes directory via configuration setting `theme.path`
- Accepts absolute paths or relative paths (relative to executable)
- Example: `theme.path = "D:/MyThemes"` or `theme.path = "../shared-themes"`

**Server static file serving:**
URL pattern: `/themes/{theme_name}/{file_path}`
Physical path: `{themes_dir}/{theme_name}/{file_path}`

**Bundled themes:**

- Default themes can be bundled inside the Tauri app (in `src-tauri/src/themes/`)
- These are copied to the portable `./themes/` directory on first run
- Users can add custom themes by placing them in the themes directory

### 5.2 Template Syntax

**Layout file:** `layout.html` in theme root

**Placeholders (simple tag-style):**

- `{author}` - Author display name (HTML-escaped)
- `{content}` - Rendered content with emotes (already sanitized HTML)
- `{timestamp}` - Formatted time (configurable format)
- `{platform}` - Platform name (twitch, youtube)
- `{color}` - Author's chat color (hex)
- `{id}` - Message UUID
- `{author_avatar}` - Author avatar URL (if available)

**No conditionals or logic:** All template logic should be handled via CSS classes. The server provides all necessary data fields, and the theme uses CSS to style based on classes applied to the message container.

**Message container classes (automatically added by server):**

The server wraps each rendered message in a container with these CSS classes based on metadata:

- `message`
- `platform-twitch` / `platform-youtube`
- `moderator` (if is_moderator)
- `subscriber` (if is_subscriber)
- `vip` (if is_vip)
- `broadcaster` (if is_broadcaster)
- `first-message` (if first_message)
- `returning-chatter` (if returning_chatter)

**Example template:**

```html
<div class="message" style="color: {color}">
	<img class="avatar" src="{author_avatar}" alt="" />
	<span class="author">{author}</span>
	<span class="content">{content}</span>
	<span class="time">{timestamp}</span>
</div>
```

**CSS example for subscriber styling:**

```css
.message.subscriber {
	border-left: 3px solid #a970ff;
}
```

**Note:** All placeholders are replaced with plain strings. The `{content}` field contains pre-sanitized HTML (emotes as `<img>` tags) and is rendered in Svelte using {@html content}. No triple braces needed - the template engine just does string substitution.

### 5.3 CSS/JS Asset Serving

**Path resolution:**

- Relative URLs in theme CSS/JS: `./emotes/pepe.png` → `/themes/my-theme/emotes/pepe.png`
- Absolute URLs: `https://...` (external resources allowed)
- Theme can include `theme.json` for metadata (name, version, author, supported platforms)

**Hot-reload (development):**

- File watcher on themes directory
- On change, broadcast `theme_reload` event to connected clients
- OBS overlay fetches updated layout.html automatically

### 5.4 XSS Sanitization

**Library:** `ammonia`  
**Allowed tags:**

- `a[href]`, `img[src|alt|width|height]`, `span`, `div`, `b`, `i`, `strong`, `em`, `p`, `br`
- `svg` only from trusted emote providers (7TV, BTTV, Twitch, YouTube CDNs)

**Allowed attributes:**

- `class`, `id`, `style` (limited, sanitized separately)
- `src`, `href`, `alt`, `title`, `width`, `height`
- `data-*` attributes for custom theming

**Sanitization pipeline:**

1. Platform data → UnifiedChatMessage (Rust)
2. Content tokens assembled into HTML string (emotes as `<img>` tags)
3. Sanitize with ammonia (whitelist mode)
4. Inject into template via `{@html}` in Svelte
5. **Note:** Template itself is trusted (user-created theme), but message content is sanitized

### 5.5 Theme Validation

**Required files:**

- `layout.html` (must exist)
- Optional: `theme.json` (metadata)
- Optional: `styles.css`, `script.js`, assets folder

**Validation rules:**

- `layout.html` must contain at least one of the required placeholders
- No absolute file paths (only relative to theme root)
- Max theme size: 10 MB (configurable)
- No executable code in theme (JS allowed but sandboxed in iframe? TBD)

**Theme loading:**

- Server scans themes directory on startup
- Invalid themes logged but not loaded
- User selects active theme via config

---

## 6. Plugin System

### 6.1 Plugin Discovery

**Directory:** `{app_data}/plugins/`  
**Scanning:** On startup, recursively scan for `plugin.toml` manifest files

**Plugin manifest (`plugin.toml`):**

```toml
name = "my-plugin"
version = "1.0.0"
author = "Streamer"
description = "Adds custom filters"
entrypoint = "lib.so"  # or .dll/.dylib

[hooks]
pre_send = "filter_messages"
post_auth = "log_auth"
```

### 6.2 Plugin API

**Rust dynamic library interface:**

```rust
#[no_mangle]
pub extern "C" fn plugin_init() -> PluginHandle {
    // Return struct with function pointers
}

#[no_mangle]
pub extern "C" fn plugin_name() -> *const c_char;

#[no_mangle]
pub extern "C" fn plugin_hook_pre_send(
    messages: &mut Vec<UnifiedChatMessage>,
    context: &PluginContext,
) -> Result<(), PluginError>;

#[no_mangle]
pub extern "C" fn plugin_hook_post_auth(
    platform: ChatPlatform,
    user_info: &UserInfo,
    context: &PluginContext,
) -> Result<(), PluginError>;
```

**Hook points:**

- `pre_send`: Modify/filter messages before WebSocket broadcast
- `post_auth`: Called after OAuth success, can enrich user context
- `on_connect`: When OBS client connects
- `on_disconnect`: When OBS client disconnects

### 6.3 Error Handling

**Plugin isolation:**

- Each plugin loaded in separate module (dynamic lib)
- Panic in plugin must not crash main server
- Timeout for plugin hooks (100ms default)

**Error reporting:**

- Plugin errors logged to file with plugin name
- Option to disable faulty plugin automatically after 3 errors
- UI notification for user (Tauri frontend)

### 6.4 Dynamic Loading/Unloading

**Loading:** On startup or via admin command (hot-reload)  
**Unloading:** Graceful - wait for current hook execution to complete, then unload lib

**State:** Plugins maintain internal state between hooks (thread-safe with `Arc<Mutex<>>`)

---

## 7. Configuration Management

### 7.1 Storage Method

**Primary:** Tauri's built-in store (`tauri-plugin-store`)
**Backup:** JSON file in app data directory (`config.json`)
**Rationale:** Tauri store provides simple key-value API with automatic persistence

**OAuth tokens:** Stored in the same config store (plain text). Since the app runs entirely on the user's machine and the config file is already accessible by the user, additional encryption provides no real security benefit. Simplicity over unnecessary security theater.

### 7.2 User-Configurable Settings

**Server settings:**

- `server.host` (default: "127.0.0.1")
- `server.port` (default: 3000) - HTTP port for OBS overlay and API
- `server.backlog_size` (default: 50, range: 10-200)

**Note:** WebSocket is served on the same HTTP port via upgrade mechanism (path `/ws`). OAuth callbacks are handled by the same server on path `/oauth/{platform}/callback`. No separate ports needed.

**Theme settings:**

- `theme.active` (theme name)
- `theme.hot_reload` (bool, default: false for prod, true for dev)

**Connector settings:**

- `connectors.enabled` (list of platforms)
- `connectors.twitch.auto_reconnect` (bool, default: true)
- `connectors.twitch.retry_interval_sec` (default: 5)
- `connectors.youtube.auto_reconnect` (bool, default: true)

**Logging:**

- `logging.level` (trace/debug/info/warn/error, default: info)
- `logging.file` (path to log file, default: app_data/logs/app.log)
- `logging.max_size_mb` (default: 10)
- `logging.rotation_count` (default: 5)

**Plugins:**

- `plugins.enabled` (list of plugin names)
- `plugins.auto_reload` (bool, default: false)

### 7.3 Configuration UI

**Implementation:** Tauri frontend (Svelte) with settings page  
**Features:**

- Form-based editing with validation
- Live preview of changes (where possible)
- Export/import config as JSON
- Reset to defaults

---

## 8. Logging Strategy

### 8.1 Logging Library

**Decision:** `tracing` + `tracing-subscriber`  
**Rationale:**

- Modern, structured logging
- Multiple output targets (stdout, file, journald)
- Levels: trace, debug, info, warn, error

### 8.2 Log File Location

**Base directory:** OS-specific app data  
**Path:** `{app_data}/logs/app-{date}.log`  
**Rotation:** Daily + size-based (max 10 MB per file, keep 5 files)

**Log format:** JSON lines for easy parsing  
**Example:**

```json
{
	"timestamp": "2025-01-15T10:30:00Z",
	"level": "INFO",
	"target": "xboct_chat::connector::twitch",
	"message": "Connected to Twitch IRC",
	"connector": "twitch"
}
```

### 8.3 Verbosity Levels

- **trace:** Every internal event, message bytes
- **debug:** Connector state changes, OAuth flow steps
- **info:** Normal operations (connect/disconnect, errors)
- **warn:** Recoverable errors (retry, fallback)
- **error:** Fatal errors, crashes

Default: `info`

---

## 9. Error Handling & Reporting

### 9.1 Connector Failure Retry Policy

**Exponential backoff:**

- Initial delay: 5 seconds
- Max delay: 300 seconds (5 minutes)
- Reset after 1 hour of successful operation

**Retry conditions:**

- Network errors (timeout, connection refused)
- Rate limit (429) - respect Retry-After header
- Temporary server errors (5xx)

**No retry:**

- Authentication errors (401, 403) - require user re-auth
- Invalid configuration - notify user

### 9.2 User Error Reporting

**UI notifications (Tauri frontend):**

- Toast notifications for critical events
- Status bar showing connection state per platform
- Detailed error log viewer

**Log accessibility:**

- "Open Log Folder" button in settings
- Log tailing in dev mode (live view)

---

## 10. Testing Strategy

### 10.1 Connector Testing

**Mock servers:**

- Twitch IRC mock server (simulate messages, disconnects, rate limits)
- YouTube mock API (simulate chat events)
- OAuth mock server (simulate auth flow)

**Test scenarios:**

- Normal message flow
- High message rate (100 msg/sec)
- Connector crash and recovery
- Network partitions
- Malformed data handling

### 10.2 Integration Tests

**Full flow tests:**

1. OAuth → token storage → connector start → message receipt → WebSocket broadcast
2. Multiple connectors simultaneous
3. OBS client connect/disconnect
4. Theme switching
5. Plugin loading and hook execution

**Test environment:**

- Use `tokio-test` for async testing
- Spin up real Axum server in tests
- Use WebSocket client to verify messages

---

## 11. Performance & Scalability

### 11.1 Expected Load

**MVP targets:**

- 1-3 platforms simultaneously
- 10-50 messages per second (typical stream)
- Burst up to 200 msg/sec (hype moments)
- 1-5 OBS clients connected (single streamer, maybe mod dashboard)

**Memory footprint:**

- Backlog: 50 messages × ~1KB = 50 KB
- Per-connector state: ~10 MB
- Total target: <100 MB RAM

### 11.2 Backlog Mechanism

**Implementation:**

- Circular buffer of `UnifiedChatMessage` (capacity = config.backlog_size)
- New messages push, old ones drop
- On client connect, send entire backlog immediately (as separate messages)
- Then stream live messages

**Ordering:** By timestamp (server time upon receipt)

**Transmission:** Send backlog messages with `type="backlog_start"` then individual messages, then `type="backlog_end"` to signal end.

### 11.3 Backpressure Handling

**Scenario:** OBS client can't keep up (slow network, high latency)

**Strategy:**

- WebSocket send queue per client (bounded, e.g., 1000 messages)
- If queue full, drop oldest non-critical messages (keep latest)
- Log warning if backpressure occurs
- No blocking on broadcast (fire-and-forget with bounded queue)

**Metrics:** Track queue depth, dropped messages count (exposed via status API)

---

## 12. Platform Support (MVP)

### 12.1 Selected Platforms

**Phase 1 (MVP):**

1. **Twitch** - Primary platform, IRC via `twitch-irc` crate or custom
2. **YouTube** - Via YouTube Live Chat API (requires Google OAuth)

**Phase 2 (post-MVP):** 3. Kick 4. Facebook Gaming 5. Custom (webhook-based)

### 12.2 Twitch Requirements

**Auth:** OAuth 2.0 with `chat:read` scope  
**API:** IRC over websockets (wss://irc-ws.chat.twitch.tv:443)  
**Rate limits:** 20 messages/sec per connection, 100 connections per IP (we use 1)  
**Features:**

- Message parsing (PRIVMSG, USERNOTICE, etc.)
- Emotes: 7TV, BTTV, FFZ (fetch via their APIs)
- Badges: Global and channel badges
- Bits, subs, raids, predictions

**Implementation notes:**

- Use `twitch-irc` crate or custom tokio-tungstenite client
- Handle CAP REQ for commands/membership/state
- Parse IRC tags for metadata

### 12.3 YouTube Requirements

**Auth:** OAuth 2.0 with `https://www.googleapis.com/auth/youtube.readonly`  
**API:** YouTube Live Chat API (REST polling or push via PubSub?)  
**Rate limits:** 10,000 units/day, chat messages ~1 unit each  
**Features:**

- Chat messages, super chat, super stickers
- Member-only mode
- Emotes: YouTube native only (no third-party)

**Implementation notes:**

- Use `google-api` crates or direct HTTP
- Polling interval: 2-5 seconds (respect quota)
- Handle pagination tokens

### 12.4 Platform-Specific Features

**Bits (Twitch):**

- Parse `bits` tag from IRC
- Include in metadata or as special content token

**Subscribers/Tiers:**

- `subscriber` flag from IRC
- Parse `sub-plan` and `sub-plan-name` tags for tier

**Badges:**

- Global badges (broadcaster, mod, vip, staff, etc.)
- Channel-specific badges (custom emotes as badges)
- Fetch badge URLs from Twitch API

---

## 13. OBS Integration

### 13.1 Connection URL

**Format:** `http://{server_host}:{server_port}/overlay`  
**Default:** `http://127.0.0.1:8080/overlay`  
**OBS Browser Source settings:**

- Width: 1920 (or custom)
- Height: 1080 (or custom)
- Custom CSS: Optional, for scaling
- Control via OBS WebSocket (optional, for scene switching)

**WebSocket endpoint:** `ws://{server_host}:{ws_port}/chat`  
**Default:** `ws://127.0.0.1:8081/chat`

### 13.2 OBS Disconnection/Reconnection

**Client-side (OBS overlay Svelte app):**

- WebSocket `onclose` event triggers reconnection
- Exponential backoff: 1s, 2s, 4s, 8s, max 30s
- Show "Disconnected" placeholder in overlay during outage
- On reconnect, request backlog (server sends automatically on new connection)

**Server-side:**

- Track connected clients (Arc<Mutex<HashSet<WsStream>>>)
- Broadcast to all clients on message receipt
- On client disconnect, remove from set (cleanup)

### 13.3 WebSocket Heartbeat

**Implementation:**

- Server sends ping every 30 seconds (configurable)
- Client must respond with pong within 10 seconds
- If no pong, server closes connection (stale client)
- Client reconnects automatically

**Message format:**

```json
{"type":"ping","seq":123}
{"type":"pong","seq":123}
```

---

## 14. Security Considerations

### 14.1 Open Access Assessment

**Risk:** If server bound to `0.0.0.0`, any device on local network can connect and read chat.

**Mitigation options:**

1. **Default to 127.0.0.1** - Only localhost access (safe)
2. **Optional token auth** - If binding to 0.0.0.0, require API token in WebSocket handshake (query param or header)
3. **Network-level firewall** - Advise user to configure router/firewall

**Decision:** Default `127.0.0.1`, optional token if user changes host to `0.0.0.0`. Token stored in config, generated on first run.

### 14.2 DDoS Protection

**If bound to 0.0.0.0:**

- Rate limit per IP: 10 connections/minute
- Max concurrent connections: 20 (configurable)
- Connection timeout: 60 seconds idle
- Early close for malformed messages

**Implementation:** Tower middleware (axum) with `tower-limit` and `tower-timeout`

---

## 15. Development Workflow

### 15.1 Tauri Dev Mode

**Commands:**

- `npm run tauri dev` - Start Vite dev server + Tauri app
- Backend runs in debug mode with hot-reload (via `cargo watch`)

**Features:**

- Live reload of frontend on Svelte changes
- Backend recompiles on Rust changes (automatic restart)
- Dev tools enabled (tracing debug logs)
- Mock connectors available for testing without real API keys

### 15.2 Debugging Strategy

**Connector debugging:**

- Detailed logs at `debug` level show IRC/API traffic
- Ability to dump raw messages to file for analysis
- Simulated error injection (via config) to test reconnection

**Theme debugging:**

- Browser devtools accessible in OBS overlay (via remote debugging)
- Template error reporting (missing placeholders) shown in overlay

**Plugin debugging:**

- Plugin logs tagged with plugin name
- Plugin hot-reload in dev mode

---

## 16. Theme Testing with Hot Reload

**Development workflow:**

1. Run app in dev mode with `theme.hot_reload=true`
2. Edit theme files (layout.html, CSS)
3. Server detects file change (via `notify` crate)
4. Broadcast `theme_reload` event to all connected clients
5. OBS overlay fetches new layout.html and applies
6. Browser devtools show any template errors

**Testing checklist:**

- All placeholders present
- CSS loads correctly
- Images (emotes) display
- Responsive layout (different OBS resolutions)
- Sanitization doesn't break HTML

---

## 17. Implementation Phases

### Phase 1: Core Backend (Week 1-2)

- Axum server with WebSocket endpoint
- UnifiedChatMessage struct and serialization
- Backlog buffer implementation
- Basic logging and config
- Health check endpoint

### Phase 2: Connectors (Week 3-4)

- Twitch IRC connector (OAuth + IRC)
- YouTube connector (OAuth + API)
- Emote fetching (7TV, BTTV)
- Unified message normalization

### Phase 3: OAuth & Security (Week 5)

- Local OAuth server
- Token storage in keyring
- Refresh logic
- Security middleware

### Phase 4: Theme System (Week 6-7)

- Theme directory scanning
- Template rendering (Rust side)
- XSS sanitization
- Static file serving
- Hot-reload

### Phase 5: Frontend & OBS (Week 8-9)

- Tauri UI for config
- OBS overlay Svelte app
- WebSocket client with reconnection
- Theme selector UI

### Phase 6: Plugins & Polish (Week 10-11)

- Plugin system implementation
- Error handling improvements
- Performance optimization
- Documentation

### Phase 7: Testing & Release (Week 12)

- Integration tests
- User acceptance testing
- Packaging (NSIS, DMG, AppImage)
- Release notes

---

## 18. Open Questions (Requires User Input)

1. **Should we support multiple OBS clients simultaneously?** (Assumption: yes, broadcast to all)
2. **Do we need message history persistence?** (MVP: no, in-memory only)
3. **Should themes be distributable via marketplace?** (MVP: manual install only)
4. **What is the minimum supported OS version?** (Windows 10+, macOS 10.14+, Ubuntu 20.04+)
5. **Do we need a CLI mode (headless)?** (MVP: no, Tauri GUI required)
6. **Should we support custom emote uploads?** (MVP: no, only external providers)
7. **How to handle rate limits during high-traffic events?** (Drop messages, log warning)
8. **Do we need analytics/telemetry?** (MVP: no, optional in future)

---

## 19. Success Metrics

- **Performance:** <50ms latency from message receipt to OBS display (p95)
- **Uptime:** >99% connector availability (auto-reconnect works)
- **Memory:** <100 MB typical usage
- **CPU:** <5% on idle, <20% at 100 msg/sec
- **OBS stability:** No crashes or freezes during 24h continuous operation

---

## 20. Risks & Mitigations

| Risk                 | Impact | Mitigation                            |
| -------------------- | ------ | ------------------------------------- |
| Twitch API changes   | High   | Use stable IRC, monitor announcements |
| YouTube quota limits | Medium | Efficient polling, cache emote data   |
| OAuth token theft    | High   | Use OS keyring, never log tokens      |
| XSS via themes       | High   | Strict sanitization, sandbox iframe?  |
| Plugin crashes       | Medium | Isolation, auto-disable               |
| High message rate    | Medium | Backpressure, drop oldest             |
| OBS WebSocket issues | Medium | Robust reconnection, heartbeat        |

---

**Document End**
