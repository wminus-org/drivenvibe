// The one place UI chrome icons come from: Font Awesome Free (SVG core, named
// imports so only these glyphs are bundled). The FA stylesheet is imported once
// here and autoAddCss is off, so nothing injects a <style> at runtime.
import { config, icon, type IconDefinition } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';

config.autoAddCss = false;

export {
  faChevronLeft, faChevronRight, faChevronDown, faGear, faFolder, faTerminal, faPlus,
  faEllipsis, faDownload, faMicrophone, faStop, faCircleNotch, faPaperPlane, faVolumeHigh,
  faTrashCan, faKeyboard, faTriangleExclamation, faCircleInfo, faCircleCheck,
} from '@fortawesome/free-solid-svg-icons';

/** Decorative SVG markup (FA sets aria-hidden="true"); the owning control carries the label. */
export function iconHtml(def: IconDefinition): string {
  return icon(def).html.join('');
}
