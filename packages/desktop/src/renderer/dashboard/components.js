const NS = 'http://www.w3.org/2000/svg';
const paths = {
  spark: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6',
  check: 'M5 12l4 4L19 6',
  layers: 'M12 3L3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  sliders: 'M5 4v16M12 4v16M19 4v16M2 8h6M9 16h6M16 10h6',
};
export function icon(name = 'spark') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ui-icon');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', paths[name] || paths.spark);
  svg.append(path);
  return svg;
}
export function decorate(root) {
  for (const node of root.querySelectorAll('button'))
    if (/^(Forget|Delete|Reject|Remove|Stop all)/i.test(node.textContent.trim()))
      node.classList.add('danger-action');
  for (const card of root.querySelectorAll('.studio-detail .card')) {
    // Consecutive controls share a grid; prose and result blocks retain their reading order.
    let fields, actions;
    for (const child of [...card.children]) {
      if (child.tagName === 'LABEL') {
        actions = undefined;
        if (!fields) {
          fields = document.createElement('div');
          fields.className = 'studio-fields';
          card.insertBefore(fields, child);
        }
        if (child.querySelector('textarea')) child.classList.add('field-wide');
        fields.append(child);
      } else if (child.tagName === 'BUTTON') {
        fields = undefined;
        if (!actions) {
          actions = document.createElement('div');
          actions.className = 'studio-actions';
          card.insertBefore(actions, child);
        }
        actions.append(child);
      } else {
        fields = undefined;
        actions = undefined;
      }
    }
  }
}
function inline(parent, text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      parent.append(strong);
    } else if (part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      parent.append(code);
    } else parent.append(document.createTextNode(part));
  }
}
/** Safe, small Markdown subset: output remains DOM text, never model-provided HTML. */
export function renderContent(root, text) {
  root.replaceChildren();
  root.classList.add('rich-content');
  let code, paragraph, list;
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      paragraph = list = undefined;
      if (code) code = undefined;
      else {
        const pre = document.createElement('pre');
        code = document.createElement('code');
        pre.append(code);
        root.append(pre);
      }
      continue;
    }
    if (code) {
      code.append(document.createTextNode(line + '\n'));
      continue;
    }
    if (!line.trim()) {
      paragraph = list = undefined;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      paragraph = list = undefined;
      const h = document.createElement('h' + Math.min(heading[1].length + 1, 4));
      inline(h, heading[2]);
      root.append(h);
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      paragraph = undefined;
      if (!list) {
        list = document.createElement('ul');
        root.append(list);
      }
      const li = document.createElement('li');
      inline(li, bullet[1]);
      list.append(li);
      continue;
    }
    list = undefined;
    if (!paragraph) {
      paragraph = document.createElement('p');
      root.append(paragraph);
    } else paragraph.append(document.createElement('br'));
    inline(paragraph, line);
  }
}
