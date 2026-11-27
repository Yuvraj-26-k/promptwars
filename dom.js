export function get(id) {
  return document.getElementById(id);
}

export function setText(id, value) {
  const element = get(id);
  if (element) element.textContent = value;
}

export function showDialog(dialog, control) {
  if (dialog && !dialog.open) dialog.showModal();
  control?.focus();
}

export function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function svgElement(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}
