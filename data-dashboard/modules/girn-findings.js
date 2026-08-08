import { COLLECTIONS } from "../../shared/firebase/database.js";
export default { id:"girn-findings", label:"Penemuan GIRN", shortLabel:"GIRN", collection:COLLECTIONS.girnFindings, finding:true, columns:[
  ["date","Tarikh"],["shift","Syif"],["device","Peralatan"],["inspectionStatus","Status alat"],["note","Catatan"],["reporter","Pelapor"],["state","Status tindakan"],["acknowledgedBy","Diambil maklum oleh"],["action","Tindakan"]
] };
