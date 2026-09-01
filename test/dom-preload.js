// happy-dom environment preload for `bun test`.
// Bun's test runner has no built-in DOM environment, so we install a
// happy-dom window/document before tests load.
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
const document = window.document;
document.body.innerHTML = '<div id="root"></div>';

globalThis.window = window;
globalThis.document = document;
globalThis.navigator = window.navigator;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
