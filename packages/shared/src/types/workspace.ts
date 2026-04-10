export type FileType =
  | 'directory'
  | 'text'
  | 'code'
  | 'markdown'
  | 'json'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'archive'
  | 'unknown';

export interface FileEntry {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly isDirectory: boolean;
  readonly type: FileType;
}

export interface DirectoryListing {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: readonly FileEntry[];
}

export interface FileContent {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly type: FileType;
  readonly content: string | null;
  readonly truncated: boolean;
}

export interface CreateEntryRequest {
  readonly path: string;
  readonly type: 'file' | 'directory';
}

export interface RenameRequest {
  readonly path: string;
  readonly newName: string;
}

export interface MoveRequest {
  readonly path: string;
  readonly destination: string;
}

export interface DeleteRequest {
  readonly path: string;
}

export interface DeleteResponse {
  readonly path: string;
  readonly deleted: true;
}

export interface UpdateContentRequest {
  readonly path: string;
  readonly content: string;
  readonly expectedModifiedAt: string;
  readonly force?: boolean;
}

export interface UpdateContentResponse {
  readonly path: string;
  readonly size: number;
  readonly modifiedAt: string;
}
