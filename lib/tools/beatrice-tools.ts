import { FunctionCall } from '../state';
import { FunctionResponseScheduling } from '@google/genai';

export const beatriceTools: FunctionCall[] = [
  {
    name: 'document_scan_start',
    description: 'Opens Beatrice media/file intake so the user can take a normal photo/video or upload an image/document. Readable documents can still be OCR analyzed and saved.',
    parameters: {
      type: 'OBJECT',
      properties: {
        userRequest: {
          type: 'STRING',
          description: 'The user request that explains what they want from the uploaded photo, video, image, or document.',
        },
        autoSaveLongMemory: {
          type: 'BOOLEAN',
          description: 'Whether Beatrice should save readable document text directly to long memory after OCR and analysis.',
        },
      },
      required: ['userRequest'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'document_memory_search',
    description: 'Searches Beatrice long-term document memory for previously scanned documents and returns the most relevant matches.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Natural language search query, such as "the French agreement from yesterday".',
        },
      },
      required: ['query'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'document_memory_save',
    description: 'Saves the currently active scanned document into long-term memory.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Optional title override for the saved document.',
        },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'document_memory_forget',
    description: 'Deletes a previously saved scanned document from Beatrice memory.',
    parameters: {
      type: 'OBJECT',
      properties: {
        memoryId: {
          type: 'STRING',
          description: 'Optional explicit memory id to forget. If omitted, Beatrice should forget the active scanned document.',
        },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'gmail_send',
    description: 'Sends an email using Gmail.',
    parameters: {
      type: 'OBJECT',
      properties: {
        recipient: { type: 'STRING', description: 'The email address of the recipient.' },
        subject: { type: 'STRING', description: 'The subject line of the email.' },
        body: { type: 'STRING', description: 'The body content of the email.' },
      },
      required: ['recipient', 'subject', 'body'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'gmail_read',
    description: 'Reads recent emails from Gmail.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Optional search query to filter emails.' },
        limit: { type: 'INTEGER', description: 'Number of emails to fetch.' }
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'calendar_create_event',
    description: 'Creates a new event in Google Calendar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING', description: 'The title or summary of the event.' },
        location: { type: 'STRING', description: 'The location of the event.' },
        startTime: { type: 'STRING', description: 'The start time of the event in ISO 8601 format.' },
        endTime: { type: 'STRING', description: 'The end time of the event in ISO 8601 format.' },
      },
      required: ['summary', 'startTime', 'endTime'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'calendar_check_schedule',
    description: 'Checks the user\'s Google Calendar schedule for conflicts or free time.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'The date to check in ISO 8601 format.' }
      },
      required: ['date'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'drive_search',
    description: 'Searches for a file or folder in Google Drive.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'The search query or filename.' }
      },
      required: ['query'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'drive_knowledge_sync',
    description: 'Fetches documents from the current user\'s Google Drive "Beatrice Knowledge Base" folder, extracts readable content, and stores it in Beatrice long-term document memory.',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: {
          type: 'INTEGER',
          description: 'Maximum number of Drive files to inspect. Default 50.',
        },
        force: {
          type: 'BOOLEAN',
          description: 'Whether to re-import files even if the same Drive modified timestamp was already synced.',
        },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'docs_create',
    description: 'Creates a new Google Doc.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'The title of the new document.' },
        content: { type: 'STRING', description: 'Initial content to add to the document.' }
      },
      required: ['title'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'meet_schedule',
    description: 'Generates a Google Meet link and schedules a video call.',
    parameters: {
      type: 'OBJECT',
      properties: {
        attendees: { type: 'STRING', description: 'Comma-separated list of attendee email addresses.' },
        time: { type: 'STRING', description: 'The time for the meeting in ISO 8601 format.' }
      },
      required: ['time'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'set_reminder',
    description: 'Sets a reminder for the user by creating a calendar event.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task: { type: 'STRING', description: 'The task or reminder text.' },
        time: { type: 'STRING', description: 'The time for the reminder in ISO 8601 format.' },
      },
      required: ['task'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'maps_navigate',
    description: 'Gets navigation directions from Google Maps.',
    parameters: {
      type: 'OBJECT',
      properties: {
        destination: { type: 'STRING', description: 'The destination address or place name.' },
        origin: { type: 'STRING', description: 'The starting location.' }
      },
      required: ['destination'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'image_generate',
    description: 'Generates an AI image from a descriptive prompt and places the result in Beatrice\'s voice workspace. Use this when the user asks Beatrice to create, generate, or design an image.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'Detailed image prompt including subject, style, lighting, composition, colors, and any text that should appear.',
        },
        aspectRatio: {
          type: 'STRING',
          description: 'Optional output aspect ratio: "1:1", "3:4", "4:3", "9:16", or "16:9". Default "1:1".',
        },
        negativePrompt: {
          type: 'STRING',
          description: 'Optional things to avoid in the image.',
        },
        numberOfImages: {
          type: 'INTEGER',
          description: 'Optional number of images to generate, from 1 to 4. Default 1.',
        },
      },
      required: ['prompt'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'video_generate',
    description: 'Generates a high-quality AI video based on a descriptive text prompt. This tool uses an advanced video agent to create visuals, script, and avatar presentation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: { type: 'STRING', description: 'A detailed description of the video content, including the presenter\'s topic, style, and duration (e.g., "A presenter explaining our product launch in 30 seconds").' }
      },
      required: ['prompt'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'vision_detect_objects',
    description: 'Runs real object detection on the latest image or CCTV frame and returns YOLO-style boxes, labels, confidence scores, and potential threat flags.',
    parameters: {
      type: 'OBJECT',
      properties: {
        imageDataUrl: {
          type: 'STRING',
          description: 'Optional data URL for an image frame. If omitted, Beatrice uses the latest captured CCTV/camera frame.',
        },
        sourceLabel: {
          type: 'STRING',
          description: 'Human-readable source name, such as "front gate camera" or "uploaded invoice photo".',
        },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'vision_video_camera_open',
    description: 'Opens the normal browser video camera for live vision. Beatrice can use this to show YOLO-style boxes, labels, confidence scores, threat flags, and realtime OCR preview from a phone or desktop camera.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sourceLabel: {
          type: 'STRING',
          description: 'Human-readable camera label, such as "phone rear camera", "desk camera", or "front gate view".',
        },
        autoDetect: {
          type: 'BOOLEAN',
          description: 'Whether to automatically run live object detection and OCR once the camera opens. Default true.',
        },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'vision_take_photo',
    description: 'Opens the phone camera/native photo picker so the user can take or upload an image. After capture Beatrice can detect objects, draw boxes/labels, and OCR readable text.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sourceLabel: {
          type: 'STRING',
          description: 'Human-readable source label, such as "phone camera photo" or "receipt photo".',
        },
        autoDetect: {
          type: 'BOOLEAN',
          description: 'Whether to run object detection and OCR immediately after image capture. Default true.',
        },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'vision_ocr_latest_frame',
    description: 'Runs OCR on the latest captured camera, photo, CCTV, or uploaded image frame and returns readable text plus OCR confidence and language.',
    parameters: {
      type: 'OBJECT',
      properties: {
        imageDataUrl: {
          type: 'STRING',
          description: 'Optional image data URL. If omitted, Beatrice uses the latest captured frame.',
        },
        sourceLabel: {
          type: 'STRING',
          description: 'Human-readable source label for the OCR result.',
        },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'vision_cctv_monitor_start',
    description: 'Opens a CCTV/IP camera monitor and repeatedly scans browser-readable frames for objects, boxes, labels, and potential threat flags. Supports HTTP snapshot, MJPEG, HLS, MP4, or other browser-readable feeds; RTSP needs a gateway.',
    parameters: {
      type: 'OBJECT',
      properties: {
        streamUrl: {
          type: 'STRING',
          description: 'Browser-readable CCTV feed URL, HTTP snapshot URL, MJPEG URL, HLS URL, or MP4 stream URL.',
        },
        sourceLabel: {
          type: 'STRING',
          description: 'Camera label, such as "warehouse entrance" or "front gate".',
        },
        intervalMs: {
          type: 'INTEGER',
          description: 'Detection interval in milliseconds. Default 3000.',
        },
      },
      required: ['streamUrl'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'vision_cctv_monitor_stop',
    description: 'Stops the active CCTV object-detection monitor.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'eburonflix_browse',
    description: 'Open EburonFlix and browse the catalog. Use when the user asks to see popular movies, top rated, new releases, Tagalog films, or to filter by genre.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mediaType: { type: 'STRING', description: 'Either "movie" or "tv". Defaults to "movie".' },
        category: { type: 'STRING', description: 'One of "popular", "new_released", "top_rated", or "tagalog". Defaults to "popular".' },
        genre: { type: 'STRING', description: 'Optional genre name like "Action", "Comedy", "Romance".' },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'eburonflix_search',
    description: 'Search EburonFlix for movies, TV shows, or actors by name. Returns top matches with title, year, and rating so Beatrice can describe them.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'The search term — title, actor name, or keyword.' },
        limit: { type: 'INTEGER', description: 'Max results to summarise (default 5, max 10).' },
      },
      required: ['query'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'eburonflix_play',
    description: 'Open the EburonFlix player and start streaming a movie or TV episode. Pass either a TMDB id or a title to resolve via search.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'The title of the movie or TV show to play.' },
        tmdbId: { type: 'INTEGER', description: 'Optional explicit TMDB id when known.' },
        mediaType: { type: 'STRING', description: 'Either "movie" or "tv". Defaults to "movie".' },
        season: { type: 'INTEGER', description: 'For TV: season number, default 1.' },
        episode: { type: 'INTEGER', description: 'For TV: episode number, default 1.' },
        server: { type: 'STRING', description: 'Optional source: "vidsrc.net", "vidsrc.in", "vidsrc.pm", or "vidsrc.xyz".' },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'eburonflix_translate',
    description: 'Translate the EburonFlix synopsis or actor biography into another language using TMDB translations.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tmdbId: { type: 'INTEGER', description: 'TMDB id of the movie, TV show, or person.' },
        mediaType: { type: 'STRING', description: 'One of "movie", "tv", or "person".' },
        language: { type: 'STRING', description: 'Target language: English name (e.g. "Dutch", "Tagalog", "Spanish") or ISO 639-1 code.' },
      },
      required: ['tmdbId', 'mediaType', 'language'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'eburonflix_close',
    description: 'Close the EburonFlix overlay and return the user to the previous Beatrice view.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'remember_this',
    description: 'Saves an important fact, preference, event, or personal detail about the current user into Beatrice\'s long-term conversation memory. Call this when the user says "remember this" / "save this" / "don\'t forget", or when Beatrice notices something important about the user during conversation (a preference, a life event, a personal detail, a goal, etc.). Memories are unique per user and persist across sessions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fact: {
          type: 'STRING',
          description: 'The fact, preference, event, or personal detail to remember. Use clear, specific wording like "Sarah prefers to be called by her first name" or "User is planning a trip to Japan next month".',
        },
        category: {
          type: 'STRING',
          description: 'Category of the memory: "preference", "personal", "fact", "event", "goal", "instruction", or "general". Default "general".',
        },
        importance: {
          type: 'STRING',
          description: 'How important this memory is: "low", "medium", "high", or "critical". Default "medium".',
        },
      },
      required: ['fact'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'remember_that',
    description: 'Shorthand version of remember_this — saves a personal detail about the current user into long-term conversation memory. Use when the user says "remember that I..." or "remember that about me...".',
    parameters: {
      type: 'OBJECT',
      properties: {
        fact: {
          type: 'STRING',
          description: 'The personal detail to remember about the user.',
        },
        category: {
          type: 'STRING',
          description: 'Category: "preference", "personal", "fact", "event", "goal", "instruction", or "general". Default "personal".',
        },
        importance: {
          type: 'STRING',
          description: '"low", "medium", "high", or "critical". Default "medium".',
        },
      },
      required: ['fact'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'conversation_memory_search',
    description: 'Searches Beatrice\'s long-term conversation memories for facts, preferences, or events that match a query. Use when the user asks "what do you remember about me?" or "do you remember when..." or when you need to recall something you saved earlier.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Natural language search query to find relevant memories.',
        },
        limit: {
          type: 'INTEGER',
          description: 'Maximum number of matching memories to return. Default 5, max 10.',
        },
      },
      required: ['query'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'conversation_memory_recent',
    description: 'Retrieves the most recent or most frequently accessed conversation memories for the current user. Use when the user asks "what do you know about me?" or to remind yourself of important user context.',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: {
          type: 'INTEGER',
          description: 'Maximum number of memories to return. Default 10. Max 20.',
        },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
  {
    name: 'conversation_memory_forget',
    description: 'Forgets/deletes a specific conversation memory. Use when the user says "forget that" or "never mind, don\'t remember that" or "remove that from your memory".',
    parameters: {
      type: 'OBJECT',
      properties: {
        fact: {
          type: 'STRING',
          description: 'The fact or memory to forget, described in natural language.',
        },
        memoryId: {
          type: 'STRING',
          description: 'Optional explicit memory id to forget.',
        },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.WHEN_IDLE,
  },
];
