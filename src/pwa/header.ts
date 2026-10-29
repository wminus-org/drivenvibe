// Shared contextual header (from ui-examples comp): Back pill on the left,
// centered title, gear on the right. Each slot is optional. `large` puts the
// title under the bar as an iOS large title (top-level screens).

import { iconHtml, faChevronLeft, faGear } from './icons.js';

export interface HeaderHandle {
  el: HTMLElement;
  setTitle: (t: string) => void;
}

export function renderHeader(opts: {
  title: string;
  onBack?: () => void;
  onGear?: () => void;
  large?: boolean;
}): HeaderHandle {
  document.title = opts.title === 'drivenvibe' ? 'drivenvibe' : `${opts.title} · drivenvibe`;
  const header = document.createElement('header');
  header.className = opts.large ? 'dnv-header dnv-header-large' : 'dnv-header';

  const left = document.createElement('div');
  left.className = 'dnv-header-l';
  if (opts.onBack) {
    const back = document.createElement('button');
    back.className = 'dnv-back';
    back.innerHTML = iconHtml(faChevronLeft);
    back.appendChild(document.createTextNode('Back'));
    back.setAttribute('aria-label', 'Back');
    back.addEventListener('click', () => opts.onBack!());
    left.appendChild(back);
  }

  const center = document.createElement('h1');
  center.className = 'dnv-header-c';
  center.textContent = opts.title;

  const right = document.createElement('div');
  right.className = 'dnv-header-r';
  if (opts.onGear) {
    const gear = document.createElement('button');
    gear.className = 'dnv-iconbtn';
    gear.innerHTML = iconHtml(faGear);
    gear.setAttribute('aria-label', 'Settings');
    gear.addEventListener('click', () => opts.onGear!());
    right.appendChild(gear);
  }

  header.append(left, center, right);

  return {
    el: header,
    setTitle: (t) => {
      center.textContent = t;
      document.title = `${t} · drivenvibe`;
    },
  };
}
