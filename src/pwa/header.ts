// Shared contextual header (from ui-examples comp): Back pill on the left,
// centered title, gear on the right. Each slot is optional.

const CHEVRON_LEFT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

const GEAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

export interface HeaderHandle {
  el: HTMLElement;
  setTitle: (t: string) => void;
}

export function renderHeader(opts: {
  title: string;
  onBack?: () => void;
  onGear?: () => void;
}): HeaderHandle {
  document.title = opts.title === 'drivenvibe' ? 'drivenvibe' : `${opts.title} · drivenvibe`;
  const header = document.createElement('header');
  header.className = 'dnv-header';

  const left = document.createElement('div');
  left.className = 'dnv-header-l';
  if (opts.onBack) {
    const back = document.createElement('button');
    back.className = 'dnv-back';
    back.innerHTML = CHEVRON_LEFT;
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
    gear.innerHTML = GEAR;
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
