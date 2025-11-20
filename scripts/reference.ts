export interface IReference {
}

export class GitRef implements IReference {
  url: string;
  branch?: string;
  commit?: string;
  constructor(url: string, commit: string) {
    this.url = url;
    this.commit = commit;
  }
}

export class HttpRef implements IReference {
  url: string;
  constructor(url: string) {
    this.url = url;
  }
}

export class LocalRef implements IReference {
  path: string;
  constructor(path: string) {
    this.path = path;
  }
}
