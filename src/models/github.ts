export interface GhStatus {
  installed: boolean;
  authenticated: boolean;
}

export interface PrStatus {
  title: string;
  url: string;
  state: string;
  checksPassing: boolean | null;
  checksTotal: number;
}
