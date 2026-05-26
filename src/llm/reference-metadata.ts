import type { ReferenceFailureReason } from '../constants/reference-failures.js';
import type { TemplateWarning } from '../constants/template-warnings.js';

export interface TemplateParamsInput {
  [key: string]: Record<string, unknown>;
}

export interface TemplateParamDeclaration {
  type: 'string' | 'document';
  required?: boolean;
  default?: unknown;
}

export interface TemplateParamUsage {
  type: 'string' | 'document';
  chars: number;
  input?: string;
  resolved_to?: string;
}

export interface TemplateItemMetadata {
  input: string;
  chars: number;
  resolved_to?: string;
  template?: boolean;
  template_path?: string;
  template_params_used?: Record<string, TemplateParamUsage>;
  template_warnings?: TemplateWarning[];
}

export interface InjectedReferenceMetadata {
  ref: string;
  chars: number;
  resolved_to?: string;
  template?: boolean;
  template_path?: string;
  template_params_used?: Record<string, TemplateParamUsage>;
  template_warnings?: TemplateWarning[];
  resolved_to_count?: number;
  items?: TemplateItemMetadata[];
}

export interface InjectionMetadata {
  injectedReferences: InjectedReferenceMetadata[];
  promptChars: number;
}

export interface RenderTemplateDocumentSuccess {
  ok: true;
  content: string;
  paramsUsed: Record<string, TemplateParamUsage>;
  warnings: TemplateWarning[];
}

export interface RenderTemplateDocumentFailure {
  ok: false;
  reason: ReferenceFailureReason;
  detail: string;
}

export type RenderTemplateDocumentResult =
  | RenderTemplateDocumentSuccess
  | RenderTemplateDocumentFailure;
