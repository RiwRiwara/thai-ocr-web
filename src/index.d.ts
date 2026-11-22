export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];

export interface OcrLine {
  /** Recognised text of the line (Thai-normalised). */
  text: string;
  /** Mean per-character probability, 0..1. */
  confidence: number;
  /** Index of the reading-order row the line belongs to. */
  row: number;
  /** Corners TL, TR, BR, BL in the coordinates of the image passed to read(). */
  box: Quad;
}

export interface DroppedLine extends OcrLine {
  reason: "empty" | "low_confidence" | "too_short" | "invalid_thai";
}

export interface OcrResult {
  /** The page's text in reading order, one row per line. */
  text: string;
  lines: OcrLine[];
  /** Lines the filter removed (stamps, signatures, specks) and why. */
  dropped: DroppedLine[];
  /** Median text angle after straightening, degrees. */
  text_angle: number;
  /** Clockwise turn applied to an upright page: 0, 90, 180 or 270. */
  rotation: 0 | 90 | 180 | 270;
  timing: { det_ms: number; rec_ms: number; n_lines: number };
}

/** Pixels in RGBA order, e.g. CanvasRenderingContext2D.getImageData(). */
export interface ImageDataLike {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export type ConfigOverrides = Partial<Record<keyof typeof DEFAULTS, Record<string, unknown>>>;

export interface CreateOptions {
  ort: any;
  cv: any;
  ClipperLib: any;
  /** Returns the bytes (or text) of one file of the model folder: det.yml, config.json, rec_dict.txt, *.onnx. */
  loadFile(name: string): Promise<Uint8Array | string>;
  executionProviders?: string[];
  overrides?: ConfigOverrides;
  sessionOptions?: Record<string, unknown>;
}

export declare const DEFAULTS: Record<string, Record<string, unknown>>;

export declare class LineOCR {
  static create(options: CreateOptions): Promise<LineOCR>;
  /** Read one page: ImageData-like RGBA pixels, or a cv.Mat (BGR, grey or RGBA). */
  read(image: ImageDataLike | any): Promise<OcrResult>;
  dispose(): Promise<void>;
  cfg: Record<string, Record<string, unknown>>;
}

export declare function canonical(text: string): string;
export declare function fixScripts(text: string): string;
export declare function invalidShare(text: string): number;
export declare function lineHeight(boxes: Quad[]): number;
export declare function pageSkew(boxes: Quad[]): number;
export declare function readingOrder(boxes: Quad[], angle?: number | null, columns?: boolean,
  texts?: string[] | null, rules?: Record<string, number> | null): number[][];
