import type { TaskInfo } from './task-engagement';

export type ProcessingMessage = {
  id: string;
  text: string;
  type: 'opening' | 'entertainment' | 'result';
  subType?: string;
};

export type ProcessingStepStatus = 'idle' | 'running' | 'done' | 'skipped' | 'error';

export type ProcessingStep = {
  key: 'route' | 'workspace' | 'model' | 'finalize';
  label: string;
  detail: string;
  status: ProcessingStepStatus;
};

export type ProcessingServiceKey =
  | 'core'
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'docs'
  | 'meet'
  | 'maps'
  | 'scanner'
  | 'memory'
  | 'video'
  | 'image'
  | 'research'
  | 'model';

export type ProcessingConsoleState = {
  activeServiceKeys: ProcessingServiceKey[];
  currentProcess: string;
  statusNote: string;
  stage: 'running' | 'completed' | 'failed';
  steps: ProcessingStep[];
};

export type ProcessingServiceVisual = {
  title: string;
  scope: string;
  icon: string;
  accent: string;
  mode: 'scan' | 'flip' | 'pulse' | 'lines' | 'grid' | 'buffer' | 'bubbles' | 'wave';
  loadingLabel: string;
};

export type ProcessingTaskInfo = {
  type: string;
  label: string;
  icon: string;
};

export const PROCESSING_SERVICE_VISUALS: Record<ProcessingServiceKey, ProcessingServiceVisual> = {
  core: {
    title: 'Beatrice Core',
    scope: 'task/router',
    icon: 'ph-fill ph-sparkle',
    accent: '#a855f7',
    mode: 'pulse',
    loadingLabel: 'Routing Intent',
  },
  gmail: {
    title: 'Gmail',
    scope: 'mail.google.com',
    icon: 'ph-fill ph-envelope',
    accent: '#EA4335',
    mode: 'scan',
    loadingLabel: 'Indexing Inbox',
  },
  calendar: {
    title: 'Calendar',
    scope: 'auth/calendar',
    icon: 'ph-fill ph-calendar-blank',
    accent: '#4285F4',
    mode: 'flip',
    loadingLabel: 'Checking Schedule',
  },
  drive: {
    title: 'Drive',
    scope: 'auth/drive',
    icon: 'ph-fill ph-hard-drives',
    accent: '#FBBC05',
    mode: 'pulse',
    loadingLabel: 'Querying Metadata',
  },
  docs: {
    title: 'Docs',
    scope: 'auth/documents',
    icon: 'ph-fill ph-file-doc',
    accent: '#4285F4',
    mode: 'lines',
    loadingLabel: 'Parsing Structure',
  },
  meet: {
    title: 'Meet',
    scope: 'auth/meet',
    icon: 'ph-fill ph-video-camera',
    accent: '#34A853',
    mode: 'bubbles',
    loadingLabel: 'Provisioning Room',
  },
  maps: {
    title: 'Maps',
    scope: 'auth/maps',
    icon: 'ph-fill ph-map-pin-area',
    accent: '#34A853',
    mode: 'grid',
    loadingLabel: 'Plotting Route',
  },
  scanner: {
    title: 'Scanner',
    scope: 'document/vision',
    icon: 'ph-fill ph-scan',
    accent: '#ec4899',
    mode: 'scan',
    loadingLabel: 'Calibrating Capture',
  },
  memory: {
    title: 'Memory',
    scope: 'long-term/index',
    icon: 'ph-fill ph-brain',
    accent: '#8b5cf6',
    mode: 'pulse',
    loadingLabel: 'Linking Context',
  },
  video: {
    title: 'Video',
    scope: 'render/pipeline',
    icon: 'ph-fill ph-film-strip',
    accent: '#f97316',
    mode: 'buffer',
    loadingLabel: 'Rendering Frames',
  },
  image: {
    title: 'Image',
    scope: 'visual/generator',
    icon: 'ph-fill ph-image',
    accent: '#ec4899',
    mode: 'wave',
    loadingLabel: 'Synthesizing Visual',
  },
  research: {
    title: 'Research',
    scope: 'knowledge/search',
    icon: 'ph-fill ph-magnifying-glass',
    accent: '#14b8a6',
    mode: 'grid',
    loadingLabel: 'Collecting Sources',
  },
  model: {
    title: 'Reasoning',
    scope: 'deepseek-chat',
    icon: 'ph-fill ph-cpu',
    accent: '#c084fc',
    mode: 'wave',
    loadingLabel: 'Synthesizing Response',
  },
};

export function getProcessingServiceKeys(task: ProcessingTaskInfo): ProcessingServiceKey[] {
  switch (task.type) {
    case 'email_compose':
    case 'email_read':
      return ['gmail', 'model'];
    case 'calendar_check':
    case 'calendar_create':
      return ['calendar', 'model'];
    case 'drive_search':
      return ['drive', 'model'];
    case 'docs_create':
      return ['docs', 'model'];
    case 'meet_schedule':
      return ['calendar', 'meet', 'model'];
    case 'maps_navigate':
      return ['maps', 'model'];
    case 'document_scan':
      return ['scanner', 'memory', 'model'];
    case 'document_memory':
      return ['memory', 'model'];
    case 'video_generate':
      return ['video', 'model'];
    case 'image_generate':
      return ['image', 'model'];
    case 'research':
      return ['research', 'model'];
    default:
      return ['core', 'model'];
  }
}

export function createProcessingConsole(task: ProcessingTaskInfo): ProcessingConsoleState {
  const services = getProcessingServiceKeys(task);
  const primaryService = PROCESSING_SERVICE_VISUALS[services[0]];
  return {
    activeServiceKeys: services,
    currentProcess: `Routing request into ${task.label.toLowerCase()}`,
    statusNote: `Preparing ${primaryService.title} workflow`,
    stage: 'running',
    steps: [
      {
        key: 'route',
        label: 'Route Request',
        detail: `Detecting task intent for ${task.label.toLowerCase()}`,
        status: 'running',
      },
      {
        key: 'workspace',
        label: primaryService.title === 'Reasoning' ? 'Prepare Services' : `${primaryService.title} Service`,
        detail: `Waiting to start ${primaryService.title.toLowerCase()} pipeline`,
        status: 'idle',
      },
      {
        key: 'model',
        label: 'Model Synthesis',
        detail: 'Queued for response generation',
        status: 'idle',
      },
      {
        key: 'finalize',
        label: 'Finalize Response',
        detail: 'Pending handoff to the conversation',
        status: 'idle',
      },
    ],
  };
}

export function updateProcessingStep(
  state: ProcessingConsoleState | null,
  key: ProcessingStep['key'],
  status: ProcessingStepStatus,
  detail?: string,
): ProcessingConsoleState | null {
  if (!state) return state;
  return {
    ...state,
    steps: state.steps.map(step =>
      step.key === key
        ? {
            ...step,
            status,
            detail: detail ?? step.detail,
          }
        : step,
    ),
  };
}

export function getProcessingTaskInfoFromToolName(toolName: string): ProcessingTaskInfo {
  const normalized = toolName.toLowerCase();

  if (normalized.includes('gmail') || normalized.includes('email')) {
    return { type: 'email_compose', label: 'Executing Gmail task', icon: '✉️' };
  }
  if (normalized.includes('calendar')) {
    return { type: 'calendar_create', label: 'Executing Calendar task', icon: '🗓️' };
  }
  if (normalized.includes('drive')) {
    return { type: 'drive_search', label: 'Executing Drive task', icon: '📁' };
  }
  if (normalized.includes('docs')) {
    return { type: 'docs_create', label: 'Executing Docs task', icon: '📝' };
  }
  if (normalized.includes('meet')) {
    return { type: 'meet_schedule', label: 'Executing Meet task', icon: '🎥' };
  }
  if (normalized.includes('map') || normalized.includes('navigate')) {
    return { type: 'maps_navigate', label: 'Executing Maps task', icon: '🗺️' };
  }
  if (normalized.includes('scan')) {
    return { type: 'document_scan', label: 'Executing scanner task', icon: '📄' };
  }
  if (normalized.includes('memory')) {
    return { type: 'document_memory', label: 'Executing memory task', icon: '🧠' };
  }
  if (normalized.includes('video')) {
    return { type: 'video_generate', label: 'Executing video task', icon: '🎬' };
  }
  if (normalized.includes('image')) {
    return { type: 'image_generate', label: 'Executing image task', icon: '🎨' };
  }

  return { type: 'general', label: 'Executing Beatrice task', icon: '⚡' };
}

export function toProcessingTaskInfo(task: TaskInfo): ProcessingTaskInfo {
  return task;
}
