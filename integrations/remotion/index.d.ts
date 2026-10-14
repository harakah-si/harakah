// Types for `harakah-fixer/remotion` (remotion.config.ts): Config.overrideWebpackConfig(withHarakah())
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface HarakahRemotionOptions {
  /** Also block on warnings (default: errors only). HARAKAH_GATE=strict does the same. */
  strict?: boolean;
  /** Treat every component as Arabic. Rarely needed: Arabic is followed through props, defaultProps and --props. */
  assumeArabic?: boolean;
  /** Project root (default: nearest folder with package.json + remotion.config / src). */
  root?: string;
  /** "warn" never blocks renders (HARAKAH_GATE=warn). */
  mode?: "auto" | "warn";
  /** Show the Harakah panel inside Remotion Studio (default true; development builds only). */
  studioOverlay?: boolean;
  /** Render-time props to follow: an object, inline JSON or a JSON file path. Default: read `--props` from the Remotion command. */
  inputProps?: Record<string, unknown> | string;
  /** Composition id(s) the props apply to. Default: read from the Remotion command. */
  composition?: string | string[];
  /** Command line to read `--props` / composition id from (default process.argv); false = don't read it. */
  argv?: string[] | false;
  /** Path to the harakah-fix CLI (default: this package's dist/cli.js; env HARAKAH_CLI). */
  cli?: string;
  /** Extra node arguments for the CLI child process. */
  nodeArgs?: string[];
  /** Gate timeout in ms (default 120000). */
  timeoutMs?: number;
  /** Also run the runtime layout audit (HZ24: Arabic visual order at sampled frames) before renders. HARAKAH_LAYOUT=1/0 overrides. Default false (adds ~2 s per composition). */
  layout?: boolean;
  /** Log "Arabic OK" in Studio. */
  verbose?: boolean;
}
type WebpackOverride = (config: any) => any | Promise<any>;
/** Wrap (or create) a Remotion webpack override that adds the Harakah gate (renders) and panel (Studio). */
export function withHarakah(options?: HarakahRemotionOptions): WebpackOverride;
export function withHarakah(override: WebpackOverride, options?: HarakahRemotionOptions): WebpackOverride;
export class HarakahWebpackPlugin {
  constructor(options?: HarakahRemotionOptions & { resultsFile?: string });
  apply(compiler: any): void;
}
/** `--props` value and composition-id candidates from a Remotion CLI argv. */
export function renderArgs(argv: string[]): { props?: string; compositions: string[] };
/** Where the Studio panel's results JSON lives for a project root. */
export function resultsFile(root: string): string;
export const OVERLAY: string;
