import type { ISODateString } from '../common';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: ISODateString;
}

export interface PublicUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}
