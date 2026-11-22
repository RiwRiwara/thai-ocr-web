// Port of runtime/thai_norm.py (OpenThai 2.1 OCR Text, Apache-2.0, iApp Technology), modified for JavaScript.
// One canonical form for Thai text; see the original for the rationale of every rule.

const PUA = {
  0xf700: 0x0e10, 0xf701: 0x0e34, 0xf702: 0x0e35, 0xf703: 0x0e36, 0xf704: 0x0e37,
  0xf705: 0x0e48, 0xf706: 0x0e49, 0xf707: 0x0e4a, 0xf708: 0x0e4b, 0xf709: 0x0e4c,
  0xf70a: 0x0e48, 0xf70b: 0x0e49, 0xf70c: 0x0e4a, 0xf70d: 0x0e4b, 0xf70e: 0x0e4c,
  0xf70f: 0x0e0d, 0xf710: 0x0e31, 0xf711: 0x0e4d, 0xf712: 0x0e47, 0xf713: 0x0e48,
  0xf714: 0x0e49, 0xf715: 0x0e4a, 0xf716: 0x0e4b, 0xf717: 0x0e4c, 0xf718: 0x0e38,
  0xf719: 0x0e39, 0xf71a: 0x0e3a,
};
const DROP = new Set(["​", "‌", "‍", "⁠", "­", "﻿"]);

const VOWEL_MARKS = new Set("ัิีึืฺุู็");
const TONE_MARKS = new Set("่้๊๋์๎");
const NIKHAHIT = "ํ";
const MARKS = new Set([...VOWEL_MARKS, ...TONE_MARKS, NIKHAHIT]);
const MARK_RUN = new RegExp("[" + [...MARKS].sort().join("") + "]{2,}", "gu");
const SARA_AM = /([่-๋]?)ํ([่-๋]?)า/gu;
const SPACES = /[ \t\f\v]+/g;

function translate(text) {
  let out = "";
  for (const ch of text) {
    if (DROP.has(ch)) continue;
    const cp = ch.codePointAt(0);
    if (cp === 0xa0) out += " ";
    else if (PUA[cp] !== undefined) out += String.fromCodePoint(PUA[cp]);
    else out += ch;
  }
  return out;
}

function rank(c) {
  return VOWEL_MARKS.has(c) ? 0 : TONE_MARKS.has(c) ? 1 : 2;
}

function order(run) {
  const sorted = [...run].sort((a, b) => rank(a) - rank(b)); // Array.sort is stable, as Python's sorted
  const out = [];
  for (const ch of sorted) if (!out.length || out[out.length - 1] !== ch) out.push(ch);
  return out.join("");
}

export function canonical(text) {
  text = translate(text || "").normalize("NFC");
  text = text.replace(MARK_RUN, order);
  text = text.replace(SARA_AM, (_, a, b) => a + b + "ำ");
  text = text.split("เเ").join("แ").split("ำำ").join("ำ");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return text.split("\n").map((l) => l.replace(SPACES, " ").trim()).join("\n").trim();
}
