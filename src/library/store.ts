/**
 * LibraryStore — библиотека мелодий (SPEC §4.5).
 * Встроенные мелодии собираются из builtin-data в памяти; загруженные
 * пользователем хранятся в IndexedDB (сырой файл + разобранная Melody),
 * их метаданные и лучшие попытки — в localStorage (инвариант SPEC:
 * «IndexedDB (файлы) + метаданные localStorage»).
 *
 * Слой выше (плеер, UI) знает только этот API: list/get/addUserFile/
 * remove/setBest + ready(). Форматы файлов сюда не проникают.
 */
import type { Melody } from "../core/types";
import { buildBuiltinMelody } from "../import/builtin";
import { parseMidi } from "../import/midi";
import { ImportError } from "../import/shared";
import { parseMusicXml } from "../import/musicxml";
import { BUILTIN_SPECS } from "./builtin-data";

/** Источник мелодии в библиотеке. */
export type MelodySource = "builtin" | "user";

/** Запись библиотеки: то, что показывает список (без нот). */
export interface MelodyMeta {
  id: string;
  title: string;
  composer: string;
  source: MelodySource;
  /** Общая длительность в секундах (при множителе 1.0). */
  durationSec: number;
  /** Лучшая попытка: процент попаданий 0–100 (SPEC §4.7). */
  bestScore?: number;
}

/** Дата добавления пользовательской мелодии (для сортировки списка). */
interface UserMeta extends MelodyMeta {
  addedAt: number;
}

/** Запись в IndexedDB: сырой файл для повторного разбора + готовая Melody. */
interface StoredUserMelody {
  id: string;
  title: string;
  composer: string;
  addedAt: number;
  buffer: ArrayBuffer;
  melody: Melody;
}

const DB_NAME = "piano-library";
const DB_VERSION = 1;
const STORE_NAME = "melodies";
const LS_USER_META = "piano.library.userMeta";
const LS_BEST_SCORES = "piano.library.bestScores";

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Квота/приватный режим: счёт и список потеряются, играть можно.
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB недоступен"));
  });
}

function idbGetAll(): Promise<StoredUserMelody[]> {
  return new Promise((resolve, reject) => {
    const request = openDb();
    request.then((db) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as StoredUserMelody[]);
      req.onerror = () => reject(req.error ?? new Error("Ошибка чтения библиотеки"));
    }).catch(reject);
  });
}

function idbPut(record: StoredUserMelody): Promise<void> {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Ошибка записи в библиотеку"));
    }).catch(reject);
  });
}

function idbDelete(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Ошибка удаления из библиотеки"));
    }).catch(reject);
  });
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export class LibraryStore {
  #melodies = new Map<string, Melody>();
  #meta = new Map<string, MelodyMeta>();
  #bestScores = new Map<string, number>(Object.entries(readJson<Record<string, number>>(LS_BEST_SCORES, {})));
  #readyPromise: Promise<void>;

  constructor() {
    for (const spec of BUILTIN_SPECS) {
      const melody = buildBuiltinMelody(spec);
      this.#melodies.set(melody.id, melody);
      this.#meta.set(melody.id, {
        id: melody.id,
        title: melody.title,
        composer: melody.composer,
        source: "builtin",
        durationSec: melody.durationSec,
      });
    }
    for (const userMeta of readJson<UserMeta[]>(LS_USER_META, [])) {
      this.#meta.set(userMeta.id, userMeta);
    }
    this.#readyPromise = this.#loadUserMelodies().catch((error: unknown) => {
      // Хранилище недоступно (приватный режим и т.п.): сессия работает в памяти.
      console.error("Библиотека: не удалось прочитать хранилище", error);
    });
  }

  /** Promise загрузки пользовательских мелодий из IndexedDB; после него list/get полны. */
  ready(): Promise<void> {
    return this.#readyPromise;
  }

  /** Все записи библиотеки: сначала встроенные, затем пользовательские по дате. */
  list(): MelodyMeta[] {
    const builtin: MelodyMeta[] = [];
    const user: UserMeta[] = [];
    for (const meta of this.#meta.values()) {
      if (meta.source === "builtin") builtin.push(this.withBestScore(meta));
      else user.push(meta as UserMeta);
    }
    user.sort((a, b) => b.addedAt - a.addedAt);
    return [...builtin, ...user.map((meta) => this.withBestScore(meta))];
  }

  /** Мелодия по id (например, из list()); бросает, если id неизвестен. */
  get(id: string): Melody {
    const melody = this.#melodies.get(id);
    if (!melody) throw new ImportError(`Мелодия не найдена в библиотеке: ${id}`);
    return melody;
  }

  /**
   * Добавляет файл пользователя (.mid или .musicxml/.xml): сниффинг по
   * первым байтам, разбор, сохранение. Возвращает запись для списка.
   */
  async addUserFile(file: File): Promise<MelodyMeta> {
    const buffer = await file.arrayBuffer();
    const melody = this.parseUserFile(file.name, buffer);
    const id = `user:${makeId()}`;
    melody.id = id;
    const meta: UserMeta = {
      id,
      title: melody.title,
      composer: melody.composer,
      source: "user",
      durationSec: melody.durationSec,
      addedAt: Date.now(),
    };
    if (hasIndexedDb()) {
      const record: StoredUserMelody = {
        id,
        title: meta.title,
        composer: meta.composer,
        addedAt: meta.addedAt,
        buffer,
        melody,
      };
      await idbPut(record);
    }
    this.#melodies.set(id, melody);
    this.#meta.set(id, meta);
    this.persistUserMeta();
    return this.withBestScore(meta);
  }

  /** Удаляет пользовательскую мелодию; встроенные удалять нельзя. */
  async remove(id: string): Promise<void> {
    const meta = this.#meta.get(id);
    if (!meta) throw new ImportError(`Мелодия не найдена в библиотеке: ${id}`);
    if (meta.source === "builtin") {
      throw new ImportError("Встроенную мелодию удалить нельзя.");
    }
    if (hasIndexedDb()) {
      try {
        await idbDelete(id);
      } catch (error) {
        console.error("Библиотека: не удалось удалить запись из хранилища", error);
      }
    }
    this.#melodies.delete(id);
    this.#meta.delete(id);
    this.persistUserMeta();
  }

  /** Записывает лучшую попытку (процент попаданий 0–100) для мелодии. */
  setBest(id: string, score: number): void {
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new ImportError(`Некорректный счёт: ${score} (ожидается процент 0–100).`);
    }
    if (!this.#meta.has(id)) throw new ImportError(`Мелодия не найдена в библиотеке: ${id}`);
    this.#bestScores.set(id, score);
    writeJson(LS_BEST_SCORES, Object.fromEntries(this.#bestScores));
  }

  /** Сниффинг формата по содержимому: 'MThd' → MIDI, иначе XML с корнем score-*. */
  parseUserFile(fileName: string, buffer: ArrayBuffer): Melody {
    const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    const isMidiHeader =
      head.length === 4 &&
      head[0] === 0x4d && // "M"
      head[1] === 0x54 && // "T"
      head[2] === 0x68 && // "h"
      head[3] === 0x64; // "d"
    if (isMidiHeader) {
      return parseMidi(buffer, { fallbackTitle: stripExtension(fileName) });
    }
    const decoder = new TextDecoder();
    const prefix = decoder.decode(new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength)));
    if (prefix.includes("<score-partwise") || prefix.includes("<score-timewise")) {
      return parseMusicXml(decoder.decode(buffer), { fallbackTitle: stripExtension(fileName) });
    }
    throw new ImportError("Файл не распознан: это не MIDI и не MusicXML.");
  }

  async #loadUserMelodies(): Promise<void> {
    if (!hasIndexedDb()) return;
    const records = await idbGetAll();
    for (const record of records) {
      const melody: Melody = { ...record.melody, id: record.id };
      this.#melodies.set(record.id, melody);
    }
  }

  private persistUserMeta(): void {
    const userMeta: UserMeta[] = [];
    for (const meta of this.#meta.values()) {
      if (meta.source === "user") userMeta.push(meta as UserMeta);
    }
    writeJson(LS_USER_META, userMeta);
  }

  private withBestScore(meta: MelodyMeta): MelodyMeta {
    const best = this.#bestScores.get(meta.id);
    const copy: MelodyMeta = { ...meta };
    if (best !== undefined) copy.bestScore = best;
    else delete copy.bestScore;
    return copy;
  }
}

/** Единственный экземпляр на приложение (регистрация — очередь плеера/Q4). */
export const library = new LibraryStore();
