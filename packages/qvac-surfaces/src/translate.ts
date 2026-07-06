/**
 * Terrace translate — 32 nations, one swarm, everyone reads their own language.
 *
 * Every chat message carries its author's `lang`; each peer renders every
 * message in the viewer's language via on-device translation. Nothing leaves
 * the device. Pure routing (what needs translating) is tested here; the model
 * call is behind an adapter with a fake for tests and the scripted demo.
 */
export interface Translator {
  translate(text: string, from: string, to: string): Promise<string>;
}

/** Obvious stub so tests assert routing, not translation quality. */
export class FakeTranslator implements Translator {
  async translate(text: string, _from: string, to: string): Promise<string> {
    return `[${to}] ${text}`;
  }
}

export interface ChatLine {
  readonly text: string;
  readonly lang: string;
}

/** A message needs translating only when its language differs from the viewer's. */
export function needsTranslation(line: ChatLine, viewerLang: string): boolean {
  return line.lang !== viewerLang;
}

/** Render a chat line in the viewer's language (no-op if already matching). */
export async function renderForViewer(
  line: ChatLine,
  viewerLang: string,
  translator: Translator,
): Promise<string> {
  if (!needsTranslation(line, viewerLang)) return line.text;
  return translator.translate(line.text, line.lang, viewerLang);
}
