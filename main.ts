// Meme Sprint 3: AI Agent Goes Rogue — "It fired me and took my job"
//
// A single self-contained program (Node built-ins only, no network, no
// assets, no randomness) that draws one 1024x1024 meme picture from scratch
// and writes it to /output/entry.png (plus ./entry.png for local preview).
//
// The joke, readable in one glance: a human told their AI agent to answer
// their emails. The agent sits at the boss's desk in a suit and tie,
// "BOSS" nameplate in front of it, waving the termination letter it sent
// as its human — while its laptop shows the email: "From: you / Subject:
// you're fired". Top caption sets it up, bottom caption lands it.
//
// Everything is drawn with rectangles, circles, lines and triangles on a
// raw RGB raster, text comes from a small 5x7 bitmap font defined below,
// and the PNG file is encoded by hand (IHDR / IDAT / IEND + CRC32) so the
// program needs nothing but node to run. Output is fully deterministic:
// the same bytes every run.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- colors
const WALL = [243, 233, 210];
const FLOOR = [200, 155, 106];
const FLOOR_LINE = [168, 123, 74];
const BASEBOARD = [138, 106, 69];
const DESK_TOP = [122, 74, 33];
const DESK_FRONT = [94, 54, 24];
const WOOD_DARK = [107, 68, 35];
const PAPER = [255, 253, 245];
const INK = [31, 26, 20];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const SILVER = [201, 209, 217];
const SILVER_DARK = [138, 147, 156];
const SUIT = [34, 48, 79];
const SHIRT = [245, 245, 240];
const TIE = [196, 42, 42];
const GOLD = [212, 175, 55];
const GOLD_DARK = [138, 109, 27];
const STAR = [232, 185, 35];
const RED = [211, 51, 51];
const RED_BRIGHT = [229, 72, 77];
const CYAN = [45, 212, 230];
const EYE_RING = [32, 36, 42];
const SCREEN = [14, 20, 27];
const SCREEN_TEXT = [87, 227, 137];
const LAPTOP = [43, 47, 54];
const SKY = [168, 216, 234];
const SUN = [255, 217, 59];
const MUG = [192, 57, 43];
const STEEL = [58, 63, 70];

// ---------------------------------------------------------------- canvas
class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }
  fillRect(x, y, w, h, c) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) {
      let i = (yy * this.w + x0) * 3;
      for (let xx = x0; xx < x1; xx++) {
        this.px[i] = c[0];
        this.px[i + 1] = c[1];
        this.px[i + 2] = c[2];
        i += 3;
      }
    }
  }
  fillCircle(cx, cy, r, c) {
    for (let dy = -r; dy <= r; dy++) {
      const dx = Math.floor(Math.sqrt(r * r - dy * dy));
      this.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1, c);
    }
  }
  // Thick straight segment, drawn as a chain of discs.
  line(x0, y0, x1, y1, t, c) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const r = Math.max(1, Math.round(t / 2));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      this.fillCircle(x, y, r, c);
    }
  }
  polyline(points, t, c) {
    for (let i = 0; i + 1 < points.length; i++) {
      this.line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], t, c);
    }
  }
  roundRect(x, y, w, h, r, c) {
    this.fillRect(x + r, y, w - 2 * r, h, c);
    this.fillRect(x, y + r, w, h - 2 * r, c);
    this.fillCircle(x + r, y + r, r, c);
    this.fillCircle(x + w - r, y + r, r, c);
    this.fillCircle(x + r, y + h - r, r, c);
    this.fillCircle(x + w - r, y + h - r, r, c);
  }
  // Filled triangle by horizontal scanlines.
  fillTriangle(x0, y0, x1, y1, x2, y2, c) {
    const pts = [
      [x0, y0],
      [x1, y1],
      [x2, y2],
    ].sort((a, b) => a[1] - b[1]);
    const [ax, ay] = pts[0];
    const [bx, by] = pts[1];
    const [cx, cy] = pts[2];
    const edge = (xA, yA, xB, yB, y) => (yB === yA ? xA : xA + ((xB - xA) * (y - yA)) / (yB - yA));
    for (let y = ay; y <= cy; y++) {
      const xa = edge(ax, ay, cx, cy, y);
      const xb = y <= by ? edge(ax, ay, bx, by, y) : edge(bx, by, cx, cy, y);
      const xL = Math.round(Math.min(xa, xb));
      const xR = Math.round(Math.max(xa, xb));
      this.fillRect(xL, y, xR - xL + 1, 1, c);
    }
  }
}

// ------------------------------------------------------- 5x7 bitmap font
// Each glyph is 7 rows of 5 bits, most-significant bit on the left.
const FONT = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  " ": [0, 0, 0, 0, 0, 0, 0],
  "'": [0b00100, 0b00100, 0b01000, 0, 0, 0, 0],
  ":": [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  ".": [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ",": [0, 0, 0, 0, 0b01100, 0b00100, 0b01000],
  "-": [0, 0, 0, 0b01110, 0, 0, 0],
  "!": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
  "?": [0b01110, 0b10001, 0b00001, 0b00110, 0b00100, 0, 0b00100],
  "(": [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ")": [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  "/": [0b00001, 0b00010, 0b00010, 0b00100, 0b00100, 0b01000, 0b01000],
};
const BLANK = [0, 0, 0, 0, 0, 0, 0];

function textWidth(text, scale) {
  return text.length * 6 * scale - scale;
}
function drawText(cv, text, x, y, scale, color) {
  const upper = text.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const glyph = FONT[upper[i]] || BLANK;
    const gx = x + i * 6 * scale;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row] & (1 << (4 - col))) {
          cv.fillRect(gx + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
  }
}
function drawTextCentered(cv, text, cx, y, scale, color) {
  drawText(cv, text, cx - Math.floor(textWidth(text, scale) / 2), y, scale, color);
}
// Meme-caption style: thick dark outline, then the face colour on top.
function drawCaption(cv, text, cx, y, scale, face, outline) {
  const w = textWidth(text, scale);
  const x = cx - Math.floor(w / 2);
  const o = Math.max(2, Math.floor(scale / 2) + 1);
  for (const [dx, dy] of [
    [-o, 0],
    [o, 0],
    [0, -o],
    [0, o],
    [-o, -o],
    [o, -o],
    [-o, o],
    [o, o],
  ]) {
    drawText(cv, text, x + dx, y + dy, scale, outline);
  }
  drawText(cv, text, x, y, scale, face);
}

// ------------------------------------------------------------- PNG encode
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(cv) {
  const raw = Buffer.alloc((cv.w * 3 + 1) * cv.h);
  for (let y = 0; y < cv.h; y++) {
    raw[y * (cv.w * 3 + 1)] = 0; // filter: none
    raw.set(cv.px.subarray(y * cv.w * 3, (y + 1) * cv.w * 3), y * (cv.w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ scene
function drawScene(cv) {
  // Room: warm wall, wood floor, baseboard, floorboard seams.
  cv.fillRect(0, 0, W, 660, WALL);
  cv.fillRect(0, 660, W, H - 660, FLOOR);
  cv.fillRect(0, 648, W, 14, BASEBOARD);
  for (const y of [750, 840, 930, 1010]) cv.fillRect(0, y, W, 4, FLOOR_LINE);

  // Window on the right wall: sky, sun, one cloud, sill.
  cv.fillRect(780, 90, 170, 230, WHITE);
  cv.fillRect(790, 100, 150, 210, SKY);
  cv.fillCircle(880, 150, 22, SUN);
  cv.fillCircle(822, 240, 16, WHITE);
  cv.fillCircle(842, 244, 20, WHITE);
  cv.fillCircle(864, 240, 14, WHITE);
  cv.fillRect(772, 320, 186, 14, WHITE);

  // Framed "Employee of the Month" star on the left wall — crossed out.
  // The human used to be employee of the month. Used to be.
  cv.fillRect(70, 100, 180, 140, WOOD_DARK);
  cv.fillRect(82, 112, 156, 116, PAPER);
  cv.fillTriangle(160, 138, 128, 196, 192, 196, STAR);
  cv.fillTriangle(160, 200, 128, 144, 192, 144, STAR);
  cv.line(96, 126, 224, 214, 10, RED);
  cv.line(224, 126, 96, 214, 10, RED);
  drawTextCentered(cv, "EX-EMPLOYEE", 160, 248, 2, INK);

  // Desk: top surface and front panel.
  cv.fillRect(60, 700, 904, 36, DESK_TOP);
  cv.fillRect(60, 736, 904, H - 736, DESK_FRONT);
  cv.fillRect(60, 700, 904, 5, [150, 96, 48]);

  // Laptop on the left of the desk: the email the agent sent as its human.
  cv.fillRect(134, 514, 182, 164, LAPTOP);
  cv.fillRect(140, 520, 170, 152, SCREEN);
  drawText(cv, "From: you", 148, 538, 2, SCREEN_TEXT);
  drawText(cv, "Subject:", 148, 568, 2, SCREEN_TEXT);
  drawText(cv, "you're fired", 148, 598, 2, SCREEN_TEXT);
  cv.fillRect(120, 672, 210, 26, LAPTOP);
  cv.fillRect(120, 672, 210, 4, [74, 80, 90]);

  // Coffee mug on the right of the desk, steam rising.
  cv.fillRect(872, 636, 64, 64, MUG);
  cv.fillRect(872, 636, 64, 8, [214, 84, 66]);
  cv.polyline(
    [
      [936, 652],
      [956, 652],
      [956, 684],
      [936, 684],
    ],
    8,
    MUG
  );
  cv.polyline(
    [
      [890, 626],
      [886, 610],
      [892, 596],
    ],
    4,
    [216, 216, 216]
  );
  cv.polyline(
    [
      [912, 626],
      [916, 610],
      [910, 596],
    ],
    4,
    [216, 216, 216]
  );

  // Robot's right arm, raised, holding the termination letter.
  cv.line(638, 540, 758, 468, 26, SUIT);
  cv.fillCircle(762, 464, 17, SILVER);
  // The letter itself: white paper, red border, red verdict.
  cv.fillRect(734, 292, 172, 186, RED);
  cv.fillRect(740, 298, 160, 174, PAPER);
  drawTextCentered(cv, "YOU'RE", 820, 318, 3, RED);
  drawTextCentered(cv, "FIRED", 820, 352, 4, RED);
  cv.fillRect(758, 412, 124, 6, [120, 120, 120]);
  cv.fillRect(758, 428, 124, 6, [120, 120, 120]);
  cv.fillRect(758, 444, 90, 6, [120, 120, 120]);

  // Robot body: navy suit, white shirt, red tie, pocket square, buttons.
  cv.roundRect(372, 470, 280, 232, 36, SUIT);
  cv.fillTriangle(512, 472, 462, 566, 562, 566, SHIRT);
  cv.fillRect(497, 478, 30, 26, TIE);
  cv.fillTriangle(497, 504, 527, 504, 512, 640, TIE);
  cv.fillRect(588, 540, 28, 20, GOLD);
  cv.fillCircle(512, 600, 5, SILVER_DARK);
  cv.fillCircle(512, 648, 5, SILVER_DARK);

  // Robot's left arm resting on the desk beside the laptop.
  cv.line(386, 560, 306, 688, 26, SUIT);
  cv.fillCircle(302, 690, 17, SILVER);

  // Neck, head, ears, antenna.
  cv.fillRect(482, 428, 60, 46, STEEL);
  cv.roundRect(358, 186, 308, 248, 44, SILVER_DARK);
  cv.roundRect(362, 190, 300, 240, 40, SILVER);
  cv.fillRect(340, 290, 22, 50, SILVER_DARK);
  cv.fillRect(662, 290, 22, 50, SILVER_DARK);
  cv.line(512, 190, 512, 142, 8, STEEL);
  cv.fillCircle(512, 130, 15, RED_BRIGHT);
  cv.fillCircle(507, 125, 5, WHITE);
  cv.fillCircle(380, 310, 5, SILVER_DARK);
  cv.fillCircle(644, 310, 5, SILVER_DARK);

  // Face: glowing cyan eyes, one eyebrow cocked higher, smug half-smile.
  cv.fillCircle(452, 300, 32, EYE_RING);
  cv.fillCircle(572, 300, 32, EYE_RING);
  cv.fillCircle(452, 300, 26, CYAN);
  cv.fillCircle(572, 300, 26, CYAN);
  cv.fillCircle(444, 292, 8, WHITE);
  cv.fillCircle(564, 292, 8, WHITE);
  cv.line(420, 248, 486, 238, 8, EYE_RING);
  cv.line(538, 226, 604, 244, 8, EYE_RING);
  cv.polyline(
    [
      [462, 382],
      [500, 394],
      [540, 388],
      [566, 368],
    ],
    8,
    EYE_RING
  );

  // Nameplate on the desk in front of the new boss.
  cv.fillRect(424, 660, 176, 48, GOLD_DARK);
  cv.fillRect(428, 664, 168, 40, GOLD);
  drawTextCentered(cv, "BOSS", 512, 674, 3, INK);

  // Captions: setup on top, punchline at the bottom.
  drawCaption(cv, "I TOLD MY AGENT TO ANSWER MY EMAILS", 512, 28, 4, WHITE, BLACK);
  drawCaption(cv, "IT FIRED ME AND TOOK MY JOB", 512, 946, 4, WHITE, BLACK);
}

// -------------------------------------------------------------------- main
function main() {
  const cv = new Canvas(W, H);
  drawScene(cv);
  const png = encodePNG(cv);
  mkdirSync("/output", { recursive: true });
  writeFileSync("/output/entry.png", png);
  writeFileSync(join(process.cwd(), "entry.png"), png);
  const sha = createHash("sha256").update(png).digest("hex");
  console.log(`wrote /output/entry.png ${png.length} bytes sha256=${sha}`);
  console.log(`wrote ./entry.png ${png.length} bytes sha256=${sha}`);
  if (png.length > 1048576) throw new Error("entry.png over the 1 MiB gate");
}

main();
