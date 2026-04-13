# Site Map and User Flows

**Last updated:** 2026-04-10

---

## Table of Contents

1. [Site Map](#site-map)
2. [Tab/Screen Structure by Role](#tabscreen-structure-by-role)
3. [User Flows](#user-flows)
   - [Buyer Flow](#buyer-flow)
   - [Dealer Flow](#dealer-flow)
   - [Auth Flow](#auth-flow)

---

## Site Map

All routes use Expo Router file-based routing. The root `index` screen acts as an auth gate and role-based redirect. All authenticated screens live under a single `(app)` route group, with `RoleGuard` components on individual screens enforcing role-based access.

```mermaid
flowchart TD
    ROOT["/ (index)"] --> AUTH_CHECK{Authenticated?}

    AUTH_CHECK -- No --> LOGIN["/(auth)/login"]
    AUTH_CHECK -- "Yes, role=buyer" --> APP_CHATS["/(app)/chats"]
    AUTH_CHECK -- "Yes, role=dealer" --> APP_SIMS["/(app)/simulations"]

    LOGIN --> REGISTER["/(auth)/register"]
    REGISTER --> LOGIN

    LOGIN -- "Login as buyer" --> APP_CHATS
    LOGIN -- "Login as dealer" --> APP_SIMS
    REGISTER -- "Register (Buying)" --> APP_CHATS
    REGISTER -- "Register (Selling)" --> APP_SIMS

    subgraph AUTH ["(auth) — Unauthenticated"]
        LOGIN
        REGISTER
    end

    subgraph APP ["(app) — Authenticated (AuthGuard)"]
        APP_CHATS["/(app)/chats\nChats List (buyer home)\n(RoleGuard: buyer)"]
        APP_CHAT["/(app)/chat\nAI Chat + Dashboard\n(RoleGuard: buyer)"]
        APP_SIMS["/(app)/simulations\nScenario List\n(RoleGuard: dealer)"]
        APP_SIM_ID["/(app)/sim/[id]\nSimulation Chat\n(RoleGuard: dealer)"]
        APP_SETTINGS["/(app)/settings\nSettings (shared)"]
    end

    APP_CHATS --> APP_CHAT
    APP_CHATS <--> APP_SETTINGS
    APP_CHAT --> APP_CHATS

    APP_SIMS --> APP_SIM_ID
    APP_SIM_ID --> APP_SIMS
    APP_SIMS <--> APP_SETTINGS
```

---

## Tab/Screen Structure by Role

| Route | Screen | Buyer | Dealer | Guard | Description |
|---|---|:---:|:---:|---|---|
| `/(auth)/login` | Login | -- | -- | None | Email/password login with quick sign-in buttons |
| `/(auth)/register` | Register | -- | -- | None | Account creation with "Buying"/"Selling" role selection |
| `/(app)/chats` | Chats | Yes | -- | RoleGuard(buyer) | Buyer home screen; session list with search, Active/Past sections, SessionCard (phase dot, preview, deal summary); single-session fast-path; ContextPicker empty state |
| `/(app)/chat` | Chat | Yes | -- | RoleGuard(buyer) | AI chat with deal dashboard (phase, numbers, scorecard, vehicle, checklist); context pressure banner from messages API; system-role bubbles for compaction notices; explicit "edit from here" action on eligible user messages; back button to chats list; dynamic title from session |
| `/(app)/simulations` | Simulations | -- | Yes | RoleGuard(dealer) | Browse AI training scenarios; start a new simulation |
| `/(app)/sim/[id]` | Simulation Chat | -- | Yes | RoleGuard(dealer) | Live chat session for a selected training scenario |
| `/(app)/settings` | Settings | Yes | Yes | None (shared) | App settings (theme toggle, logout); back button with animated icon entrance |

The `(app)` route group has an `AuthGuard` that redirects to `/(auth)/login` if the user is not authenticated. Individual screens use `RoleGuard` to enforce role-based access and redirect mismatched users to their default screen.

---

## User Flows

### Buyer Flow

Open app, authenticate, manage sessions from chats list, chat with AI advisor, receive dashboard updates.

```mermaid
flowchart TD
    OPEN[Open App] --> INDEX["/  — Auth Gate"]
    INDEX --> |Not authenticated| LOGIN[Login Screen]
    INDEX --> |Authenticated as buyer| CHATS

    LOGIN --> |Sign in| CHATS[Chats Screen\nBuyer Home]

    CHATS --> |No sessions| WELCOME[ContextPicker\nEmpty State]
    CHATS --> |Single session| CHAT[Chat Screen]
    CHATS --> |Select session| CHAT
    CHATS --> |Search sessions| CHATS
    CHATS --> |Pull to refresh| CHATS
    CHATS --> |New session| WELCOME_NEW[ContextPicker\n3 situation cards]
    WELCOME --> |Tap card| SESSION_CREATE[Create Session\nwith buyer_context]
    WELCOME_NEW --> |Tap card| SESSION_CREATE
    SESSION_CREATE --> |Hardcoded greeting| CHAT

    CHAT --> |Send message| AI[Send Message to AI]
    AI --> |AI responds via SSE| STREAM[Stream Response]
    STREAM --> |text events| BUBBLES[Chat Bubbles Update]
    STREAM --> |Stop button| INTERRUPT[Interrupted\nPartial text kept]
    STREAM --> |tool_result events| DASHBOARD[Dashboard Updates]
    DASHBOARD --> PHASE[Deal Phase]
    DASHBOARD --> NUMBERS[Deal Numbers]
    DASHBOARD --> SCORECARD[Scorecard]
    DASHBOARD --> VEHICLE[Vehicle Info]
    DASHBOARD --> CHECKLIST[Checklist]

    CHAT --> |Reply from insight card| AI
    CHAT --> |Edit earlier user message| BRANCH_CONFIRM[Confirm edit-from-here]
    BRANCH_CONFIRM --> |Continue| AI
    CHAT --> |Back button| CHATS

    CHATS --> |Gear icon| SETTINGS[Settings Screen]
    SETTINGS --> |Back button| CHATS
    SETTINGS --> |Logout| LOGIN
```

### Dealer Flow

Open app, authenticate, browse training scenarios, start and practice a simulation.

```mermaid
flowchart TD
    OPEN[Open App] --> INDEX["/  — Auth Gate"]
    INDEX --> |Not authenticated| LOGIN[Login Screen]
    INDEX --> |Authenticated as dealer| SIMS

    LOGIN --> |Sign in| SIMS[Simulations Screen]

    SIMS --> |Load scenarios| LIST[Scenario List]
    LIST --> |Tap scenario| START[Start Simulation]
    START --> |Creates session,\nnavigates to sim| SIM_CHAT["Simulation Chat\n/(app)/sim/[id]"]

    SIM_CHAT --> |Send message| AI[AI Customer Response]
    AI --> SIM_CHAT
    SIM_CHAT --> |Back button| SIMS

    SIMS --> |Navigate via menu| SETTINGS[Settings Screen]
    SETTINGS --> |Logout| LOGIN
```

### Auth Flow

Register a new account or log in, then redirect based on role.

```mermaid
flowchart TD
    START[App Launch] --> AUTH_CHECK{Authenticated?}

    AUTH_CHECK -- No --> LOGIN[Login Screen]
    AUTH_CHECK -- Yes --> ROLE_CHECK{User Role?}

    LOGIN --> |Enter credentials| VALIDATE[Validate Login]
    LOGIN --> |Quick sign-in button| VALIDATE
    LOGIN --> |"Don't have an account?"| REGISTER[Register Screen]

    REGISTER --> |"Buying" or "Selling"\nrole selection| CREATE[Create Account]
    REGISTER --> |"Already have an account?"| LOGIN

    CREATE --> ROLE_CHECK
    VALIDATE --> ROLE_CHECK

    ROLE_CHECK -- buyer --> BUYER["/(app)/chats"]
    ROLE_CHECK -- dealer --> DEALER["/(app)/simulations"]
```
