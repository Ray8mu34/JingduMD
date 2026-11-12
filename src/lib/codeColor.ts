// Extend the grammar's output, never the raw HTML source. Strings, comments and
// existing tokens remain opaque; only unclassified code receives extra marks.
export function enrichCodeColors(html: string, language?: string): string {
  if (!/^(python|py|gyp|javascript|js|jsx|typescript|ts|tsx)$/.test(language ?? "") || html.length > 500_000) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const stack: { character: string; element: HTMLElement; depth: number }[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (const node of nodes) {
    let parent = node.parentElement;
    let opaque = false;
    while (parent) {
      if ([...parent.classList].some(name => name.startsWith("hljs-") && !["hljs-params", "hljs-function", "hljs-subst"].includes(name))) opaque = true;
      parent = parent.parentElement;
    }
    if (opaque) continue;
    const text = node.data;
    const fragment = document.createDocumentFragment();
    const pattern = /[\p{L}_$][\p{L}\p{N}_$]*\b(?=\s*\()|[()[\]{}]|(?:\*\*|\/\/|===|!==|==|!=|<=|>=|:=|=>|<<|>>|&&|\|\||\?\?|[+*/%=<>!&|^~:@-])=?/gu;
    let end = 0;
    for (const match of text.matchAll(pattern)) {
      fragment.append(text.slice(end, match.index));
      const token = match[0];
      const element = document.createElement("span");
      element.textContent = token;
      if ("([{".includes(token) && token.length === 1) {
        stack.push({ character: token, element, depth: stack.length });
      } else if (pairs[token]) {
        const open = stack[stack.length - 1];
        if (open?.character === pairs[token]) {
          stack.pop();
          element.className = open.element.className = `code-bracket-${open.depth % 3}`;
        } else {
          // A malformed pair must not shift colors for the rest of the block.
          stack.length = 0;
        }
      } else {
        element.className = /^[\p{L}_$]/u.test(token) ? "code-call" : "code-operator";
      }
      fragment.append(element);
      end = match.index! + token.length;
    }
    fragment.append(text.slice(end));
    node.replaceWith(fragment);
  }
  return template.innerHTML;
}
