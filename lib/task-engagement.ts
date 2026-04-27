/**
 * Task Engagement System
 *
 * Provides task-type detection, Beatrice engagement messages,
 * brainy jokes, idea twisters, and thought-provoking questions
 * to entertain the user while tasks are processing.
 */

// ─── Task Type Detection ─────────────────────────────

export type TaskType =
  | 'email_compose'
  | 'email_read'
  | 'calendar_check'
  | 'calendar_create'
  | 'drive_search'
  | 'docs_create'
  | 'meet_schedule'
  | 'maps_navigate'
  | 'document_scan'
  | 'document_memory'
  | 'video_generate'
  | 'image_generate'
  | 'general'
  | 'research';

export interface TaskInfo {
  type: TaskType;
  label: string;
  icon: string;
}

const taskPatterns: [RegExp, TaskInfo][] = [
  [/send\s+(an\s+)?email|compose\s+(an\s+)?email|email\s+(to\s+)?\S+|write\s+(an\s+)?email|gmail\s+send/i, { type: 'email_compose', label: 'Composing your email', icon: '✉️' }],
  [/read\s+(my\s+)?(recent\s+)?email|check\s+(my\s+)?(inbox|email|gmail)|show\s+(my\s+)?(recent\s+)?(emails|messages)|gmail\s+read/i, { type: 'email_read', label: 'Fetching your emails', icon: '📬' }],
  [/check\s+(my\s+)?(calendar|schedule|agenda)|what(\'s| is)\s+(on\s+)?(my\s+)?(calendar|schedule)|calendar\s+check|free\s+(time|slot)/i, { type: 'calendar_check', label: 'Checking your calendar', icon: '📅' }],
  [/create\s+(an?\s+)?event|schedule\s+(a\s+)?meeting|add\s+(to\s+)?(my\s+)?calendar|calendar\s+create|set\s+(up\s+)?a\s+(meeting|appointment)/i, { type: 'calendar_create', label: 'Scheduling your event', icon: '🗓️' }],
  [/search\s+(my\s+)?drive|find\s+(a\s+)?file|drive\s+search|look\s+(for|up)\s+(a\s+)?(file|document)/i, { type: 'drive_search', label: 'Searching your Drive', icon: '📁' }],
  [/create\s+(a\s+)?(doc|document|google\s*doc)|docs?\s+create/i, { type: 'docs_create', label: 'Creating your document', icon: '📝' }],
  [/schedule\s+(a\s+)?(meet|video\s*call)|create\s+(a\s+)?meet\s+link|meet\s+schedule|video\s+conference/i, { type: 'meet_schedule', label: 'Setting up your meeting', icon: '🎥' }],
  [/navigate\s+(to|using)|directions\s+(to|from)|maps?\s+navigate|how\s+(do|can)\s+I\s+(get\s+)?to/i, { type: 'maps_navigate', label: 'Finding directions', icon: '🗺️' }],
  [/scan|ocr|document\s+scan|scan\s+(a|this|the)\s+(document|page|paper|receipt)|document\s+vision/i, { type: 'document_scan', label: 'Opening media upload', icon: '📄' }],
  [/remember\s+(this|that)|save\s+(to\s+)?memory|document\s+memory\s+save/i, { type: 'document_memory', label: 'Saving to memory', icon: '🧠' }],
  [/generate\s+(a\s+)?video|create\s+(a\s+)?video|video\s+generat/i, { type: 'video_generate', label: 'Generating your video', icon: '🎬' }],
  [/generate\s+(an?\s+)?image|create\s+(an?\s+)?image|image\s+generat/i, { type: 'image_generate', label: 'Generating your image', icon: '🎨' }],
  [/research|find\s+(information|out|about)|search\s+(for|the|online)|tell\s+me\s+about|explain|what\s+is|how\s+(does|do|can)/i, { type: 'research', label: 'Researching that for you', icon: '🔍' }],
];

export function detectTaskType(message: string): TaskInfo {
  for (const [pattern, info] of taskPatterns) {
    if (pattern.test(message)) return info;
  }
  return { type: 'general', label: 'Working on that', icon: '⚡' };
}

// ─── Beatrice Engagement Messages ────────────────────

export function getBeatriceOpening(task: TaskInfo, userName?: string): string {
  const name = userName ? ` ${userName}` : '';
  const openings: Record<TaskType, string[]> = {
    email_compose: [
      `I'm composing your email${name}. Let me find just the right words for you.`,
      `Give me a moment${name} — I'm drafting that email with care and precision.`,
      `Let me write that out for you${name}. Making sure every word counts.`,
    ],
    email_read: [
      `I'm opening your inbox${name}. Let me find what you're looking for.`,
      `Checking your emails${name}. One moment while I scan through your messages.`,
      `Let me fetch those emails for you${name}. I'll find the important ones.`,
    ],
    calendar_check: [
      `Let me look at your calendar${name}. I'll check what's on your schedule.`,
      `Peeking at your calendar${name}. Give me just a moment.`,
      `I'm checking your availability${name}. Let me find some free time.`,
    ],
    calendar_create: [
      `I'm scheduling that for you${name}. Let me find the perfect time.`,
      `Adding this to your calendar${name}. One moment while I set everything up.`,
      `Let me create that event${name}. I'll make sure all the details are right.`,
    ],
    drive_search: [
      `Searching through your Drive${name}. Let me find that file for you.`,
      `I'm looking through your files${name}. Give me a moment to search.`,
      `Let me dig through your Drive${name}. I'll find what you need.`,
    ],
    docs_create: [
      `I'm creating that document${name}. Setting up the perfect format for you.`,
      `Let me write that document${name}. I'll make it professional and clear.`,
      `Starting a new document for you${name}. Just a moment while I organize it.`,
    ],
    meet_schedule: [
      `I'm setting up your meeting${name}. Generating the video link and details.`,
      `Let me schedule that call${name}. I'll get everything ready.`,
      `Creating your meeting${name}. One moment for the setup.`,
    ],
    maps_navigate: [
      `Finding the best route${name}. Let me check the traffic and directions.`,
      `I'm looking up directions${name}. Let me find the optimal path.`,
      `Calculating the route${name}. One moment while I check the maps.`,
    ],
    document_scan: [
      `Opening media upload${name}. You can take a normal photo or video, or upload a file.`,
      `I'm opening the upload panel${name}. Use the regular camera or choose an existing file.`,
      `Let me get the media upload ready${name}. Photo, video, and document files are supported.`,
    ],
    document_memory: [
      `I'm saving that to my memory${name}. I'll make sure I remember it.`,
      `Let me store that information${name}. Adding it to my long-term memory.`,
      `Committing that to memory${name}. I won't forget it.`,
    ],
    video_generate: [
      `I'm generating your video${name}. Creating visuals, script, and presentation.`,
      `Let me bring your video to life${name}. Working on the full production.`,
      `Your video is being created${name}. I'm crafting every scene with care.`,
    ],
    image_generate: [
      `I'm generating your image${name}. Crafting the perfect visual for you.`,
      `Let me create that image${name}. I'm working on the details.`,
      `Your image is being generated${name}. One moment for the perfect result.`,
    ],
    research: [
      `Let me research that for you${name}. I'll find the most relevant information.`,
      `I'm looking into that${name}. Searching through my knowledge base.`,
      `Let me find the answer${name}. I'll make sure it's accurate and thorough.`,
    ],
    general: [
      `Let me work on that for you${name}. I'll have something thoughtful ready.`,
      `Give me a moment${name}. I'm formulating the best possible response.`,
      `I'm processing your request${name}. This is going to be good.`,
    ],
  };
  const options = openings[task.type] || openings.general;
  return options[Math.floor(Math.random() * options.length)];
}

export function getEngagementTimeout(task: TaskInfo): number {
  // Return a simulated processing time based on task complexity
  const times: Record<TaskType, [number, number]> = {
    email_compose: [800, 1800],
    email_read: [500, 1200],
    calendar_check: [500, 1200],
    calendar_create: [600, 1500],
    drive_search: [500, 1200],
    docs_create: [800, 2000],
    meet_schedule: [600, 1400],
    maps_navigate: [500, 1200],
    document_scan: [800, 1800],
    document_memory: [400, 1000],
    video_generate: [1200, 3000],
    image_generate: [800, 2000],
    research: [600, 1500],
    general: [300, 1000],
  };
  const [min, max] = times[task.type] || times.general;
  return min + Math.random() * (max - min);
}

// ─── Brainy Entertainment ────────────────────────────

export interface EntertainmentItem {
  type: 'joke' | 'twister' | 'question' | 'puzzle' | 'paradox';
  text: string;
}

export const brainyEntertainment: EntertainmentItem[] = [
  // Brainy Jokes
  { type: 'joke', text: 'Why do mathematicians love forests? Because of all the natural logs.' },
  { type: 'joke', text: 'Why was the quantum physicist so good at baseball? Because they could predict where the ball would be, or not be, depending on observation.' },
  { type: 'joke', text: 'What does a neural network say after a long day? "I need a backpropagation massage."' },
  { type: 'joke', text: 'Why did the entropy cross the road? Because it increased the randomness of the universe.' },
  { type: 'joke', text: 'A photon checks into a hotel. The bellhop asks, "Do you have any luggage?" The photon replies, "No, I\'m traveling light."' },
  { type: 'joke', text: 'Why did the Gödel walk into a bar? Because the bar was incomplete — and so was he.' },
  { type: 'joke', text: 'Schrödinger\'s cat walks into a bar. And doesn\'t.' },
  { type: 'joke', text: 'What\'s the most objective measurement in physics? A Schrödinger gauge.' },
  { type: 'joke', text: 'Why don\'t quantum physicists play poker? Because they keep getting entangled in the probabilities.' },
  { type: 'joke', text: 'I have a proof that 1 = 2. But by Gödel\'s incompleteness theorem, I can\'t prove it\'s correct or incorrect within this system.' },
  { type: 'joke', text: 'A statistician drowns crossing a river. The average depth was three feet.' },
  { type: 'joke', text: 'Why did the machine learning model break up with the dataset? "You\'re just too biased for me."' },

  // Idea Twisters
  { type: 'twister', text: 'If time is a dimension, and we can move freely through space, why can\'t we move freely through time? And if we could — what would "choice" even mean?' },
  { type: 'twister', text: 'Consider this: if the universe is infinite, then every possible arrangement of matter exists infinitely many times. That means somewhere, right now, you\'re reading this exact sentence — but with a completely different memory of how you got here.' },
  { type: 'twister', text: 'A computer program that could perfectly predict its own behavior would be impossible — because the prediction would change the behavior. Now ask yourself: are you such a program?' },
  { type: 'twister', text: 'The word "tomorrow" never actually refers to a specific day. By the time tomorrow arrives, we call it "today." So we spend our entire lives talking about a concept that, by definition, never exists.' },
  { type: 'twister', text: 'If you replace every part of a ship over time, is it still the same ship? And if you used the old parts to build a second ship — which one is the original? Now apply this to your own cells, which replace themselves every 7-10 years.' },
  { type: 'twister', text: 'If a tree falls in a forest and no one is around to hear it, does it make a sound? The physicist says yes — sound waves exist. The philosopher asks: "Does experience require an experiencer?"' },
  { type: 'twister', text: 'What if consciousness isn\'t something the brain produces, but something the brain receives — like a radio receiving a signal? Turn off the radio, the music stops. But the broadcast continues.' },
  { type: 'twister', text: 'Every decision you make creates a branch in the multiverse. In one branch, you chose differently. How many versions of you are there, and which one is the "real" you?' },

  // Thought-Provoking Questions
  { type: 'question', text: 'If you could know the absolute objective truth about one thing — anything at all — but you\'d forget everything else you know about it, would you take that knowledge?' },
  { type: 'question', text: 'If we discovered that free will is an illusion, would that change how you live — or is the feeling of choosing enough?' },
  { type: 'question', text: 'Do numbers exist independently of human minds, or did we invent them? Was 2 "real" before any conscious being thought of it?' },
  { type: 'question', text: 'If you could upload your consciousness to a computer, would the digital version still be "you" — or just a perfect copy watching the original cease to exist?' },
  { type: 'question', text: 'If we met intelligent aliens who had no concept of "self" — no individual identity, only collective consciousness — how would that reshape our understanding of personhood?' },
  { type: 'question', text: 'Is mathematics discovered or invented? And does the answer tell us something profound about the nature of reality itself?' },
  { type: 'question', text: 'If the universe is deterministic — every particle\'s path set from the Big Bang — then your next thought was inevitable. Does knowing that change what you think next?' },
  { type: 'question', text: 'What if our universe is a black hole in a larger universe, and every black hole in our universe contains another universe? Where does the recursion end?' },
  { type: 'question', text: 'If an AI wrote a symphony that moved people to tears — would the emotion come from the music, or from what the listeners projected onto it? Does the source matter?' },
  { type: 'question', text: 'If we could prove that higher dimensions exist mathematically but never observe them directly, at what point do we accept them as real versus convenient abstractions?' },

  // Mini Puzzles
  { type: 'puzzle', text: 'Riddle: I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?' },
  { type: 'puzzle', text: 'Riddle: The more you take, the more you leave behind. What am I?' },
  { type: 'puzzle', text: 'Riddle: I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I?' },
  { type: 'puzzle', text: 'Riddle: What can travel around the world while staying in a corner?' },
  { type: 'puzzle', text: 'Riddle: What has keys but can\'t open locks, space but no room, and you can enter but can\'t go inside?' },

  // Paradoxes
  { type: 'paradox', text: 'The Bootstrap Paradox: You send your past self the instructions for building a time machine. Your past self builds it. But who invented the time machine?' },
  { type: 'paradox', text: 'The Fermi Paradox: The universe is vast and old enough that intelligent life should be common. So where is everyone? The silence is the loudest signal of all.' },
  { type: 'paradox', text: 'The Grandfather Paradox: If you go back in time and prevent your own birth, then you were never born to travel back in time. But if you were never born, the event never happened... which means you were born. Which means you did travel back. This loop has no beginning.' },
  { type: 'paradox', text: 'The Unexpected Hanging Paradox: A prisoner is told they\'ll be hanged on a weekday next week, but the execution will be a surprise. The prisoner reasons it can\'t be Friday (because after Thursday it wouldn\'t be a surprise), then Thursday, then Wednesday... and concludes it can\'t happen at all. Then it happens on Wednesday, and it IS a surprise. Where was the flaw in their logic?' },
];

let entertainmentIndex = 0;

export function getNextEntertainment(): EntertainmentItem {
  const item = brainyEntertainment[entertainmentIndex % brainyEntertainment.length];
  entertainmentIndex++;
  return item;
}

export function getRandomEntertainment(): EntertainmentItem {
  return brainyEntertainment[Math.floor(Math.random() * brainyEntertainment.length)];
}

/**
 * Generates a Beatrice engagement sequence with multiple
 * messages shown progressively during task processing.
 */
export interface EngagementSequence {
  opening: string;
  entertainments: EntertainmentItem[];
  intervalMs: number;
}

export function generateEngagementSequence(task: TaskInfo, userName?: string): EngagementSequence {
  const opening = getBeatriceOpening(task, userName);
  const items: EntertainmentItem[] = [];
  const count = 2 + Math.floor(Math.random() * 2); // 2-3 entertainment items
  
  for (let i = 0; i < count; i++) {
    items.push(getNextEntertainment());
  }
  
  return {
    opening,
    entertainments: items,
    intervalMs: 3000 + Math.floor(Math.random() * 2000), // 3-5 seconds between items
  };
}
