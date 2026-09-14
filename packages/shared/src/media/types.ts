export type AttachmentKind = 'image' | 'audio';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  sizeBytes: number;
  url: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface MediaUploadResult {
  attachment: Attachment;
}
