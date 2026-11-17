export type ModelModeId =
  | 'auto'
  | 'keyless-unlimited'
  | 'deepseek-r1'
  | 'searchgpt'
  | 'coder-pro'
  | 'local-webgpu';

export interface ModelModeOption {
  id: ModelModeId;
  label: string;
  shortLabel: string;
  rankBadge?: string;
  description: string;
  pollinationsModel: string;
}

export type IntentMode =
  | 'CASUAL_CHAT'
  | 'REALTIME_SEARCH'
  | 'CODE_DEBUG'
  | 'APP_BUILDER';

export interface LiveSource {
  title: string;
  url: string;
  snippet: string;
  provider: 'DuckDuckGo' | 'Wikipedia' | 'Google Search' | 'Google Maps' | 'SearchGPT';
}

export interface ChatImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

export type MultimodalPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ApiMessageContent = string | MultimodalPart[];

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImageAttachment[];
  createdAt: number;
  modelMode?: ModelModeId;
  engineUsed?: string;
  thinkingDurationSec?: number;
  sources?: LiveSource[];
  isError?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface PersonaRule {
  id: string;
  type: 'rule' | 'fact' | 'qa';
  label: string;
  content: string;
  answer?: string;
  enabled: boolean;
  createdAt: number;
}

export interface MapPlaceResult {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  types?: string[];
}

export interface MapsGroundingLink {
  title: string;
  uri: string;
  reviewSnippets?: string[];
}

export interface LocalModelProgress {
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  text: string;
}
