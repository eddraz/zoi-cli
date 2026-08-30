export interface OptionKV {
  path: string; // Relative path
}

export class DenoKV {
  private fullpath: string;

  constructor(option: OptionKV) {
    this.fullpath = Deno.cwd() + option.path;
  }
  async connect() {
    return await Deno.openKv(this.fullpath);
  }
  async disconnect() {
    const kv = await this.connect();

    return kv.close();
  }
}
