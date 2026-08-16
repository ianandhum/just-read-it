export function createSvg(doc: Document, paths: string, attributes: Record<string, string>): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  const source = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${paths}</svg>`, 'image/svg+xml');
  for (const child of Array.from(source.documentElement.children)) svg.append(doc.importNode(child, true));
  return svg;
}
