import { COLLECTIONS } from "../../shared/firebase/database.js";

export default {
  id: "supervisor-audit",
  label: "Jejak Audit",
  shortLabel: "AUDIT",
  collection: COLLECTIONS.actionAudit,
  columns: [
    ["actedAt", "Tarikh / masa"],
    ["sourceModule", "Modul"],
    ["sourceTitle", "Rekod"],
    ["actionLabel", "Tindakan"],
    ["actorName", "Oleh"],
    ["actorEmail", "E-mel"],
    ["sourceDetail", "Butiran"]
  ]
};
