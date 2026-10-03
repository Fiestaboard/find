import { hydrateRoot } from "react-dom/client";

import { FindPage } from "../pages/FindPage";

hydrateRoot(document.getElementById("root")!, <FindPage />);
