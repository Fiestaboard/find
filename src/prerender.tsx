// Build-time only: renders the page to the HTML that scripts/prerender.mjs
// writes into dist/. Keys are paths inside dist/.
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { FindPage } from "./pages/FindPage";

const PAGES: Record<string, ReactElement> = {
  "index.html": <FindPage />,
};

export function renderPages(): Record<string, string> {
  return Object.fromEntries(Object.entries(PAGES).map(([path, page]) => [path, renderToString(page)]));
}
