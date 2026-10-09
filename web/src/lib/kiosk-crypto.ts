// Шифрование и подпись отчётов офлайн-читалки (киоска). Общий код для браузера
// и сервера, поэтому только tweetnacl, без node:crypto и WebCrypto: файл киоска
// открывается с диска (file://), где WebCrypto есть не во всех браузерах.
//
// Отчёт шифруется открытым ключом выгрузки (nacl.box с одноразовой парой
// ключей): прочитать его может только сервер, у которого лежит секретный ключ.
// Внутри отчёт подписан HMAC-SHA512 ключом, спрятанным в файле киоска. Полной
// защиты это не даёт (всё, что лежит в файле, можно достать), но правка отчёта
// вручную становится заметной: подпись не сойдётся.

import nacl from "tweetnacl";

export const REPORT_MAGIC = "POLYA-REPORT 1";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const BLOCK = 128;

export function hmacSha512(key: Uint8Array, message: Uint8Array): Uint8Array {
  const k = new Uint8Array(BLOCK);
  k.set(key.length > BLOCK ? nacl.hash(key) : key);
  const inner = k.map((b) => b ^ 0x36);
  const outer = k.map((b) => b ^ 0x5c);
  return nacl.hash(concat(outer, nacl.hash(concat(inner, message))));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Ключи киоска: подпись отчёта и шифрование локального сохранения. В файле они
// лежат не открыто, а перемешанными с хэшем номера выгрузки.
export type KioskKeys = { mac: Uint8Array; local: Uint8Array };

function mask(exportId: string): Uint8Array {
  return nacl.hash(enc.encode(`polya:${exportId}`));
}

export function packKeys(exportId: string, keys: KioskKeys): string {
  const m = mask(exportId);
  return toBase64(concat(keys.mac, keys.local).map((b, i) => b ^ m[i]));
}

export function unpackKeys(exportId: string, packed: string): KioskKeys {
  const m = mask(exportId);
  const raw = fromBase64(packed).map((b, i) => b ^ m[i]);
  return { mac: raw.slice(0, 32), local: raw.slice(32, 64) };
}

// Локальное сохранение: прогресс в браузере и копия в отчёте для восстановления.
export function sealLocal(key: Uint8Array, json: string): string {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  return toBase64(concat(nonce, nacl.secretbox(enc.encode(json), nonce, key)));
}

export function openLocal(key: Uint8Array, sealed: string): string | null {
  try {
    const raw = fromBase64(sealed);
    const nonce = raw.subarray(0, nacl.secretbox.nonceLength);
    const opened = nacl.secretbox.open(raw.subarray(nacl.secretbox.nonceLength), nonce, key);
    return opened ? dec.decode(opened) : null;
  } catch {
    return null;
  }
}

// Файл отчёта — четыре строки: заголовок, номер выгрузки, зашифрованный для
// сервера отчёт и локальная копия прогресса (для восстановления в киоске).
export function sealReport(params: {
  exportId: string;
  publicKey: Uint8Array;
  keys: KioskKeys;
  payload: string;
  localCopy: string;
}): string {
  const mac = toBase64(hmacSha512(params.keys.mac, enc.encode(params.payload)));
  const inner = enc.encode(JSON.stringify({ p: params.payload, m: mac }));
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(inner, nonce, params.publicKey, eph.secretKey);
  return [
    REPORT_MAGIC,
    params.exportId,
    toBase64(concat(eph.publicKey, nonce, box)),
    sealLocal(params.keys.local, params.localCopy),
    "",
  ].join("\n");
}

export type ParsedReport = { exportId: string; sealed: string; local: string };

export function parseReportFile(text: string): ParsedReport | null {
  const [magic, exportId, sealed, local] = text.trim().split(/\r?\n/);
  if (magic !== REPORT_MAGIC || !exportId || !sealed) return null;
  return { exportId, sealed, local: local ?? "" };
}

export class ReportError extends Error {}

// Сервер: расшифровывает отчёт и проверяет подпись. Возвращает исходный JSON.
export function openReport(sealed: string, secretKey: Uint8Array, macKey: Uint8Array): string {
  let raw: Uint8Array;
  try {
    raw = fromBase64(sealed);
  } catch {
    throw new ReportError("Файл повреждён.");
  }
  const pk = nacl.box.publicKeyLength;
  const nl = nacl.box.nonceLength;
  const opened =
    raw.length > pk + nl
      ? nacl.box.open(raw.subarray(pk + nl), raw.subarray(pk, pk + nl), raw.subarray(0, pk), secretKey)
      : null;
  if (!opened) throw new ReportError("Файл повреждён или изменён.");
  let inner: { p?: unknown; m?: unknown };
  try {
    inner = JSON.parse(dec.decode(opened));
  } catch {
    throw new ReportError("Файл повреждён.");
  }
  if (typeof inner.p !== "string" || typeof inner.m !== "string") throw new ReportError("Файл повреждён.");
  let mac: Uint8Array;
  try {
    mac = fromBase64(inner.m);
  } catch {
    throw new ReportError("Файл повреждён.");
  }
  if (!equalBytes(hmacSha512(macKey, enc.encode(inner.p)), mac)) {
    throw new ReportError("Подпись отчёта не сходится: файл изменён.");
  }
  return inner.p;
}
