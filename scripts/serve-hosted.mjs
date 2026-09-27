import express from "express";
import state from "../api/state.mjs";
import workspace from "../api/workspace.mjs";
import audit from "../api/export.mjs";
import transaction from "../api/transaction/[signature].mjs";
import { readOnly } from "../api/_shared.mjs";
const app = express();
app.all("/api/state", state);
app.all("/api/workspace", workspace);
app.all("/api/export", audit);
app.all("/api/transaction/:signature", (req, res) =>
  transaction(
    { method: req.method, query: { signature: req.params.signature } },
    res,
  ),
);
app.post("/api/{*path}", readOnly);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Неизвестный метод API" }),
);
app.use(express.static("dist"));
app.listen(5174, "127.0.0.1", () =>
  console.log("Hosted preview http://127.0.0.1:5174"),
);
