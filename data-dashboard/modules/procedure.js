import { COLLECTIONS } from "../../shared/firebase/database.js";
export default { id:"procedure", label:"Prosedur", collection:COLLECTIONS.procedure, columns:[
  ["date","Tarikh"],["time","Masa"],["shift","Syif"],["zone","Zon"],["registrationNumber","ID Pesakit"],["procedures","Prosedur"]
] };
