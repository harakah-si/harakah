declare module "fontkit" {
  export function create(buffer: Buffer, postscriptName?: string): any;
  export function openSync(file: string, postscriptName?: string): any;
}
