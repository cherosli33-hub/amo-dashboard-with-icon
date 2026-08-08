import { COLLECTIONS } from "../../shared/firebase/database.js";
export default { id:"phc", label:"PHC", collection:COLLECTIONS.phc, columns:[
  ["date","Tarikh"],["time","Masa"],["bag","Beg"],["shift","Syif"],["ppp","PPP"],["notes","Catatan"],["verified","Disahkan"],["verifiedBy","Penyelia"]
] };
