import { COLLECTIONS } from "../../shared/firebase/database.js";
export default { id:"phc-findings", label:"Penemuan PHC", shortLabel:"PHC", collection:COLLECTIONS.phcFindings, finding:true, columns:[
  ["date","Tarikh"],["bagShift","Beg / Syif"],["type","Jenis"],["item","Item"],["qty","Baki"],["standard","Standard"],["note","Catatan"],["status","Status"],["action","Tindakan"]
] };
