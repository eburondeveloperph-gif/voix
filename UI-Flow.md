# Beatrice App Flow Specification

## 👁️ Overview
This document defines the canonical, step-by-step UI/UX flow for all pages in the Beatrice application. The goal is to ensure the experience is consistently calm, minimal, and highly intuitive, matching Apple's native assistant aesthetic.

---

## � Page Specifications

### Page 1: Auth Screen
**File:** `components/demo/AuthScreen.tsx`

#### Purpose
Authentication gateway for the application. Handles user sign-in via Google OAuth and provides local development bypass.

#### Visual Design
- **Background:** Dark theme with ambient glow effects (`ambient-glow glow-1`, `ambient-glow glow-2`)
- **Layout:** Centered modal card on main stage
- **Brand Logo:** SVG waveform icon with gradient (28x28px)

#### Elements & Icons
| Element | Icon | Material Symbol | Function |
|---------|------|-------------------|----------|
| Brand Logo | Waveform SVG | N/A | Visual identity |
| Google Sign-in | Google "G" logo | N/A | OAuth authentication |
| Email Sign-in | Mail envelope | `mail` | Placeholder (disabled) |
| Loading State | Spinner | N/A | Auth state initialization |

#### States
1. **Loading:** `loading=true`, shows spinner while checking auth state
2. **Sign In Required:** `user=null` && not local dev, shows auth modal
3. **Authenticated:** `user!=null`, renders children (main app)
4. **Local Dev Bypass:** `isLocalDevHost=true`, bypasses auth for localhost/127.0.0.1

#### Functions
- `handleGoogleSignIn()` - Initiates Google OAuth flow via Firebase
- `onAuthStateChanged()` - Firebase auth state listener
- `loadProfile()` - Loads user profile from store on auth change

---

### Page 2: Missing API Key Screen
**File:** `App.tsx` (inline component)

#### Purpose
Displays when `GEMINI_API_KEY` is not configured in environment.

#### Elements & Icons
| Element | Icon | Material Symbol |
|---------|------|-----------------|
| Status Indicator | Dot | N/A |

#### Content
- **Title:** "Missing Gemini API key"
- **Instruction:** Create `.env.local` with `GEMINI_API_KEY=your_key_here`
- **Command:** `npm run dev`

---

### Page 3: User Profile Onboarding Modal
**File:** `components/user/UserProfileOnboardingModal.tsx`

#### Purpose
First-time user setup for preferred name and address format.

#### Visual Design
- **Type:** Modal overlay with shell and backdrop
- **Kicker:** Small caps label above title
- **Form:** Stacked input fields with labels

#### Elements & Icons
| Element | Icon | Material Symbol | Function |
|---------|------|-------------------|----------|
| Modal Shell | Backdrop | N/A | Click outside to dismiss (not implemented) |
| Submit Button | None | N/A | Saves profile, disabled until input provided |

#### Form Fields
1. **Your Name** - Text input, placeholder: "Your name"
2. **Preferred Address** - Text input, placeholder: "For example: Meneer Alex, Alex, Doctor, Ms. Claire"

#### Functions
- `setDraftPreferredName()` - Updates name state
- `setDraftPreferredAddress()` - Updates address state
- `submitOnboarding()` - Persists profile to backend

#### States
- `isOnboardingOpen` - Controls modal visibility
- `profile?.onboarding_completed` - Determines if onboarding needed
- Button disabled when `!draftPreferredName.trim() && !draftPreferredAddress.trim()`

---

### Page 4: Streaming Console (Main Interface)
**File:** `components/demo/streaming-console/StreamingConsole.tsx`

#### Purpose
Primary voice and chat interface for Beatrice AI interaction.

#### Visual Design
- **Background:** Full-screen dark theme
- **Centerpiece:** Animated orb visualizer that responds to voice activity
- **Layout:** Floating circular controls at corners, chat drawer slides from right

#### Elements & Icons
| Element | Icon | Material Symbol | Position | Function |
|---------|------|-----------------|----------|----------|
| Settings | Tune/slider | `tune` | Top-left | Toggle sidebar |
| Microphone Start | Microphone | `mic` | Bottom-center-left | Start voice session |
| Microphone Stop | Stop square | `stop` | Bottom-center-left | End voice session |
| Mic Requesting | Hourglass | `hourglass_top` | Bottom-center-left | Permission pending |
| Document Scanner | Document scanner | `document_scanner` | Bottom-center-right | Open scanner modal |
| Chat Toggle | Chat bubble | `chat_bubble` | Bottom-right | Open chat drawer |
| Chat Close | X close | `close` | Chat header | Close chat drawer |
| Send Message | Send arrow | `send` | Chat input | Submit text message |
| Active Document | Docs icon | `docs` | Transcript area | Shows loaded document |

#### Status Indicators
- **Top Status Bar:** "Listening" | "Thinking" | "Idle"
- **Orb States:**
  - `active` - Session connected, orb glows
  - `thinking` - AI processing, orb pulses differently
  - `connecting` - User speaking, orb reacts to mic level

#### Chat Drawer Components
- **Header:** "Conversation" title + close button
- **History:** Scrollable message bubbles (user/assistant)
- **Input:** Text field + send button (disabled when `!connected`)
- **Empty State:** "Start a voice session to see the conversation here."

#### Functions
- `handleMicToggle()` - Start/stop voice session
- `requestMicrophoneAccess()` - Request browser mic permission
- `handleManualSend()` - Send chat message
- `openScanner()` - Trigger document scanner modal
- `toggleChat()` - Show/hide chat drawer
- `toggleSidebar()` - Show/hide settings sidebar

#### Voice Activity Detection
- `micLevel` - Real-time microphone input level
- `volume` - AI response audio level
- `orbScale` - 1 + orbEnergy * 0.38
- `orbShadow` - 50 + orbEnergy * 110px

---

### Page 5: Document Scanner Modal
**File:** `components/document/DocumentScannerModal.tsx`

#### Purpose
Full document scanning workflow from capture to OCR analysis.

#### Visual Design
- **Type:** Modal overlay with dark backdrop
- **Header:** Persistent kicker + title + close button
- **Content:** Stage-dependent layouts

#### Header Elements (All Stages)
| Element | Icon | Material Symbol |
|---------|------|-----------------|
| Close Modal | X | `close` |

#### Stage 1: Capture (Camera Active)
**Layout:** Video preview with overlay controls

| Element | Icon | Material Symbol | Function |
|---------|------|-----------------|----------|
| Flash Toggle On | Flash on | `flash_on` | Enable torch |
| Flash Toggle Off | Flash off | `flash_off` | Disable torch |
| Upload from Gallery | Photo library | `photo_library` | Open file picker |
| Cancel | None | N/A | Close scanner |
| Capture Photo | Document scanner | `document_scanner` | Capture frame |

**Controls:**
- Flash button (disabled when `!torchSupported`)
- Gallery/PDF upload pill button
- Cancel pill button
- Large circular capture button (footer)

#### Stage 2: Crop (Guided Selection)
**Layout:** Image preview with adjustable crop overlay

| Element | Icon | Material Symbol | Function |
|---------|------|-----------------|----------|
| Page Tabs | None | N/A | Multi-page navigation |
| Retake | None | N/A | Back to capture |
| Use Scan | None | N/A | Confirm and process |

**Controls:**
- 4 range sliders: Left, Top, Width, Height (0-100%)
- Page tabs when `draftPages.length > 1`
- Visual crop rectangle overlay (`scan-crop-rect`)

#### Stage 3: Processing (OCR Running)
**Layout:** Centered loading state

| Element | Icon | Material Symbol | Function |
|---------|------|-----------------|----------|
| Scan Ring | Animated CSS | N/A | Visual progress indicator |
| Progress Bar | CSS bar | N/A | Percentage completion |

**Content:**
- Animated processing ring
- Status message: "Beatrice is reading the document..."
- Dynamic progress: `Math.round(ocrProgress * 100)%`

#### Stage 4: Result (Analysis Complete)
**Layout:** Multi-section results view

| Element | Icon | Material Symbol | Function |
|---------|------|-----------------|----------|
| Metadata Pills | None | N/A | Language, Type, Confidence |
| Ask Beatrice | None | N/A | Open chat with document context |
| Translate | None | N/A | Dutch translation action |
| Save to Memory | None | N/A | Persist to long-term memory |
| Detailed Summary | None | N/A | Generate detailed explanation |
| Copy Text | None | N/A | Copy OCR text to clipboard |
| Export | None | N/A | Download JSON export |
| Delete Scan | None | N/A | Remove scan and close |

**Result Sections:**
1. **Metadata Header:** Pill badges for Language, Document Type, Confidence %
2. **Title & Summary:** Document title + short_summary
3. **Extracted Text Preview:** First 2800 chars with scroll
4. **Detailed Summary:** AI-generated document explanation
5. **Follow-up Chips:** `suggested_followups` mapped to clickable buttons
6. **Action Feedback:** Shows after action completion (title + value)

#### Error States
| Element | Icon | Material Symbol |
|---------|------|-----------------|
| Error Banner | Warning | `warning` |

**Error Messages:**
- Camera denied: "Ik heb cameratoegang nodig om dit document te scannen."
- Capture failed: "Ik kon de camera-opname niet vastleggen. Probeer opnieuw."
- Upload failed: "Ik kon dit bestand niet openen voor scanning."
- No text found: "Ik zie geen duidelijke tekst in deze afbeelding."
- Processing failed: "Ik kon de tekst niet goed lezen. Probeer opnieuw met beter licht of dichter bij het document."

#### Functions
- `handleCapture()` - Capture from video stream
- `handleUpload()` - Process selected file/PDF
- `processScan()` - Full OCR pipeline
- `handleAskBeatrice()` - Load document into chat context
- `handleActionQuestion()` - Send follow-up question to AI
- `handleSaveLongMemory()` - Persist to memory service
- `handleCopyText()` - Clipboard write
- `handleExport()` - JSON download
- `handleDelete()` - Remove from memory and reset
- `handleRetake()` - Return to capture stage

---

### Page 6: Error Screen
**File:** `components/demo/ErrorScreen.tsx`

#### Purpose
Global error boundary and error display modal.

#### Elements & Icons
| Element | Icon | Material Symbol |
|---------|------|-----------------|
| Error Icon | Warning | `warning` |
| Close/Dismiss | X | `close` |

#### Content
- Error title (context-dependent)
- Error message/description
- Dismiss action

---

### Page 7: Sidebar (Settings Panel)
**File:** `components/Sidebar.tsx`

#### Purpose
Settings and configuration panel for the application.

#### Elements (Typical Settings UI)
- System prompt configuration
- Voice selection
- Tool enablement toggles
- Model settings

#### Icons
| Element | Icon | Material Symbol |
|---------|------|-----------------|
| Close Sidebar | X | `close` |
| Settings Groups | Various | Context-dependent |

---

## 💾 Flow Transitions

### Document Scanner Flow
| From | To | Trigger | Icon |
|------|-----|---------|------|
| Idle | Capture | Tap scan icon | `document_scanner` |
| Capture | Crop | Capture image/PDF | `document_scanner` |
| Crop | Processing | Confirm crop | "Use Scan" button |
| Processing | Result | OCR/AI completes | Auto-transition |
| Result | Ask | Tap "Ask Beatrice" | Chat opens |
| Result | Save | Tap "Save to Memory" | Memory persisted |
| Result | Export | Tap "Export" | JSON download |

### Auth Flow
| From | To | Trigger |
|------|-----|---------|
| Loading | Sign In | No user detected |
| Sign In | Main App | Google auth success |
| Sign In | Local Dev | On localhost/127.0.0.1 |

### User Profile Onboarding Flow
| From | To | Trigger |
|------|-----|---------|
| Detect New User | Show Onboarding | `!onboarding_completed` |
| Input | Enable Submit | Text entered in fields |
| Submit | Close Modal | Profile saved |

### Streaming Console Flow
| From | To | Trigger | Icon Change |
|------|-----|---------|-------------|
| Idle | Requesting Mic | Tap mic | `mic` → `hourglass_top` |
| Requesting Mic | Listening | Permission granted | `hourglass_top` → `stop` |
| Requesting Mic | Denied | Permission blocked | Error shown |
| Listening | Thinking | Stop speaking | `stop` (orb changes) |
| Listening | Idle | Tap stop | `stop` → `mic` |
| Voice Command | Open Scanner | "scan this" intent | Modal opens |
| Chat Input | Send | Enter/send tap | `send` |

### Sidebar Flow
| From | To | Trigger | Icon |
|------|-----|---------|------|
| Closed | Open | Tap settings | `tune` |
| Open | Closed | Tap close/X | `close` |

---

## 🎨 Icon Reference (Material Symbols)

### Core Navigation
| Symbol Name | Unicode | Usage |
|-------------|---------|-------|
| `close` | e5cd | Close modals, dismiss |
| `tune` | e429 | Settings, configuration |
| `mic` | e029 | Start voice session |
| `stop` | e047 | End voice session |
| `hourglass_top` | ea5b | Loading, requesting |
| `chat_bubble` | e0cb | Open chat |
| `send` | e163 | Send message |
| `warning` | e002 | Error states |

### Document Scanner
| Symbol Name | Unicode | Usage |
|-------------|---------|-------|
| `document_scanner` | e991 | Scan action, capture |
| `flash_on` | e3e6 | Torch enabled |
| `flash_off` | e3e7 | Torch disabled |
| `photo_library` | e413 | Gallery upload |
| `docs` | ea6d | Active document indicator |

### Auth & User
| Symbol Name | Unicode | Usage |
|-------------|---------|-------|
| `mail` | e158 | Email sign-in placeholder |

