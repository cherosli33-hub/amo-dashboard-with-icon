import { COLLECTIONS } from "../../shared/firebase/database.js";
export default { id:"asthma", label:"Asma", collection:COLLECTIONS.asthma, columns:[
  ["date","Tarikh"],["time","Masa"],["patientType","Kategori"],["patientName","Pesakit"],["patientId","IC/RN"],["categoryBefore","Before"],["categoryAfter","After"],["uptriage","Uptriage"],["pppName","PPP"]
] };
