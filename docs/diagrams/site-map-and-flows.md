# Site Map and User Flows

**Last updated:** 2026-03

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

All routes use Expo Router file-based routing. The root `index` screen acts as an auth gate and role-based redirect.

```mermaid
flowchart TD
    ROOT["/ (index)"] --> AUTH_CHECK{Authenticated?}

    AUTH_CHECK -- No --> LOGIN["/(auth)/login"]
    AUTH_CHECK -- "Yes, role=buyer" --> BUYER_CHAT["/(buyer)/chat"]
    AUTH_CHECK -- "Yes, role=dealer" --> DEALER_SIMS["/(dealer)/simulations"]

    LOGIN --> REGISTER["/(auth)/register"]
    REGISTER --> LOGIN

    LOGIN -- "Login as buyer" --> BUYER_CHAT
    LOGIN -- "Login as dealer" --> DEALER_SIMS
    REGISTER -- "Register as buyer" --> BUYER_CHAT
    REGISTER -- "Register as dealer" --> DEALER_SIMS

    subgraph AUTH ["(auth) — Unauthenticated"]
        LOGIN
        REGISTER
    end

    subgraph BUYER ["(buyer) — Buyer Role"]
        BUYER_CHAT["/(buyer)/chat\nAI Chat + Dashboard"]
        BUYER_SESSIONS["/(buyer)/sessions\nSession History"]
        BUYER_SETTINGS["/(buyer)/settings\nSettings"]
    end

    subgraph DEALER ["(dealer) — Dealer Role"]
        DEALER_SIMS["/(dealer)/simulations\nScenario List"]
        DEALER_SIM_ID["/(dealer)/sim/[id]\nSimulation Chat"]
        DEALER_SETTINGS["/(dealer)/settings\nSettings"]
    end

    BUYER_CHAT <--> BUYER_SESSIONS
    BUYER_CHAT <--> BUYER_SETTINGS
    BUYER_SESSIONS --> BUYER_CHAT

    DEALER_SIMS --> DEALER_SIM_ID
    DEALER_SIM_ID --> DEALER_SIMS
    DEALER_SIMS <--> DEALER_SETTINGS
```

---

## Tab/Screen Structure by Role

| Route | Screen | Buyer | Dealer | Description |
|---|---|:---:|:---:|---|
| `/(auth)/login` | Login | -- | -- | Email/password login with quick sign-in buttons |
| `/(auth)/register` | Register | -- | -- | Account creation with role selection (buyer/dealer) |
| `/(buyer)/chat` | Chat | Yes | -- | AI chat with deal dashboard (phase, numbers, scorecard, vehicle, checklist) |
| `/(buyer)/sessions` | Sessions | Yes | -- | List of past chat sessions; select to resume or delete |
| `/(buyer)/settings` | Settings | Yes | -- | App settings (theme toggle, logout) |
| `/(dealer)/simulations` | Simulations | -- | Yes | Browse AI training scenarios; start a new simulation |
| `/(dealer)/sim/[id]` | Simulation Chat | -- | Yes | Live chat session for a selected training scenario |
| `/(dealer)/settings` | Settings | -- | Yes | App settings (theme toggle, logout) |

Both buyer and dealer route groups have auth guards that redirect to `/(auth)/login` if the user is not authenticated.

---

## User Flows

### Buyer Flow

Open app, authenticate, chat with AI advisor, receive dashboard updates, manage sessions.

```mermaid
flowchart TD
    OPEN[Open App] --> INDEX["/  — Auth Gate"]
    INDEX --> |Not authenticated| LOGIN[Login Screen]
    INDEX --> |Authenticated as buyer| CHAT

    LOGIN --> |Sign in| CHAT[Chat Screen]

    CHAT --> |Auto-creates session\nif none active| AI[Send Message to AI]
    AI --> |AI responds via SSE| STREAM[Stream Response]
    STREAM --> |text events| BUBBLES[Chat Bubbles Update]
    STREAM --> |tool_result events| DASHBOARD[Dashboard Updates]
    DASHBOARD --> PHASE[Deal Phase]
    DASHBOARD --> NUMBERS[Deal Numbers]
    DASHBOARD --> SCORECARD[Scorecard]
    DASHBOARD --> VEHICLE[Vehicle Info]
    DASHBOARD --> CHECKLIST[Checklist]

    CHAT --> |Tap quick action| AI
    CHAT --> |Navigate via menu| SESSIONS[Sessions Screen]
    SESSIONS --> |Select session| CHAT
    SESSIONS --> |Delete session| SESSIONS
    SESSIONS --> |New session| CHAT

    CHAT --> |Navigate via menu| SETTINGS[Settings Screen]
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
    START --> |Creates session,\nnavigates to sim| SIM_CHAT["Simulation Chat\n/(dealer)/sim/[id]"]

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

    REGISTER --> |Select role\nbuyer or dealer| CREATE[Create Account]
    REGISTER --> |"Already have an account?"| LOGIN

    CREATE --> ROLE_CHECK
    VALIDATE --> ROLE_CHECK

    ROLE_CHECK -- buyer --> BUYER["/(buyer)/chat"]
    ROLE_CHECK -- dealer --> DEALER["/(dealer)/simulations"]
```
