/** On-device text recognition (ML Kit, bundled Latin model). Needs the native module, so it only works in the installed app. */
import { Platform } from 'react-native';

import type { OcrResult } from './prepare';

export async function recognizeImage(uri: string): Promise<{ ok: true; result: OcrResult } | { ok: false; error: 'unavailable' | 'failed' }> {
  if (Platform.OS !== 'android') return { ok: false, error: 'unavailable' };
  try {
    const mod = await import('@react-native-ml-kit/text-recognition');
    const r = await mod.default.recognize(uri);
    return { ok: true, result: { text: r.text, blocks: r.blocks.map((b) => ({ text: b.text, frame: b.frame, lines: b.lines.map((l) => ({ text: l.text, frame: l.frame })) })) } };
  } catch (e) {
    return { ok: false, error: /linked|NativeModules|not.*function/i.test(String(e)) ? 'unavailable' : 'failed' };
  }
}
