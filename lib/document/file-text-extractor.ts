import { normalizeWhitespace } from './utils';

export type KnowledgeFileKind =
  | 'image'
  | 'pdf'
  | 'docx'
  | 'spreadsheet'
  | 'text'
  | 'binary';

export interface ExtractedFileText {
  kind: KnowledgeFileKind;
  text: string;
  rawCharCount: number;
  truncated: boolean;
  mimeType: string;
  filename: string;
}

const TEXT_LIKE_EXT = new Set([
  'txt',
  'md',
  'markdown',
  'rst',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'sh',
  'bash',
  'zsh',
  'sql',
  'log',
  'ini',
  'toml',
  'env',
  'conf',
  'csv',
  'tsv',
]);

const TEXT_LIKE_MIME_PREFIXES = ['text/', 'application/json', 'application/xml'];

const fileToArrayBuffer = (file: File) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsArrayBuffer(file);
  });

const fileToText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsText(file);
  });

let pdfJsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

const loadPdfJs = () => {
  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist').then(module => {
      module.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      return module;
    });
  }
  return pdfJsPromise;
};

export const getKnowledgeFileKind = (file: File): KnowledgeFileKind => {
  const mime = file.type.toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return 'docx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.oasis.opendocument.spreadsheet' ||
    ext === 'xlsx' ||
    ext === 'xls' ||
    ext === 'ods'
  ) {
    return 'spreadsheet';
  }
  if (TEXT_LIKE_EXT.has(ext) || TEXT_LIKE_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))) {
    return 'text';
  }
  return 'binary';
};

const maybeTruncate = (text: string, maxChars?: number) => {
  const cleaned = normalizeWhitespace(text);
  if (!maxChars || cleaned.length <= maxChars) {
    return {
      text: cleaned,
      rawCharCount: cleaned.length,
      truncated: false,
    };
  }
  return {
    text: cleaned.slice(0, maxChars),
    rawCharCount: cleaned.length,
    truncated: true,
  };
};

const extractPdfText = async (file: File) => {
  const pdfjs = await loadPdfJs();
  const buf = await fileToArrayBuffer(file);
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map(item => ('str' in item ? (item as any).str : ''))
      .filter(Boolean)
      .join(' ');
    if (pageText.trim()) {
      pages.push(`--- Page ${pageNum} ---\n${pageText}`);
    }
  }

  return pages.join('\n\n');
};

const extractDocxText = async (file: File) => {
  const mammoth = await import('mammoth/mammoth.browser');
  const buf = await fileToArrayBuffer(file);
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value || '';
};

const extractSpreadsheetText = async (file: File) => {
  const XLSX = await import('xlsx');
  const buf = await fileToArrayBuffer(file);
  const workbook = XLSX.read(buf, { type: 'array' });
  const out: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) {
      out.push(`--- Sheet: ${sheetName} ---`);
      out.push(csv.trim());
    }
  }

  return out.join('\n\n');
};

export async function extractFileText(
  file: File,
  options: { maxChars?: number } = {},
): Promise<ExtractedFileText> {
  const kind = getKnowledgeFileKind(file);
  let raw = '';

  if (kind === 'pdf') {
    raw = await extractPdfText(file);
  } else if (kind === 'docx') {
    raw = await extractDocxText(file);
  } else if (kind === 'spreadsheet') {
    raw = await extractSpreadsheetText(file);
  } else if (kind === 'text') {
    raw = await fileToText(file);
  }

  const truncated = maybeTruncate(raw, options.maxChars);
  return {
    kind,
    text: truncated.text,
    rawCharCount: truncated.rawCharCount,
    truncated: truncated.truncated,
    mimeType: file.type || 'application/octet-stream',
    filename: file.name || 'uploaded-file',
  };
}
